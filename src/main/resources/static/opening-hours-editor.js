/* Shared by opening-hours review, report approval and facility actions. */
globalThis.OpeningHoursEditor = (() => {
  const days = ['월', '화', '수', '목', '금', '토', '일']
  const policies = { ALWAYS: '상시 운영', SCHEDULED: '요일별 운영', IRREGULAR: '불규칙', CLOSED: '미개방' }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
  const time = value => String(value || '').slice(0, 5)
  const options = (values, selected) => Object.entries(values).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('')
  function slotMarkup(slot, day, index) {
    return `<div class="hours-editor-slot" data-hours-slot><input type="time" data-start aria-label="${days[day - 1]}요일 ${index + 1}번째 시작" value="${esc(time(slot.startTime))}"><span>–</span><input type="time" data-end aria-label="${days[day - 1]}요일 ${index + 1}번째 종료" value="${esc(time(slot.endTime))}"><button type="button" data-remove aria-label="${days[day - 1]}요일 ${index + 1}번째 시간대 삭제">×</button><small data-overnight></small></div>`
  }
  function markup(hours, { id = 'hours', allowUnknown = false } = {}) {
    const policy = hours?.openingPolicy in policies ? hours.openingPolicy : ''
    return `<div class="hours-editor" data-allow-unknown="${allowUnknown}"><div class="hours-editor-controls"><label>운영 정책<select data-policy>${options({'':'미확인',...policies},policy)}</select></label><fieldset><legend>24시간 운영</legend><label><input type="radio" name="${esc(id)}-24h" data-open24h value="true"${hours?.open24h === true ? ' checked' : ''}>예</label><label><input type="radio" name="${esc(id)}-24h" data-open24h value="false"${hours?.open24h === true ? '' : ' checked'}>아니오</label></fieldset><label>공휴일 운영<select data-holiday>${options({UNKNOWN:'확인 필요',OPEN:'운영',CLOSED:'휴무'},hours?.holidayPolicy || 'UNKNOWN')}</select></label></div><div class="hours-editor-schedule"><div class="hours-editor-head"><span>요일</span><span>휴무</span><span>시작 · 종료</span></div>${days.map((name,index) => {
      const day = index + 1, slots = (hours?.schedules || []).filter(slot => slot.dayOfWeek === day).sort((a,b) => a.slotIndex - b.slotIndex)
      return `<div class="hours-editor-day" data-day="${day}"><label><input type="checkbox" data-enabled${slots.length ? ' checked' : ''}>${name}요일</label><label><input type="checkbox" data-closed${slots.some(slot => slot.closed) ? ' checked' : ''}>휴무</label><div class="hours-editor-times"><div data-slots>${(slots.filter(slot => !slot.closed).length ? slots.filter(slot => !slot.closed) : [{}]).map((slot,i) => slotMarkup(slot,day,i)).join('')}</div><button type="button" data-add>${name}요일 시간대 추가</button></div></div>`
    }).join('')}</div><p class="hours-editor-help">요일별 운영은 확인한 요일만 선택하세요. 선택한 요일의 빈 첫 시간대에는 09:00~18:00이 입력됩니다. 선택하지 않은 요일은 미확인으로 남습니다. 종료가 시작보다 이르면 익일 종료입니다.</p></div>`
  }
  function sync(root) {
    const policy = root.querySelector('[data-policy]').value
    const scheduled = policy === 'SCHEDULED'
    root.querySelector('[data-holiday]').disabled = !policy
    root.querySelectorAll('[data-open24h]').forEach(input => { input.disabled = !policy })
    root.querySelectorAll('[data-day]').forEach(row => {
      const enabled = row.querySelector('[data-enabled]'), closed = row.querySelector('[data-closed]')
      enabled.disabled = !scheduled
      closed.disabled = !scheduled || !enabled.checked
      const editable = scheduled && enabled.checked && !closed.checked
      row.querySelectorAll('input[type=time], button').forEach(input => { input.disabled = !editable })
      row.querySelectorAll('[data-hours-slot]').forEach((slot,index) => {
        const start = slot.querySelector('[data-start]'), end = slot.querySelector('[data-end]')
        start.setAttribute('aria-label', `${days[Number(row.dataset.day) - 1]}요일 ${index + 1}번째 시작`)
        end.setAttribute('aria-label', `${days[Number(row.dataset.day) - 1]}요일 ${index + 1}번째 종료`)
        slot.querySelector('[data-remove]').setAttribute('aria-label', `${days[Number(row.dataset.day) - 1]}요일 ${index + 1}번째 시간대 삭제`)
        slot.querySelector('[data-overnight]').textContent = editable && start.value && end.value && end.value < start.value ? '익일 종료' : ''
      })
    })
  }
  function bind(root) {
    if (!root) throw new Error('개방시간 양식을 다시 열어 주세요.')
    root.onchange = event => {
      if (event.target.matches('[data-policy]') && event.target.value !== 'ALWAYS') root.querySelector('[data-open24h][value="false"]').checked = true
      if (event.target.matches('[data-open24h]') && event.target.value === 'true') root.querySelector('[data-policy]').value = 'ALWAYS'
      if (event.target.matches('[data-enabled], [data-closed]') && root.querySelector('[data-policy]').value === 'SCHEDULED') {
        const row = event.target.closest('[data-day]'), slots = row.querySelectorAll('[data-hours-slot]')
        if (row.querySelector('[data-enabled]').checked && !row.querySelector('[data-closed]').checked && slots.length === 1) {
          const start = slots[0].querySelector('[data-start]'), end = slots[0].querySelector('[data-end]')
          if (!start.value && !end.value) {
            start.value = '09:00'
            end.value = '18:00'
          }
        }
      }
      sync(root)
    }
    root.onclick = event => {
      const button = event.target.closest('[data-add], [data-remove]')
      if (!button || button.disabled) return
      const row = button.closest('[data-day]'), slots = row.querySelector('[data-slots]')
      if (button.matches('[data-add]')) slots.insertAdjacentHTML('beforeend', slotMarkup({},Number(row.dataset.day),slots.children.length))
      else if (slots.children.length > 1) button.closest('[data-hours-slot]').remove()
      else button.closest('[data-hours-slot]').querySelectorAll('input').forEach(input => { input.value = '' })
      sync(root)
    }
    sync(root)
  }
  function request(openingPolicy, open24h, holidayPolicy, rows, allowUnknown = false) {
    if (!openingPolicy && allowUnknown) return null
    if (!(openingPolicy in policies)) throw new Error('운영 정책을 선택해 주세요.')
    if (open24h && openingPolicy !== 'ALWAYS') throw new Error('24시간 운영은 상시 운영 정책을 선택해 주세요.')
    const counts = new Map(), schedules = []
    if (openingPolicy === 'SCHEDULED') {
      if (!rows.length) throw new Error('요일별 운영에는 하나 이상의 운영 요일이 필요합니다.')
      for (const row of rows) {
        const day = Number(row.dayOfWeek), slotIndex = counts.get(day) || 0
        if (!Number.isInteger(day) || day < 1 || day > 7) throw new Error('운영 요일을 확인해 주세요.')
        if (!row.closed && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime) || row.startTime === row.endTime)) throw new Error(`${days[day - 1]}요일 시작·종료 시간을 확인해 주세요.`)
        if (schedules.some(slot => slot.dayOfWeek === day && (slot.closed || row.closed))) throw new Error(`${days[day - 1]}요일의 휴무와 운영 시간을 함께 지정할 수 없습니다.`)
        counts.set(day,slotIndex + 1)
        schedules.push({dayOfWeek:day,slotIndex,startTime:row.closed ? null : row.startTime,endTime:row.closed ? null : row.endTime,closed:!!row.closed,crossesMidnight:!row.closed && row.endTime < row.startTime})
      }
    }
    return {openingPolicy,open24h,holidayPolicy,schedules}
  }
  function read(root) {
    if (!root) throw new Error('개방시간 양식을 다시 열어 주세요.')
    const rows = [...root.querySelectorAll('[data-day]')].filter(row => row.querySelector('[data-enabled]').checked).flatMap(row => {
      const dayOfWeek = Number(row.dataset.day)
      if (row.querySelector('[data-closed]').checked) return [{dayOfWeek,closed:true}]
      return [...row.querySelectorAll('[data-hours-slot]')].map(slot => ({dayOfWeek,closed:false,startTime:slot.querySelector('[data-start]').value,endTime:slot.querySelector('[data-end]').value}))
    })
    return request(root.querySelector('[data-policy]').value,root.querySelector('[data-open24h]:checked').value === 'true',root.querySelector('[data-holiday]').value,rows,root.dataset.allowUnknown === 'true')
  }
  return Object.freeze({markup,bind,read,request})
})()
