const el = (id) => document.getElementById(id)
const API_BASE = 'https://api.geupddong.com'
const REVIEW_SIZE = 7
const KST_OFFSET = 9 * 60 * 60 * 1000
const number = (value) => new Intl.NumberFormat('ko-KR').format(value ?? 0)
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])

const state = {
  period: 7,
  reviewType: 'reports',
  reviewPages: { reports: 0, coordinates: 0, regions: 0 },
  reviews: {},
}

const reviewConfig = {
  reports: {
    title: '제보 검토',
    link: '/reports.html',
    headers: ['화장실', '제보 유형', '접수 시각', '경과'],
  },
  coordinates: {
    title: '중복 좌표',
    link: '/data-quality.html',
    headers: ['대표 시설', '지역', '연결 제보', '시설 수'],
  },
  regions: {
    title: '행정구역 검토',
    link: '/regions.html',
    headers: ['화장실', '검토 사유', '현재 주소', '경과'],
  },
}

class AuthError extends Error {
  constructor(status) {
    super('관리자 인증이 필요합니다.')
    this.status = status
  }
}

function parseKoreanDate(value) {
  if (!value) return null
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+09:00`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateTime(value) {
  const parsed = parseKoreanDate(value)
  return parsed ? new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed) : '-'
}

function formatAge(value) {
  const parsed = parseKoreanDate(value)
  if (!parsed) return '-'
  const minutes = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 60000))
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}시간`
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`
}

function ageHours(value) {
  const parsed = parseKoreanDate(value)
  return parsed ? Math.max(0, (Date.now() - parsed.getTime()) / 3600000) : 0
}

function seoulDateValue(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function periodRange(days) {
  const today = new Date()
  const from = new Date(today.getTime() - (days - 1) * 86400000)
  return { from: seoulDateValue(from), to: seoulDateValue(today) }
}

function nextBatchTime() {
  const now = new Date()
  const korean = new Date(now.getTime() + KST_OFFSET)
  let next = new Date(Date.UTC(korean.getUTCFullYear(), korean.getUTCMonth(), korean.getUTCDate(), -7, 0, 0))
  if (next <= now) next = new Date(next.getTime() + 86400000)
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(next)
}

function duration(seconds) {
  if (seconds == null) return '-'
  const value = Math.max(0, Number(seconds))
  const minutes = Math.floor(value / 60)
  const remains = Math.round(value % 60)
  return minutes ? `${minutes}분 ${remains}초` : `${remains}초`
}

function statusText(status) {
  return ({ UP: '정상', SUCCESS: '성공', WARN: '주의', STALE: '확인 필요', DOWN: '장애', FAILED: '실패', UNKNOWN: '정보 없음', UNAVAILABLE: '연동 필요' })[status] || '확인 필요'
}

function statusClass(status) {
  if (status === 'UP' || status === 'SUCCESS') return 'state-good'
  if (status === 'WARN' || status === 'STALE') return 'state-warn'
  if (status === 'DOWN' || status === 'FAILED') return 'state-bad'
  return 'state-unknown'
}

function setState(target, status, detail) {
  target.className = `state ${statusClass(status)}`
  target.textContent = detail || statusText(status)
}

function worstStatus(statuses) {
  const rank = { DOWN: 4, FAILED: 4, WARN: 3, STALE: 3, UNKNOWN: 2, UNAVAILABLE: 2, UP: 1, SUCCESS: 1 }
  return statuses.reduce((worst, current) => (rank[current] || 2) > (rank[worst] || 0) ? current : worst, 'UP')
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  if (response.status === 401 || response.status === 403) throw new AuthError(response.status)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error?.message || payload?.message || '데이터를 불러오지 못했습니다.')
  }
  return response.json()
}

async function loadOperations() {
  try {
    const data = await fetchJson('/api/admin/v1/operations/status')
    const services = [data.admin, data.publicApi, data.database]
    setState(el('service-admin'), data.admin.status)
    setState(el('service-api'), data.publicApi.status)
    setState(el('service-db'), data.database.status)
    setState(el('service-disk'), data.disk.status, `${data.disk.usedPercent}% 사용`)
    const overall = worstStatus([...services.map((item) => item.status), data.disk.status])
    setState(el('service-overall'), overall)
    const abnormal = [
      ['관리자', data.admin.status], ['공개 API', data.publicApi.status], ['데이터베이스', data.database.status], ['디스크', data.disk.status],
    ].filter(([, status]) => status !== 'UP').map(([name]) => name)
    el('service-note').textContent = abnormal.length ? `${abnormal.join('·')} 상태를 확인해 주세요.` : '확인된 서비스 이상이 없습니다.'
    setState(el('batch-overall'), data.batch.status)
    if (data.batch.completedAt) el('batch-last').textContent = formatDateTime(data.batch.completedAt)
    el('batch-next').textContent = nextBatchTime()
    return true
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error)
    ;['service-admin', 'service-api', 'service-db', 'service-disk', 'service-overall', 'batch-overall'].forEach((id) => setState(el(id), 'UNKNOWN'))
    el('service-note').textContent = '서비스 상태를 확인하지 못했습니다.'
    el('batch-next').textContent = nextBatchTime()
    return false
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function quotaMarkup(label, metric, bytes = false) {
  const used = bytes ? formatBytes(metric.used) : number(metric.used)
  const limit = bytes ? formatBytes(metric.limit) : number(metric.limit)
  const level = metric.usedPercent >= 100 ? 'is-critical' : metric.usedPercent >= 80 ? 'is-high' : ''
  return `<div><div><span>${label}</span><strong>${used} <small>/ ${limit}</small></strong></div><div class="quota-track ${level}" role="progressbar" aria-label="${label} 이용률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${metric.usedPercent}"><i style="width:${metric.usedPercent}%"></i></div></div>`
}

async function loadCloudflare() {
  try {
    const data = await fetchJson('/api/admin/v1/cloudflare/usage')
    if (data.dashboardUrl) {
      el('cloudflare-link').href = data.dashboardUrl
    }
    el('cloudflare-quotas').innerHTML = [
      quotaMarkup('Workers 요청', data.workersRequests),
      quotaMarkup('D1 행 읽기', data.d1RowsRead),
      quotaMarkup('R2 저장소', data.r2StorageBytes, true),
    ].join('')
    const lastSuccess = data.lastSuccessfulAt ? ` · 마지막 성공 ${formatDateTime(data.lastSuccessfulAt)}` : ''
    el('cloudflare-note').textContent = data.available
      ? `${data.message} · 일일 한도 09:00 KST 초기화`
      : `${data.message}${lastSuccess}`
    return data.available
  } catch (error) {
    el('cloudflare-note').textContent = 'Cloudflare 이용량을 확인하지 못했습니다.'
    return false
  }
}

function reportTypeLabel(type) {
  return type === 'COORDINATE_CORRECTION' ? '위치 제보' : type === 'OPEN_TIME_CORRECTION' ? '개방 시간' : type || '-'
}

function regionReason(item) {
  const labels = {
    MISMATCH: '지역 불일치', ADDRESS_UNVERIFIED: '주소 검증 불확실', REVERSE_FAILED: '역조회·코드 충돌',
    NO_COORDINATE: '좌표 미입력', STALE: '재판정 필요', UNASSESSED: '최초 판정 필요',
  }
  return labels[item.status] || item.reason || '검토 필요'
}

function itemAddress(item) {
  return item.location?.roadAddress?.trim() || item.location?.jibunAddress?.trim() || '주소 정보 없음'
}

function reviewRow(type, item) {
  if (type === 'reports') return {
    href: `/reports.html?reportId=${encodeURIComponent(item.id)}`,
    cells: [item.toiletName || `화장실 #${item.toiletId}`, reportTypeLabel(item.reportType), formatDateTime(item.createdAt), formatAge(item.createdAt)],
    danger: ageHours(item.createdAt) >= 48,
  }
  if (type === 'coordinates') return {
    href: `/data-quality.html?groupKey=${encodeURIComponent(item.groupKey)}`,
    cells: [item.representativeName || '이름 없는 화장실', item.region || '-', item.pendingReportCount ? `${number(item.pendingReportCount)}건` : '없음', `${number(item.toiletCount)}개`],
    danger: false,
  }
  return {
    href: `/regions.html?toiletId=${encodeURIComponent(item.toiletId)}`,
    cells: [item.name || `화장실 #${item.toiletId}`, regionReason(item), itemAddress(item), formatAge(item.checkedAt)],
    danger: ageHours(item.checkedAt) >= 48,
  }
}

function renderReview() {
  const type = state.reviewType
  const config = reviewConfig[type]
  const data = state.reviews[type]
  document.querySelectorAll('[data-review-type]').forEach((button) => {
    const active = button.dataset.reviewType === type
    button.setAttribute('aria-selected', String(active))
    button.closest('.review-type-card').classList.toggle('is-active', active)
  })
  el('review-current-title').textContent = config.title
  el('review-detail-link').href = config.link
  el('review-caption').textContent = `${config.title} 목록`
  ;['review-column-main', 'review-column-detail', 'review-column-context', 'review-column-value'].forEach((id, index) => { el(id).textContent = config.headers[index] })
  if (!data) {
    el('review-list').innerHTML = '<tr><td colspan="5" class="home-empty">목록을 불러오는 중입니다.</td></tr>'
    el('review-range').textContent = '-'
    updateReviewPagination({ page: 0, totalPages: 0 })
    return
  }
  if (data.error) {
    el('review-list').innerHTML = `<tr><td colspan="5" class="home-empty is-error">${escapeHtml(data.error)}</td></tr>`
    el('review-range').textContent = '-'
    updateReviewPagination({ page: 0, totalPages: 0 })
    return
  }
  const start = data.page * REVIEW_SIZE
  el('review-range').textContent = data.totalElements ? `${start + 1}–${Math.min(start + data.items.length, data.totalElements)} / ${number(data.totalElements)}${type === 'coordinates' ? '그룹' : '건'}` : '0건'
  const rows = data.items.map((item, index) => {
    const row = reviewRow(type, item)
    return `<tr tabindex="0" data-href="${escapeHtml(row.href)}" aria-label="${escapeHtml(row.cells[0])} 상세 보기"><td>${start + index + 1}</td><td><strong>${escapeHtml(row.cells[0])}</strong></td><td><span class="review-kind">${escapeHtml(row.cells[1])}</span></td><td><span class="review-context">${escapeHtml(row.cells[2])}</span></td><td><span class="${row.danger ? 'review-attention' : ''}">${escapeHtml(row.cells[3])}</span></td></tr>`
  }).join('')
  el('review-list').innerHTML = rows || '<tr><td colspan="5" class="home-empty">현재 확인할 항목이 없습니다.</td></tr>'
  updateReviewPagination(data)
}

function updateReviewPagination(data) {
  el('review-page').textContent = data.totalPages ? data.page + 1 : 0
  el('review-pages').textContent = data.totalPages || 0
  el('review-prev').disabled = !data.totalPages || data.page <= 0
  el('review-next').disabled = !data.totalPages || data.page + 1 >= data.totalPages
}

async function loadReportReviews(page = 0) {
  if (page === 0) {
    const data = await fetchJson(`${API_BASE}/api/admin/v1/reports/summary`, { credentials: 'include' })
    const totalPages = Math.ceil(data.pendingCount / REVIEW_SIZE)
    const oldest = data.recentReports?.[0]?.createdAt
    el('review-count-reports').innerHTML = `${number(data.pendingCount)}<small>건</small>`
    el('review-note-reports').textContent = Number.isFinite(data.overdueCount)
      ? `48시간 이상 ${number(data.overdueCount)}건`
      : oldest ? `가장 오래된 항목 ${formatAge(oldest)}` : '확인할 제보 없음'
    return { items: data.recentReports || [], page: 0, totalElements: data.pendingCount, totalPages }
  }
  const query = new URLSearchParams({ status: 'PENDING', sort: 'OLDEST', page: String(page), size: String(REVIEW_SIZE) })
  return fetchJson(`${API_BASE}/api/admin/v1/reports/search?${query}`, { credentials: 'include' })
}

async function loadCoordinateReviews(page = 0) {
  const query = new URLSearchParams({ page: String(page), size: String(REVIEW_SIZE) })
  const data = await fetchJson(`${API_BASE}/api/admin/v1/data-quality/duplicate-coordinates?${query}`, { credentials: 'include' })
  el('review-count-coordinates').innerHTML = `${number(data.totalElements)}<small>그룹</small>`
  el('review-note-coordinates').textContent = data.items.length ? `최대 ${number(data.items[0].toiletCount)}개 시설` : '확인할 그룹 없음'
  return data
}

async function loadRegionReviews(page = 0) {
  const query = new URLSearchParams({ status: 'REVIEW', page: String(page), size: String(REVIEW_SIZE) })
  const data = await fetchJson(`${API_BASE}/api/admin/v1/regions?${query}`, { credentials: 'include' })
  el('review-count-regions').innerHTML = `${number(data.totalElements)}<small>건</small>`
  el('review-note-regions').textContent = data.items[0]?.checkedAt ? `가장 오래된 항목 ${formatAge(data.items[0].checkedAt)}` : '확인할 항목 없음'
  return data
}

async function loadReviewType(type, page = state.reviewPages[type]) {
  state.reviewPages[type] = Math.max(page, 0)
  if (type === state.reviewType) {
    state.reviews[type] = null
    renderReview()
  }
  try {
    const loaders = { reports: loadReportReviews, coordinates: loadCoordinateReviews, regions: loadRegionReviews }
    const data = await loaders[type](state.reviewPages[type])
    state.reviewPages[type] = data.page
    state.reviews[type] = data
    if (type === state.reviewType) renderReview()
    return true
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error)
    state.reviews[type] = { error: error.message || '목록을 불러오지 못했습니다.' }
    if (type === state.reviewType) renderReview()
    return false
  }
}

async function loadAllReviews() {
  const results = await Promise.all(['reports', 'coordinates', 'regions'].map((type) => loadReviewType(type, state.reviewPages[type])))
  return results.every(Boolean)
}

function renderChart(rows) {
  const target = el('period-chart')
  const series = [...rows].sort((left, right) => String(left.date).localeCompare(String(right.date)))
  if (!series.length) {
    target.innerHTML = '<p class="home-empty">선택한 기간의 수집 이력이 없습니다.</p>'
    return
  }
  const width = 760
  const height = 144
  const baseline = 112
  const left = 38
  const right = 8
  const top = 8
  const max = Math.max(...series.map((row) => row.insertedRecords + row.updatedRecords), 1)
  const roundedMax = Math.max(100, Math.ceil(max / 100) * 100)
  const slot = (width - left - right) / series.length
  const barWidth = Math.min(30, slot * .56)
  const scale = (baseline - top) / roundedMax
  const axes = [0, roundedMax / 2, roundedMax].map((value) => {
    const y = baseline - value * scale
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="${left - 7}" y="${y + 4}" text-anchor="end">${Math.round(value)}</text>`
  }).join('')
  const bars = series.map((row, index) => {
    const x = left + slot * (index + .5) - barWidth / 2
    const updated = row.updatedRecords * scale
    const inserted = row.insertedRecords * scale
    const failed = row.failedRuns > 0 && row.successfulRuns === 0
    const label = series.length <= 7 || index === 0 || index === series.length - 1 || index % 6 === 0
    const dateLabel = String(row.date).slice(5).replace('-', '.')
    return `<g><title>${dateLabel}: 신규 ${number(row.insertedRecords)}건, 수정 ${number(row.updatedRecords)}건${failed ? ', 실패 있음' : ''}</title>${failed && inserted + updated === 0 ? `<rect class="bar-failed" x="${x}" y="${baseline - 4}" width="${barWidth}" height="4" rx="2"/>` : `<rect class="bar-updated" x="${x}" y="${baseline - updated}" width="${barWidth}" height="${updated}"/><rect class="bar-new" x="${x}" y="${baseline - updated - inserted}" width="${barWidth}" height="${inserted}" rx="2"/>`}${label ? `<text x="${x + barWidth / 2}" y="136" text-anchor="middle">${dateLabel}</text>` : ''}</g>`
  }).join('')
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="일별 신규 및 수정 데이터 반영량">${axes}${bars}</svg>`
}

function renderRecent(rows) {
  const recent = rows.slice(0, 5)
  el('recent-list').innerHTML = recent.map((row) => `<tr><td><time>${escapeHtml(formatDateTime(row.completedAt))}</time></td><td><span class="state ${statusClass(row.status)}">${statusText(row.status)}</span></td><td>${number(row.insertedRecords)}</td><td>${number(row.updatedRecords)}</td></tr>`).join('') || '<tr><td colspan="4" class="home-empty">최근 수집 이력이 없습니다.</td></tr>'
  const failures = recent.filter((row) => row.status === 'FAILED').length
  el('recent-note').textContent = recent.length ? failures ? `최근 ${recent.length}회 중 실패 ${failures}회가 있습니다.` : `최근 ${recent.length}회 모두 정상 완료했습니다.` : '최근 수집 이력이 없습니다.'
  el('recent-note').classList.toggle('is-attention', failures > 0)
}

async function loadDashboard() {
  const range = periodRange(state.period)
  try {
    const query = new URLSearchParams(range)
    const data = await fetchJson(`/api/admin/v1/dashboard?${query}`)
    const batch = data.batch
    const runs = batch.successfulRuns + batch.failedRuns
    if (batch.totalToiletCount != null) el('home-total-toilets').textContent = number(batch.totalToiletCount)
    el('period-dates').textContent = state.period === 1 ? `${data.to} · 오늘` : `${data.from} – ${data.to} · 최근 ${state.period}일`
    el('period-runs').textContent = number(runs)
    el('period-new').textContent = number(batch.insertedRecords)
    el('period-updated').textContent = number(batch.updatedRecords)
    el('period-result').textContent = `성공 ${number(batch.successfulRuns)} · 실패 ${number(batch.failedRuns)}`
    el('period-result').classList.toggle('is-attention', batch.failedRuns > 0)
    el('failed-legend').hidden = batch.failedRuns === 0
    if (batch.lastSuccessAt) el('batch-last').textContent = formatDateTime(batch.lastSuccessAt)
    el('batch-duration').textContent = duration(batch.lastSuccessDurationSeconds)
    renderChart(data.dailySummaries || [])
    renderRecent(data.recentExecutions || [])
    return true
  } catch (error) {
    el('period-dates').textContent = '수집 요약을 불러오지 못했습니다.'
    el('period-chart').innerHTML = '<p class="home-empty is-error">수집 이력을 확인하지 못했습니다.</p>'
    el('recent-list').innerHTML = '<tr><td colspan="4" class="home-empty is-error">수집 이력을 확인하지 못했습니다.</td></tr>'
    return false
  }
}

function showLoginPage(forbidden = false) {
  el('loading-shell').hidden = true
  el('dashboard-shell').hidden = true
  el('auth-shell').hidden = false
  el('auth-title').textContent = forbidden ? '관리자 권한이 필요합니다' : '관리자 로그인'
  el('auth-description').textContent = forbidden ? '다른 관리자 계정으로 로그인하거나 관리자 권한 설정을 확인해 주세요.' : '승인된 관리자 계정으로 로그인해 주세요.'
}

function handleAuthError(error) {
  showLoginPage(error.status === 403)
  return false
}

async function refreshAll() {
  const button = el('refresh')
  button.disabled = true
  el('home-status').textContent = '운영 데이터를 새로 확인하고 있습니다.'
  const results = await Promise.all([loadOperations(), loadCloudflare(), loadDashboard(), loadAllReviews()])
  if (!el('dashboard-shell').hidden) {
    const time = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
    el('home-status').textContent = results.every(Boolean) ? `${time} 기준 최신 상태입니다.` : `${time} 기준 · 일부 항목을 확인하지 못했습니다.`
  }
  button.disabled = false
}

function bindEvents() {
  el('refresh').addEventListener('click', () => void refreshAll())
  document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => {
    state.period = Number(button.dataset.period)
    document.querySelectorAll('[data-period]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
    void loadDashboard()
  }))
  document.querySelectorAll('[data-review-type]').forEach((button) => button.addEventListener('click', () => {
    state.reviewType = button.dataset.reviewType
    renderReview()
    if (!state.reviews[state.reviewType]) void loadReviewType(state.reviewType)
  }))
  el('review-prev').addEventListener('click', () => void loadReviewType(state.reviewType, state.reviewPages[state.reviewType] - 1))
  el('review-next').addEventListener('click', () => void loadReviewType(state.reviewType, state.reviewPages[state.reviewType] + 1))
  el('review-list').addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-href]')
    if (row) window.location.assign(row.dataset.href)
  })
  el('review-list').addEventListener('keydown', (event) => {
    const row = event.target.closest('tr[data-href]')
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      window.location.assign(row.dataset.href)
    }
  })
  const menuSearch = el('menu-search')
  const menuResults = el('menu-search-results')
  if (menuSearch && menuResults) {
    const links = [...document.querySelectorAll('.admin-nav-link[href]')]
    const closeSearch = () => {
      menuResults.hidden = true
      menuResults.replaceChildren()
    }
    menuSearch.addEventListener('input', () => {
      const query = menuSearch.value.trim().toLocaleLowerCase('ko-KR')
      if (!query) return closeSearch()
      const matches = links.filter((link) => link.textContent.toLocaleLowerCase('ko-KR').includes(query)).slice(0, 7)
      menuResults.replaceChildren(...(matches.length ? matches.map((link) => {
        const result = document.createElement('a')
        result.href = link.href
        result.textContent = link.textContent.trim()
        if (link.target) result.target = link.target
        if (link.rel) result.rel = link.rel
        return result
      }) : [Object.assign(document.createElement('span'), { textContent: '일치하는 메뉴가 없습니다.' })]))
      menuResults.hidden = false
    })
    menuSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        menuSearch.value = ''
        closeSearch()
      }
    })
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.admin-search-wrap')) closeSearch()
    })
  }
}

async function bootstrap() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
    if (response.status === 401) return showLoginPage(false)
    if (!response.ok) return showLoginPage(true)
    const profile = await response.json()
    if (!profile.roles?.includes('ADMIN')) return showLoginPage(true)
    el('loading-shell').hidden = true
    el('auth-shell').hidden = true
    el('dashboard-shell').hidden = false
    bindEvents()
    await refreshAll()
  } catch {
    showLoginPage(false)
  }
}

bootstrap()
