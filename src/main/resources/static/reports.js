const el = (id) => document.getElementById(id)
const API_BASE = 'https://api.geupddong.com'
let reports = []
let selectedReportId = null

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const date = (value) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-'
const reportTypeLabel = (type) => type === 'COORDINATE_CORRECTION' ? '위치 제보' : '개방 시간 제보'
const reportName = (report) => report.toiletName || `화장실 #${report.toiletId}`
const reportTypeClass = (report) => report.reportType === 'COORDINATE_CORRECTION' ? 'location' : 'time'
const kakaoMapLink = (name, latitude, longitude) => `https://map.kakao.com/link/map/${encodeURIComponent(name)},${latitude},${longitude}`

function selectedIdFromUrl() {
  const value = new URLSearchParams(window.location.search).get('reportId')
  return value && /^\d+$/.test(value) ? Number(value) : null
}
function updateUrl(reportId) {
  const url = new URL(window.location.href)
  if (reportId == null) url.searchParams.delete('reportId'); else url.searchParams.set('reportId', String(reportId))
  window.history.replaceState({}, '', url)
}
function matchingReports() {
  const keyword = el('report-search').value.trim().toLowerCase()
  return keyword ? reports.filter((report) => reportName(report).toLowerCase().includes(keyword)) : reports
}
function renderReports() {
  const target = el('report-list'); target.replaceChildren()
  const filtered = matchingReports()
  if (!filtered.length) { target.innerHTML = `<p class="empty-state">${reports.length ? '검색 결과가 없습니다.' : '현재 검토할 제보가 없습니다.'}</p>`; return }
  filtered.forEach((report) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `report-list-item${selectedReportId === report.id ? ' is-selected' : ''}`
    button.innerHTML = `<span class="report-type-badge ${reportTypeClass(report)}">${reportTypeLabel(report.reportType)}</span><strong>${escapeHtml(reportName(report))}</strong><span>${escapeHtml(date(report.createdAt))}</span>`
    button.addEventListener('click', () => void selectReport(report.id))
    target.append(button)
  })
}
async function getToilet(id) {
  const response = await fetch(`${API_BASE}/api/v1/toilets/${id}`, { credentials: 'include' })
  if (!response.ok) throw new Error('화장실 상세 정보를 불러오지 못했습니다.')
  return response.json()
}
async function selectReport(id) {
  const report = reports.find((item) => item.id === id); if (!report) return
  selectedReportId = id; updateUrl(id); renderReports()
  const detail = el('report-detail'); detail.innerHTML = '<p class="status">제보 상세를 불러오는 중입니다.</p>'
  try {
    const toilet = await getToilet(report.toiletId); const isLocation = report.reportType === 'COORDINATE_CORRECTION'
    const current = isLocation ? `<a target="_blank" rel="noreferrer" href="${kakaoMapLink(toilet.name, toilet.latitude, toilet.longitude)}">현재 위치 지도 열기</a>` : `<strong>${escapeHtml(toilet.openTime || '정보 없음')}</strong>`
    const proposed = isLocation ? `<a target="_blank" rel="noreferrer" href="${kakaoMapLink(toilet.name, report.latitude, report.longitude)}">제보 위치 지도 열기</a>` : `<strong>${escapeHtml(report.openTime)}</strong>`
    detail.innerHTML = `<div class="report-detail-head"><div><span class="report-type-badge ${reportTypeClass(report)}">${reportTypeLabel(report.reportType)}</span><h3>${escapeHtml(reportName(report))}</h3><p>${escapeHtml(date(report.createdAt))} 접수</p></div><button id="report-detail-close" class="icon-button" type="button" aria-label="제보 상세 닫기">×</button></div><div class="comparison-grid"><article><span>${isLocation ? '현재 등록 정보' : '현재 개방 시간'}</span>${current}${isLocation ? `<small>${escapeHtml(toilet.roadAddress || toilet.jibunAddress || '주소 정보 없음')}</small>` : ''}</article><article><span>${isLocation ? '제보된 위치' : '제보된 개방 시간'}</span>${proposed}${isLocation ? `<small>${escapeHtml(report.roadAddress || '주소 정보 없음')}</small>` : ''}</article></div><div class="report-reason"><span>제보 사유</span><p>${escapeHtml(report.reason)}</p></div><label class="review-note"><span>검토 메모 <em>(선택)</em></span><textarea id="review-note" maxlength="500" placeholder="승인 또는 반려 사유를 남길 수 있습니다."></textarea></label><div class="review-actions"><button id="report-reject" class="reject-button" type="button">반려</button><button id="report-approve" type="button">승인 후 반영</button></div>`
    el('report-detail-close').addEventListener('click', () => { selectedReportId = null; updateUrl(null); detail.innerHTML = '<p class="empty-state">왼쪽 목록에서 제보를 선택해 주세요.</p>'; renderReports() })
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
    selectedReportId = null; updateUrl(null); detail.innerHTML = '<p class="empty-state">제보가 처리되었습니다.</p>'; await loadReports()
  } catch (error) { detail.insertAdjacentHTML('afterbegin', `<p class="status is-error">${error.message ?? '제보 처리에 실패했습니다.'}</p>`); detail.querySelectorAll('button').forEach((button) => { button.disabled = false }) }
}
function showLoginPage(title, description) {
  el('reports-shell').hidden = true; el('auth-shell').hidden = false
  el('auth-title').textContent = title; el('auth-description').textContent = description; el('auth-actions').hidden = false
}
async function loadReports() {
  const status = el('report-list-status'); status.className = 'status'; status.textContent = '제보를 불러오는 중입니다.'
  try {
    const response = await fetch(`${API_BASE}/api/admin/v1/reports`, { credentials: 'include' })
    if (!response.ok) { if (response.status === 401) return showLoginPage('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.'); if (response.status === 403) return showLoginPage('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나, 관리자 권한 설정을 확인해 주세요.'); throw new Error('제보 목록을 불러오지 못했습니다.') }
    reports = await response.json(); renderReports(); status.textContent = reports.length ? `대기 제보 ${reports.length}건` : '대기 제보가 없습니다.'
    const requestedId = selectedReportId ?? selectedIdFromUrl(); if (requestedId && reports.some((report) => report.id === requestedId)) await selectReport(requestedId)
  } catch (error) { reports = []; renderReports(); status.className = 'status is-error'; status.textContent = error.message ?? '제보 목록을 불러오지 못했습니다.' }
}
async function bootstrap() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
    if (response.status === 401) return showLoginPage('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.')
    if (!response.ok) return showLoginPage('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나, 관리자 권한 설정을 확인해 주세요.')
    const profile = await response.json(); if (!profile.roles?.includes('ADMIN')) return showLoginPage('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나, 관리자 권한 설정을 확인해 주세요.')
    el('auth-shell').hidden = true; el('reports-shell').hidden = false
    el('report-search').addEventListener('input', renderReports); el('report-refresh').addEventListener('click', () => void loadReports()); await loadReports()
  } catch { showLoginPage('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.') }
}
bootstrap()
