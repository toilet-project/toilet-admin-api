const LOCAL_DUPLICATE_PREVIEW = location.hostname === '127.0.0.1' && location.port === '8796'
const DUPLICATE_PREVIEW_ROOT = location.hostname === 'preview.geupddong.com' && location.pathname.startsWith('/admin-duplicates/') ? '/admin-duplicates' : ''
const ISOLATED_DUPLICATE_PREVIEW = LOCAL_DUPLICATE_PREVIEW || !!DUPLICATE_PREVIEW_ROOT
const API_BASE = DUPLICATE_PREVIEW_ROOT || (LOCAL_DUPLICATE_PREVIEW ? '' : 'https://api.geupddong.com')
const PAGE_SIZE = 15
const $ = id => document.getElementById(id)
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character])
const query = new URLSearchParams(window.location.search)
const DEMO = window.location.pathname.startsWith('/preview') && query.get('demo') === '1'
const initialReviewId = Number(query.get('reviewId'))
const stateLabels = { PENDING:'검토 대기', APPLIED:'반영 완료', KEPT_CURRENT:'현재 값 유지', SUPERSEDED:'대체됨' }
const actionLabels = { APPLY:'변경 반영', KEEP_CURRENT:'현재 값 유지', DEFER:'나중에 검토' }
const fieldLabels = { NAME:'시설명', LATITUDE:'위도', LONGITUDE:'경도', ROAD_ADDRESS:'도로명 주소', JIBUN_ADDRESS:'지번 주소' }
let currentPage = 0
let selectedId = Number.isSafeInteger(initialReviewId) && initialReviewId > 0 ? initialReviewId : null
let currentItems = []
let totalPages = 0
let searchTimer = 0
let listSequence = 0
let detailSequence = 0
let saving = false
let kakaoMapsReady = null

const demoItems = [
  { id:1042, toiletId:5821, name:'문화회관 본관 화장실', managementNumber:'DEMO-2026-001', status:'PENDING', changedFields:['LATITUDE','LONGITUDE','ROAD_ADDRESS'], firstReceivedAt:'2026-09-08T02:04:12+09:00', lastReceivedAt:'2026-09-15T02:03:48+09:00', receiptCount:4, hasWarning:false, version:3 },
  { id:1041, toiletId:4472, name:'시민공원 제1화장실', managementNumber:'DEMO-2026-002', status:'PENDING', changedFields:['ROAD_ADDRESS','JIBUN_ADDRESS'], firstReceivedAt:'2026-09-07T02:04:08+09:00', lastReceivedAt:'2026-09-14T02:03:51+09:00', receiptCount:3, hasWarning:true, version:2 },
  { id:1038, toiletId:3304, name:'환승센터 공중화장실', managementNumber:'DEMO-2026-003', status:'PENDING', changedFields:['LATITUDE','LONGITUDE'], firstReceivedAt:'2026-09-05T02:03:59+09:00', lastReceivedAt:'2026-09-13T02:04:02+09:00', receiptCount:6, hasWarning:false, version:5 },
]

const demoDetails = {
  1042: {
    review: demoItems[0], dataSource:'공공데이터포털', baselineHash:'demo-baseline-1042', isStale:false,
    current:{ latitude:37.566286, longitude:126.977944, roadAddress:'서울특별시 중구 세종대로 110', jibunAddress:'서울특별시 중구 태평로1가 31', confirmedAt:'2026-08-21T16:42:00+09:00', confirmedBy:'관리자' },
    proposal:{ latitude:37.566841, longitude:126.978531, roadAddress:'서울특별시 중구 세종대로 112', jibunAddress:'서울특별시 중구 태평로1가 31', providerUpdatedAt:'2026-09-14T18:20:00+09:00' },
    distanceMeters:80,
    receipt:{ batchExecutionKey:'batch-20260915-020000', receivedAt:'2026-09-15T02:03:48+09:00', receiptCount:4, result:'CHANGE_CANDIDATE', inputHash:'9a4f…71c2' },
    validation:{ issues:[] },
    decisionHistory:[{ action:'DEFER', decidedAt:'2026-09-10T11:20:00+09:00', actorName:'관리자', note:'건물 출입구 위치를 추가 확인합니다.' }],
  },
  1041: {
    review: demoItems[1], dataSource:'공공데이터포털', baselineHash:'demo-baseline-1041', isStale:false,
    current:{ latitude:35.179554, longitude:129.075642, roadAddress:'부산광역시 연제구 중앙대로 1001', jibunAddress:'부산광역시 연제구 연산동 1000', confirmedAt:'2026-08-19T09:14:00+09:00', confirmedBy:'관리자' },
    proposal:{ latitude:null, longitude:null, roadAddress:'부산광역시 연제구 중앙대로', jibunAddress:null, providerUpdatedAt:'2026-09-13T17:10:00+09:00' },
    distanceMeters:null,
    receipt:{ batchExecutionKey:'batch-20260914-020000', receivedAt:'2026-09-14T02:03:51+09:00', receiptCount:3, result:'CHANGE_CANDIDATE', inputHash:'772e…40ba' },
    validation:{ issues:[{ code:'MISSING_COORDINATE', message:'제안 좌표가 없어 위치 변경으로 반영할 수 없습니다.', blocking:true }, { code:'INCOMPLETE_ADDRESS', message:'도로명 주소에 건물번호가 없고 지번 주소가 비어 있습니다.', blocking:true }] },
    decisionHistory:[],
  },
  1038: {
    review: demoItems[2], dataSource:'공공데이터포털', baselineHash:'demo-baseline-1038', isStale:false,
    current:{ latitude:36.350412, longitude:127.384548, roadAddress:'대전광역시 서구 둔산로 100', jibunAddress:'대전광역시 서구 둔산동 1420', confirmedAt:'2026-08-12T13:08:00+09:00', confirmedBy:'관리자' },
    proposal:{ latitude:36.350744, longitude:127.384112, roadAddress:'대전광역시 서구 둔산로 100', jibunAddress:'대전광역시 서구 둔산동 1420', providerUpdatedAt:'2026-09-12T19:30:00+09:00' },
    distanceMeters:54,
    receipt:{ batchExecutionKey:'batch-20260913-020000', receivedAt:'2026-09-13T02:04:02+09:00', receiptCount:6, result:'CHANGE_CANDIDATE', inputHash:'d10c…611e' },
    validation:{ issues:[] },
    decisionHistory:[{ action:'KEEP_CURRENT', decidedAt:'2026-08-29T10:05:00+09:00', actorName:'관리자', note:'거리뷰에서 기존 출입구 좌표를 확인했습니다.' }],
  },
}

function date(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(parsed).replace(/\. /g, '.').replace('.', '')
}

function number(value) {
  return Number(value || 0).toLocaleString('ko-KR')
}

function coordinate(value) {
  if (value == null || String(value).trim() === '') return '없음'
  if (!Number.isFinite(Number(value))) return '없음'
  return Number(value).toFixed(6)
}

function statusBadge(status) {
  return `<span class="change-state ${String(status || '').toLowerCase()}">${escapeHtml(stateLabels[status] || status || '상태 없음')}</span>`
}

function changedFields(item) {
  const fields = Array.isArray(item.changedFields) ? item.changedFields : []
  const visible = fields.slice(0, 3).map(field => `<span class="change-field-chip ${['LATITUDE','LONGITUDE'].includes(field) ? 'is-coordinate' : ''}">${escapeHtml(fieldLabels[field] || field)}</span>`).join('')
  return `${visible}${fields.length > 3 ? `<span class="change-field-chip">+${fields.length - 3}</span>` : ''}`
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { credentials:ISOLATED_DUPLICATE_PREVIEW?'omit':'include', ...options })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `요청을 처리하지 못했습니다. (${response.status})`)
    error.status = response.status
    throw error
  }
  return payload
}

function listParameters(page) {
  const params = new URLSearchParams({ page:String(Math.max(page, 0)), size:String(PAGE_SIZE), sort:'lastReceivedAt,desc' })
  const keyword = $('change-keyword').value.trim()
  const status = $('change-status').value
  const period = $('change-period').value
  if (keyword) params.set('keyword', keyword)
  if (status !== 'ALL') params.set('status', status)
  if (period !== 'ALL') params.set('receivedWithinDays', period)
  return params
}

function demoPage(page) {
  const keyword = $('change-keyword').value.trim().toLocaleLowerCase('ko-KR')
  const status = $('change-status').value
  const items = demoItems.filter(item => (!keyword || `${item.name} ${item.managementNumber}`.toLocaleLowerCase('ko-KR').includes(keyword)) && (status === 'ALL' || item.status === status))
  return { items, page:0, size:PAGE_SIZE, totalElements:items.length, totalPages:items.length ? 1 : 0, summary:{ pending:18, aged:6, coordinate:11, warning:3 } }
}

function renderSummary(summary = {}) {
  $('change-summary-pending').textContent = number(summary.pending)
  $('change-summary-aged').textContent = number(summary.aged)
  $('change-summary-coordinate').textContent = number(summary.coordinate)
  $('change-summary-warning').textContent = number(summary.warning)
}

function renderList(items) {
  currentItems = items
  const target = $('change-list')
  target.replaceChildren()
  if (!items.length) {
    target.innerHTML = '<div class="change-empty-state"><strong>조건에 맞는 변경 후보가 없습니다</strong><p>상태나 기간을 바꾸어 다시 확인해 주세요.</p></div>'
    return
  }
  for (const item of items) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'change-list-item'
    button.dataset.id = item.id
    button.setAttribute('aria-pressed', String(selectedId === item.id))
    button.innerHTML = `<span class="change-list-main"><strong>${escapeHtml(item.name || '이름 없는 화장실')}</strong>${statusBadge(item.status)}</span><span class="change-list-fields">${changedFields(item)}</span><span class="change-list-meta"><span>${escapeHtml(item.managementNumber || `TOILET #${item.toiletId}`)} · ${number(item.receiptCount)}회 수신</span><span>최근 ${escapeHtml(date(item.lastReceivedAt))}</span></span>`
    button.addEventListener('click', () => { if (!saving) void loadDetail(item.id) })
    target.append(button)
  }
}

const pageIcon = direction => ({ first:'<path d="m11 7-5 5 5 5M18 7l-5 5 5 5"/>', previous:'<path d="m15 7-5 5 5 5"/>', next:'<path d="m9 7 5 5-5 5"/>', last:'<path d="m6 7 5 5-5 5M13 7l5 5-5 5"/>' })[direction]

function pagination() {
  const target = $('change-pages')
  target.replaceChildren()
  if (!totalPages) return
  const append = (label, targetPage, disabled, iconName = null, current = false) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.disabled = disabled
    button.setAttribute('aria-label', label)
    if (current) button.setAttribute('aria-current', 'page')
    if (iconName) { button.className = 'change-page-move'; button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${pageIcon(iconName)}</svg>` }
    else button.textContent = String(targetPage + 1)
    button.addEventListener('click', () => void loadList(targetPage))
    target.append(button)
  }
  append('맨앞', 0, currentPage === 0, 'first')
  append('이전', Math.max(0, currentPage - 1), currentPage === 0, 'previous')
  const visible = Math.min(5, totalPages)
  const start = Math.max(0, Math.min(currentPage - Math.floor(visible / 2), totalPages - visible))
  for (let page = start; page < start + visible; page += 1) append(`${page + 1}페이지`, page, page === currentPage, null, page === currentPage)
  append('다음', Math.min(totalPages - 1, currentPage + 1), currentPage >= totalPages - 1, 'next')
  append('맨뒤', totalPages - 1, currentPage >= totalPages - 1, 'last')
}

async function loadList(page = 0) {
  const sequence = ++listSequence
  $('change-review-workspace').setAttribute('aria-busy', 'true')
  $('change-list-status').className = `change-list-status${DEMO ? ' is-demo' : ''}`
  $('change-list-status').textContent = DEMO ? '프리뷰 화면 예시를 불러오는 중입니다.' : '변경 후보를 불러오는 중입니다.'
  try {
    const data = DEMO ? demoPage(page) : await request(`/api/admin/v1/public-data-change-reviews?${listParameters(page)}`)
    if (sequence !== listSequence) return
    currentPage = Number(data.page || 0)
    totalPages = Number(data.totalPages || 0)
    renderSummary(data.summary)
    renderList(Array.isArray(data.items) ? data.items : [])
    pagination()
    $('change-list-status').textContent = DEMO ? `화면 설계 예시 ${number(data.totalElements)}건 · 운영 데이터가 아닙니다.` : `${stateLabels[$('change-status').value] || '전체'} ${number(data.totalElements)}건 · ${totalPages ? currentPage + 1 : 0}페이지`
    const requested = selectedId || (data.items?.[0]?.id ?? null)
    if (requested) await loadDetail(requested)
  } catch (error) {
    if (sequence !== listSequence) return
    renderSummary()
    renderList([])
    $('change-pages').replaceChildren()
    $('change-list-status').className = 'change-list-status is-error'
    $('change-list-status').textContent = error.status === 404 ? '변경 후보 API가 아직 연결되지 않았습니다.' : error.message
    if (window.location.pathname.startsWith('/preview')) $('change-list').innerHTML = '<div class="change-empty-state"><strong>화면 구조는 준비되었습니다</strong><p>프리뷰 주소에 <b>?demo=1</b>을 붙이면 운영 데이터와 분리된 화면 예시를 볼 수 있습니다.</p></div>'
  } finally {
    if (sequence === listSequence) $('change-review-workspace').setAttribute('aria-busy', 'false')
  }
}

function valueRows(value, changed, highlight, facilityName) {
  const rows = [
    [['LATITUDE', 'LONGITUDE'], '좌표', `${coordinate(value?.latitude)}, ${coordinate(value?.longitude)}`, 'coordinate'],
    [['ROAD_ADDRESS'], '도로명 주소', value?.roadAddress || '없음', 'address'],
    [['JIBUN_ADDRESS'], '지번 주소', value?.jibunAddress || '없음', 'address'],
  ]
  if(facilityName!=null)rows.unshift([['NAME'],'시설명',facilityName,'name'])
  return rows.map(([keys, label, text, type]) => `<div class="change-value-row is-${type}"><dt>${label}</dt><dd${highlight && keys.some(key => changed.includes(key)) ? ' class="is-changed"' : ''}>${escapeHtml(text)}</dd></div>`).join('')
}

function historyMarkup(items = []) {
  if (!items.length) return '<p class="change-list-status">이전 결정 이력이 없습니다.</p>'
  return `<div class="change-history-list">${items.map(item => `<div class="change-history-item"><span>${escapeHtml(date(item.decidedAt))}</span><strong>${escapeHtml(actionLabels[item.action] || item.action)}</strong><span>${escapeHtml(item.actorName || '관리자')} · ${escapeHtml(item.note || '사유 없음')}</span></div>`).join('')}</div>`
}

function detailMarkup(detail) {
  const review = detail.review
  const changed = Array.isArray(review.changedFields) ? review.changedFields : []
  const issues = Array.isArray(detail.validation?.issues) ? detail.validation.issues : []
  const pending = review.status === 'PENDING'
  const hidden = detail.hiddenContext
  return `<header class="change-detail-head"><div><span class="change-section-kicker">CHANGE #${escapeHtml(review.id)} · TOILET #${escapeHtml(review.toiletId)}</span><h2>${escapeHtml(review.name || '이름 없는 화장실')}</h2><p>${escapeHtml(review.managementNumber || '관리번호 없음')} · ${escapeHtml(detail.dataSource || '공공데이터')} · 최초 ${escapeHtml(date(review.firstReceivedAt))}</p></div>${statusBadge(review.status)}</header>
    ${ISOLATED_DUPLICATE_PREVIEW ? '<div class="change-validation-alert"><strong>분리된 기능 검증 프리뷰</strong><span>실제 시설 정보 사본과 시험용 변경 후보입니다. 운영 데이터는 변경하지 않습니다.</span><a href="/duplicate-names.html">중복 이름 관리로</a></div>' : ''}
    ${hidden ? `<section class="change-validation-alert"><strong>중복 숨김 시설 · 대표 #${escapeHtml(hidden.representativeToiletId)}</strong><span>숨김 근거: ${escapeHtml(hidden.reason)}</span><span>숨김 시각: ${escapeHtml(date(hidden.hiddenAt))} · 현재 상태: ${escapeHtml(hidden.currentVisibility)}</span><span>당시 시설명: ${escapeHtml(hidden.baselineName)} → 수신 이름: ${escapeHtml(hidden.proposalName)}</span><span>변경을 반영해도 숨김은 유지됩니다. 숨김 해제는 중복 이름 관리에서 별도로 진행하세요.</span></section>` : ''}
    ${detail.isStale ? '<div class="change-stale-alert"><strong>다시 비교 필요</strong><span>후보를 연 뒤 현재 확정값이나 새 제안이 바뀌었습니다. 새로고침 후 결정해 주세요.</span></div>' : ''}
    ${issues.length ? `<div class="change-validation-alert"><strong>확인 필요</strong><span>${issues.map(issue => escapeHtml(issue.message)).join(' · ')}</span></div>` : ''}
    <div class="change-comparison-head"><div><span class="change-section-kicker">VALUE COMPARISON</span><h3>현재 서비스 값과 수신 값 비교</h3></div><p>달라진 수신 값은 주황색으로 표시합니다.</p></div>
    <section class="change-comparison-grid" aria-label="변경값 비교">
      <article class="change-value-card current"><header><span>현재</span><div><small>CURRENT SERVICE</small><strong>현재 서비스 값</strong></div><time>${escapeHtml(date(detail.current?.confirmedAt))} 확정</time></header><dl>${valueRows(detail.current, changed, false, hidden?.currentName)}</dl></article>
      <article class="change-value-card proposed"><header><span>수신</span><div><small>PUBLIC DATA RECEIVED</small><strong>공공데이터 수신 값</strong></div><time>${escapeHtml(date(detail.proposal?.providerUpdatedAt || review.lastReceivedAt))} 수신</time></header><dl>${valueRows(detail.proposal, changed, true, hidden?.proposalName)}</dl></article>
    </section>
    <section class="change-work-grid">
      <div>
        <article class="change-map-card"><header class="change-card-title"><span>지도</span><div><small>LOCATION COMPARISON</small><h3>현재 위치와 제안 위치</h3></div></header><div class="change-map-legend"><span>현재 서비스 위치</span><span>공공데이터 제안 위치</span></div><div id="change-map" class="change-map"><p>지도를 준비하는 중입니다.</p></div><p id="change-map-distance" class="change-map-distance">두 위치의 거리를 계산하는 중입니다.</p></article>
        <article class="change-receipt-card"><header class="change-card-title"><span>수신</span><div><small>RECEIPT EVIDENCE</small><h3>배치 수신 근거</h3></div></header><dl><dt>실행 식별자</dt><dd>${escapeHtml(detail.receipt?.batchExecutionKey || '없음')}</dd><dt>최근 수신</dt><dd>${escapeHtml(date(detail.receipt?.receivedAt))}</dd><dt>반복 수신</dt><dd>${number(detail.receipt?.receiptCount || review.receiptCount)}회</dd><dt>처리 결과</dt><dd>${escapeHtml(detail.receipt?.result || '확인 전')}</dd><dt>입력 해시</dt><dd>${escapeHtml(detail.receipt?.inputHash || '없음')}</dd></dl></article>
      </div>
      <article class="change-decision-card"><header class="change-card-title"><span>결정</span><div><small>ADMIN DECISION</small><h3>서비스 반영 결정</h3></div></header>
        ${pending ? `<div class="change-decision-stack"><div class="change-decision-options"><label class="change-decision-option"><input type="radio" name="change-decision" value="APPLY"/><span><strong>변경 반영</strong><small>검증된 제안 좌표와 두 주소를 함께 반영합니다.</small></span></label><label class="change-decision-option"><input type="radio" name="change-decision" value="KEEP_CURRENT"/><span><strong>현재 값 유지</strong><small>이 확정 기준과 제안에는 기존 값을 유지합니다.</small></span></label><label class="change-decision-option"><input type="radio" name="change-decision" value="DEFER"/><span><strong>나중에 검토</strong><small>값을 바꾸지 않고 대기 상태로 남깁니다.</small></span></label></div><label class="change-decision-note"><span>결정 사유</span><textarea id="change-decision-note" maxlength="500" placeholder="확인한 근거를 남겨 주세요."></textarea></label><p id="change-decision-status" class="change-decision-status" role="status">후보 버전 ${escapeHtml(review.version)} · 결정 시 최신 상태를 다시 확인합니다.</p><button id="change-decision-submit" class="change-decision-button" type="button" disabled>결정 선택</button></div>` : '<p class="change-list-status">처리가 끝난 후보입니다. 아래 결정 이력에서 결과를 확인할 수 있습니다.</p>'}
      </article>
    </section>
    <details class="change-history"><summary>이전 결정 이력 ${number(detail.decisionHistory?.length || 0)}건</summary>${historyMarkup(detail.decisionHistory)}</details>`
}

function updateUrl(id) {
  const url = new URL(window.location.href)
  url.searchParams.set('reviewId', String(id))
  window.history.replaceState(null, '', url)
}

async function loadDetail(id) {
  if (saving) return
  selectedId = Number(id)
  updateUrl(selectedId)
  document.querySelectorAll('.change-list-item').forEach(item => item.setAttribute('aria-pressed', String(Number(item.dataset.id) === selectedId)))
  const sequence = ++detailSequence
  $('change-detail').innerHTML = '<div class="change-empty-state"><strong>비교 정보를 불러오는 중입니다</strong></div>'
  try {
    const detail = DEMO ? demoDetails[selectedId] : await request(`/api/admin/v1/public-data-change-reviews/${encodeURIComponent(selectedId)}`)
    if (!detail) throw new Error('변경 후보를 찾지 못했습니다.')
    if (sequence !== detailSequence) return
    $('change-detail').innerHTML = detailMarkup(detail)
    mountDecision(detail, sequence)
    void mountMap(detail, sequence)
  } catch (error) {
    if (sequence === detailSequence) $('change-detail').innerHTML = `<div class="change-empty-state"><strong>상세 정보를 불러오지 못했습니다</strong><p>${escapeHtml(error.message)}</p></div>`
  }
}

function mountDecision(detail, sequence) {
  const submit = $('change-decision-submit')
  if (!submit) return
  const note = $('change-decision-note')
  const radios = [...document.querySelectorAll('input[name="change-decision"]')]
  const blocking = (detail.validation?.issues || []).some(issue => issue.blocking)
  const live = () => sequence === detailSequence && selectedId === Number(detail.review.id)
  const selectedAction = () => radios.find(radio => radio.checked)?.value || null
  const update = () => {
    const action = selectedAction()
    const needsNote = action && action !== 'DEFER'
    submit.textContent = action ? actionLabels[action] : '결정 선택'
    submit.className = `change-decision-button${action === 'KEEP_CURRENT' ? ' is-keep' : action === 'DEFER' ? ' is-defer' : ''}`
    submit.disabled = !action || saving || detail.isStale || (action === 'APPLY' && blocking) || (needsNote && !note.value.trim())
    $('change-decision-status').textContent = action === 'APPLY' && blocking ? '확인 필요 항목을 해결하기 전에는 변경을 반영할 수 없습니다.' : `후보 버전 ${detail.review.version} · 결정 시 최신 상태를 다시 확인합니다.`
  }
  radios.forEach(radio => radio.addEventListener('change', update))
  note.addEventListener('input', update)
  submit.addEventListener('click', async () => {
    const action = selectedAction()
    if (!action || !live() || saving) return
    if (!window.confirm(`이 후보를 ‘${actionLabels[action]}’로 처리할까요?`)) return
    saving = true
    update()
    try {
      if (DEMO) {
        detail.decisionHistory.unshift({ action, decidedAt:new Date().toISOString(), actorName:'프리뷰 관리자', note:note.value.trim() || '나중에 검토' })
        if (action !== 'DEFER') detail.review.status = action === 'APPLY' ? 'APPLIED' : 'KEPT_CURRENT'
      } else {
        await request(`/api/admin/v1/public-data-change-reviews/${encodeURIComponent(detail.review.id)}/decisions`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ action, note:note.value.trim(), expectedVersion:detail.review.version, expectedBaselineHash:detail.baselineHash }) })
      }
      if (!live()) return
      saving = false
      await loadList(currentPage)
      await loadDetail(detail.review.id)
    } catch (error) {
      if (live()) $('change-decision-status').textContent = error.status === 409 ? '후보가 변경되었습니다. 새로고침 후 다시 비교해 주세요.' : error.message
    } finally {
      saving = false
      if (live()) update()
    }
  })
}

function point(value) {
  if (value?.latitude == null || value?.longitude == null || String(value.latitude).trim() === '' || String(value.longitude).trim() === '') return null
  const latitude = Number(value?.latitude)
  const longitude = Number(value?.longitude)
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? { latitude, longitude } : null
}

function distance(a, b) {
  if (!a || !b) return null
  const rad = value => value * Math.PI / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const first = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(first), Math.sqrt(1 - first))
}

async function loadKakaoMaps() {
  if (window.kakao?.maps?.LatLng) return window.kakao.maps
  if (kakaoMapsReady) return kakaoMapsReady
  kakaoMapsReady = (async () => {
    const response = await fetch(DUPLICATE_PREVIEW_ROOT + '/api/admin/v1/map-config', {credentials:ISOLATED_DUPLICATE_PREVIEW?'omit':'same-origin'})
    const config = await response.json().catch(() => null)
    if (!response.ok || !config?.enabled || !config.javascriptKey) throw new Error('지도 설정을 불러오지 못했습니다.')
    await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.javascriptKey)}&autoload=false`; script.onload = resolve; script.onerror = () => reject(new Error('카카오 지도 SDK를 불러오지 못했습니다.')); document.head.append(script) })
    await new Promise(resolve => window.kakao.maps.load(resolve))
    return window.kakao.maps
  })()
  return kakaoMapsReady
}

async function mountMap(detail, sequence) {
  const current = point(detail.current)
  const proposed = point(detail.proposal)
  const target = $('change-map')
  const distanceTarget = $('change-map-distance')
  if (!target || sequence !== detailSequence) return
  if (!current && !proposed) { target.innerHTML = '<p>현재 위치와 제안 위치에 유효한 좌표가 없습니다.</p>'; distanceTarget.textContent = '주소와 좌표를 보완한 뒤 변경을 반영할 수 있습니다.'; return }
  try {
    const K = await loadKakaoMaps()
    if (sequence !== detailSequence || !$('change-map')) return
    target.replaceChildren()
    const center = current || proposed
    const map = new K.Map(target, { center:new K.LatLng(center.latitude, center.longitude), level:4 })
    const bounds = new K.LatLngBounds()
    const add = (location, label, tone) => {
      if (!location) return
      const position = new K.LatLng(location.latitude, location.longitude)
      bounds.extend(position)
      new K.CustomOverlay({ map, position, yAnchor:1, zIndex:tone === 'proposed' ? 4 : 3, content:`<div class="change-map-pin ${tone}"><span></span>${escapeHtml(label)}</div>` })
    }
    add(current, '현재', 'current')
    add(proposed, '제안', 'proposed')
    if (current && proposed) {
      new K.Polyline({ map, path:[new K.LatLng(current.latitude, current.longitude), new K.LatLng(proposed.latitude, proposed.longitude)], strokeWeight:3, strokeColor:'#c66a27', strokeOpacity:.72, strokeStyle:'shortdash' })
      map.setBounds(bounds, 70, 70, 70, 70)
    }
    const meters = detail.distanceMeters != null && String(detail.distanceMeters).trim() !== '' && Number.isFinite(Number(detail.distanceMeters)) ? Number(detail.distanceMeters) : distance(current, proposed)
    distanceTarget.textContent = meters == null ? '한쪽 좌표가 없어 두 위치의 거리를 계산할 수 없습니다.' : `현재 위치에서 제안 위치까지 약 ${number(Math.round(meters))}m입니다.`
  } catch (error) {
    if (sequence === detailSequence) { target.innerHTML = `<p>${escapeHtml(error.message)}</p>`; distanceTarget.textContent = '좌표값은 위 비교 카드에서 확인할 수 있습니다.' }
  }
}

function showLogin(status) {
  const title = $('auth-title')
  const description = $('auth-description')
  if (title) title.textContent = status === 403 ? '관리자 권한이 필요합니다' : '관리자 로그인'
  if (description) description.textContent = status === 403 ? '관리자 권한이 있는 계정으로 다시 로그인해 주세요.' : '승인된 관리자 계정으로 로그인해 주세요.'
  $('auth-shell').hidden = false
  $('change-review-shell').hidden = true
}

async function start() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials:ISOLATED_DUPLICATE_PREVIEW?'omit':'include' })
    if (response.status === 401) return showLogin(401)
    if (!response.ok) return showLogin(403)
    const profile = await response.json()
    if (!profile.roles?.includes('ADMIN')) return showLogin(403)
    $('change-keyword').addEventListener('input', () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => void loadList(0), 260) })
    $('change-status').addEventListener('change', () => void loadList(0))
    $('change-period').addEventListener('change', () => void loadList(0))
    $('change-refresh').addEventListener('click', () => { void loadList(currentPage); if (selectedId) void loadDetail(selectedId) })
    await loadList()
  } catch {
    showLogin(401)
  }
}

void start()
