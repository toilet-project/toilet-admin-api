const $ = (id) => document.getElementById(id)
const API = 'https://api.geupddong.com'
const labels = { VERIFIED:'검증 통과', MISMATCH:'지역 불일치', ADDRESS_UNVERIFIED:'주소 검증 불확실', REVERSE_FAILED:'역조회·코드 충돌', NO_COORDINATE:'좌표 미입력', STALE:'재판정 대기', UNASSESSED:'최초 판정 대기' }
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
const address = (location) => location?.roadAddress?.trim() || location?.jibunAddress?.trim() || '주소 정보 없음'
const valid = (location) => location?.latitude != null && location?.longitude != null && String(location.latitude).trim() !== '' && String(location.longitude).trim() !== '' && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
const coordinate = (location) => valid(location) ? `${Number(location.latitude).toFixed(7)}, ${Number(location.longitude).toFixed(7)}` : '좌표 없음'
const date = (value) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Seoul' }).format(new Date(value)) : '판정 이력 없음'
const badge = (status) => `<span class="region-badge ${status === 'VERIFIED' ? 'verified' : ''}">${escape(labels[status] || status)}</span>`
let page = 0, selected = null, listSequence = 0, detailSequence = 0, historySequence = 0, mapReady, searchTimer, saving = false

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
    throw new Error(response.status === 409 ? '위치나 주소가 변경되었습니다. 새로고침 후 다시 확인해 주세요.' : body?.message || '요청에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return response.json()
}

function pagination(id, data, load) {
  const target = $(id)
  target.replaceChildren()
  if (data.totalPages <= 1) return
  for (const [label, next, disabled] of [['이전',data.page-1,data.page === 0],[`${data.page+1} / ${data.totalPages}`,null,true],['다음',data.page+1,data.page+1 >= data.totalPages]]) {
    const node = document.createElement(next == null ? 'span' : 'button')
    node.textContent = label
    if (next != null) { node.type = 'button'; node.disabled = disabled; node.addEventListener('click', () => load(next)) }
    target.append(node)
  }
}

async function loadList(nextPage = 0) {
  const sequence = ++listSequence
  $('region-status').textContent = '목록을 불러오는 중…'
  try {
    const query = new URLSearchParams({ status:$('region-filter').value, keyword:$('region-search').value.trim(), page:String(nextPage), size:'20' })
    const data = await request(`/api/admin/v1/regions?${query}`)
    if (sequence !== listSequence || !$('auth-shell').hidden) return
    page = data.page
    $('region-list').replaceChildren()
    for (const item of data.items) {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'region-item'; button.dataset.id = item.toiletId
      button.setAttribute('aria-pressed', String(selected === item.toiletId))
      button.innerHTML = `${badge(item.status)}<strong>${escape(item.name || '이름 없는 화장실')}</strong><small>${escape(address(item.location))}</small><small>#${item.toiletId} · ${escape(date(item.checkedAt))}</small>`
      button.addEventListener('click', () => { if (!saving) void loadDetail(item.toiletId) })
      $('region-list').append(button)
    }
    $('region-status').textContent = `${data.totalElements.toLocaleString()}건 · 오래된 판정부터 표시`
    if (!data.items.length) $('region-list').textContent = '조건에 맞는 화장실이 없습니다.'
    pagination('region-pages', data, loadList)
  } catch (error) { if (sequence === listSequence) $('region-status').textContent = error.message }
}

function evidence(value) {
  if (!value) return '판정 근거 없음'
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return String(value) }
}

async function loadDetail(id) {
  if (saving) return
  selected = id
  const sequence = ++detailSequence
  document.querySelectorAll('.region-item').forEach(node => node.setAttribute('aria-pressed', String(Number(node.dataset.id) === id)))
  const target = $('region-detail')
  target.innerHTML = '<p class="status">상세를 불러오는 중…</p>'
  try {
    const detail = await request(`/api/admin/v1/regions/${id}`)
    if (sequence !== detailSequence) return
    const item = detail.toilet
    target.innerHTML = `<h2>${escape(item.name || '이름 없는 화장실')}</h2>${badge(item.status)}
      <dl><dt>관리번호</dt><dd>${escape(item.managementNumber || '-')}</dd><dt>현재 도로명</dt><dd>${escape(item.location.roadAddress || '-')}</dd><dt>현재 지번</dt><dd>${escape(item.location.jibunAddress || '-')}</dd><dt>현재 좌표</dt><dd>${escape(coordinate(item.location))}</dd><dt>최근 판정</dt><dd>${escape(date(item.checkedAt))}</dd><dt>판정 사유</dt><dd>${escape(item.reason || '-')}</dd></dl>
      <details><summary>최근 판정 당시 지역·주소·원본 근거</summary><p>현재 위치와 달라졌다면 아래는 이전 판정 자료이며 현재 확정 지역이 아닙니다.</p><dl><dt>판정 상태</dt><dd>${escape(item.assessmentStatus || '-')}</dd><dt>시·도</dt><dd>${escape(item.sidoName || '-')} / ${escape(item.sidoCode || '-')}</dd><dt>시·군·구</dt><dd>${escape(item.sigunguName || '-')} / ${escape(item.sigunguCode || '-')}</dd><dt>시 → 구</dt><dd>${escape(item.cityName || '-')} → ${escape(item.districtName || '-')}</dd><dt>당시 좌표</dt><dd>${escape(coordinate(detail.assessedSource))}</dd><dt>당시 주소</dt><dd>${escape(address(detail.assessedSource))}</dd></dl><pre>${escape(evidence(detail.evidenceJson))}</pre></details>
      <fieldset><legend>관리자 확정 위치</legend><p>주황색 핀은 저장할 위치, 초록색 핀은 현재 위치입니다. 좌표가 없으면 검색 결과를 선택하거나 지도를 클릭해야 합니다.</p><div class="region-map-toolbar"><input id="region-map-search" aria-label="지도 주소 검색" placeholder="도로명 또는 지번주소 검색"/><button id="region-map-find" type="button">검색</button><button id="region-reset" type="button" aria-label="기존 좌표로 초기화">↻</button></div><div id="region-candidates"></div><div id="region-map" class="region-map"></div><strong id="region-draft"></strong><label>수정 사유 (필수)<textarea id="region-note" maxlength="500" rows="2"></textarea></label><p id="region-save-status" class="status" role="status"></p><button id="region-save" type="button" disabled>확정 좌표 저장</button></fieldset>
      <h3>판정 이력</h3><div id="region-history"></div><nav id="region-history-pages" class="report-pagination" aria-label="판정 이력 페이지"></nav>`
    void loadHistory(id, 0, sequence)
    if (window.matchMedia('(max-width: 900px)').matches) target.scrollIntoView({ block:'start', behavior:'smooth' })
    await mountMap(item, sequence)
  } catch (error) { if (sequence === detailSequence) target.textContent = error.message }
}

async function loadHistory(id, nextPage, sequence) {
  const historyRequest = ++historySequence
  try {
    const data = await request(`/api/admin/v1/regions/${id}/history?page=${nextPage}&size=10`)
    if (sequence !== detailSequence || historyRequest !== historySequence) return
    $('region-history').innerHTML = data.items.map(item => `<article class="region-history-item">${badge(item.status)}<p>${escape(date(item.checkedAt))} · ${escape(item.algorithmVersion)}</p><p>${escape(item.reason)}</p><details><summary>판정 근거</summary><pre>${escape(evidence(item.evidenceJson))}</pre></details></article>`).join('') || '<p>판정 이력이 없습니다.</p>'
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
    const pin = (color) => new K.MarkerImage(`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="38"><path d="M12 11V36" stroke="${color}" stroke-width="3"/><circle cx="12" cy="10" r="8" fill="${color}" stroke="white" stroke-width="2"/></svg>`)}`, new K.Size(24,38), { offset:new K.Point(12,36) })
    if (valid(item.location)) new K.Marker({ map, position:initial, image:pin('#157d48'), title:'현재 위치' })
    const marker = new K.Marker({ position:initial, draggable:true, image:pin('#ee872c'), title:'저장할 위치' })
    let draft = null, draftAddress = '', lookupSequence = 0, searchSequence = 0
    const reset = () => { if (saving) return; ++lookupSequence; ++searchSequence; draft = null; draftAddress = ''; marker.setMap(null); map.setCenter(initial); map.setLevel(valid(item.location) ? 3 : 12); $('region-save').disabled = true; $('region-candidates').replaceChildren(); $('region-draft').textContent = '저장할 위치를 지도에서 선택해 주세요.' }
    reset()
    const choose = position => {
      if (!live() || saving) return
      const lookup = ++lookupSequence
      draft = { latitude:position.getLat(), longitude:position.getLng() }
      draftAddress = ''
      marker.setPosition(position); marker.setMap(map)
      $('region-save').disabled = true
      $('region-draft').textContent = `${coordinate(draft)} · 주소 확인 중…`
      geocoder.coord2Address(draft.longitude, draft.latitude, (results, status) => {
        if (!live() || lookup !== lookupSequence) return
        const result = results?.[0]
        draftAddress = status === K.services.Status.OK ? result?.road_address?.address_name || result?.address?.address_name || '' : ''
        $('region-draft').textContent = `${coordinate(draft)} · ${draftAddress || '주소를 확인하지 못했습니다. 다른 위치를 선택해 주세요.'}`
        $('region-save').disabled = !draftAddress
      })
    }
    K.event.addListener(map, 'click', event => choose(event.latLng))
    K.event.addListener(marker, 'dragend', () => choose(marker.getPosition()))
    $('region-reset').addEventListener('click', reset)
    $('region-map-find').addEventListener('click', () => {
      if (saving) return
      const text = $('region-map-search').value.trim()
      if (!text) return
      const search = ++searchSequence
      $('region-candidates').textContent = '주소 검색 중…'
      geocoder.addressSearch(text, (results, status) => {
        if (!live() || search !== searchSequence || saving) return
        $('region-candidates').replaceChildren()
        if (status !== K.services.Status.OK || !results?.length) { $('region-candidates').textContent = '검색 결과가 없습니다. 주소를 바꾸거나 지도를 클릭해 주세요.'; return }
        for (const result of results.slice(0, 5)) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = result.address_name
          button.addEventListener('click', () => { if (saving) return; const point = new K.LatLng(Number(result.y), Number(result.x)); map.setCenter(point); map.setLevel(3); choose(point) })
          $('region-candidates').append(button)
        }
      })
    })
    $('region-save').addEventListener('click', async () => {
      const note = $('region-note').value.trim()
      if (!draft || !draftAddress || saving) return
      if (!note) { $('region-save-status').textContent = '수정 사유를 입력해 주세요.'; return }
      if (!window.confirm(`${item.name}\n${coordinate(draft)}\n${draftAddress}\n이 위치로 확정할까요? 서버에서 두 주소를 다시 확인하고 이력을 남깁니다.`)) return
      saving = true
      $('region-save').disabled = true
      try {
        await request(`/api/admin/v1/regions/${item.toiletId}/coordinates`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...draft, note, expectedLocation:item.location }) })
        saving = false
        await loadDetail(item.toiletId)
        await loadList(page)
        if (live() || selected === item.toiletId) $('region-save-status').textContent = '좌표와 주소를 저장했습니다. 새로고침으로 자동 재판정 결과를 확인해 주세요.'
      } catch (error) { if (live()) { $('region-save-status').textContent = error.message; $('region-save').disabled = false } }
      finally { saving = false }
    })
  } catch (error) { if (live()) { $('region-map').textContent = error.message; $('region-save-status').textContent = '지도 로딩 실패로 저장할 수 없습니다. 새로고침해 주세요.' } }
}

async function start() {
  try {
    const profile = await request('/api/v1/auth/me')
    if (!profile.roles?.includes('ADMIN')) { showLogin(403); return }
    $('loading-shell').hidden = true
    $('region-shell').hidden = false
    $('region-filter').addEventListener('change', () => { if (!saving) void loadList(0) })
    $('region-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (!saving) void loadList(0) }, 250) })
    $('region-refresh').addEventListener('click', () => { if (saving) return; void loadList(page); if (selected != null) void loadDetail(selected) })
    await loadList()
  } catch { showLogin(401) }
}
void start()
