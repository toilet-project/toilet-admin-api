const el = (id) => document.getElementById(id)
const number = (value) => new Intl.NumberFormat('ko-KR').format(value ?? 0)
const date = (value) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '최근 성공 이력 없음'
const compactDate = (value) => value ? value.slice(5).replace('-', '/') : ''
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const API_BASE = 'https://api.geupddong.com'
let reports = []
let selectedReportId = null

function setDefaultPeriod() {
  const today = new Date(); const before = new Date(); before.setDate(today.getDate() - 29)
  el('to').value = today.toISOString().slice(0, 10); el('from').value = before.toISOString().slice(0, 10)
}
function renderTrend(rows) {
  const target = el('trend'); target.replaceChildren()
  if (!rows.length) { target.textContent = '표시할 데이터가 없습니다.'; return }
  const series = rows.slice().reverse().map((row) => ({ ...row, value: row.insertedRecords + row.updatedRecords }))

  if (series.length === 1) {
    const [latest] = series
    const summary = document.createElement('div'); summary.className = 'trend-single-day'
    summary.innerHTML = '<span class="trend-single-day-icon" aria-hidden="true">↗</span><div><span>최근 동기화 반영</span><strong></strong><p>일별 데이터가 2일 이상 쌓이면 추이를 표시합니다.</p></div>'
    summary.querySelector('strong').textContent = `${number(latest.value)}건`
    target.append(summary)
    return
  }

  const width = 760; const height = 180; const padding = { top: 22, right: 20, bottom: 32, left: 20 }
  const max = Math.max(...series.map(({ value }) => value), 1)
  const availableWidth = width - padding.left - padding.right; const availableHeight = height - padding.top - padding.bottom
  const points = series.map((row, index) => ({
    ...row,
    x: padding.left + (availableWidth * index / (series.length - 1)),
    y: padding.top + availableHeight - (row.value / max * availableHeight),
  }))
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '일별 신규 및 수정 데이터 추이')
  const create = (name, attributes = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', name); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value))); return node }
  ;[0.25, 0.5, 0.75].forEach((ratio) => svg.append(create('line', { x1: padding.left, y1: padding.top + availableHeight * ratio, x2: width - padding.right, y2: padding.top + availableHeight * ratio, class: 'trend-grid-line' })))
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const areaPath = `${linePath} L ${points.at(-1).x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`
  svg.append(create('path', { d: areaPath, class: 'trend-area' }), create('path', { d: linePath, class: 'trend-line' }))
  points.forEach((point, index) => {
    svg.append(create('circle', { cx: point.x, cy: point.y, r: 4.5, class: 'trend-point' }))
    if (index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2)) {
      const label = create('text', { x: point.x, y: height - 10, 'text-anchor': 'middle', class: 'trend-label' }); label.textContent = compactDate(point.date); svg.append(label)
    }
  })
  target.append(svg)
}
function renderHistory(rows) {
  const target = el('history'); target.replaceChildren()
  if (!rows.length) { target.innerHTML = '<tr><td colspan="6">표시할 배치 실행 이력이 없습니다.</td></tr>'; return }
  rows.forEach((row) => {
    const tr = document.createElement('tr')
    const textCell = (value) => Object.assign(document.createElement('td'), { textContent: value })
    const statusCell = document.createElement('td'); const badge = document.createElement('span')
    badge.className = `badge ${row.status === 'FAILED' ? 'failed' : ''}`; badge.textContent = row.status === 'SUCCESS' ? '성공' : '실패'; statusCell.append(badge)
    tr.append(textCell(date(row.completedAt)), statusCell, textCell(number(row.receivedRecords)), textCell(number(row.insertedRecords)), textCell(number(row.updatedRecords)), textCell(row.errorMessage ?? '-'))
    target.append(tr)
  })
}
function reportTypeLabel(type) { return type === 'COORDINATE_CORRECTION' ? '위치 제보' : '개방 시간 제보' }
function kakaoMapLink(name, latitude, longitude) { return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${latitude},${longitude}` }
function setReportSummary() {
  const target = el('report-status'); const caption = el('report-caption')
  target.textContent = `${number(reports.length)}건`; caption.textContent = reports.length ? '검토가 필요한 제보입니다.' : '검토 대기 중인 제보가 없습니다.'
}
function renderReports() {
  const target = el('report-list'); target.replaceChildren(); setReportSummary()
  if (!reports.length) { target.innerHTML = '<p class="empty-state">현재 검토할 제보가 없습니다.</p>'; return }
  reports.forEach((report) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `report-list-item${selectedReportId === report.id ? ' is-selected' : ''}`
    button.innerHTML = `<span class="report-type-badge ${report.reportType === 'COORDINATE_CORRECTION' ? 'location' : 'time'}">${reportTypeLabel(report.reportType)}</span><strong>화장실 #${escapeHtml(report.toiletId)}</strong><span>${escapeHtml(date(report.createdAt))}</span>`
    button.addEventListener('click', () => void selectReport(report.id)); target.append(button)
  })
}
async function getToilet(id) { const response = await fetch(`${API_BASE}/api/v1/toilets/${id}`, { credentials: 'include' }); if (!response.ok) throw new Error('화장실 상세 정보를 불러오지 못했습니다.'); return response.json() }
async function selectReport(id) {
  selectedReportId = id; renderReports(); const report = reports.find((item) => item.id === id); const detail = el('report-detail'); if (!report) return
  detail.hidden = false; detail.innerHTML = '<p class="status">제보 상세를 불러오는 중입니다.</p>'
  try {
    const toilet = await getToilet(report.toiletId); const isLocation = report.reportType === 'COORDINATE_CORRECTION'
    const current = isLocation ? `<a target="_blank" rel="noreferrer" href="${kakaoMapLink(toilet.name, toilet.latitude, toilet.longitude)}">현재 위치 지도 열기</a>` : `<strong>${escapeHtml(toilet.openTime || '정보 없음')}</strong>`
    const proposed = isLocation ? `<a target="_blank" rel="noreferrer" href="${kakaoMapLink(toilet.name, report.latitude, report.longitude)}">제보 위치 지도 열기</a>` : `<strong>${escapeHtml(report.openTime)}</strong>`
    detail.innerHTML = `<div class="report-detail-head"><div><span class="report-type-badge ${isLocation ? 'location' : 'time'}">${reportTypeLabel(report.reportType)}</span><h3>${escapeHtml(toilet.name)}</h3><p>${escapeHtml(date(report.createdAt))} 접수</p></div><button id="report-detail-close" class="icon-button" type="button" aria-label="제보 상세 닫기">×</button></div><div class="comparison-grid"><article><span>${isLocation ? '현재 등록 정보' : '현재 개방 시간'}</span>${current}${isLocation ? `<small>${escapeHtml(toilet.roadAddress || toilet.jibunAddress || '주소 정보 없음')}</small>` : ''}</article><article><span>${isLocation ? '제보된 위치' : '제보된 개방 시간'}</span>${proposed}${isLocation ? `<small>${escapeHtml(report.roadAddress || '주소 정보 없음')}</small>` : ''}</article></div><div class="report-reason"><span>제보 사유</span><p>${escapeHtml(report.reason)}</p></div><label class="review-note"><span>검토 메모 <em>(선택)</em></span><textarea id="review-note" maxlength="500" placeholder="승인 또는 반려 사유를 남길 수 있습니다."></textarea></label><div class="review-actions"><button id="report-reject" class="reject-button" type="button">반려</button><button id="report-approve" type="button">승인 후 반영</button></div>`
    el('report-detail-close').addEventListener('click', () => { selectedReportId = null; detail.hidden = true; renderReports() })
    el('report-approve').addEventListener('click', () => void reviewReport(report.id, 'approve'))
    el('report-reject').addEventListener('click', () => void reviewReport(report.id, 'reject'))
  } catch (error) { detail.innerHTML = `<p class="status is-error">${error.message ?? '제보 상세를 불러오지 못했습니다.'}</p>` }
}
async function reviewReport(id, action) {
  const note = el('review-note')?.value?.trim() ?? ''; const actionLabel = action === 'approve' ? '승인하고 서비스 정보에 반영' : '반려'
  if (!window.confirm(`이 제보를 ${actionLabel}할까요?`)) return
  const detail = el('report-detail'); detail.querySelectorAll('button').forEach((button) => { button.disabled = true })
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/reports/${id}/${action}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })
    if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.error?.message ?? '제보 처리에 실패했습니다.') }
    selectedReportId = null; detail.hidden = true; await loadReports()
  } catch (error) { detail.insertAdjacentHTML('afterbegin', `<p class="status is-error">${error.message ?? '제보 처리에 실패했습니다.'}</p>`); detail.querySelectorAll('button').forEach((button) => { button.disabled = false }) }
}
async function loadReports() {
  const status = el('report-list-status'); status.className = 'status'; status.textContent = '대기 제보를 불러오는 중입니다.'
  try { const response = await fetch(`${API_BASE}/api/admin/v1/reports`, { credentials: 'include' }); if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.error?.message ?? '제보 목록을 불러오지 못했습니다.') }; reports = await response.json(); renderReports(); status.textContent = reports.length ? `대기 제보 ${number(reports.length)}건` : '대기 제보가 없습니다.' }
  catch (error) { reports = []; renderReports(); status.className = 'status is-error'; status.textContent = error.message ?? '제보 목록을 불러오지 못했습니다.' }
}
async function load() {
  const status = el('status'); status.className = 'status'; status.textContent = '운영 데이터를 불러오는 중입니다.'
  try { const query = new URLSearchParams({ from: el('from').value, to: el('to').value }); const response = await fetch(`/api/admin/v1/dashboard?${query}`); if (!response.ok) throw new Error('조회에 실패했습니다.'); const data = await response.json(); const batch = data.batch
    el('total-count').textContent = batch.totalToiletCount == null ? '-' : `${number(batch.totalToiletCount)}곳`; el('last-success').textContent = `마지막 성공 ${date(batch.lastSuccessAt)}`
    el('success-count').textContent = `${number(batch.successfulRuns)}회`; el('failure-count').textContent = `실패 ${number(batch.failedRuns)}회`
    el('inserted-count').textContent = `${number(batch.insertedRecords)}건`; el('updated-count').textContent = `수정 ${number(batch.updatedRecords)}건`
    renderTrend(data.dailySummaries); renderHistory(data.recentExecutions); status.textContent = `${data.from} ~ ${data.to} 기준`; }
  catch (error) { status.className = 'status is-error'; status.textContent = error.message ?? '운영 데이터를 불러오지 못했습니다.'; }
}
setDefaultPeriod(); el('refresh').addEventListener('click', load); el('report-refresh').addEventListener('click', () => void loadReports()); load(); void loadReports()
