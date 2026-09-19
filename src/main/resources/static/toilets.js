const $ = id => document.getElementById(id)
const API = 'https://api.geupddong.com'
const PAGE_SIZE = 15
const number = value => new Intl.NumberFormat('ko-KR').format(Number(value || 0))
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char])
const primaryAddress = value => value?.roadAddress?.trim() || value?.jibunAddress?.trim() || '주소 정보 없음'
const regionName = value => value?.sigunguName ? `${value.sidoName || ''} ${value.sigunguName}`.trim() : value?.sidoName || '지역 미확정'
const coordinateText = value => validCoordinates(value) ? `${Number(value.latitude).toFixed(7)}, ${Number(value.longitude).toFixed(7)}` : '좌표 없음'
const validCoordinates = value => value?.latitude != null && value?.longitude != null && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude))

let page = 0
let listData = { items:[], page:0, totalPages:0, totalElements:0 }
let selectedId = selectedFromUrl()
let selectedDetail = null
let regions = []
let listSequence = 0
let detailSequence = 0
let suggestionSequence = 0
let mapSequence = 0
let listAbort = null
let suggestionAbort = null
let searchTimer = null
let suggestionTimer = null
let composing = false
let kakaoReady = null
let saving = false
let legacyPreview = false

const legacySidoNames = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시',
  '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '전남광주통합특별시', '경상북도', '경상남도', '제주특별자치도'
]

const fieldGroups = [
  { title:'기본 정보', fields:[
    ['name','화장실명','text',100], ['toiletType','구분','text',20], ['agencyName','관리 기관','text',100],
    ['phoneNumber','전화번호','text',20], ['openTime','개방 시간','text',50], ['openTimeDetail','개방 시간 상세','textarea',255],
    ['installationDate','설치일','text',20]
  ]},
  { title:'주소·좌표', fields:[
    ['roadAddress','도로명주소','textarea',255], ['jibunAddress','지번주소','textarea',255],
    ['latitude','위도','coordinate',null], ['longitude','경도','coordinate',null]
  ]},
  { title:'시설 수', fields:[
    ['maleToiletCount','남성 대변기','number'], ['maleUrinalCount','남성 소변기','number'],
    ['maleDisabledToiletCount','남성 장애인 대변기','number'], ['maleDisabledUrinalCount','남성 장애인 소변기','number'],
    ['maleChildToiletCount','남성 어린이 대변기','number'], ['maleChildUrinalCount','남성 어린이 소변기','number'],
    ['femaleToiletCount','여성 대변기','number'], ['femaleDisabledToiletCount','여성 장애인 대변기','number'],
    ['femaleChildToiletCount','여성 어린이 대변기','number']
  ]},
  { title:'안전·편의', fields:[
    ['hasEmergencyBell','비상벨','text',10], ['emergencyBellLocation','비상벨 위치','text',100],
    ['hasCctv','CCTV','text',10], ['hasDiaperTable','기저귀 교환대','text',10],
    ['diaperTableLocation','교환대 위치','text',100]
  ]}
]
const fieldDefinitions = fieldGroups.flatMap(group => group.fields)

function selectedFromUrl() {
  const value = new URLSearchParams(window.location.search).get('toiletId')
  return value && /^\d+$/.test(value) ? Number(value) : null
}

function updateUrl(id) {
  const url = new URL(window.location.href)
  if (id == null) url.searchParams.delete('toiletId')
  else url.searchParams.set('toiletId', String(id))
  window.history.replaceState({}, '', url)
}

function showLogin(status) {
  $('loading-shell').hidden = true
  $('toilet-shell').hidden = true
  $('auth-shell').hidden = false
  $('auth-title').textContent = status === 403 ? '관리자 권한이 필요합니다' : '관리자 로그인'
  $('auth-description').textContent = status === 403 ? '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.' : '승인된 관리자 계정으로 로그인해 주세요.'
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials:'include', ...options })
  if (response.status === 401 || response.status === 403) showLogin(response.status)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = response.status === 409
      ? '다른 작업에서 화장실 정보가 변경되었습니다. 최신 값을 다시 불러와 주세요.'
      : body?.error?.message || body?.message || '요청을 처리하지 못했습니다.'
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return response.json()
}

async function legacyRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials:'include', ...options })
  if (response.status === 401 || response.status === 403) showLogin(response.status)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = new Error(body?.error?.message || body?.message || '실데이터 프리뷰를 불러오지 못했습니다.')
    error.status = response.status
    throw error
  }
  return response.json()
}

function legacyRegion(item) {
  return {
    sidoName:item.sidoName || null,
    sidoCode:item.sidoCode || null,
    sigunguName:item.sigunguName || null,
    sigunguCode:item.sigunguCode || null,
    cityName:item.cityName || null,
    districtName:item.districtName || null
  }
}

function legacyListItem(item) {
  return {
    id:item.toiletId,
    name:item.name,
    toiletType:null,
    roadAddress:item.location?.roadAddress || null,
    jibunAddress:item.location?.jibunAddress || null,
    latitude:item.location?.latitude ?? null,
    longitude:item.location?.longitude ?? null,
    managementNumber:item.managementNumber || null,
    visibilityStatus:'VISIBLE',
    region:legacyRegion(item)
  }
}

function selectedRegionLabel() {
  const sido = $('toilet-sido')
  const sigungu = $('toilet-sigungu')
  return [sido.selectedOptions[0]?.textContent, sigungu.value ? sigungu.selectedOptions[0]?.textContent : '']
    .filter(value => value && !value.startsWith('전체 ')).join(' ')
}

function matchesSelectedRegion(item) {
  const sidoCode = $('toilet-sido').value
  const sigunguCode = $('toilet-sigungu').value
  return (!sidoCode || item.sidoCode === sidoCode) && (!sigunguCode || item.sigunguCode === sigunguCode)
}

async function loadLegacyList(targetPage, signal) {
  const nameKeyword = $('toilet-search').value.trim()
  const regionKeyword = selectedRegionLabel()
  const keyword = nameKeyword || regionKeyword
  const query = new URLSearchParams({ status:'ALL', keyword, page:String(Math.max(targetPage, 0)), size:String(PAGE_SIZE) })
  const data = await legacyRequest(`/api/admin/v1/regions?${query}`, { signal })
  const filtered = nameKeyword && regionKeyword ? data.items.filter(matchesSelectedRegion) : data.items
  return {
    items:filtered.map(legacyListItem), page:data.page, size:data.size,
    totalElements:nameKeyword && regionKeyword ? filtered.length : data.totalElements,
    totalPages:nameKeyword && regionKeyword ? (filtered.length ? 1 : 0) : data.totalPages
  }
}

function pageWindow(current, total) {
  const count = Math.min(5, total)
  const start = Math.min(Math.max(current - Math.floor(count / 2), 0), Math.max(total - count, 0))
  return Array.from({ length:count }, (_, index) => start + index)
}

function renderPagination() {
  const target = $('toilet-pagination')
  target.replaceChildren()
  if (listData.totalPages <= 1) return
  const current = Math.min(Math.max(listData.page, 0), listData.totalPages - 1)
  const icons = {
    first:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 7-5 5 5 5M18 7l-5 5 5 5"/></svg>',
    previous:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7-5 5 5 5"/></svg>',
    next:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 5 5-5 5"/></svg>',
    last:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 7 5 5-5 5M13 7l5 5-5 5"/></svg>'
  }
  const add = (label, destination, disabled, icon = null) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.disabled = disabled
    if (icon) { button.innerHTML = icons[icon]; button.setAttribute('aria-label', label); button.title = label }
    else button.textContent = label
    if (!icon && destination === current) button.setAttribute('aria-current', 'page')
    if (!disabled) button.addEventListener('click', () => void loadList(destination))
    target.append(button)
  }
  add('맨앞', 0, current === 0, 'first')
  add('이전', current - 1, current === 0, 'previous')
  pageWindow(current, listData.totalPages).forEach(next => add(String(next + 1), next, next === current))
  add('다음', current + 1, current === listData.totalPages - 1, 'next')
  add('맨뒤', listData.totalPages - 1, current === listData.totalPages - 1, 'last')
}

function renderList() {
  const target = $('toilet-list')
  target.replaceChildren()
  if (!listData.items.length) {
    target.innerHTML = '<p class="toilet-list-empty">검색 조건에 맞는 화장실이 없습니다.</p>'
  } else {
    for (const item of listData.items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'toilet-list-item'
      button.setAttribute('aria-pressed', String(item.id === selectedId))
      const visible = item.visibilityStatus === 'VISIBLE'
      button.innerHTML = `<span class="toilet-list-name"><strong>${escapeHtml(item.name || '이름 없는 화장실')}</strong><em class="${visible ? '' : 'hidden'}">${visible ? escapeHtml(item.toiletType || '화장실') : '숨김'}</em></span><span class="toilet-list-address">${escapeHtml(primaryAddress(item))}</span><span class="toilet-list-meta"><b>${escapeHtml(regionName(item.region))}</b><span>ID ${item.id}${item.managementNumber ? ` · ${escapeHtml(item.managementNumber)}` : ''}</span></span>`
      button.addEventListener('click', () => void selectToilet(item.id))
      target.append(button)
    }
  }
  $('toilet-list-count').textContent = `${number(listData.totalElements)}개`
  renderPagination()
}

function listQuery(targetPage) {
  const query = new URLSearchParams({
    keyword:$('toilet-search').value.trim(),
    sidoCode:$('toilet-sido').value,
    sigunguCode:$('toilet-sigungu').value,
    page:String(Math.max(targetPage, 0)),
    size:String(PAGE_SIZE)
  })
  return query
}

async function loadList(targetPage = 0) {
  const sequence = ++listSequence
  listAbort?.abort()
  listAbort = new AbortController()
  const status = $('toilet-status')
  status.querySelector('span').textContent = '검색 결과를 불러오는 중입니다.'
  try {
    let data
    if (legacyPreview) data = await loadLegacyList(targetPage, listAbort.signal)
    else {
      try {
        data = await request(`/api/admin/v1/toilets?${listQuery(targetPage)}`, { signal:listAbort.signal })
      } catch (error) {
        if (error.status !== 404) throw error
        legacyPreview = true
        data = await loadLegacyList(targetPage, listAbort.signal)
      }
    }
    if (sequence !== listSequence) return
    listData = data
    page = data.page
    renderList()
    status.querySelector('span').textContent = data.totalElements
      ? `${number(data.totalElements)}개 시설 · ${data.page + 1}페이지`
      : '검색 조건에 맞는 화장실이 없습니다.'
    if (selectedId && !selectedDetail) void loadDetail(selectedId)
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== listSequence) return
    listData = { items:[], page:0, totalPages:0, totalElements:0 }
    renderList()
    status.querySelector('span').textContent = error.message
    status.classList.add('is-error')
  }
}

function closeSuggestions() {
  $('toilet-suggestions').hidden = true
  $('toilet-suggestions').replaceChildren()
}

function renderSuggestions(items) {
  const target = $('toilet-suggestions')
  target.replaceChildren()
  if (!items.length) {
    target.innerHTML = '<span class="toilet-list-empty">연관된 화장실명이 없습니다.</span>'
  } else {
    for (const item of items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'toilet-suggestion'
      button.setAttribute('role', 'option')
      button.innerHTML = `<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.address)}</small></span><i>ID ${item.id}</i>`
      button.addEventListener('click', () => {
        $('toilet-search').value = item.name
        $('toilet-search-clear').hidden = false
        closeSuggestions()
        selectedId = item.id
        selectedDetail = null
        updateUrl(item.id)
        void Promise.all([loadList(0), loadDetail(item.id)])
      })
      target.append(button)
    }
  }
  target.hidden = false
}

async function loadSuggestions() {
  const keyword = $('toilet-search').value.trim()
  if (!keyword) return closeSuggestions()
  const sequence = ++suggestionSequence
  suggestionAbort?.abort()
  suggestionAbort = new AbortController()
  try {
    let items
    if (legacyPreview) {
      const data = await legacyRequest(`/api/admin/v1/regions?status=ALL&keyword=${encodeURIComponent(keyword)}&page=0&size=8`, { signal:suggestionAbort.signal })
      items = data.items.map(item => ({ id:item.toiletId, name:item.name, address:item.location?.roadAddress || item.location?.jibunAddress || '주소 정보 없음' }))
    } else {
      try {
        items = await request(`/api/admin/v1/toilets/suggestions?keyword=${encodeURIComponent(keyword)}&limit=8`, { signal:suggestionAbort.signal })
      } catch (error) {
        if (error.status !== 404) throw error
        legacyPreview = true
        const data = await legacyRequest(`/api/admin/v1/regions?status=ALL&keyword=${encodeURIComponent(keyword)}&page=0&size=8`, { signal:suggestionAbort.signal })
        items = data.items.map(item => ({ id:item.toiletId, name:item.name, address:item.location?.roadAddress || item.location?.jibunAddress || '주소 정보 없음' }))
      }
    }
    if (sequence === suggestionSequence && $('toilet-search').value.trim() === keyword) renderSuggestions(items)
  } catch (error) {
    if (error.name !== 'AbortError' && sequence === suggestionSequence) closeSuggestions()
  }
}

function bindSearch() {
  const input = $('toilet-search')
  const schedule = () => {
    $('toilet-search-clear').hidden = !input.value
    window.clearTimeout(searchTimer)
    window.clearTimeout(suggestionTimer)
    ++listSequence
    ++suggestionSequence
    listAbort?.abort()
    suggestionAbort?.abort()
    if (composing) return
    searchTimer = window.setTimeout(() => void loadList(0), 320)
    suggestionTimer = window.setTimeout(() => void loadSuggestions(), 180)
  }
  input.addEventListener('compositionstart', () => { composing = true; window.clearTimeout(searchTimer); window.clearTimeout(suggestionTimer) })
  input.addEventListener('compositionend', () => { composing = false; schedule() })
  input.addEventListener('input', event => { if (!event.isComposing && !composing) schedule() })
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSuggestions(); input.blur(); return }
    if (event.key !== 'Enter' || event.isComposing || composing || event.keyCode === 229) return
    event.preventDefault()
    window.clearTimeout(searchTimer); window.clearTimeout(suggestionTimer); closeSuggestions(); void loadList(0)
  })
  $('toilet-search-clear').addEventListener('click', () => { input.value = ''; closeSuggestions(); schedule(); input.focus() })
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.toilet-search-wrap')) closeSuggestions() })
}

async function loadRegions() {
  try {
    regions = await request('/api/admin/v1/toilets/regions')
  } catch (error) {
    if (error.status !== 404) throw error
    legacyPreview = true
    const batches = await Promise.all(legacySidoNames.map(name => legacyRequest(`/api/admin/v1/regions/options?keyword=${encodeURIComponent(name)}&limit=50`)))
    regions = batches.flat().map(item => item.region)
  }
  const sido = $('toilet-sido')
  const unique = new Map(regions.map(item => [item.sidoCode, item.sidoName]))
  for (const [value, label] of unique) sido.add(new Option(label, value))
}

function populateSigungu() {
  const sidoCode = $('toilet-sido').value
  const sigungu = $('toilet-sigungu')
  sigungu.replaceChildren(new Option('전체 시·군·구', ''))
  regions.filter(item => item.sidoCode === sidoCode).forEach(item => sigungu.add(new Option(item.sigunguName, item.sigunguCode)))
  sigungu.disabled = !sidoCode
}

async function selectToilet(id) {
  selectedId = id
  selectedDetail = null
  updateUrl(id)
  renderList()
  await loadDetail(id)
}

async function loadDetail(id) {
  const sequence = ++detailSequence
  $('toilet-map-card').innerHTML = '<div class="toilet-empty is-map"><span>LOCATION</span><strong>위치를 불러오는 중입니다.</strong></div>'
  $('toilet-editor-card').innerHTML = '<div class="toilet-empty"><span>DETAIL EDITOR</span><strong>시설 정보를 불러오는 중입니다.</strong></div>'
  try {
    let data
    if (legacyPreview) {
      const [editable, regionDetail] = await Promise.all([
        legacyRequest(`/api/v1/toilets/${id}`),
        legacyRequest(`/api/admin/v1/regions/${id}`)
      ])
      data = {
        id, managementNumber:regionDetail.toilet?.managementNumber || null,
        visibilityStatus:'VISIBLE', coordinateSource:null, snapshotToken:'preview-read-only',
        region:legacyRegion(regionDetail.toilet || {}), editable
      }
    } else data = await request(`/api/admin/v1/toilets/${id}`)
    if (sequence !== detailSequence || selectedId !== id) return
    selectedDetail = data
    renderList()
    renderDetail(data)
  } catch (error) {
    if (sequence !== detailSequence) return
    $('toilet-map-card').innerHTML = `<div class="toilet-empty"><strong>${escapeHtml(error.message)}</strong></div>`
    $('toilet-editor-card').innerHTML = `<div class="toilet-empty"><strong>${escapeHtml(error.message)}</strong></div>`
  }
}

function displayValue(value) {
  return value == null || String(value).trim() === '' ? '—' : String(value)
}

function inputMarkup(definition, editable) {
  const [key, label, type, maximum] = definition
  const value = editable[key]
  const common = `id="edit-${key}" data-field="${key}" aria-label="${escapeHtml(label)} 수정값"`
  let control
  if (type === 'textarea') control = `<textarea ${common}${maximum ? ` maxlength="${maximum}"` : ''}>${escapeHtml(value ?? '')}</textarea>`
  else if (type === 'number') control = `<input ${common} type="number" min="0" step="1" value="${escapeHtml(value ?? '')}"/>`
  else if (type === 'coordinate') control = `<input ${common} type="text" value="${escapeHtml(value ?? '')}" readonly/>`
  else control = `<input ${common} type="text"${maximum ? ` maxlength="${maximum}"` : ''} value="${escapeHtml(value ?? '')}"/>`
  return `<div class="toilet-compare-row"><label for="edit-${key}">${escapeHtml(label)}</label><span class="toilet-current-value" title="${escapeHtml(displayValue(value))}">${escapeHtml(displayValue(value))}</span>${control}</div>`
}

function renderDetail(detail) {
  const item = detail.editable
  $('toilet-map-card').innerHTML = `<header class="toilet-card-head"><div><small>LOCATION</small><h2>${escapeHtml(item.name)}</h2></div><div class="toilet-card-actions"><button id="toilet-origin" class="secondary-button" type="button">기존 위치</button></div></header><form id="toilet-map-search-form" class="toilet-map-toolbar"><input id="toilet-map-search" type="search" autocomplete="off" placeholder="지도에서 장소나 주소 찾기"/><button type="submit">이동</button></form><div id="toilet-map" class="toilet-map"></div><footer class="toilet-map-foot"><span>지도를 누르거나 주황 핀을 움직여 수정 좌표를 지정합니다.</span><strong id="toilet-coordinate-status">${escapeHtml(coordinateText(item))}</strong></footer>`
  const groups = fieldGroups.map(group => `<section class="toilet-edit-section"><h3>${escapeHtml(group.title)}</h3><div class="toilet-compare-head"><span>항목</span><span>현재값</span><span>수정값</span></div>${group.fields.map(field => inputMarkup(field, item)).join('')}</section>`).join('')
  $('toilet-editor-card').innerHTML = `<header class="toilet-card-head"><div><small>DETAIL EDITOR</small><h2>${escapeHtml(item.name)}</h2></div><div class="toilet-editor-meta"><span>ID ${detail.id}</span><span>${escapeHtml(detail.managementNumber || '관리번호 없음')}</span><span>${escapeHtml(regionName(detail.region))}</span><span>${escapeHtml(detail.visibilityStatus)}</span></div></header><div class="toilet-editor-scroll">${groups}</div><footer class="toilet-save-bar"><p id="toilet-save-status">${legacyPreview ? '실데이터 프리뷰에서는 저장하지 않습니다.' : '변경된 항목이 없습니다.'}</p><div class="toilet-card-actions"><button id="toilet-reset-form" class="secondary-button" type="button" disabled>되돌리기</button><button id="toilet-save" type="button" disabled>${legacyPreview ? '프리뷰 저장 차단' : '변경 저장'}</button></div></footer>`
  document.querySelectorAll('#toilet-editor-card [data-field]').forEach(input => input.addEventListener('input', updateDirtyState))
  $('toilet-reset-form').addEventListener('click', () => renderDetail(selectedDetail))
  $('toilet-save').addEventListener('click', () => void saveDetail())
  updateDirtyState()
  void drawMap(detail)
}

function collectEditable() {
  const result = {}
  for (const [key,,type] of fieldDefinitions) {
    const input = $(`edit-${key}`)
    if (!input) continue
    const value = input.value.trim()
    if (type === 'number') result[key] = value === '' ? null : Number(value)
    else if (type === 'coordinate') result[key] = value === '' ? null : Number(value)
    else result[key] = value === '' ? null : value
  }
  return result
}

function changedKeys() {
  if (!selectedDetail) return []
  const current = collectEditable()
  return fieldDefinitions.map(field => field[0]).filter(key => {
    const left = selectedDetail.editable[key] == null || selectedDetail.editable[key] === '' ? null : selectedDetail.editable[key]
    const right = current[key]
    if (typeof left === 'number' || typeof right === 'number') return Number(left) !== Number(right)
    return left !== right
  })
}

function updateDirtyState() {
  const changed = changedKeys()
  const status = $('toilet-save-status')
  if (!status) return
  status.textContent = legacyPreview
    ? (changed.length ? `${changed.length}개 수정값을 프리뷰 중입니다. 운영 데이터에는 반영되지 않습니다.` : '실데이터 프리뷰에서는 저장하지 않습니다.')
    : (changed.length ? `${changed.length}개 항목이 변경되었습니다.` : '변경된 항목이 없습니다.')
  status.classList.toggle('is-dirty', changed.length > 0)
  $('toilet-save').disabled = legacyPreview || !changed.length || saving
  $('toilet-reset-form').disabled = !changed.length || saving
}

async function saveDetail() {
  if (legacyPreview) return
  if (!selectedDetail || saving || !changedKeys().length) return
  if (!window.confirm(`${selectedDetail.editable.name}의 변경 내용을 저장할까요?`)) return
  saving = true
  updateDirtyState()
  $('toilet-save-status').textContent = '변경 내용을 저장하는 중입니다.'
  try {
    const updated = await request(`/api/admin/v1/toilets/${selectedDetail.id}`, {
      method:'PUT', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ snapshotToken:selectedDetail.snapshotToken, editable:collectEditable() })
    })
    selectedDetail = updated
    renderDetail(updated)
    await loadList(page)
    $('toilet-status').querySelector('span').textContent = `${updated.editable.name}의 변경 내용을 저장했습니다.`
  } catch (error) {
    $('toilet-save-status').textContent = error.message
    $('toilet-save-status').classList.add('is-dirty')
  } finally {
    saving = false
    updateDirtyState()
  }
}

async function loadKakaoMaps() {
  if (window.kakao?.maps?.services) return
  if (!kakaoReady) kakaoReady = (async () => {
    const response = await fetch('/api/admin/v1/map-config')
    if (!response.ok) throw new Error('지도 설정을 불러오지 못했습니다.')
    const config = await response.json()
    if (!config.enabled || !config.javascriptKey) throw new Error('카카오 지도 키가 설정되지 않았습니다.')
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.javascriptKey)}&libraries=services&autoload=false`
      script.onload = resolve
      script.onerror = () => reject(new Error('카카오 지도를 불러오지 못했습니다.'))
      document.head.append(script)
    })
    await new Promise(resolve => window.kakao.maps.load(resolve))
  })()
  return kakaoReady
}

function markerImage(K, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46"><path fill="${color}" stroke="white" stroke-width="2" d="M19 1C9.6 1 2 8.6 2 18c0 12.2 17 27 17 27s17-14.8 17-27C36 8.6 28.4 1 19 1z"/><circle cx="19" cy="18" r="6" fill="white"/></svg>`
  return new K.MarkerImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, new K.Size(38,46), { offset:new K.Point(19,45) })
}

async function drawMap(detail) {
  const sequence = ++mapSequence
  const target = $('toilet-map')
  try {
    await loadKakaoMaps()
    if (sequence !== mapSequence || selectedId !== detail.id || !target?.isConnected) return
    const K = window.kakao.maps
    const original = detail.editable
    const fallback = new K.LatLng(37.5665, 126.9780)
    const initial = validCoordinates(original) ? new K.LatLng(Number(original.latitude), Number(original.longitude)) : fallback
    const map = new K.Map(target, { center:initial, level:validCoordinates(original) ? 3 : 12 })
    const currentMarker = validCoordinates(original) ? new K.Marker({ map, position:initial, image:markerImage(K,'#187343'), title:'현재 등록 위치' }) : null
    if (currentMarker) currentMarker.setZIndex(10)
    const editMarker = new K.Marker({ position:initial, image:markerImage(K,'#e47724'), draggable:true, title:'수정 좌표' })
    if (validCoordinates(original)) editMarker.setMap(map)
    editMarker.setZIndex(20)
    const geocoder = new K.services.Geocoder()

    const setCoordinate = (position, lookup = true) => {
      if (sequence !== mapSequence || selectedId !== detail.id) return
      editMarker.setPosition(position); editMarker.setMap(map); editMarker.setZIndex(20)
      $('edit-latitude').value = position.getLat().toFixed(7)
      $('edit-longitude').value = position.getLng().toFixed(7)
      $('toilet-coordinate-status').textContent = `${position.getLat().toFixed(7)}, ${position.getLng().toFixed(7)}`
      updateDirtyState()
      if (lookup) geocoder.coord2Address(position.getLng(), position.getLat(), (rows, status) => {
        if (sequence !== mapSequence || status !== K.services.Status.OK) return
        const address = rows[0]?.road_address?.address_name || rows[0]?.address?.address_name
        if (address) $('toilet-coordinate-status').textContent = `${position.getLat().toFixed(7)}, ${position.getLng().toFixed(7)} · ${address}`
      })
    }
    K.event.addListener(map, 'click', event => setCoordinate(event.latLng))
    K.event.addListener(editMarker, 'dragend', () => setCoordinate(editMarker.getPosition()))
    $('toilet-origin').addEventListener('click', () => {
      map.setCenter(initial); map.setLevel(validCoordinates(original) ? 3 : 12)
      if (validCoordinates(original)) setCoordinate(initial, false)
      else { editMarker.setMap(null); $('edit-latitude').value=''; $('edit-longitude').value=''; $('toilet-coordinate-status').textContent='좌표 없음'; updateDirtyState() }
    })
    $('toilet-map-search-form').addEventListener('submit', event => {
      event.preventDefault()
      const keyword = $('toilet-map-search').value.trim()
      if (!keyword) return
      new K.services.Places().keywordSearch(keyword, (results, status) => {
        if (sequence !== mapSequence) return
        if (status !== K.services.Status.OK || !results.length) { $('toilet-coordinate-status').textContent = '검색 결과를 찾지 못했습니다.'; return }
        const position = new K.LatLng(Number(results[0].y), Number(results[0].x))
        map.setCenter(position); map.setLevel(3); setCoordinate(position, false)
        $('toilet-coordinate-status').textContent = `${results[0].place_name} · ${results[0].road_address_name || results[0].address_name}`
      })
    })
  } catch (error) {
    if (sequence === mapSequence && target?.isConnected) target.innerHTML = `<div class="toilet-empty"><strong>${escapeHtml(error.message)}</strong></div>`
  }
}

async function bootstrap() {
  try {
    const auth = await fetch(`${API}/api/v1/auth/me`, { credentials:'include' })
    if (auth.status === 401 || auth.status === 403) return showLogin(auth.status)
    if (!auth.ok) throw new Error('관리자 인증을 확인하지 못했습니다.')
    const profile = await auth.json()
    if (!profile.roles?.includes('ADMIN')) return showLogin(403)
    $('loading-shell').hidden = true
    $('auth-shell').hidden = true
    $('toilet-shell').hidden = false
    bindSearch()
    await loadRegions()
    $('toilet-sido').addEventListener('change', () => { populateSigungu(); void loadList(0) })
    $('toilet-sigungu').addEventListener('change', () => void loadList(0))
    $('toilet-refresh').addEventListener('click', () => { closeSuggestions(); void loadList(page) })
    populateSigungu()
    await loadList(0)
    $('toilet-shell').closest('.admin-frame')?.removeAttribute('aria-busy')
    document.querySelector('.toilet-data-workspace')?.setAttribute('aria-busy','false')
  } catch (error) {
    $('toilet-status').querySelector('span').textContent = error.message
    $('toilet-status').classList.add('is-error')
  }
}

document.addEventListener('admin:before-route-change', () => {
  window.clearTimeout(searchTimer); window.clearTimeout(suggestionTimer)
  listAbort?.abort(); suggestionAbort?.abort()
  ++listSequence; ++detailSequence; ++suggestionSequence; ++mapSequence
}, { once:true })

bootstrap()
