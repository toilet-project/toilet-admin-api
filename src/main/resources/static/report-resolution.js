/* Real report resolution: immutable evidence above, current facility actions below. */
globalThis.ReportResolution = (() => {
  const labels = { HIDE_TEMPORARILY: '임시 숨김', RESTORE: '숨김 해제', UPDATE_OPENING_HOURS: '개방시간', UPDATE_COORDINATES: '위치 조정' }
  const policies = { ALWAYS: '24시간', SCHEDULED: '요일별 운영', IRREGULAR: '비정기 운영', CLOSED: '운영 중단', UNKNOWN: '미확인' }
  const days = ['월', '화', '수', '목', '금', '토', '일']
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const time = value => value ? String(value).slice(0, 5) : ''
  const date = value => value ? new Intl.DateTimeFormat('ko-KR', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Seoul'}).format(new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : value.length === 10 ? value + 'T00:00:00+09:00' : value + '+09:00')) : '-'
  function hoursText(hours, facility) {
    if (!hours || hours.openingPolicy === 'UNKNOWN') return [facility.sourceOpenTime, facility.sourceOpenTimeDetail].filter(Boolean).join(' · ') || '정보 없음'
    if (hours.openingPolicy !== 'SCHEDULED') return policies[hours.openingPolicy] || '정보 없음'
    return hours.schedules.map(s => `${days[s.dayOfWeek - 1]} ${s.closed ? '휴무' : `${time(s.startTime)}–${time(s.endTime)}${s.crossesMidnight ? '(익일)' : ''}`}`).join(' · ')
  }
  function historyMarkup(history) {
    return `<details class="resolution-history"${history.length ? ' open' : ''}><summary>시설 조치 이력 ${history.length}${history.length === 50 ? '+' : ''}건</summary>${history.map(item => {
      let before = {}, after = {}; try { before = JSON.parse(item.beforeJson); after = JSON.parse(item.afterJson) } catch {}
      const describe = value => item.action === 'UPDATE_OPENING_HOURS' ? hoursText(value.openingHours, value) : item.action === 'UPDATE_COORDINATES' ? `${value.latitude}, ${value.longitude} · ${value.roadAddress || value.jibunAddress || ''}` : ({ VISIBLE: '공개', HIDDEN_TEMPORARY: '임시 숨김', HIDDEN_DUPLICATE: '중복 숨김' })[value.visibilityStatus] || value.visibilityStatus
      return `<article><strong>${esc(labels[item.action] || item.action)}</strong><small>${esc(date(item.createdAt))} · 제보 #${esc(item.reportId)} · 관리자 #${esc(item.actorUserId)}</small><p>${esc(item.reason)}</p><div class="resolution-history-diff"><span>이전 · ${esc(describe(before))}</span><span>변경 · ${esc(describe(after))}</span></div></article>`
    }).join('')}</details>`
  }
  function slotMarkup(slot, index) {
    return `<div class="resolution-slot" data-slot><select aria-label="요일">${days.map((day, i) => `<option value="${i + 1}"${slot.dayOfWeek === i + 1 ? ' selected' : ''}>${day}</option>`).join('')}</select><input type="time" aria-label="시작 시간" value="${esc(time(slot.startTime))}"${slot.closed ? ' disabled' : ''}><span>–</span><input type="time" aria-label="종료 시간" value="${esc(time(slot.endTime))}"${slot.closed ? ' disabled' : ''}><label><input type="checkbox" data-closed${slot.closed ? ' checked' : ''}>휴무</label><button type="button" class="resolution-remove" aria-label="${index + 1}번째 시간대 삭제">×</button></div>`
  }
  function hoursMarkup(hours) {
    const policy = hours?.openingPolicy in policies && hours.openingPolicy !== 'UNKNOWN' ? hours.openingPolicy : ''
    return `<div class="resolution-hours-head"><label>운영 방식<select id="resolution-policy"><option value="">선택</option>${Object.entries(policies).filter(([key]) => key !== 'UNKNOWN').map(([key, label]) => `<option value="${key}"${policy === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>공휴일<select id="resolution-holiday">${[['UNKNOWN','미확인'],['OPEN','운영'],['CLOSED','휴무']].map(([key,label]) => `<option value="${key}"${(hours?.holidayPolicy || 'UNKNOWN') === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div><div id="resolution-schedule"${policy === 'SCHEDULED' ? '' : ' hidden'}><div id="resolution-slots">${(hours?.schedules || []).map(slotMarkup).join('')}</div><button type="button" id="resolution-add-slot" class="secondary-button">시간대 추가</button><small>종료가 시작보다 이르면 익일 종료입니다.</small></div>`
  }
  function scheduleRequest(policy, holidayPolicy, rows) {
    if (!policy) throw new Error('운영 방식을 선택해 주세요.')
    const counts = new Map()
    return { openingPolicy: policy, open24h: policy === 'ALWAYS', holidayPolicy, schedules: policy === 'SCHEDULED' ? rows.map(row => {
      const day = Number(row.dayOfWeek), index = counts.get(day) || 0; counts.set(day, index + 1)
      if (!row.closed && (!row.startTime || !row.endTime || row.startTime === row.endTime)) throw new Error('시작·종료 시간을 확인해 주세요.')
      return { dayOfWeek: day, slotIndex: index, startTime: row.closed ? null : row.startTime, endTime: row.closed ? null : row.endTime, closed: row.closed, crossesMidnight: !row.closed && row.endTime < row.startTime }
    }) : [] }
  }
  async function mount(report, reload, context) {
    const root = document.getElementById('report-resolution')
    if (!root || !report.toiletId) return
    // admin-shell loads page scripts as ES modules on navigation. Never rely on another script's lexical scope.
    const active = () => root.isConnected && context.isSelected()
    const API_BASE = context.apiBase
    root.innerHTML = '<p class="status">현재 시설 정보를 확인하고 있습니다.</p>'
    try {
      const response = await fetch(`${API_BASE}/api/admin/v1/reports/${report.id}/actions`, { credentials: 'include' })
      if (!response.ok) throw new Error('시설 조치를 불러오지 못했습니다. 상세를 다시 열어 주세요.')
      const state = await response.json(); if (!active()) return
      const facility = state.facility
      let action = null, position = null, busy = false, requestId = null, requestSignature = null, mapSequence = 0
      const status = ({ VISIBLE: '공개 중', HIDDEN_TEMPORARY: '임시 숨김 중', HIDDEN_DUPLICATE: '중복 숨김 중' })[facility.visibilityStatus] || facility.visibilityStatus
      const choices = facility.visibilityStatus === 'HIDDEN_TEMPORARY' ? ['RESTORE'] : facility.visibilityStatus === 'VISIBLE' ? ['HIDE_TEMPORARILY'] : []
      choices.push('UPDATE_OPENING_HOURS', 'UPDATE_COORDINATES')
      root.innerHTML = `<div class="resolution-head"><strong>시설 조치</strong><span class="resolution-visibility">${esc(status)}</span></div><p class="resolution-current">현재 개방시간 · ${esc(hoursText(state.openingHours, facility))}</p>${state.actionable ? `<div class="resolution-tabs">${choices.map(key => `<button type="button" data-action="${key}" aria-pressed="false">${labels[key]}</button>`).join('')}</div><form id="resolution-form" hidden><div id="resolution-editor"></div><div class="resolution-save"><textarea id="resolution-reason" maxlength="500" required rows="2" aria-label="조치 근거" placeholder="조치 근거"></textarea><button type="submit" id="resolution-submit">${report.status === 'PENDING' ? '적용하고 완료' : '변경사항 저장'}</button></div></form>` : ''}<p id="resolution-feedback" class="status" role="status"></p>${historyMarkup(state.history)}`
      if (!state.actionable) return
      const form = root.querySelector('form'), editor = root.querySelector('#resolution-editor'), feedback = root.querySelector('#resolution-feedback')
      const bindSlots = () => editor.querySelectorAll('[data-slot]').forEach(row => {
        row.querySelector('[data-closed]').onchange = event => row.querySelectorAll('input[type=time]').forEach(input => { input.disabled = event.target.checked })
        row.querySelector('.resolution-remove').onclick = () => row.remove()
      })
      root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
        if (busy) return
        action = button.dataset.action; position = null; requestId = null; requestSignature = null; mapSequence++
        feedback.textContent = ''; form.hidden = false
        root.querySelectorAll('[data-action]').forEach(node => node.setAttribute('aria-pressed', String(node === button)))
        if (action === 'HIDE_TEMPORARILY' || action === 'RESTORE') {
          editor.innerHTML = `<p class="resolution-help">${action === 'HIDE_TEMPORARILY' ? '사용자 지도·목록에서 숨깁니다. 관리자가 해제할 때까지 유지됩니다.' : '사용자 지도·목록에 다시 표시합니다.'}</p>`
        } else if (action === 'UPDATE_OPENING_HOURS') {
          editor.innerHTML = hoursMarkup(state.openingHours)
          editor.querySelector('#resolution-policy').onchange = event => { editor.querySelector('#resolution-schedule').hidden = event.target.value !== 'SCHEDULED' }
          editor.querySelector('#resolution-add-slot').onclick = () => { const target = editor.querySelector('#resolution-slots'); target.insertAdjacentHTML('beforeend', slotMarkup({dayOfWeek: 1, startTime: '09:00', endTime: '18:00'}, target.children.length)); bindSlots() }
          bindSlots()
        } else {
          editor.innerHTML = '<p class="resolution-help">지도를 누르거나 핀을 옮겨 위치를 지정하세요.</p><div id="resolution-map" class="review-location-map"></div><div class="resolution-coordinates"><label>위도<input id="resolution-lat" type="number" step="0.0000001" min="32" max="39.5" required></label><label>경도<input id="resolution-lng" type="number" step="0.0000001" min="124" max="132" required></label></div>'
          const target = editor.querySelector('#resolution-map'), lat = editor.querySelector('#resolution-lat'), lng = editor.querySelector('#resolution-lng'), sequence = mapSequence
          const valid = context.hasCoordinates(facility.latitude, facility.longitude)
          if (valid) { lat.value = facility.latitude; lng.value = facility.longitude; position = { latitude: Number(lat.value), longitude: Number(lng.value) } }
          try {
            await context.loadMaps(); if (!active() || !target.isConnected || sequence !== mapSequence) return
            const center = new kakao.maps.LatLng(valid ? facility.latitude : 36.5, valid ? facility.longitude : 127.5)
            const map = new kakao.maps.Map(target, { center, level: valid ? 3 : 12 })
            globalThis.AdminResponsive?.watchMap(map, target)
            const marker = new kakao.maps.Marker({ map: valid ? map : null, position: center, draggable: true })
            const setPosition = point => { if (!active() || !target.isConnected) return; marker.setMap(map); marker.setPosition(point); lat.value = point.getLat().toFixed(7); lng.value = point.getLng().toFixed(7); position = { latitude: Number(lat.value), longitude: Number(lng.value) } }
            kakao.maps.event.addListener(map, 'click', event => setPosition(event.latLng))
            kakao.maps.event.addListener(marker, 'dragend', () => setPosition(marker.getPosition()))
            for (const input of [lat, lng]) input.addEventListener('change', () => { if (lat.value && lng.value && lat.checkValidity() && lng.checkValidity()) { setPosition(new kakao.maps.LatLng(Number(lat.value), Number(lng.value))); map.panTo(marker.getPosition()) } })
          } catch (error) { if (active() && target.isConnected) target.innerHTML = `<p class="status is-error">${esc(error.message)} 좌표를 직접 입력할 수 있습니다.</p>` }
        }
      }))
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (busy || !active() || !action) return
        feedback.className = 'status'
        try {
          const payload = { action, reason: root.querySelector('#resolution-reason').value.trim(), expectedState: state.expectedState }
          if (!payload.reason) throw new Error('조치 근거를 입력해 주세요.')
          if (action === 'UPDATE_COORDINATES') {
            const lat = editor.querySelector('#resolution-lat').value, lng = editor.querySelector('#resolution-lng').value
            if (!lat || !lng) throw new Error('위치를 지정해 주세요.')
            Object.assign(payload, {latitude: Number(lat), longitude: Number(lng)})
          }
          if (action === 'UPDATE_OPENING_HOURS') payload.openingHours = scheduleRequest(editor.querySelector('#resolution-policy').value, editor.querySelector('#resolution-holiday').value, [...editor.querySelectorAll('[data-slot]')].map(row => ({dayOfWeek: row.querySelector('select').value, startTime: row.querySelectorAll('input[type=time]')[0].value, endTime: row.querySelectorAll('input[type=time]')[1].value, closed: row.querySelector('[data-closed]').checked})))
          const signature = JSON.stringify(payload)
          if (signature !== requestSignature) { requestSignature = signature; requestId = crypto.randomUUID() }
          payload.requestId = requestId; busy = true
          root.querySelectorAll('button').forEach(node => { node.disabled = true })
          feedback.textContent = '시설 정보를 반영하고 있습니다.'
          const result = await fetch(`${API_BASE}/api/admin/v1/reports/${report.id}/actions`, {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)})
          const data = await result.json().catch(() => null)
          if (!result.ok) throw new Error(data?.error?.message || data?.message || '저장하지 못했습니다. 입력 내용은 유지됩니다.')
          if (!active()) return
          await reload()
          const notice = document.getElementById('resolution-feedback'); if (notice) notice.textContent = '시설 정보에 반영했습니다.'
        } catch (error) { if (active()) { feedback.className = 'status is-error'; feedback.textContent = error.message } }
        finally { busy = false; if (active()) root.querySelectorAll('button').forEach(node => { node.disabled = false }) }
      })
    } catch (error) { if (active()) root.innerHTML = `<p class="status is-error">${esc(error.message)}</p>` }
  }
  function proposalHoursMarkup(hours) {
    return hoursMarkup(hours).replaceAll('id="resolution-', 'id="new-hours-')
  }
  function bindProposalHours() {
    const root = document.getElementById('new-hours-editor')
    if (!root) return
    const bind = () => root.querySelectorAll('[data-slot]').forEach(row => {
      row.querySelector('[data-closed]').onchange = event => row.querySelectorAll('input[type=time]').forEach(input => { input.disabled = event.target.checked })
      row.querySelector('.resolution-remove').onclick = () => row.remove()
    })
    root.querySelector('#new-hours-policy').onchange = event => { root.querySelector('#new-hours-schedule').hidden = event.target.value !== 'SCHEDULED' }
    root.querySelector('#new-hours-add-slot').onclick = () => {
      const slots = root.querySelector('#new-hours-slots')
      slots.insertAdjacentHTML('beforeend', slotMarkup({dayOfWeek:1},slots.children.length)); bind()
    }
    bind()
  }
  function readProposalHours() {
    const root = document.getElementById('new-hours-editor')
    if (!root?.querySelector) return null
    const policy = root.querySelector('#new-hours-policy').value
    if (!policy) return null
    const rows = [...root.querySelectorAll('[data-slot]')].map(row => ({dayOfWeek:row.querySelector('select').value,startTime:row.querySelectorAll('input[type=time]')[0].value,endTime:row.querySelectorAll('input[type=time]')[1].value,closed:row.querySelector('[data-closed]').checked}))
    if (policy === 'SCHEDULED' && !rows.length) throw new Error('요일별 시간대를 추가해 주세요.')
    return scheduleRequest(policy,root.querySelector('#new-hours-holiday').value,rows)
  }
  return {mount, hoursText, scheduleRequest, historyMarkup, proposalHoursMarkup, bindProposalHours, readProposalHours}
})()
