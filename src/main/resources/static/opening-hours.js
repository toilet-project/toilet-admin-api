const $ = (id) => document.getElementById(id)
const PREVIEW_PREFIX = location.hostname === 'preview.geupddong.com' && location.pathname.startsWith('/opening-hours-preview/') ? '/opening-hours-preview' : ''
const ISOLATED_PREVIEW = Boolean(PREVIEW_PREFIX) || location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.hostname.endsWith('.trycloudflare.com')
const API = PREVIEW_PREFIX || (ISOLATED_PREVIEW ? '' : 'https://api.geupddong.com')
const DAY_NAMES = ['월','화','수','목','금','토','일']
const STATUS_LABELS = { REVIEW_REQUIRED:'검토 필요', SOURCE_CHANGED:'원문 변경', PARSED:'자동 판정', CONFIRMED:'관리자 확정', NOT_NORMALIZED:'미정형' }
const POLICY_LABELS = { ALWAYS:'상시 운영', SCHEDULED:'요일별 운영', IRREGULAR:'불규칙', CLOSED:'미개방', UNKNOWN:'판정 불가' }
const HOLIDAY_LABELS = { OPEN:'공휴일 운영', CLOSED:'공휴일 휴무', UNKNOWN:'확인 필요' }
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))
let page = 0, selectedKey = null, currentDetail = null, listSequence = 0, detailSequence = 0, searchTimer = null, saving = false

function showLogin(status) {
  $('loading-shell').hidden = true
  $('opening-hours-shell').hidden = true
  $('auth-shell').hidden = false
  $('auth-title').textContent = status === 403 ? '관리자 권한이 필요합니다' : '관리자 로그인'
  $('auth-description').textContent = status === 403 ? '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.' : '승인된 관리자 계정으로 로그인해 주세요.'
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: ISOLATED_PREVIEW ? 'omit' : 'include', ...options })
  if (!ISOLATED_PREVIEW && (response.status === 401 || response.status === 403)) showLogin(response.status)
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || '요청을 처리하지 못했습니다.')
  return data
}

function statusOf(item) { return item.status }
function badge(item) {
  const status = statusOf(item)
  const tone = status === 'CONFIRMED' ? 'confirmed' : status === 'SOURCE_CHANGED' ? 'changed' : status === 'REVIEW_REQUIRED' || status === 'NOT_NORMALIZED' ? 'review' : ''
  return `<span class="opening-hours-badge ${tone}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`
}
function rawText(item) { return [item.openTime, item.openTimeDetail].filter(Boolean).join(' · ') || '개방시간 원문 없음' }
function address(item) { return item.roadAddress || item.jibunAddress || '주소 정보 없음' }

function renderList(data) {
  const list = $('opening-hours-list')
  list.replaceChildren()
  for (const item of data.items) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'opening-hours-item'
    button.dataset.patternKey = item.patternKey
    button.setAttribute('aria-pressed', String(selectedKey === item.patternKey))
    button.innerHTML = `<span class="opening-hours-item-head"><strong>${escapeHtml(rawText(item))}</strong>${badge(item)}</span><span class="opening-hours-item-source">대표 · ${escapeHtml(item.sampleName || '이름 없는 화장실')}</span><span class="opening-hours-item-meta"><span>전체 ${Number(item.facilityCount).toLocaleString()}개 · 적용 ${Number(item.targetCount).toLocaleString()}개</span>${item.protectedCount ? `<span>보호 ${Number(item.protectedCount).toLocaleString()}</span>` : ''}</span>`
    button.addEventListener('click', () => { if (!saving) void loadDetail(item.patternKey) })
    list.append(button)
  }
  if (!data.items.length) list.innerHTML = '<p class="opening-hours-list-empty">조건에 맞는 개방시간 유형이 없습니다.</p>'
  renderPages(data)
  const selectedLabel = $('opening-hours-filter').selectedOptions[0]?.textContent || '검토 대상'
  $('opening-hours-status').innerHTML = `<strong>${escapeHtml(selectedLabel)} ${Number(data.totalElements).toLocaleString()}개 유형</strong><span>같은 원문 유형을 한 번에 검토하고 적용합니다.</span>`
}

function renderPages(data) {
  const nav = $('opening-hours-pages')
  nav.replaceChildren()
  if (data.totalPages <= 1) return
  const current = data.page, visible = Math.min(5, data.totalPages)
  const start = Math.min(Math.max(current - Math.floor(visible / 2), 0), data.totalPages - visible)
  const icons = { first:'<svg viewBox="0 0 24 24"><path d="m11 7-5 5 5 5M18 7l-5 5 5 5"/></svg>', prev:'<svg viewBox="0 0 24 24"><path d="m15 7-5 5 5 5"/></svg>', next:'<svg viewBox="0 0 24 24"><path d="m9 7 5 5-5 5"/></svg>', last:'<svg viewBox="0 0 24 24"><path d="m6 7 5 5-5 5M13 7l5 5-5 5"/></svg>' }
  const add = (label, target, disabled, icon) => {
    const button = document.createElement('button'); button.type = 'button'; button.disabled = disabled
    if (icon) { button.innerHTML = icons[icon]; button.setAttribute('aria-label', label); button.title = label } else { button.textContent = label; if (target === current) button.setAttribute('aria-current','page') }
    if (!disabled) button.addEventListener('click', () => void loadList(target))
    nav.append(button)
  }
  add('맨앞', 0, current === 0, 'first'); add('이전', current - 1, current === 0, 'prev')
  for (let index = start; index < start + visible; index += 1) add(String(index + 1), index, index === current)
  add('다음', current + 1, current === data.totalPages - 1, 'next'); add('맨뒤', data.totalPages - 1, current === data.totalPages - 1, 'last')
}

async function loadList(nextPage = 0) {
  const sequence = ++listSequence
  $('opening-hours-workspace').setAttribute('aria-busy','true')
  try {
    const query = new URLSearchParams({ status:$('opening-hours-filter').value, keyword:$('opening-hours-keyword').value.trim(), page:String(nextPage), size:'15' })
    const data = await request(`/api/admin/v1/opening-hours/patterns?${query}`)
    if (sequence !== listSequence) return
    page = data.page
    renderList(data)
    if (selectedKey && !data.items.some(item => item.patternKey === selectedKey)) selectedKey = null
  } catch (error) {
    if (sequence === listSequence) $('opening-hours-list').innerHTML = `<p class="opening-hours-error">${escapeHtml(error.message)}</p>`
  } finally { if (sequence === listSequence) $('opening-hours-workspace').setAttribute('aria-busy','false') }
}

function normalizedText(item) {
  if (item.open24h === true) return '24시간 운영'
  if (item.open24h === false) return POLICY_LABELS[item.openingPolicy] || '24시간 아님'
  return POLICY_LABELS[item.openingPolicy] || '판정 필요'
}

function detailMarkup(detail) {
  const item = detail.pattern, normalized = item.suggested || {}
  const confidence = normalized.confidence == null ? '—' : `${Math.round(normalized.confidence * 100)}%`
  const facilities = detail.facilities.map(facility => `<li><span><strong>${escapeHtml(facility.name || '이름 없는 화장실')}</strong><small>${escapeHtml(address(facility))}</small></span>${facility.manualOverride ? '<em>기존 확정 보호</em>' : '<em class="target">일괄 적용 대상</em>'}</li>`).join('')
  return `<header class="opening-hours-detail-head"><div><span class="opening-hours-detail-kicker">OPENING HOURS TYPE</span><h2>${escapeHtml(rawText(item))}</h2><p>전체 ${Number(item.facilityCount).toLocaleString()}개 시설 · 이번 적용 ${Number(item.targetCount).toLocaleString()}개 · 기존 확정 보호 ${Number(item.protectedCount).toLocaleString()}개</p></div>${badge(item)}</header>
    ${item.status === 'SOURCE_CHANGED' ? '<p class="opening-hours-notice">일부 시설은 관리자 확정 이후 공공데이터 원문이 변경되었습니다. 기존 개별 확정값은 보호하고 나머지 대상에만 새 유형을 적용합니다.</p>' : ''}
    <section class="opening-hours-summary">
      <article class="opening-hours-card"><small>PUBLIC DATA SOURCE</small><h3>공공데이터 원문 유형</h3><dl><dt>운영 구분</dt><dd>${escapeHtml(item.openTime || '없음')}</dd><dt>운영 상세</dt><dd>${escapeHtml(item.openTimeDetail || '없음')}</dd></dl></article>
      <article class="opening-hours-card auto"><small>NORMALIZED RESULT</small><h3>자동 해석 제안</h3><dl><dt>판정</dt><dd>${escapeHtml(normalizedText(normalized))}</dd><dt>신뢰도</dt><dd>${confidence}</dd><dt>파서</dt><dd>현재 정형 규칙</dd><dt>상태</dt><dd>${escapeHtml(STATUS_LABELS[item.status] || item.status)}</dd></dl></article>
      <article class="opening-hours-card service"><small>APPLY SCOPE</small><h3>일괄 적용 범위</h3><dl><dt>전체 시설</dt><dd>${Number(item.facilityCount).toLocaleString()}개</dd><dt>적용 대상</dt><dd>${Number(item.targetCount).toLocaleString()}개</dd><dt>보호 제외</dt><dd>${Number(item.protectedCount).toLocaleString()}개</dd><dt>적용 기준</dt><dd>원문 완전 일치</dd></dl></article>
    </section>
    <section class="opening-hours-members"><header><div><small>AFFECTED FACILITIES</small><h3>이 유형을 사용하는 화장실</h3></div><span>최대 30개 표본</span></header><ul>${facilities}</ul></section>
    <form id="opening-hours-form" class="opening-hours-form">
      <header class="opening-hours-form-head"><h3>유형 일괄 확정</h3><span>개별 확정값은 유지하고 적용 대상만 갱신합니다.</span></header>
      <div class="opening-hours-controls">
        <label class="opening-hours-field">운영 정책<select id="opening-policy"><option value="ALWAYS">상시 운영</option><option value="SCHEDULED">요일별 운영</option><option value="IRREGULAR">불규칙</option><option value="CLOSED">미개방</option></select></label>
        <div class="opening-hours-field">24시간 운영<div class="opening-hours-radio"><label><input type="radio" name="open24h" value="true"/>예</label><label><input type="radio" name="open24h" value="false"/>아니오</label></div></div>
        <label class="opening-hours-field">공휴일 운영<select id="holiday-policy"><option value="UNKNOWN">확인 필요</option><option value="OPEN">운영</option><option value="CLOSED">휴무</option></select></label>
      </div>
      <section class="opening-hours-schedule"><div class="opening-hours-schedule-head"><span>요일</span><span>휴무</span><span>시작</span><span></span><span>종료</span></div><div id="opening-hours-days"></div></section>
      <footer class="opening-hours-actions"><p id="opening-hours-save-status">요일별 운영인 경우 실제 운영하는 요일과 시간을 선택해 주세요.</p><button id="opening-hours-save" type="submit">${Number(item.targetCount).toLocaleString()}개 시설에 적용</button></footer>
    </form>`
}

function renderDays(schedules = []) {
  const target = $('opening-hours-days'); target.replaceChildren()
  for (let index = 0; index < 7; index += 1) {
    const day = index + 1, slot = schedules.find(value => value.dayOfWeek === day)
    const row = document.createElement('div'); row.className = 'opening-hours-day'; row.dataset.day = String(day)
    row.innerHTML = `<label><input class="day-enabled" type="checkbox" ${slot ? 'checked' : ''}/> ${DAY_NAMES[index]}요일</label><label class="closed"><input class="day-closed" type="checkbox" ${slot?.closed ? 'checked' : ''}/> 휴무</label><input class="day-start" type="time" value="${escapeHtml(slot?.startTime || '09:00')}"/><i>–</i><input class="day-end" type="time" value="${escapeHtml(slot?.endTime || '18:00')}"/>`
    target.append(row)
    row.querySelectorAll('input').forEach(input => input.addEventListener('change', syncFormState))
  }
}

function syncFormState() {
  const policy = $('opening-policy').value
  const open24h = document.querySelector('[name="open24h"]:checked')?.value === 'true'
  if (open24h && policy !== 'ALWAYS') $('opening-policy').value = 'ALWAYS'
  const scheduleEnabled = $('opening-policy').value === 'SCHEDULED' && !open24h
  document.querySelectorAll('.opening-hours-day').forEach(row => {
    const enabled = row.querySelector('.day-enabled'); const closed = row.querySelector('.day-closed')
    enabled.disabled = !scheduleEnabled
    closed.disabled = !scheduleEnabled || !enabled.checked
    row.querySelectorAll('input[type="time"]').forEach(input => { input.disabled = !scheduleEnabled || !enabled.checked || closed.checked })
  })
}

function mountForm(detail) {
  const value = detail.pattern.suggested || {}
  $('opening-policy').value = ['ALWAYS','SCHEDULED','IRREGULAR','CLOSED'].includes(value.openingPolicy) ? value.openingPolicy : 'SCHEDULED'
  const open24h = value.open24h === true
  document.querySelector(`[name="open24h"][value="${open24h}"]`).checked = true
  $('holiday-policy').value = ['OPEN','CLOSED','UNKNOWN'].includes(value.holidayPolicy) ? value.holidayPolicy : 'UNKNOWN'
  renderDays(value.schedules || [])
  $('opening-policy').addEventListener('change', () => { if (['IRREGULAR','CLOSED'].includes($('opening-policy').value)) document.querySelector('[name="open24h"][value="false"]').checked = true; syncFormState() })
  document.querySelectorAll('[name="open24h"]').forEach(input => input.addEventListener('change', syncFormState))
  $('opening-hours-form').addEventListener('submit', event => { event.preventDefault(); void saveDetail() })
  syncFormState()
}

async function loadDetail(patternKey) {
  const sequence = ++detailSequence; selectedKey = patternKey
  document.querySelectorAll('.opening-hours-item').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.patternKey === patternKey)))
  $('opening-hours-detail').innerHTML = '<div class="opening-hours-empty"><strong>개방시간 유형을 불러오는 중입니다.</strong></div>'
  try {
    const detail = await request(`/api/admin/v1/opening-hours/patterns/${patternKey}`)
    if (sequence !== detailSequence) return
    currentDetail = detail
    $('opening-hours-detail').innerHTML = detailMarkup(detail)
    mountForm(detail)
  } catch (error) { if (sequence === detailSequence) $('opening-hours-detail').innerHTML = `<p class="opening-hours-error">${escapeHtml(error.message)}</p>` }
}

function schedulesFromForm() {
  if ($('opening-policy').value !== 'SCHEDULED' || document.querySelector('[name="open24h"]:checked')?.value === 'true') return []
  return [...document.querySelectorAll('.opening-hours-day')].filter(row => row.querySelector('.day-enabled').checked).map(row => {
    const closed = row.querySelector('.day-closed').checked
    const startTime = closed ? null : row.querySelector('.day-start').value
    const endTime = closed ? null : row.querySelector('.day-end').value
    return { dayOfWeek:Number(row.dataset.day), slotIndex:0, startTime, endTime, crossesMidnight:!closed && endTime <= startTime, closed }
  })
}

async function saveDetail() {
  if (!currentDetail || saving) return
  const schedules = schedulesFromForm(), policy = $('opening-policy').value
  if (policy === 'SCHEDULED' && !schedules.length) { $('opening-hours-save-status').textContent = '요일별 운영에는 하나 이상의 운영 요일이 필요합니다.'; return }
  const body = { openingPolicy:policy, open24h:document.querySelector('[name="open24h"]:checked')?.value === 'true', holidayPolicy:$('holiday-policy').value, schedules }
  saving = true; $('opening-hours-save').disabled = true; $('opening-hours-save-status').textContent = '확정값을 저장하는 중입니다.'
  try {
    const result = await request(`/api/admin/v1/opening-hours/patterns/${currentDetail.pattern.patternKey}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
    $('opening-hours-save-status').textContent = `${Number(result.appliedCount).toLocaleString()}개 시설에 적용했습니다. 기존 확정 ${Number(result.protectedCount).toLocaleString()}개는 유지했습니다.`
    await Promise.all([loadList(page), loadDetail(currentDetail.pattern.patternKey)])
  } catch (error) { $('opening-hours-save-status').textContent = error.message }
  finally { saving = false; const button = $('opening-hours-save'); if (button) button.disabled = false }
}

async function bootstrap() {
  try {
    if (!ISOLATED_PREVIEW) {
      const auth = await fetch(`${API}/api/v1/auth/me`, { credentials:'include' })
      if (auth.status === 401 || auth.status === 403) return showLogin(auth.status)
      if (!auth.ok) throw new Error('관리자 인증을 확인하지 못했습니다.')
      const profile = await auth.json(); if (!profile.roles?.includes('ADMIN')) return showLogin(403)
    }
    $('loading-shell').hidden = true; $('opening-hours-shell').hidden = false
    $('opening-hours-filter').addEventListener('change', () => void loadList(0))
    $('opening-hours-keyword').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void loadList(0), 220) })
    await loadList(0)
  } catch { showLogin(401) }
}

document.addEventListener('admin:before-route-change', () => { ++listSequence; ++detailSequence; clearTimeout(searchTimer) }, { once:true })
bootstrap()
