/* Proposed evidence and administrator's confirmed registration are separate snapshots. */
globalThis.ReportFacilityInfo = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
  const fields = [
    ['name', '화장실 이름', 100],
    ['agencyName', '관리 기관', 100], ['phoneNumber', '시설 연락처', 20],
  ]
  const amenities = [['emergencyBell','비상벨'], ['cctv','CCTV'], ['diaperTable','기저귀 교환대']]
  const counts = [['maleDisabledToiletCount','남성 장애인 변기 수'], ['femaleDisabledToiletCount','여성 장애인 변기 수']]
  const choices = (values, current) => values.map(([value, label]) => `<option value="${value}"${String(current ?? '') === value ? ' selected' : ''}>${label}</option>`).join('')
  const yesNo = value => value === true ? '있음' : value === false ? '없음' : '미확인'
  const textInput = (key,max,source) => `<input data-facility-field="${key}" value="${esc(source[key])}" maxlength="${max}"${key === 'name' ? ' required' : ''}${key === 'phoneNumber' ? ' type="tel"' : ''}>`
  function markup(report, editable) {
    if (report.reportType !== 'NEW_FACILITY') return ''
    const source = report.facilityInfo || { name: report.toiletName, openTime: report.openTime, openTimeDetail: report.openTimeDetail }
    const evidence = [...fields.map(([key,label]) => [label,source[key] || '미입력']), ['개방시간 원문',source.openTime || '미입력'], ['개방시간 상세 원문',source.openTimeDetail || '미입력'],
      ...(source.openingHours ? [['운영 방식·시간표',globalThis.ReportResolution?.hoursText(source.openingHours,{}) || source.openingHours.openingPolicy],['공휴일',({UNKNOWN:'미확인',OPEN:'운영',CLOSED:'휴무'})[source.openingHours.holidayPolicy || 'UNKNOWN']]] : []),
      ['화장실 구분',source.toiletType || '미확인'], ...amenities.map(([key,label]) => [label,yesNo(source[key])]),
      ...counts.map(([key,label]) => [label,source[key] == null ? '미확인' : `${source[key]}개`])]
    return `<section class="new-facility-review"><details class="new-facility-evidence"${editable ? '' : ' open'}><summary>제보 원문 · 기본 정보</summary><dl>${evidence.map(([label,value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></details>${editable ? `<div class="new-facility-head"><strong>등록할 기본 정보</strong><small>빈 항목은 미확인으로 저장</small></div><div id="new-facility-fields" class="new-facility-grid" data-source-open-time="${esc(source.openTime)}" data-source-open-time-detail="${esc(source.openTimeDetail)}">${fields.map(([key,label,max]) => `<label><span>${label}</span>${textInput(key,max,source)}</label>`).join('')}<label><span>화장실 구분</span><select data-facility-field="toiletType">${choices([['','미확인'],...['공중','개방','이동','간이','기타'].map(value => [value,value])],source.toiletType)}</select></label>${amenities.map(([key,label]) => `<label><span>${label}</span><select data-facility-field="${key}">${choices([['','미확인'],['true','있음'],['false','없음']],source[key])}</select></label>`).join('')}${counts.map(([key,label]) => `<label><span>${label}</span><input data-facility-field="${key}" type="number" min="0" max="999" step="1" value="${esc(source[key])}" placeholder="미확인"></label>`).join('')}</div><div class="new-facility-head"><strong>등록할 개방시간</strong><small>승인 시 아래 정책·시간표로 확정</small></div><div id="new-hours-editor">${globalThis.ReportResolution.proposalHoursMarkup(source.openingHours)}</div>` : ''}</section>`
  }
  function read() {
    const root = document.getElementById('new-facility-fields')
    if (!root) throw new Error('등록할 기본 정보를 다시 열어 주세요.')
    const result = {openTime:root.dataset.sourceOpenTime || null, openTimeDetail:root.dataset.sourceOpenTimeDetail || null}
    for (const input of root.querySelectorAll('[data-facility-field]')) {
      if (!input.checkValidity()) { input.reportValidity(); throw new Error('기본 정보의 입력 내용을 확인해 주세요.') }
      const key = input.dataset.facilityField, value = input.value.trim()
      result[key] = value === '' ? null : amenities.some(([field]) => field === key) ? value === 'true'
        : counts.some(([field]) => field === key) ? Number(value) : value
    }
    if (!result.name) throw new Error('화장실 이름을 입력해 주세요.')
    result.openingHours = globalThis.ReportResolution.readProposalHours()
    return result
  }
  return Object.freeze({markup, read, mount: () => globalThis.ReportResolution?.bindProposalHours()})
})()
