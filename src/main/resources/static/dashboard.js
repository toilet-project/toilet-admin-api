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
  const max = Math.max(...rows.map((row) => row.insertedRecords + row.updatedRecords), 1)
  rows.slice().reverse().forEach((row) => { const item = document.createElement('div'); item.className = 'bar'; const bar = document.createElement('div'); bar.style.height = `${Math.max(6, ((row.insertedRecords + row.updatedRecords) / max) * 105)}px`; item.append(bar, Object.assign(document.createElement('strong'), { textContent: number(row.insertedRecords + row.updatedRecords) }), Object.assign(document.createElement('span'), { textContent: compactDate(row.date) })); target.append(item) })
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
