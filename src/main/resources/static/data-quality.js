const el = (id) => document.getElementById(id)
const API_BASE = 'https://api.geupddong.com'
const PAGE_SIZE = 20
const initialGroupKey = new URLSearchParams(window.location.search).get('groupKey')
let groups = []
let page = 0
let totalPages = 0
let totalElements = 0
let selectedGroupKey = null
let searchTimer
let kakaoMapsReady
let coordinateDraft = null
let coordinateEditorSequence = 0
let coordinateEditorState = null
let selectedToiletIds = new Set()
let activeDisplayGroupId = null
let currentGroupToilets = []

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const statusLabel = (status) => ({ PENDING: '미확인', NEEDS_CORRECTION: '보정 필요', CONFIRMED_SHARED: '실제 공동 위치' })[status] || status
const coordinate = (lat, lng) => `${Number(lat).toFixed(7)}, ${Number(lng).toFixed(7)}`
const date = (value) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-'

function detailPlaceholder() {
  return '<div class="quality-empty-panel"><span>그룹 화장실 목록</span><strong>검토할 그룹을 선택해 주세요</strong><p>그룹을 선택하면 같은 좌표에 등록된 화장실을 이 영역에서 확인할 수 있습니다.</p></div>'
}

function mapPlaceholder() {
  return '<div class="quality-empty-panel is-map"><span>좌표 보정</span><strong>지도를 사용할 화장실을 선택해 주세요</strong><p>그룹 화장실 목록의 ‘좌표 보정’을 누르면 현재 위치와 수정할 좌표가 이곳에 표시됩니다.</p></div>'
}

function resetCoordinateEditor() {
  coordinateEditorSequence += 1
  coordinateDraft = null
  if (coordinateEditorState) {
    window.clearTimeout(coordinateEditorState.mapIdleTimer)
    coordinateEditorState.toiletOverlays?.forEach(({ overlay }) => overlay.setMap(null))
    coordinateEditorState.originOverlay?.setMap(null)
    coordinateEditorState = null
  }
  const editor = el('coordinate-editor')
  editor.innerHTML = mapPlaceholder()
  document.querySelectorAll('.quality-toilet.is-editing').forEach((item) => item.classList.remove('is-editing'))
}

function showLogin(title, description) {
  el('loading-shell').hidden = true
  el('quality-shell').hidden = true
  el('auth-shell').hidden = false
  el('auth-title').textContent = title
  el('auth-description').textContent = description
}

function renderPagination() {
  const target = el('quality-pagination')
  target.replaceChildren()
  if (totalPages <= 1) return
  ;[['이전', page > 0, page - 1], [`${page + 1} / ${totalPages}`, false], ['다음', page < totalPages - 1, page + 1]].forEach(([label, enabled, targetPage], index) => {
    const node = document.createElement(index === 1 ? 'span' : 'button')
    node.textContent = label
    if (index !== 1) {
      node.type = 'button'
      node.className = 'secondary-button'
      node.disabled = !enabled
      node.addEventListener('click', () => void loadGroups(targetPage))
    }
    target.append(node)
  })
}

function renderGroups() {
  const target = el('quality-list')
  target.replaceChildren()
  el('quality-group-summary').textContent = `${totalElements.toLocaleString()}개`
  if (!groups.length) target.innerHTML = '<p class="empty-state">조건에 맞는 중복 좌표가 없습니다.</p>'
  groups.forEach((group) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `quality-list-item${selectedGroupKey === group.groupKey ? ' is-selected' : ''}`
    button.innerHTML = `<span class="quality-count">${group.toiletCount}</span><span class="quality-main"><strong>${escapeHtml(group.representativeName)}</strong><small>${escapeHtml(group.region)}</small></span><span class="quality-side"><i class="quality-state ${String(group.status).toLowerCase()}">${statusLabel(group.status)}</i>${group.pendingReportCount ? `<b>위치 제보 ${group.pendingReportCount}</b>` : ''}</span>`
    button.addEventListener('click', () => void selectGroup(group.groupKey))
    target.append(button)
  })
  renderPagination()
}

function toiletMarkup(item) {
  const displayGroup = item.displayGroupId
    ? `<button class="quality-display-group-chip" data-display-group-id="${item.displayGroupId}" type="button" title="이 그룹의 화장실 선택">${escapeHtml(item.displayGroupName)}</button>`
    : ''
  return `<article class="quality-toilet" data-toilet-row="${item.id}"><label class="quality-toilet-check"><input class="quality-toilet-selector" data-toilet-id="${item.id}" type="checkbox" aria-label="${escapeHtml(item.name || '이름 없는 화장실')} 선택" /><span aria-hidden="true"></span></label><div class="quality-toilet-main"><strong>${escapeHtml(item.name || '이름 없는 화장실')}</strong><span>ID ${item.id}</span></div>${displayGroup}<button class="secondary-button coordinate-edit" data-toilet-id="${item.id}" type="button">좌표</button></article>`
}

function groupMembers(displayGroupId) {
  return currentGroupToilets.filter((item) => Number(item.displayGroupId) === Number(displayGroupId))
}

function syncDisplayGroupComposer() {
  const selected = currentGroupToilets.filter((item) => selectedToiletIds.has(item.id))
  document.querySelectorAll('.quality-toilet-selector').forEach((checkbox) => {
    checkbox.checked = selectedToiletIds.has(Number(checkbox.dataset.toiletId))
    checkbox.closest('.quality-toilet')?.classList.toggle('is-checked', checkbox.checked)
  })
  const selectAll = el('quality-select-all')
  if (selectAll) {
    selectAll.checked = currentGroupToilets.length > 0 && selected.length === currentGroupToilets.length
    selectAll.indeterminate = selected.length > 0 && selected.length < currentGroupToilets.length
  }
  const selectionText = el('quality-selection-count')
  if (selectionText) selectionText.textContent = selected.length ? `${selected.length}개 선택` : '선택 없음'

  const groupIds = [...new Set(selected.map((item) => item.displayGroupId).filter(Boolean))]
  const exactGroup = groupIds.length === 1
    && selected.length === groupMembers(groupIds[0]).length
    && selected.every((item) => Number(item.displayGroupId) === Number(groupIds[0]))
  if (!activeDisplayGroupId && exactGroup) activeDisplayGroupId = Number(groupIds[0])
  const activeGroup = activeDisplayGroupId ? groupMembers(activeDisplayGroupId) : []
  const activeGroupName = activeGroup[0]?.displayGroupName || ''
  const nameInput = el('display-group-name')
  if (activeDisplayGroupId && nameInput && !nameInput.value && document.activeElement !== nameInput) nameInput.value = activeGroupName
  const saveButton = el('save-display-group')
  if (saveButton) {
    saveButton.disabled = selected.length < 2 || !nameInput?.value.trim()
    saveButton.textContent = activeDisplayGroupId ? '그룹 수정' : '그룹 지정'
  }
  const deleteButton = el('delete-display-group')
  if (deleteButton) deleteButton.hidden = !activeDisplayGroupId
  const hint = el('display-group-hint')
  if (hint) hint.textContent = activeDisplayGroupId
    ? `‘${activeGroupName}’ 그룹의 이름과 구성원을 수정할 수 있습니다.`
    : selected.length >= 2 ? '입력한 이름이 사용자 지도에 대표 이름으로 표시됩니다.' : '함께 표시할 화장실을 2개 이상 선택하세요.'
}

function bindDisplayGroupControls(group) {
  document.querySelectorAll('.quality-toilet-selector').forEach((checkbox) => checkbox.addEventListener('change', () => {
    const toiletId = Number(checkbox.dataset.toiletId)
    if (checkbox.checked) selectedToiletIds.add(toiletId)
    else selectedToiletIds.delete(toiletId)
    syncDisplayGroupComposer()
  }))
  document.querySelectorAll('.quality-display-group-chip').forEach((button) => button.addEventListener('click', () => {
    activeDisplayGroupId = Number(button.dataset.displayGroupId)
    const members = groupMembers(activeDisplayGroupId)
    selectedToiletIds = new Set(members.map((item) => item.id))
    el('display-group-name').value = members[0]?.displayGroupName || ''
    syncDisplayGroupComposer()
  }))
  el('quality-select-all').addEventListener('change', (event) => {
    selectedToiletIds = event.target.checked ? new Set(currentGroupToilets.map((item) => item.id)) : new Set()
    syncDisplayGroupComposer()
  })
  el('clear-toilet-selection').addEventListener('click', () => {
    selectedToiletIds = new Set()
    activeDisplayGroupId = null
    el('display-group-name').value = ''
    syncDisplayGroupComposer()
  })
  el('display-group-name').addEventListener('input', syncDisplayGroupComposer)
  el('save-display-group').addEventListener('click', () => void saveDisplayGroup(group))
  el('delete-display-group').addEventListener('click', () => void deleteDisplayGroup(group))
  syncDisplayGroupComposer()
}

function revisionMarkup(item, names) {
  return `<tr><td>${escapeHtml(names.get(item.toiletId) || `#${item.toiletId}`)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(coordinate(item.appliedLatitude, item.appliedLongitude))}</td><td>${escapeHtml(date(item.appliedAt))}</td></tr>`
}

async function selectGroup(groupKey) {
  selectedGroupKey = groupKey
  const url = new URL(window.location.href)
  url.searchParams.set('groupKey', groupKey)
  window.history.replaceState(null, '', url)
  resetCoordinateEditor()
  selectedToiletIds = new Set()
  activeDisplayGroupId = null
  currentGroupToilets = []
  renderGroups()
  const detail = el('quality-detail')
  detail.innerHTML = '<p class="status quality-panel-loading">그룹 화장실을 불러오는 중입니다.</p>'
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/duplicate-coordinates/${encodeURIComponent(groupKey)}`, { credentials: 'include' })
    if (!response.ok) throw new Error('중복 좌표 상세를 불러오지 못했습니다.')
    const data = await response.json()
    currentGroupToilets = data.toilets
    const names = new Map(data.toilets.map((item) => [item.id, item.name]))
    const reports = data.pendingReports.length
      ? `<section class="quality-reports"><strong>대기 중인 위치 제보 ${data.pendingReports.length}건</strong>${data.pendingReports.map((report) => `<a href="/reports.html?reportId=${report.reportId}">${escapeHtml(report.toiletName)} · ${escapeHtml(date(report.createdAt))}</a>`).join('')}</section>`
      : ''
    const revisions = data.revisions.length
      ? `<div class="quality-history-table"><table><thead><tr><th>화장실</th><th>경로</th><th>적용 좌표</th><th>적용 시각</th></tr></thead><tbody>${data.revisions.map((item) => revisionMarkup(item, names)).join('')}</tbody></table></div>`
      : '<p class="empty-state">아직 좌표 수정 이력이 없습니다.</p>'
    detail.innerHTML = `
      <header class="quality-pane-head is-detail">
        <div><span>그룹 화장실 목록</span><h2>${data.group.toiletCount}개 화장실</h2><p>${escapeHtml(coordinate(data.group.latitude, data.group.longitude))} · ${escapeHtml(data.group.region)}</p></div>
        <button id="quality-detail-close" class="icon-button" type="button" aria-label="그룹 선택 해제">×</button>
      </header>
      <section class="quality-review-box" aria-label="그룹 확인 상태">
        <select id="group-review-status"><option value="PENDING"${data.group.status === 'PENDING' ? ' selected' : ''}>미확인</option><option value="NEEDS_CORRECTION"${data.group.status === 'NEEDS_CORRECTION' ? ' selected' : ''}>보정 필요</option><option value="CONFIRMED_SHARED"${data.group.status === 'CONFIRMED_SHARED' ? ' selected' : ''}>실제 공동 위치</option></select>
        <input id="group-review-note" maxlength="500" placeholder="검토 메모(선택)" />
        <button id="save-group-review" type="button">확인 상태 저장</button>
      </section>
      ${reports}
      <section class="quality-toilets-section">
        <div class="quality-list-label"><strong>등록 화장실</strong><span>체크한 항목을 하나의 이름으로 묶을 수 있습니다.</span></div>
        <section class="quality-display-group-box" aria-label="지도 노출 그룹 지정">
          <div class="quality-selection-bar"><label><input id="quality-select-all" type="checkbox" /><span>전체 선택</span></label><strong id="quality-selection-count">선택 없음</strong><button id="clear-toilet-selection" type="button">선택 해제</button></div>
          <div class="quality-display-group-form"><input id="display-group-name" maxlength="100" placeholder="지도에 표시할 이름 (예: XXX문화원)" /><button id="save-display-group" type="button" disabled>그룹 지정</button></div>
          <div class="quality-display-group-help"><p id="display-group-hint">함께 표시할 화장실을 2개 이상 선택하세요.</p><button id="delete-display-group" type="button" hidden>그룹 해제</button></div>
        </section>
        <div class="quality-toilets">${data.toilets.map(toiletMarkup).join('')}</div>
      </section>
      <details class="quality-history"><summary>좌표 수정 이력 <strong>${data.revisions.length}건</strong></summary>${revisions}</details>`
    el('quality-detail-close').addEventListener('click', closeDetail)
    el('save-group-review').addEventListener('click', () => void saveGroupReview(data.group))
    bindDisplayGroupControls(data.group)
    detail.querySelectorAll('.coordinate-edit').forEach((button) => button.addEventListener('click', () => void openCoordinateEditor(data.toilets.find((item) => item.id === Number(button.dataset.toiletId)))))
  } catch (error) {
    detail.innerHTML = `<p class="status is-error quality-panel-loading">${escapeHtml(error.message)}</p>`
  }
}

async function saveDisplayGroup(group) {
  const displayName = el('display-group-name').value.trim()
  const toiletIds = [...selectedToiletIds]
  if (toiletIds.length < 2 || !displayName) return
  const button = el('save-display-group')
  button.disabled = true
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/duplicate-coordinates/${encodeURIComponent(group.groupKey)}/display-group`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayGroupId: activeDisplayGroupId, displayName, toiletIds })
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || '지도 노출 그룹을 저장하지 못했습니다.')
    await selectGroup(group.groupKey)
  } catch (error) {
    window.alert(error.message)
  } finally {
    if (el('save-display-group')) el('save-display-group').disabled = false
  }
}

async function deleteDisplayGroup(group) {
  if (!activeDisplayGroupId || !window.confirm('이 지도 노출 그룹을 해제할까요? 원본 화장실 데이터는 삭제되지 않습니다.')) return
  const button = el('delete-display-group')
  button.disabled = true
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/display-groups/${activeDisplayGroupId}`, {
      method: 'DELETE', credentials: 'include'
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error?.message || payload?.message || '지도 노출 그룹을 해제하지 못했습니다.')
    }
    await selectGroup(group.groupKey)
  } catch (error) {
    window.alert(error.message)
  } finally {
    if (el('delete-display-group')) el('delete-display-group').disabled = false
  }
}

function closeDetail() {
  selectedGroupKey = null
  const url = new URL(window.location.href)
  url.searchParams.delete('groupKey')
  window.history.replaceState(null, '', url)
  selectedToiletIds = new Set()
  activeDisplayGroupId = null
  currentGroupToilets = []
  el('quality-detail').innerHTML = detailPlaceholder()
  resetCoordinateEditor()
  renderGroups()
}

async function saveGroupReview(group) {
  const button = el('save-group-review')
  button.disabled = true
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/duplicate-coordinates/${encodeURIComponent(group.groupKey)}/review`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: group.latitude, longitude: group.longitude, status: el('group-review-status').value, note: el('group-review-note').value.trim() })
    })
    if (!response.ok) throw new Error('확인 상태를 저장하지 못했습니다.')
    await loadGroups(page, false)
    await selectGroup(group.groupKey)
  } catch (error) {
    window.alert(error.message)
  } finally {
    if (coordinateEditorState) syncCoordinateGroupSelection()
    else button.disabled = false
  }
}

async function loadKakaoMaps() {
  if (kakaoMapsReady) return kakaoMapsReady
  kakaoMapsReady = (async () => {
    const response = await fetch('/api/admin/v1/map-config')
    if (!response.ok) throw new Error('지도 설정을 불러오지 못했습니다.')
    const config = await response.json()
    if (!config.enabled || !config.javascriptKey) throw new Error('카카오 지도 키가 아직 배포되지 않았습니다.')
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.javascriptKey)}&libraries=services&autoload=false`
      script.onload = resolve
      script.onerror = () => reject(new Error('카카오 지도 SDK를 불러오지 못했습니다.'))
      document.head.append(script)
    })
    await new Promise((resolve) => window.kakao.maps.load(resolve))
  })().catch((error) => {
    kakaoMapsReady = null
    throw error
  })
  return kakaoMapsReady
}

function appendCoordinateNote(label) {
  const input = el('coordinate-note')
  if (!input) return
  const notes = input.value.split(' · ').map((item) => item.trim()).filter(Boolean)
  if (!notes.includes(label)) notes.push(label)
  input.value = notes.join(' · ')
  input.focus()
}

function coordinatePointGroups(toilets) {
  const points = new Map()
  toilets.forEach((toilet) => {
    const key = `${toilet.latitude}:${toilet.longitude}`
    const point = points.get(key)
    if (point) point.toilets.push(toilet)
    else points.set(key, { latitude: toilet.latitude, longitude: toilet.longitude, toilets: [toilet] })
  })
  return [...points.values()]
}

function coordinateMarkerOptions(point) {
  const options = new Map()
  point.toilets.forEach((toilet) => {
    const key = toilet.displayGroupId ? `group-${toilet.displayGroupId}` : `toilet-${toilet.id}`
    const existing = options.get(key)
    if (existing) existing.toilets.push(toilet)
    else options.set(key, {
      key,
      displayGroupId: toilet.displayGroupId || null,
      displayName: toilet.displayGroupName || toilet.name || '이름 없는 화장실',
      toilets: [toilet]
    })
  })
  return [...options.values()]
}

function clearCoordinateGroupSelection() {
  const state = coordinateEditorState
  if (!state) return
  state.activeDisplayGroupId = null
  state.activeDisplayGroupName = ''
  syncCoordinateGroupSelection()
}

function syncCoordinateGroupSelection() {
  const state = coordinateEditorState
  if (!state) return
  const save = el('save-coordinate')
  if (save) {
    save.textContent = state.activeDisplayGroupId
      ? `좌표 저장 및 ‘${state.activeDisplayGroupName}’ 편입`
      : '확정 좌표 저장'
  }
  document.querySelectorAll('[data-coordinate-display-group]').forEach((button) => {
    const selected = Number(button.dataset.coordinateDisplayGroup) === Number(state.activeDisplayGroupId)
    button.classList.toggle('is-selected', selected)
    button.textContent = selected ? '편입 선택됨' : '이 그룹에 편입'
  })
  state.toiletOverlays.forEach(({ point, button }) => {
    const selected = point.toilets.some((item) => Number(item.displayGroupId) === Number(state.activeDisplayGroupId))
    button.classList.toggle('is-selected', Boolean(state.activeDisplayGroupId) && selected)
  })
}

async function coordinateToiletAddress(toiletId) {
  try {
    const response = await fetch(`${API_BASE}/api/v1/toilets/${toiletId}`)
    if (!response.ok) return '주소 정보 없음'
    const detail = await response.json()
    return detail.roadAddress || detail.jibunAddress || '주소 정보 없음'
  } catch {
    return '주소 정보 없음'
  }
}

async function openCoordinateMarkerCard(point) {
  const state = coordinateEditorState
  if (!state) return
  const sequence = state.markerCardSequence = (state.markerCardSequence || 0) + 1
  state.setDraft(new kakao.maps.LatLng(point.latitude, point.longitude))
  state.map.panTo(new kakao.maps.LatLng(point.latitude, point.longitude))
  clearCoordinateGroupSelection()
  const card = el('coordinate-marker-card')
  card.hidden = false
  card.innerHTML = '<p class="status">화장실 주소를 확인하는 중입니다.</p>'
  const address = await coordinateToiletAddress(point.toilets[0].id)
  if (!coordinateEditorState || sequence !== coordinateEditorState.markerCardSequence || !el('coordinate-marker-card')) return
  const options = coordinateMarkerOptions(point)
  const confirmedGroups = options.filter((option) => option.displayGroupId)
  const ordinaryToilets = options.filter((option) => !option.displayGroupId).flatMap((option) => option.toilets)
  card.innerHTML = `
    <div class="coordinate-marker-card-head"><div><span>이 위치의 화장실</span><strong>${escapeHtml(address)}</strong></div><button id="coordinate-marker-card-close" type="button" aria-label="마커 정보 닫기">×</button></div>
    ${confirmedGroups.length ? `<div class="coordinate-marker-groups"><span>관리자 확정 그룹</span>${confirmedGroups.map((option) => `<article><div><strong>${escapeHtml(option.displayName)}</strong><small>${option.toilets.length.toLocaleString()}개 화장실</small></div><button data-coordinate-display-group="${option.displayGroupId}" type="button">이 그룹에 편입</button></article>`).join('')}</div>` : ''}
    ${ordinaryToilets.length ? `<div class="coordinate-marker-toilets">${ordinaryToilets.map((item) => `<div><strong>${escapeHtml(item.name || '이름 없는 화장실')}</strong><small>ID ${item.id}</small></div>`).join('')}</div>` : ''}`
  el('coordinate-marker-card-close').addEventListener('click', () => {
    card.hidden = true
  })
  confirmedGroups.forEach((option) => {
    document.querySelector(`[data-coordinate-display-group="${option.displayGroupId}"]`)?.addEventListener('click', () => {
      state.activeDisplayGroupId = Number(option.displayGroupId)
      state.activeDisplayGroupName = option.displayName
      syncCoordinateGroupSelection()
    })
  })
  syncCoordinateGroupSelection()
}

function clearCoordinateToiletOverlays() {
  const state = coordinateEditorState
  if (!state) return
  state.toiletOverlays.forEach(({ overlay }) => overlay.setMap(null))
  state.toiletOverlays = []
}

async function loadCoordinateMapToilets() {
  const state = coordinateEditorState
  if (!state) return
  const mapStatus = el('coordinate-map-status')
  const level = state.map.getLevel()
  if (level > 5) {
    clearCoordinateToiletOverlays()
    if (mapStatus) mapStatus.textContent = '지도를 확대하면 이 영역의 화장실을 표시합니다.'
    return
  }
  const bounds = state.map.getBounds()
  const southWest = bounds.getSouthWest()
  const northEast = bounds.getNorthEast()
  const requestSequence = ++state.toiletRequestSequence
  if (mapStatus) mapStatus.textContent = '현재 지도 영역의 화장실을 불러오는 중입니다.'
  try {
    const query = new URLSearchParams({
      southLat: String(southWest.getLat()), northLat: String(northEast.getLat()),
      westLng: String(southWest.getLng()), eastLng: String(northEast.getLng()),
      zoom: String(level), includeList: 'true'
    })
    const response = await fetch(`${API_BASE}/api/v1/toilets?${query}`)
    if (!response.ok) throw new Error('화장실 마커를 불러오지 못했습니다.')
    const payload = await response.json()
    if (!coordinateEditorState || requestSequence !== coordinateEditorState.toiletRequestSequence) return
    clearCoordinateToiletOverlays()
    const toilets = (payload.toilets || []).filter((item) => Number(item.id) !== Number(state.toilet.id))
    coordinatePointGroups(toilets).forEach((point) => {
      const button = document.createElement('button')
      const representative = point.toilets.find((item) => item.displayGroupId) || point.toilets[0]
      const displayName = representative.displayGroupName || representative.name || '공중화장실'
      button.type = 'button'
      button.className = `quality-map-toilet-marker${representative.displayGroupId ? ' has-confirmed-group' : ''}`
      button.setAttribute('aria-label', `${displayName}${point.toilets.length > 1 ? ` 외 ${point.toilets.length - 1}개` : ''} 정보 보기`)
      button.innerHTML = `<span class="quality-map-toilet-pin"><img src="/toilet-marker-logo.svg" alt="" /></span><span class="quality-map-toilet-name">${escapeHtml(displayName)}${point.toilets.length > 1 ? `<b>+${point.toilets.length - 1}</b>` : ''}</span>`
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        void openCoordinateMarkerCard(point)
      })
      const overlay = new kakao.maps.CustomOverlay({
        map: state.map, position: new kakao.maps.LatLng(point.latitude, point.longitude),
        content: button, yAnchor: 1, zIndex: 2, clickable: true
      })
      state.toiletOverlays.push({ overlay, button, point })
    })
    syncCoordinateGroupSelection()
    if (mapStatus) mapStatus.textContent = toilets.length
      ? `현재 지도 영역 화장실 ${toilets.length.toLocaleString()}개`
      : '현재 지도 영역에 등록된 다른 화장실이 없습니다.'
  } catch (error) {
    if (coordinateEditorState && requestSequence === coordinateEditorState.toiletRequestSequence && mapStatus) {
      mapStatus.textContent = error.message
    }
  }
}

function searchCoordinatePlace(event) {
  event.preventDefault()
  const state = coordinateEditorState
  const input = el('coordinate-place-query')
  const status = el('coordinate-search-status')
  const query = input?.value.trim()
  if (!state || !query) return
  status.hidden = true
  status.textContent = ''
  const applyResult = (latitude, longitude, address) => {
    if (!coordinateEditorState) return
    clearCoordinateGroupSelection()
    el('coordinate-marker-card').hidden = true
    const position = new kakao.maps.LatLng(Number(latitude), Number(longitude))
    state.map.setLevel(3)
    state.map.panTo(position)
    state.setDraft(position, address)
  }
  state.geocoder.addressSearch(query, (addresses, addressStatus) => {
    if (!coordinateEditorState) return
    if (addressStatus === kakao.maps.services.Status.OK && addresses.length) {
      const result = addresses[0]
      applyResult(result.y, result.x, result.road_address?.address_name || result.address_name)
      return
    }
    state.places.keywordSearch(query, (places, placeStatus) => {
      if (!coordinateEditorState) return
      if (placeStatus === kakao.maps.services.Status.OK && places.length) {
        const result = places[0]
        applyResult(result.y, result.x, result.road_address_name || result.address_name)
      } else {
        status.hidden = false
        status.textContent = '검색 결과가 없습니다. 주소나 장소명을 조금 더 구체적으로 입력해 주세요.'
      }
    })
  })
}

async function openCoordinateEditor(toilet) {
  if (!toilet) return
  const sequence = ++coordinateEditorSequence
  const editor = el('coordinate-editor')
  document.querySelectorAll('.quality-toilet.is-editing').forEach((item) => item.classList.remove('is-editing'))
  document.querySelector(`[data-toilet-row="${toilet.id}"]`)?.classList.add('is-editing')
  coordinateDraft = null
  editor.innerHTML = `
    <header class="quality-pane-head is-map-editor">
      <div><span>좌표 보정</span><h2>${escapeHtml(toilet.name)}</h2></div>
      <button id="coordinate-editor-close" class="icon-button" type="button" aria-label="좌표 보정 닫기">×</button>
    </header>
    <div class="coordinate-map-search"><form id="coordinate-place-search"><input id="coordinate-place-query" type="search" autocomplete="off" placeholder="주소 또는 장소명 검색" /><button type="submit">검색</button><button id="coordinate-show-origin" class="is-secondary" type="button">기존 위치 보기</button></form><p id="coordinate-search-status" role="alert" hidden></p></div>
    <div class="coordinate-map-stage">
      <div id="quality-coordinate-map" class="quality-coordinate-map"><p>지도를 불러오는 중입니다.</p></div>
      <p id="coordinate-map-status" class="coordinate-map-status" aria-live="polite">현재 지도 영역의 화장실을 불러오는 중입니다.</p>
      <section id="coordinate-marker-card" class="coordinate-marker-card" aria-label="선택한 위치의 화장실" hidden></section>
    </div>
    <div class="coordinate-form">
      <label><span>선택 좌표</span><strong id="coordinate-draft-value">${escapeHtml(coordinate(toilet.latitude, toilet.longitude))}</strong></label>
      <label><span>확인 주소</span><input id="coordinate-road-address" maxlength="255" value="${escapeHtml(toilet.roadAddress || toilet.jibunAddress || '')}" placeholder="좌표에서 확인한 주소" readonly title="저장 시 서버가 좌표로 도로명·지번주소를 확인합니다." /></label>
      <label class="coordinate-note-field"><span>보정 사유</span><input id="coordinate-note" maxlength="500" placeholder="보정 사유를 직접 입력하거나 아래 항목을 추가하세요." /><span class="coordinate-note-actions"><button type="button" data-coordinate-note="지도 확인">+ 지도 확인</button><button type="button" data-coordinate-note="거리뷰 확인">+ 거리뷰 확인</button><button type="button" data-coordinate-note="주소 확인">+ 주소 확인</button></span></label>
      <button id="save-coordinate" class="coordinate-save-button" type="button">확정 좌표 저장</button>
    </div>`
  el('coordinate-editor-close').addEventListener('click', resetCoordinateEditor)
  document.querySelectorAll('[data-coordinate-note]').forEach((button) => button.addEventListener('click', () => appendCoordinateNote(button.dataset.coordinateNote)))
  el('coordinate-place-search').addEventListener('submit', searchCoordinatePlace)
  try {
    await loadKakaoMaps()
    if (sequence !== coordinateEditorSequence || !el('quality-coordinate-map')) return
    const initial = new kakao.maps.LatLng(toilet.latitude, toilet.longitude)
    const mapElement = el('quality-coordinate-map')
    mapElement.replaceChildren()
    const map = new kakao.maps.Map(mapElement, { center: initial, level: 3 })
    const marker = new kakao.maps.Marker({ map, position: initial, draggable: true, title: '보정할 좌표' })
    const geocoder = new kakao.maps.services.Geocoder()
    const places = new kakao.maps.services.Places()
    const originBadge = document.createElement('span')
    originBadge.className = 'quality-map-origin-marker'
    originBadge.textContent = '기존'
    const originOverlay = new kakao.maps.CustomOverlay({ map, position: initial, content: originBadge, yAnchor: 1.8, zIndex: 1 })
    coordinateDraft = { latitude: Number(toilet.latitude), longitude: Number(toilet.longitude) }
    coordinateEditorState = {
      toilet, map, marker, geocoder, places, originOverlay,
      activeDisplayGroupId: null, activeDisplayGroupName: '', toiletOverlays: [], toiletRequestSequence: 0,
      geocodeSequence: 0, markerCardSequence: 0, mapIdleTimer: null, setDraft: null
    }
    const update = (position, knownAddress) => {
      const state = coordinateEditorState
      if (!state) return
      marker.setPosition(position)
      coordinateDraft = { latitude: position.getLat(), longitude: position.getLng() }
      el('coordinate-draft-value').textContent = coordinate(coordinateDraft.latitude, coordinateDraft.longitude)
      if (knownAddress) el('coordinate-road-address').value = knownAddress
      const lookupSequence = ++state.geocodeSequence
      geocoder.coord2Address(position.getLng(), position.getLat(), (result, status) => {
        if (coordinateEditorState && lookupSequence === coordinateEditorState.geocodeSequence && status === kakao.maps.services.Status.OK && el('coordinate-road-address')) {
          el('coordinate-road-address').value = result[0]?.road_address?.address_name || result[0]?.address?.address_name || el('coordinate-road-address').value
        }
      })
    }
    coordinateEditorState.setDraft = update
    kakao.maps.event.addListener(marker, 'dragend', () => {
      clearCoordinateGroupSelection()
      el('coordinate-marker-card').hidden = true
      update(marker.getPosition())
    })
    kakao.maps.event.addListener(map, 'click', (event) => {
      clearCoordinateGroupSelection()
      el('coordinate-marker-card').hidden = true
      update(event.latLng)
    })
    kakao.maps.event.addListener(map, 'idle', () => {
      if (!coordinateEditorState) return
      window.clearTimeout(coordinateEditorState.mapIdleTimer)
      coordinateEditorState.mapIdleTimer = window.setTimeout(() => void loadCoordinateMapToilets(), 220)
    })
    el('coordinate-show-origin').addEventListener('click', () => map.panTo(initial))
    el('save-coordinate').addEventListener('click', () => void saveCoordinate(toilet.id))
    syncCoordinateGroupSelection()
    await loadCoordinateMapToilets()
  } catch (error) {
    const mapTarget = el('quality-coordinate-map')
    if (sequence === coordinateEditorSequence && mapTarget) mapTarget.innerHTML = `<p class="status is-error">${escapeHtml(error.message)}</p>`
  }
}

async function saveCoordinate(toiletId) {
  if (!coordinateDraft) return
  const roadAddress = el('coordinate-road-address').value.trim()
  const state = coordinateEditorState
  const joiningGroup = Boolean(state?.activeDisplayGroupId)
  const confirmation = joiningGroup
    ? `이 좌표를 저장하고 ‘${state.activeDisplayGroupName}’ 그룹에 편입할까요? 변경 전·후 위치는 이력에 남습니다.`
    : '이 좌표를 관리자 확정 위치로 저장할까요? 변경 전·후 위치는 이력에 남습니다.'
  if (!window.confirm(confirmation)) return
  const button = el('save-coordinate')
  button.disabled = true
  try {
    const displayGroup = joiningGroup ? { displayGroupId: state.activeDisplayGroupId } : {}
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/toilets/${toiletId}/coordinates`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...coordinateDraft, roadAddress, note: el('coordinate-note').value.trim(), ...displayGroup })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error?.message || payload?.message || '좌표를 저장하지 못했습니다.')
    }
    const previousKey = selectedGroupKey
    await loadGroups(page, false)
    if (groups.some((group) => group.groupKey === previousKey)) await selectGroup(previousKey)
    else closeDetail()
  } catch (error) {
    window.alert(error.message)
  } finally {
    button.disabled = false
  }
}

async function loadGroups(targetPage = 0, clearDetail = true) {
  const status = el('quality-status-text')
  status.className = 'status'
  status.textContent = '중복 좌표를 불러오는 중입니다.'
  if (clearDetail) closeDetail()
  try {
    const query = new URLSearchParams({ keyword: el('quality-search').value.trim(), status: el('quality-status').value, page: String(Math.max(targetPage, 0)), size: String(PAGE_SIZE) })
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/duplicate-coordinates?${query}`, { credentials: 'include' })
    if (!response.ok) {
      if (response.status === 401) return showLogin('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.')
      if (response.status === 403) return showLogin('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.')
      throw new Error('중복 좌표 목록을 불러오지 못했습니다.')
    }
    const data = await response.json()
    groups = data.items
    page = data.page
    totalPages = data.totalPages
    totalElements = data.totalElements
    renderGroups()
    status.textContent = `중복 좌표 그룹 ${totalElements.toLocaleString()}건 · ${totalPages ? page + 1 : 0}페이지`
  } catch (error) {
    groups = []
    totalPages = totalElements = 0
    renderGroups()
    status.className = 'status is-error'
    status.textContent = error.message
  }
}

async function bootstrap() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
    if (response.status === 401) return showLogin('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.')
    if (!response.ok) return showLogin('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.')
    const profile = await response.json()
    if (!profile.roles?.includes('ADMIN')) return showLogin('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.')
    el('loading-shell').hidden = true
    el('quality-shell').hidden = false
    el('quality-search').addEventListener('input', () => {
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => void loadGroups(0), 250)
    })
    el('quality-status').addEventListener('change', () => void loadGroups(0))
    el('quality-refresh').addEventListener('click', () => void loadGroups(page))
    await loadGroups()
    if (initialGroupKey) await selectGroup(initialGroupKey)
  } catch {
    showLogin('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.')
  }
}

bootstrap()
