const $ = (id) => document.getElementById(id)
const API = 'https://api.geupddong.com'
const labels = { VERIFIED:'확정', MISMATCH:'지역 불일치', ADDRESS_UNVERIFIED:'주소 불확실', REVERSE_FAILED:'역조회 실패', NO_COORDINATE:'좌표 없음', STALE:'재판정 대기', UNASSESSED:'최초 판정 대기' }
const reasonLabels = {
  ADDRESS_REGION_CONFLICT:'공공데이터 주소와 좌표의 행정구역이 서로 다릅니다.',
  RECHECK_MANUAL_REVIEW:'주소 재검색 결과만으로 어느 시·군·구인지 확정할 수 없습니다.',
  INSUFFICIENT_ADDRESS_EVIDENCE:'주소에 시·군·구를 판별할 정보가 부족합니다.',
  RECHECK_PROVIDER_FAILURE:'주소를 다시 확인하는 과정에서 지도 응답을 받지 못했습니다.',
  FORWARD_PROVIDER_FAILURE:'주소를 좌표로 찾는 과정에서 지도 응답을 받지 못했습니다.',
  FORWARD_ROAD_PROVIDER_FAILURE:'도로명주소 검색에 실패해 자동 판정을 완료하지 못했습니다.',
  NO_UNIQUE_ADDRESS_RESULT:'주소 검색 결과가 없거나 여러 개라 좌표를 정할 수 없습니다.',
  PARTIAL_COORDINATE:'위도와 경도 중 하나만 저장되어 있습니다.',
  INVALID_COORDINATE:'저장된 좌표 범위를 확인해야 합니다.',
  ADDRESS_CORROBORATED:'공공데이터 주소와 좌표 기준 행정구역이 일치합니다.',
  STRUCTURED_ADDRESS_CORROBORATED:'주소를 다시 검색해 좌표 기준 행정구역과 일치함을 확인했습니다.'
}
const checkLabels = { MATCH:'일치', MISMATCH:'불일치', UNKNOWN:'판단 불가' }
const sourceLabels = { PUBLIC_DATA:'공공데이터포털', ADMIN_CONFIRMED:'관리자 보정 데이터' }
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
const address = (location) => location?.roadAddress?.trim() || location?.jibunAddress?.trim() || '주소 정보 없음'
const valid = (location) => location?.latitude != null && location?.longitude != null && String(location.latitude).trim() !== '' && String(location.longitude).trim() !== '' && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
const coordinate = (location) => valid(location) ? `${Number(location.latitude).toFixed(7)}, ${Number(location.longitude).toFixed(7)}` : '좌표 없음'
const date = (value) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Seoul' }).format(new Date(value)) : '판정 이력 없음'
const badge = (status) => `<span class="region-badge ${status === 'VERIFIED' ? 'verified' : ''}">${escape(labels[status] || status)}</span>`
const icon = (name) => ({ source:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6M9 7h3"/></svg>', logic:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h7M5 12h4M5 17h7M15 6l4 4-7 7-4 1 1-4z"/></svg>', final:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12z"/><path d="m9 10 2 2 4-4"/></svg>', map:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/></svg>' }[name] || '')
let page = 0, selected = null, listSequence = 0, detailSequence = 0, historySequence = 0, mapReady, optionTimer, saving = false, filterStatus = 'REVIEW'
const initialToiletId = Number(new URLSearchParams(window.location.search).get('toiletId'))

function showLogin(status) {
  $('loading-shell').hidden = true
  $('region-shell').hidden = true
  $('region-list').replaceChildren()
  $('region-detail').replaceChildren()
  $('auth-shell').hidden = false
  $('auth-title').textContent = status === 403 ? '관리자 권한이 필요합니다' : '관리자 로그인'
  selected = null
  ++detailSequence
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials:'include', ...options })
  if (response.status === 401 || response.status === 403) showLogin(response.status)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(response.status === 409 ? '다른 작업에서 주소나 위치가 변경되었습니다. 새로고침 후 다시 확인해 주세요.' : body?.message || '요청에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return response.json()
}

function pagination(id, data, load) {
  const target = $(id)
  target.replaceChildren()
  if (data.totalPages <= 1) return
  const total = data.totalPages
  const current = Math.min(Math.max(data.page, 0), total - 1)
  const visiblePages = Math.min(5, total)
  const start = Math.min(Math.max(current - Math.floor(visiblePages / 2), 0), total - visiblePages)
  const append = (label, next, disabled = false, number = false) => {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = label
    node.className = number ? 'region-page-number' : 'region-page-move'
    node.disabled = disabled
    if (number && next === current) node.setAttribute('aria-current', 'page')
    if (!disabled) node.addEventListener('click', () => load(next))
    target.append(node)
  }
  append('맨앞', 0, current === 0)
  append('이전', current - 1, current === 0)
  for (let next = start; next < start + visiblePages; next += 1) append(String(next + 1), next, next === current, true)
  append('다음', current + 1, current === total - 1)
  append('맨뒤', total - 1, current === total - 1)
}

function assessment(value) {
  if (!value) return {}
  try { return JSON.parse(value) } catch { return {} }
}

function sourceRegion(addressValue) {
  const words = String(addressValue || '').trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return '지역 정보를 읽지 못함'
  if (words[1].endsWith('시') && words[2]?.endsWith('구')) return `${words[0]} ${words[1]} ${words[2]}`
  return `${words[0]} ${words[1]}`
}

function regionName(region) {
  if (!region) return '시·군·구 미결정'
  if (!region.sigunguName) return region.sidoName || '시·군·구 미결정'
  return `${region.sidoName || ''} ${region.sigunguName}`.trim()
}

function itemRegion(item) {
  return item?.sigunguCode ? { sidoName:item.sidoName, sidoCode:item.sidoCode, sigunguName:item.sigunguName, sigunguCode:item.sigunguCode, cityName:item.cityName, districtName:item.districtName } : null
}

function conciseReason(item, data) {
  if (item.status === 'STALE') return '주소 또는 좌표가 바뀌어 다시 판정해야 합니다.'
  if (item.status === 'UNASSESSED') return '아직 자동 판정이 실행되지 않았습니다.'
  if (item.status === 'NO_COORDINATE') return '좌표가 없어 주소만으로 확인해야 합니다.'
  return reasonLabels[data.reason || item.reason] || '주소와 좌표 근거를 비교해 최종 지역을 선택해 주세요.'
}

async function loadList(nextPage = 0) {
  const sequence = ++listSequence
  $('region-workspace').setAttribute('aria-busy', 'true')
  $('region-status').textContent = '검토 목록을 불러오는 중…'
  try {
    const query = new URLSearchParams({ status:filterStatus, page:String(nextPage), size:'15' })
    const data = await request(`/api/admin/v1/regions?${query}`)
    if (sequence !== listSequence || !$('auth-shell').hidden) return
    page = data.page
    $('region-list').replaceChildren()
    for (const item of data.items) {
      const original = sourceRegion(item.location?.roadAddress || item.location?.jibunAddress)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'region-item'
      button.dataset.id = item.toiletId
      button.setAttribute('aria-pressed', String(selected === item.toiletId))
      button.innerHTML = `<span class="region-item-head"><strong>${escape(item.name || '이름 없는 화장실')}</strong>${badge(item.status)}</span><span class="region-item-meta"><span class="region-item-address">${escape(address(item.location))}</span><span class="region-item-flow"><b>${escape(original)}</b><i aria-hidden="true">→</i><b>${escape(item.sigunguName || '미결정')}</b></span></span>`
      button.addEventListener('click', () => { if (!saving) void loadDetail(item.toiletId) })
      $('region-list').append(button)
    }
    $('region-status').innerHTML = `<strong>${data.totalElements.toLocaleString()}건</strong><span>확정이 필요한 항목을 오래된 판정부터 표시합니다.</span>`
    if (!data.items.length) $('region-list').innerHTML = '<p class="region-list-empty">조건에 맞는 화장실이 없습니다.</p>'
    pagination('region-pages', data, loadList)
  } catch (error) { if (sequence === listSequence) $('region-status').textContent = error.message }
  finally { if (sequence === listSequence) $('region-workspace').setAttribute('aria-busy', 'false') }
}

function detailMarkup(detail) {
  const item = detail.toilet
  const data = assessment(detail.evidenceJson)
  const automatic = data.region || (!detail.confirmation ? itemRegion(item) : null)
  const sourceRoad = item.location?.roadAddress || '-'
  const sourceJibun = item.location?.jibunAddress || '-'
  const sourceHint = sourceRegion(item.location?.roadAddress || item.location?.jibunAddress)
  const finalRegion = detail.confirmation?.region
  const reason = conciseReason(item, data)
  return `<header class="region-detail-head"><div><span class="region-detail-kicker">TOILET #${item.toiletId}${item.managementNumber ? ` · ${escape(item.managementNumber)}` : ''}</span><h2>${escape(item.name || '이름 없는 화장실')}</h2></div>${badge(item.status)}</header>
    <section class="region-evidence-grid" aria-label="행정구역 판정 근거">
      <article class="region-evidence-card source"><header><span class="region-evidence-icon">${icon('source')}</span><div><small>공공데이터 저장값</small><strong>${escape(sourceHint)}</strong></div></header><dl><dt>도로명</dt><dd>${escape(sourceRoad)}</dd><dt>지번</dt><dd>${escape(sourceJibun)}</dd></dl><p>${escape(sourceLabels[detail.dataSource] || detail.dataSource || '공공데이터')}에서 수집된 현재 주소입니다.</p></article>
      <article class="region-evidence-card logic"><header><span class="region-evidence-icon">${icon('logic')}</span><div><small>우리 판정 로직</small><strong>${escape(regionName(automatic))}</strong></div></header><div class="region-checks"><span class="${data.roadCheck === 'MISMATCH' ? 'bad' : ''}">도로명 ${escape(checkLabels[data.roadCheck] || '판정 전')}</span><span class="${data.jibunCheck === 'MISMATCH' ? 'bad' : ''}">지번 ${escape(checkLabels[data.jibunCheck] || '판정 전')}</span></div><p>${escape(reason)}</p></article>
      <article class="region-evidence-card final ${finalRegion ? 'confirmed' : ''}"><header><span class="region-evidence-icon">${icon('final')}</span><div><small>서비스에 사용할 값</small><strong id="region-final-preview">${escape(regionName(finalRegion))}</strong></div></header><p>${finalRegion ? `${escape(date(detail.confirmation.confirmedAt))} 관리자 확정` : '아래에서 시·군·구를 선택하면 서비스 데이터에 반영됩니다.'}</p>${finalRegion ? `<small class="region-confirmed-note">${escape(detail.confirmation.note)}</small>` : ''}</article>
    </section>
    <section class="region-decision-layout">
      <article class="region-decision-card">
        <header class="region-section-head"><span>${icon('final')}</span><div><small>FINAL DISTRICT</small><h3>최종 시·군·구 지정</h3></div></header>
        <p class="region-decision-guide">주소 원문과 좌표 판정을 비교한 뒤 실제 서비스에 저장할 지역을 선택하세요.</p>
        <div id="region-recommendation" class="region-recommendation"></div>
        <label class="region-option-search"><span>다른 시·군·구 찾기</span><div><input id="region-option-search" type="search" maxlength="50" autocomplete="off" placeholder="예: 서울특별시 동대문구, 11230"/><button id="region-option-find" type="button">검색</button></div></label>
        <div id="region-option-results" class="region-option-results"></div>
        <div id="region-choice" class="region-choice"><small>선택된 지역</small><strong>시·군·구를 선택해 주세요.</strong></div>
        <label class="region-note"><span>확정 근거</span><textarea id="region-note" maxlength="500" rows="2" placeholder="확인한 근거를 간단히 남겨 주세요.">${escape(detail.confirmation?.note || '')}</textarea></label>
        <div class="region-note-actions"><button type="button">공공데이터 주소 확인</button><button type="button">지도 위치 확인</button><button type="button">관할 행정구역 확인</button></div>
        <p id="region-confirm-status" class="status" role="status"></p>
        <button id="region-confirm" class="region-confirm-button" type="button" disabled>시·군·구 확정</button>
      </article>
      <article class="region-map-card">
        <header class="region-section-head"><span>${icon('map')}</span><div><small>LOCATION CHECK</small><h3>지도에서 위치 확인</h3></div></header>
        <div class="region-map-search-shell"><div class="region-map-toolbar"><input id="region-map-search" aria-label="지도 주소 검색" autocomplete="off" placeholder="주소 또는 장소명 검색"/><button id="region-map-find" type="button">검색</button><button id="region-reset" class="secondary" type="button">현재 위치</button></div><div id="region-candidates" class="region-candidates" role="listbox" aria-label="연관 위치" aria-live="polite"></div></div><div id="region-map" class="region-map"></div>
        <details class="region-coordinate-edit"><summary>좌표 자체가 잘못된 경우 수정</summary><strong id="region-draft">저장할 위치를 지도에서 선택해 주세요.</strong><label>수정 사유<textarea id="region-coordinate-note" maxlength="500" rows="2"></textarea></label><p id="region-save-status" class="status" role="status"></p><button id="region-save" type="button" disabled>확정 좌표 저장</button></details>
      </article>
    </section>
    <details id="region-technical" class="region-technical"><summary>기술 정보와 판정 이력</summary><div class="region-technical-grid"><dl><dt>최근 판정</dt><dd>${escape(date(item.checkedAt))}</dd><dt>자동 판정 상태</dt><dd>${escape(labels[item.assessmentStatus] || item.assessmentStatus || '-')}</dd><dt>판정 코드</dt><dd>${escape(data.reason || item.reason || '-')}</dd><dt>평가 좌표</dt><dd>${escape(coordinate({latitude:detail.evaluatedLatitude, longitude:detail.evaluatedLongitude}))}</dd></dl><pre>${escape(detail.evidenceJson || '원본 응답 없음')}</pre></div><h3>판정 이력</h3><div id="region-history"><p class="status">열면 판정 이력을 불러옵니다.</p></div><nav id="region-history-pages" class="report-pagination" aria-label="판정 이력 페이지"></nav></details>`
}

async function loadDetail(id) {
  if (saving) return
  selected = id
  const url = new URL(window.location.href)
  url.searchParams.set('toiletId', String(id))
  window.history.replaceState(null, '', url)
  const sequence = ++detailSequence
  document.querySelectorAll('.region-item').forEach(node => node.setAttribute('aria-pressed', String(Number(node.dataset.id) === id)))
  const target = $('region-detail')
  target.innerHTML = '<p class="status">판정 근거를 불러오는 중…</p>'
  try {
    const detail = await request(`/api/admin/v1/regions/${id}`)
    if (sequence !== detailSequence) return
    target.innerHTML = detailMarkup(detail)
    mountDecision(detail, sequence)
    mountTechnical(id, sequence)
    await mountMap(detail.toilet, sequence)
    if (window.matchMedia('(max-width: 900px)').matches) target.scrollIntoView({ block:'start', behavior:'smooth' })
  } catch (error) { if (sequence === detailSequence) target.textContent = error.message }
}

function mountDecision(detail, sequence) {
  const item = detail.toilet
  const data = assessment(detail.evidenceJson)
  const automatic = data.region || (!detail.confirmation ? itemRegion(item) : null)
  const sourceHint = sourceRegion(item.location?.roadAddress || item.location?.jibunAddress)
  let chosen = detail.confirmation?.region || null
  let optionSequence = 0
  const live = () => sequence === detailSequence && selected === item.toiletId
  const update = () => {
    $('region-choice').innerHTML = `<small>선택된 지역</small><strong>${escape(regionName(chosen))}</strong>${chosen?.sigunguCode ? `<span>법정동 시·군·구 코드 ${escape(chosen.sigunguCode)}</span>` : ''}`
    $('region-final-preview').textContent = regionName(chosen)
    $('region-confirm').disabled = !chosen?.sigunguCode || !$('region-note').value.trim() || saving
  }
  const select = region => { chosen = region; update(); document.querySelectorAll('.region-option-button').forEach(node => node.classList.toggle('is-selected', node.dataset.code === region.sigunguCode)) }
  if (automatic?.sigunguCode) {
    $('region-recommendation').innerHTML = `<span>빠른 후보</span><button type="button" class="region-option-button"><strong>좌표 판정 · ${escape(regionName(automatic))}</strong><small>${escape(automatic.sigunguCode)} · 이 값 선택</small></button>${sourceHint !== '지역 정보를 읽지 못함' ? `<button id="region-source-find" type="button" class="region-option-button is-source"><strong>공공데이터 주소 · ${escape(sourceHint)}</strong><small>일치 후보 찾기</small></button>` : ''}`
    $('region-recommendation').querySelector('button').addEventListener('click', () => select(automatic))
  } else {
    $('region-recommendation').innerHTML = '<span>좌표 역조회 결과</span><p>추천할 수 있는 시·군·구가 없습니다. 직접 검색해 선택해 주세요.</p>'
  }
  const searchOptions = async () => {
    const keyword = $('region-option-search').value.trim()
    const requestSequence = ++optionSequence
    $('region-option-results').textContent = keyword ? '지역을 찾는 중…' : ''
    if (!keyword) return
    try {
      const options = await request(`/api/admin/v1/regions/options?${new URLSearchParams({ keyword, limit:'20' })}`)
      if (!live() || requestSequence !== optionSequence) return
      $('region-option-results').replaceChildren()
      for (const option of options) {
        const button = document.createElement('button')
        button.type = 'button'; button.className = 'region-option-button'; button.dataset.code = option.region.sigunguCode
        button.innerHTML = `<strong>${escape(regionName(option.region))}</strong><small>${escape(option.region.sigunguCode)}</small>`
        button.addEventListener('click', () => select(option.region))
        $('region-option-results').append(button)
      }
      if (!options.length) $('region-option-results').textContent = '일치하는 시·군·구가 없습니다.'
    } catch (error) { if (live()) $('region-option-results').textContent = error.message }
  }
  $('region-option-find').addEventListener('click', searchOptions)
  if ($('region-source-find')) $('region-source-find').addEventListener('click', () => { $('region-option-search').value = sourceHint; void searchOptions() })
  $('region-option-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void searchOptions() } })
  $('region-option-search').addEventListener('input', () => { clearTimeout(optionTimer); optionTimer = setTimeout(searchOptions, 300) })
  $('region-note').addEventListener('input', update)
  document.querySelectorAll('.region-note-actions button').forEach(button => button.addEventListener('click', () => {
    const note = $('region-note')
    const text = button.textContent.trim()
    if (!note.value.split(' · ').includes(text)) note.value = note.value.trim() ? `${note.value.trim()} · ${text}` : text
    update()
  }))
  $('region-confirm').addEventListener('click', async () => {
    const note = $('region-note').value.trim()
    if (!chosen?.sigunguCode || !note || saving) return
    saving = true; update(); $('region-confirm-status').textContent = '시·군·구를 저장하는 중…'
    try {
      await request(`/api/admin/v1/regions/${item.toiletId}/district`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sigunguCode:chosen.sigunguCode, note, expectedLocation:item.location }) })
      saving = false
      await loadDetail(item.toiletId)
      await loadList(page)
      if (selected === item.toiletId && $('region-confirm-status')) $('region-confirm-status').textContent = `${regionName(chosen)}로 확정했습니다.`
    } catch (error) { if (live()) $('region-confirm-status').textContent = error.message }
    finally { saving = false; if (live() && $('region-confirm')) update() }
  })
  update()
}

function mountTechnical(id, sequence) {
  let loaded = false
  $('region-technical').addEventListener('toggle', () => {
    if ($('region-technical').open && !loaded) { loaded = true; void loadHistory(id, 0, sequence) }
  })
}

async function loadHistory(id, nextPage, sequence) {
  const historyRequest = ++historySequence
  try {
    const data = await request(`/api/admin/v1/regions/${id}/history?page=${nextPage}&size=5`)
    if (sequence !== detailSequence || historyRequest !== historySequence) return
    $('region-history').innerHTML = data.items.map(item => `<article class="region-history-item">${badge(item.status)}<div><strong>${escape(date(item.checkedAt))}</strong><p>${escape(reasonLabels[item.reason] || item.reason)}</p></div></article>`).join('') || '<p class="status">판정 이력이 없습니다.</p>'
    pagination('region-history-pages', data, p => loadHistory(id, p, sequence))
  } catch (error) { if (sequence === detailSequence && historyRequest === historySequence) $('region-history').textContent = error.message }
}

async function maps() {
  if (!mapReady) mapReady = (async () => {
    const response = await fetch('/api/admin/v1/map-config')
    if (!response.ok) throw new Error('지도 설정을 불러오지 못했습니다.')
    const config = await response.json()
    if (!config.enabled || !config.javascriptKey) throw new Error('지도 키 설정을 확인해 주세요.')
    if (!window.kakao?.maps?.services) {
      await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.javascriptKey)}&libraries=services&autoload=false`; script.onload = resolve; script.onerror = () => reject(new Error('지도를 불러오지 못했습니다.')); document.head.append(script) })
      await new Promise(resolve => window.kakao.maps.load(resolve))
    }
  })().catch(error => { mapReady = null; throw error })
  return mapReady
}

async function mountMap(item, sequence) {
  const live = () => sequence === detailSequence && selected === item.toiletId
  try {
    await maps()
    if (!live()) return
    const K = window.kakao.maps
    const initial = valid(item.location) ? new K.LatLng(item.location.latitude, item.location.longitude) : new K.LatLng(36.35, 127.38)
    const map = new K.Map($('region-map'), { center:initial, level:valid(item.location) ? 3 : 12 })
    const geocoder = new K.services.Geocoder()
    const places = new K.services.Places()
    const pin = (color) => new K.MarkerImage(`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="38"><path d="M12 11V36" stroke="${color}" stroke-width="3"/><circle cx="12" cy="10" r="8" fill="${color}" stroke="white" stroke-width="2"/></svg>`)}`, new K.Size(24,38), { offset:new K.Point(12,36) })
    if (valid(item.location)) new K.Marker({ map, position:initial, image:pin('#157d48'), title:'현재 위치' })
    const marker = new K.Marker({ position:initial, draggable:true, image:pin('#ee872c'), title:'저장할 위치' })
    const searchMarker = new K.Marker({ position:initial, image:pin('#356ad7'), title:'검색 위치' })
    marker.setZIndex(20)
    searchMarker.setZIndex(30)
    let draft = null, draftAddress = '', lookupSequence = 0, searchSequence = 0, searchTimer
    const reset = () => { if (saving) return; window.clearTimeout(searchTimer); ++lookupSequence; ++searchSequence; draft = null; draftAddress = ''; marker.setMap(null); searchMarker.setMap(null); map.setCenter(initial); map.setLevel(valid(item.location) ? 3 : 12); $('region-map-search').value = ''; $('region-save').disabled = true; $('region-candidates').replaceChildren(); $('region-draft').textContent = '저장할 위치를 지도에서 선택해 주세요.' }
    reset()
    const choose = position => {
      if (!live() || saving) return
      const lookup = ++lookupSequence
      draft = { latitude:position.getLat(), longitude:position.getLng() }
      draftAddress = ''
      marker.setPosition(position); marker.setMap(map); marker.setZIndex(20)
      $('region-save').disabled = true
      $('region-coordinate-edit').open = true
      $('region-draft').textContent = `${coordinate(draft)} · 주소 확인 중…`
      geocoder.coord2Address(draft.longitude, draft.latitude, (results, status) => {
        if (!live() || lookup !== lookupSequence) return
        const result = results?.[0]
        draftAddress = status === K.services.Status.OK ? result?.road_address?.address_name || result?.address?.address_name || '' : ''
        $('region-draft').textContent = `${coordinate(draft)} · ${draftAddress || '주소를 확인하지 못했습니다.'}`
        $('region-save').disabled = !draftAddress
      })
    }
    K.event.addListener(map, 'click', event => choose(event.latLng))
    K.event.addListener(marker, 'dragend', () => choose(marker.getPosition()))
    $('region-reset').addEventListener('click', reset)
    const moveToSearchResult = result => {
      const point = new K.LatLng(Number(result.y), Number(result.x))
      searchMarker.setPosition(point)
      searchMarker.setMap(map)
      searchMarker.setZIndex(30)
      map.setLevel(3)
      map.panTo(point)
      $('region-candidates').replaceChildren()
    }
    const showSearchResults = (results, type, moveFirst) => {
      const candidates = $('region-candidates')
      candidates.replaceChildren()
      const matches = results.slice(0, 5)
      if (!matches.length) { candidates.textContent = '검색 결과가 없습니다.'; return }
      if (moveFirst) { moveToSearchResult(matches[0]); return }
      for (const result of matches) {
        const name = type === 'place' ? result.place_name : result.address_name
        const foundAddress = type === 'place' ? result.road_address_name || result.address_name : result.address_name
        const button = document.createElement('button')
        button.type = 'button'
        button.role = 'option'
        button.textContent = name
        button.title = foundAddress && foundAddress !== name ? `${name} · ${foundAddress}` : name
        button.addEventListener('click', () => { if (!saving) moveToSearchResult(result) })
        candidates.append(button)
      }
    }
    const searchMap = (moveFirst = true) => {
      if (saving) return
      const text = $('region-map-search').value.trim()
      window.clearTimeout(searchTimer)
      if (text.length < 2) { ++searchSequence; $('region-candidates').replaceChildren(); return }
      const search = ++searchSequence
      $('region-candidates').textContent = '연관 위치를 찾는 중…'
      geocoder.addressSearch(text, (results, status) => {
        if (!live() || search !== searchSequence || saving) return
        if (status === K.services.Status.OK && results?.length) { showSearchResults(results, 'address', moveFirst); return }
        places.keywordSearch(text, (placeResults, placeStatus) => {
          if (!live() || search !== searchSequence || saving) return
          if (placeStatus === K.services.Status.OK && placeResults?.length) showSearchResults(placeResults, 'place', moveFirst)
          else { $('region-candidates').replaceChildren(); $('region-candidates').textContent = '검색 결과가 없습니다.' }
        }, { size:5 })
      })
    }
    $('region-map-find').addEventListener('click', () => searchMap(true))
    $('region-map-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchMap(true) } })
    $('region-map-search').addEventListener('input', () => {
      window.clearTimeout(searchTimer)
      const text = $('region-map-search').value.trim()
      if (text.length < 2) { ++searchSequence; $('region-candidates').replaceChildren(); return }
      searchTimer = window.setTimeout(() => searchMap(false), 280)
    })
    $('region-save').addEventListener('click', async () => {
      const note = $('region-coordinate-note').value.trim()
      if (!draft || !draftAddress || saving) return
      if (!note) { $('region-save-status').textContent = '수정 사유를 입력해 주세요.'; return }
      saving = true; $('region-save').disabled = true
      try {
        await request(`/api/admin/v1/regions/${item.toiletId}/coordinates`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...draft, note, expectedLocation:item.location }) })
        saving = false
        await loadDetail(item.toiletId)
        await loadList(page)
      } catch (error) { if (live()) { $('region-save-status').textContent = error.message; $('region-save').disabled = false } }
      finally { saving = false }
    })
  } catch (error) { if (live()) $('region-map').innerHTML = `<p>${escape(error.message)}</p>` }
}

function mountFilter() {
  const picker = document.querySelector('.region-filter-picker')
  const trigger = $('region-filter-trigger')
  const label = $('region-filter-label')
  const menu = $('region-filter-menu')
  const options = [...menu.querySelectorAll('[role="option"]')]

  const close = (focusTrigger = false) => {
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (focusTrigger) trigger.focus()
  }
  const open = () => {
    menu.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation()
    if (menu.hidden) open()
    else close()
  })
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      open()
      const selectedOption = options.find(option => option.getAttribute('aria-selected') === 'true') || options[0]
      selectedOption.focus()
    } else if (event.key === 'Escape') close()
  })
  options.forEach((option) => option.addEventListener('click', (event) => {
    event.stopPropagation()
    if (saving) return
    filterStatus = option.dataset.filter
    label.textContent = option.querySelector('span').textContent
    options.forEach(node => node.setAttribute('aria-selected', String(node === option)))
    close(true)
    void loadList(0)
  }))
  menu.addEventListener('keydown', (event) => {
    const current = options.indexOf(document.activeElement)
    if (event.key === 'Escape') { event.preventDefault(); close(true); return }
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? (current + 1) % options.length : (current - 1 + options.length) % options.length
    options[next].focus()
  })
  document.addEventListener('click', (event) => { if (!picker.contains(event.target)) close() })
}

async function start() {
  try {
    const profile = await request('/api/v1/auth/me')
    if (!profile.roles?.includes('ADMIN')) { showLogin(403); return }
    $('loading-shell').hidden = true
    $('region-shell').hidden = false
    mountFilter()
    $('region-refresh').addEventListener('click', () => { if (saving) return; void loadList(page); if (selected != null) void loadDetail(selected) })
    await loadList()
    if (Number.isSafeInteger(initialToiletId) && initialToiletId > 0) await loadDetail(initialToiletId)
  } catch { showLogin(401) }
}
void start()
