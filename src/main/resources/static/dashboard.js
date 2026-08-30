const el = (id) => document.getElementById(id)
const number = (value) => new Intl.NumberFormat('ko-KR').format(value ?? 0)
const date = (value) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '최근 성공 이력 없음'
const compactDate = (value) => value ? value.slice(5).replace('-', '/') : ''

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
async function load() {
  const status = el('status'); status.className = 'status'; status.textContent = '운영 데이터를 불러오는 중입니다.'
  try { const query = new URLSearchParams({ from: el('from').value, to: el('to').value }); const response = await fetch(`/api/admin/v1/dashboard?${query}`); if (!response.ok) throw new Error('조회에 실패했습니다.'); const data = await response.json(); const batch = data.batch
    el('total-count').textContent = batch.totalToiletCount == null ? '-' : `${number(batch.totalToiletCount)}곳`; el('last-success').textContent = `마지막 성공 ${date(batch.lastSuccessAt)}`
    el('success-count').textContent = `${number(batch.successfulRuns)}회`; el('failure-count').textContent = `실패 ${number(batch.failedRuns)}회`
    el('inserted-count').textContent = `${number(batch.insertedRecords)}건`; el('updated-count').textContent = `수정 ${number(batch.updatedRecords)}건`
    renderTrend(data.dailySummaries); renderHistory(data.recentExecutions); status.textContent = `${data.from} ~ ${data.to} 기준`; }
  catch (error) { status.className = 'status is-error'; status.textContent = error.message ?? '운영 데이터를 불러오지 못했습니다.'; }
}
setDefaultPeriod(); el('refresh').addEventListener('click', load); load()
