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
  return `<article class="quality-toilet" data-toilet-row="${item.id}"><div><strong>${escapeHtml(item.name || '이름 없는 화장실')}</strong><span>${escapeHtml(item.toiletType || '구분 없음')} · ID ${item.id}${item.managementNumber ? ` · 관리번호 ${escapeHtml(item.managementNumber)}` : ''}</span><small>${escapeHtml(item.roadAddress || item.jibunAddress || '주소 정보 없음')}</small></div><div class="quality-toilet-actions"><i>${escapeHtml(item.coordinateSource || '출처 미상')}</i><button class="secondary-button coordinate-edit" data-toilet-id="${item.id}" type="button">좌표 보정</button></div></article>`
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
  renderGroups()
  const detail = el('quality-detail')
  detail.innerHTML = '<p class="status quality-panel-loading">그룹 화장실을 불러오는 중입니다.</p>'
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/duplicate-coordinates/${encodeURIComponent(groupKey)}`, { credentials: 'include' })
    if (!response.ok) throw new Error('중복 좌표 상세를 불러오지 못했습니다.')
    const data = await response.json()
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
        <div class="quality-list-label"><strong>등록 화장실</strong><span>좌표를 수정할 항목을 선택하세요.</span></div>
        <div class="quality-toilets">${data.toilets.map(toiletMarkup).join('')}</div>
      </section>
      <details class="quality-history"><summary>좌표 수정 이력 <strong>${data.revisions.length}건</strong></summary>${revisions}</details>`
    el('quality-detail-close').addEventListener('click', closeDetail)
    el('save-group-review').addEventListener('click', () => void saveGroupReview(data.group))
    detail.querySelectorAll('.coordinate-edit').forEach((button) => button.addEventListener('click', () => void openCoordinateEditor(data.toilets.find((item) => item.id === Number(button.dataset.toiletId)))))
  } catch (error) {
    detail.innerHTML = `<p class="status is-error quality-panel-loading">${escapeHtml(error.message)}</p>`
  }
}

function closeDetail() {
  selectedGroupKey = null
  const url = new URL(window.location.href)
  url.searchParams.delete('groupKey')
  window.history.replaceState(null, '', url)
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
    button.disabled = false
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

async function openCoordinateEditor(toilet) {
  if (!toilet) return
  const sequence = ++coordinateEditorSequence
  const editor = el('coordinate-editor')
  document.querySelectorAll('.quality-toilet.is-editing').forEach((item) => item.classList.remove('is-editing'))
  document.querySelector(`[data-toilet-row="${toilet.id}"]`)?.classList.add('is-editing')
  coordinateDraft = null
  editor.innerHTML = `
    <header class="quality-pane-head is-map-editor">
      <div><span>좌표 보정</span><h2>${escapeHtml(toilet.name)}</h2><p>지도를 클릭하거나 핀을 움직여 확정 좌표를 지정합니다.</p></div>
      <button id="coordinate-editor-close" class="icon-button" type="button" aria-label="좌표 보정 닫기">×</button>
    </header>
    <div class="quality-map-context"><span>현재 등록 위치</span><strong>${escapeHtml(coordinate(toilet.latitude, toilet.longitude))}</strong><small>${escapeHtml(toilet.roadAddress || toilet.jibunAddress || '주소 정보 없음')}</small></div>
    <div id="quality-coordinate-map" class="quality-coordinate-map"><p>지도를 불러오는 중입니다.</p></div>
    <div class="coordinate-form">
      <label><span>선택 좌표</span><strong id="coordinate-draft-value">${escapeHtml(coordinate(toilet.latitude, toilet.longitude))}</strong></label>
      <label><span>확인 주소</span><input id="coordinate-road-address" maxlength="255" value="${escapeHtml(toilet.roadAddress || toilet.jibunAddress || '')}" placeholder="좌표에서 확인한 주소" readonly title="저장 시 서버가 좌표로 도로명·지번주소를 확인합니다." /></label>
      <label><span>보정 사유</span><input id="coordinate-note" maxlength="500" placeholder="보정 사유(선택)" /></label>
      <button id="save-coordinate" type="button">확정 좌표 저장</button>
    </div>`
  el('coordinate-editor-close').addEventListener('click', resetCoordinateEditor)
  try {
    await loadKakaoMaps()
    if (sequence !== coordinateEditorSequence || !el('quality-coordinate-map')) return
    const initial = new kakao.maps.LatLng(toilet.latitude, toilet.longitude)
    const map = new kakao.maps.Map(el('quality-coordinate-map'), { center: initial, level: 3 })
    const marker = new kakao.maps.Marker({ map, position: initial, draggable: true })
    const geocoder = new kakao.maps.services.Geocoder()
    coordinateDraft = { latitude: Number(toilet.latitude), longitude: Number(toilet.longitude) }
    const update = (position) => {
      marker.setPosition(position)
      coordinateDraft = { latitude: position.getLat(), longitude: position.getLng() }
      el('coordinate-draft-value').textContent = coordinate(coordinateDraft.latitude, coordinateDraft.longitude)
      geocoder.coord2Address(position.getLng(), position.getLat(), (result, status) => {
        if (status === kakao.maps.services.Status.OK && el('coordinate-road-address')) {
          el('coordinate-road-address').value = result[0]?.road_address?.address_name || result[0]?.address?.address_name || el('coordinate-road-address').value
        }
      })
    }
    kakao.maps.event.addListener(marker, 'dragend', () => update(marker.getPosition()))
    kakao.maps.event.addListener(map, 'click', (event) => update(event.latLng))
    el('save-coordinate').addEventListener('click', () => void saveCoordinate(toilet.id))
  } catch (error) {
    const mapTarget = el('quality-coordinate-map')
    if (sequence === coordinateEditorSequence && mapTarget) mapTarget.innerHTML = `<p class="status is-error">${escapeHtml(error.message)}</p>`
  }
}

async function saveCoordinate(toiletId) {
  if (!coordinateDraft) return
  const roadAddress = el('coordinate-road-address').value.trim()
  if (!window.confirm('이 좌표를 관리자 확정 위치로 저장할까요? 변경 전·후 위치는 이력에 남습니다.')) return
  const button = el('save-coordinate')
  button.disabled = true
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/data-quality/toilets/${toiletId}/coordinates`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...coordinateDraft, roadAddress, note: el('coordinate-note').value.trim() })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.message || '좌표를 저장하지 못했습니다.')
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
