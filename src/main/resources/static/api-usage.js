(() => {
  const main = document.querySelector('main[data-admin-page="api-usage"]')
  if (!main) return
  const byId = id => main.querySelector(`#${id}`)
  const events = new AbortController()
  const requests = new AbortController()
  const dialog = byId('au-detail')
  const number = value => value == null ? '—' : new Intl.NumberFormat('ko-KR').format(value)
  const money = (value, currency) => value == null ? '—' : new Intl.NumberFormat('ko-KR', { style: 'currency', currency, minimumFractionDigits: currency === 'USD' ? 2 : 0, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(value)
  const date = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '집계 전'
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
  const statusNames = { connected: '집계 연결됨', partial: '일부 집계', stale: '갱신 지연', error: '조회 실패', unconfigured: '연결 필요', inactive: '미사용', 'no-data': '집계 대기', 'reference-only': '자동 집계 없음' }
  const state = service => `<span class="au-state ${data?.demo ? 'unconfigured' : escape(service.status)}">${data?.demo ? '예시 데이터 · 실제 사용량 아님' : escape(statusNames[service.status] || '확인 필요')}</span>`
  const sum = (metrics, key) => metrics.every(item => item[key] != null) ? metrics.reduce((value, item) => value + Number(item[key]), 0) : null
  const unitValue = (value, unit) => value == null ? '—' : `${number(value)}<small class="au-unit"> ${escape(unit)}</small>`
  const math = window.ApiUsageMath
  const percent = value => value == null ? '—' : value > 0 && value < .01 ? '<0.01%' : `${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(value)}%`
  const quota = (item,service) => math.quota(item.definition,item.used,item.projected,service.periodStart,service.asOf,service.periodEnd)
  function billingDetail(service) {
    const billing = service.billing
    if (!billing) return ''
    const b = billing.observed, format = value => money(value,b.currency)
    return `<details class="au-secondary"><summary>현재 크레딧과 결제 내역</summary><p>${escape(b.source)} · ${date(b.asOf)} KST 확인 · 계정 공용</p><dl class="au-billing-rows"><div><dt>이번 달 체험 크레딧 차감</dt><dd>${format(b.promotionalCreditApplied)}</dd></div><div><dt>남은 크레딧</dt><dd>${format(b.creditRemaining)}</dd></div><div><dt>크레딧 적용 후 현재 금액</dt><dd>${format(b.netCost)}</dd></div></dl><p>크레딧 종료일 ${escape(b.creditExpiresOn || '미확인')} · 다른 서비스와 잔액을 공유합니다.</p></details>`
  }
  let data, selectedId, timer, estimateTimer, estimateSequence = 0, busy = false, authorized = false, opener
  const tabs = [byId('au-tab-overview'),byId('au-tab-history')]
  function selectTab(selected, focus = false) {
    tabs.forEach(tab => {
      const active = tab === selected
      tab.setAttribute('aria-selected',String(active))
      tab.tabIndex = active ? 0 : -1
      byId(tab.getAttribute('aria-controls')).hidden = !active
    })
    if (focus) selected.focus()
  }

  async function json(url) {
    const response = await fetch(url, { credentials: 'include', signal: AbortSignal.any([requests.signal,AbortSignal.timeout(30000)]), cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  function meter(item,service) {
    const metric=item.definition, q=quota(item,service)
    const ratio=q.projected, current=q.current
    const tone=ratio == null ? '' : ratio > 100 ? 'over' : ratio >= 80 ? 'warn' : ''
    const label=q.kind==='unlimited' ? '무제한 무료' : q.kind==='none' ? '무료 제공량 없음' : `${q.kind==='daily' ? '일' : '월'} 무료 ${number(metric.free)}${metric.unit}`
    const forecast=q.kind==='monthly' ? `월말 예상 ${percent(ratio)}` : q.kind==='daily' ? `일평균 예상 ${percent(ratio)}` : q.kind==='unlimited' ? '한도 제한 없음' : '사용량만 추적'
    return `<div class="au-meter ${tone}"><div><span>${escape(metric.name)}</span><b>${escape(label)}</b></div><div class="au-quota-values"><span>${item.used==null ? '집계 대기' : `현재 ${number(item.used)}${escape(metric.unit)}`}${current==null ? '' : ` · ${escape(percent(current))}`}</span><strong>${escape(forecast)}</strong></div>${ratio==null ? '' : `<div class="au-track ${tone}" role="meter" aria-label="${escape(metric.name)} ${q.kind==='daily' ? '일평균' : '월말'} 예상 무료 한도 사용률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,ratio)}" aria-valuetext="${escape(percent(ratio))}"><i class="au-projected" style="width:${Math.min(100,ratio)}%"></i>${current==null ? '' : `<i style="width:${Math.min(100,current)}%"></i>`}</div>`}${q.kind==='daily' ? `<small>월 누계 기준 일평균 ${q.dailyAverage==null ? '집계 대기' : number(Math.round(q.dailyAverage))+escape(metric.unit)} · 당일 최대 사용량 미집계</small>` : ''}</div>`
  }
  function card(service) {
    const def=service.definition, known=service.metrics.filter(item=>item.used!=null)
    const complete=known.length===service.metrics.length
    const volume=known.length ? sum(known,'used') : null, projected=known.length ? sum(known,'projected') : null
    const unit=known[0]?.definition.unit || def.metrics[0].unit, visibleMetrics=def.id==='kakao' ? 2 : 3
    const usageLabel=complete ? '이번 달 사용량' : known.length===1 ? `${known[0].definition.name} 사용량` : '집계된 항목 사용량'
    const projectionLabel=complete ? '월말 예상 사용량' : known.length===1 ? `${known[0].definition.name} 월말 예상` : '집계된 항목 월말 예상'
    const shared=def.id==='kakao' && projected!=null ? `<p class="au-shared-quota">지도·Local 월말 예상 ${percent(projected/3000000*100)} / 앱 공용 월 300만 건<br>다른 API 사용량 미포함 · 일간 한도도 별도 적용</p>` : ''
    return `<article class="au-card" data-service="${escape(def.id)}"><div class="au-card-body" role="region" aria-label="${escape(def.name)} 카드 내용" tabindex="0"><div class="au-card-head"><div class="au-card-identity"><span class="au-brand ${def.id==='kakao'||def.id==='naver' ? def.id : ''}" aria-hidden="true">${escape(def.badge)}</span><div><h3>${escape(def.name)}</h3>${state(service)}</div></div><div class="au-card-actions"><a class="au-dashboard-link" href="${escape(def.consoleUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(def.name)} 공급자 대시보드 새 창에서 열기">대시보드 ↗</a><button type="button" class="au-detail-link" data-detail="${escape(def.id)}" aria-label="${escape(def.name)} 상세보기">상세보기 ↗</button></div></div><p class="au-card-desc">${escape(def.description)}</p><div class="au-volume-pair"><div><span>${escape(usageLabel)}</span><strong>${unitValue(volume,unit)}</strong></div><div><span>${escape(projectionLabel)}</span><strong>${unitValue(projected,unit)}</strong></div></div><div class="au-card-metrics">${service.metrics.slice(0,visibleMetrics).map(item=>meter(item,service)).join('')}${service.metrics.length>visibleMetrics ? `<details class="au-quota-more"><summary>다른 ${service.metrics.length-visibleMetrics}개 API의 무료 쿼터 보기</summary>${service.metrics.slice(visibleMetrics).map(item=>meter(item,service)).join('')}</details>` : ''}${shared}</div></div><div class="au-card-foot">${service.asOf ? `${date(service.asOf)} KST · 자동 집계 · ${known.length}/${service.metrics.length}개 항목` : escape(service.message)}</div></article>`
  }
  const monitored = service => service.definition.id !== 'kakao' || ['connected','partial'].includes(service.status)
  function referenceEntry(service) {
    const snapshot = service.reference, billing = snapshot.billing
    const rows = Object.entries(snapshot.metrics).map(([id, value]) => {
      const metric = service.definition.metrics.find(item => item.id === id)
      return metric ? `<div><dt>${escape(metric.name)}</dt><dd>${number(value.used)}${escape(metric.unit)}</dd></div>` : ''
    }).join('')
    const credit = billing ? `<div><dt>확인 당시 크레딧 잔액</dt><dd>${money(billing.creditRemaining,billing.currency)}</dd></div><div><dt>이번 달 확인된 크레딧 차감</dt><dd>${money(billing.promotionalCreditApplied,billing.currency)}</dd></div>` : ''
    return `<article class="au-reference-entry"><div class="au-reference-head"><h3>${escape(service.definition.name)}</h3><a class="au-dashboard-link" href="${escape(service.definition.consoleUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(service.definition.name)} 공급자 대시보드 새 창에서 열기">대시보드 ↗</a></div><p>${escape(snapshot.source)} · ${date(snapshot.asOf)} KST 기준</p><dl>${rows}${credit}</dl></article>`
  }
  function render() {
    const live = data.services.filter(monitored), references = data.services.filter(service => service.reference)
    byId('au-cards').innerHTML=live.map(card).join('')
    byId('au-cards').setAttribute('aria-busy','false')
    byId('au-monitored-count').textContent=live.length
    byId('au-reference-section').hidden=references.length===0
    byId('au-reference-count').textContent=references.length
    byId('au-reference-list').innerHTML=references.map(referenceEntry).join('')
    byId('au-updated').textContent=`${date(data.checkedAt)} KST 조회 · 실제 집계 시각은 카드별 표시`
    byId('au-status').classList.remove('is-error')
    byId('au-status').hidden=!data.demo
    byId('au-status').textContent=data.demo ? '화면 검증용 예시이며 실제 사용량이 아닙니다.' : ''
    initHistory()
  }
  let historySequence=0, historyResult, historyServiceId
  function initHistory() {
    if(byId('au-history-service').options.length) {
      const service=data.services.find(s=>s.definition.id===byId('au-history-service').value)
      if(historyResult && (Date.parse(data.checkedAt)-Date.parse(historyResult.checkedAt)>=3600000 || Date.parse(historyResult.checkedAt)<Date.parse(service.periodStart))) selectHistoryService(byId('au-history-metric').value)
      else renderHistory()
      return
    }
    byId('au-history-service').innerHTML=data.services.filter(monitored).map(s=>`<option value="${escape(s.definition.id)}">${escape(s.definition.name)}</option>`).join('')
    byId('au-history-service').addEventListener('change',()=>selectHistoryService(),{signal:events.signal})
    byId('au-history-metric').addEventListener('change',renderHistory,{signal:events.signal})
    selectHistoryService()
  }
  async function selectHistoryService(metricId) {
    const id=byId('au-history-service').value, service=data.services.find(s=>s.definition.id===id)
    byId('au-history-metric').innerHTML=service.metrics.map(m=>`<option value="${escape(m.definition.id)}">${escape(m.definition.name)}</option>`).join('')
    if(metricId) byId('au-history-metric').value=metricId
    const sequence=++historySequence
    historyResult=null; historyServiceId=id
    byId('au-history-content').setAttribute('aria-busy','true')
    byId('au-history-status').textContent='공급자의 월별 기록을 확인하고 있습니다.'
    byId('au-history-content').innerHTML=''
    try {
      const result=await json(`/api/admin/v1/api-usage/history?service=${encodeURIComponent(id)}`)
      if(sequence!==historySequence || events.signal.aborted) return
      historyResult=result; renderHistory()
    } catch(error) {
      if(sequence===historySequence && error.name!=='AbortError') byId('au-history-status').textContent='월별 기록을 불러오지 못했습니다. 서비스를 다시 선택해 주세요.'
    } finally { if(sequence===historySequence) byId('au-history-content').setAttribute('aria-busy','false') }
  }
  function deltaText(value,previous) {
    const c=math.change(value,previous)
    return c.kind==='unknown' ? '비교 자료 없음' : c.kind==='new' ? `신규 사용 (+${number(c.delta)})` : c.percent===0 ? '변동 없음' : `${c.percent>0 ? '+' : ''}${percent(c.percent)}`
  }
  function renderHistory() {
    if(!historyResult || historyServiceId!==byId('au-history-service').value) return
    const service=data.services.find(s=>s.definition.id===historyServiceId), item=service.metrics.find(m=>m.definition.id===byId('au-history-metric').value), metric=item.definition
    const rows=historyResult.months.map(row=>({...row,status:row.metrics[metric.id]?.used==null && row.status==='complete' ? 'unavailable' : row.status,value:row.metrics[metric.id]?.used??null}))
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:service.definition.timeZone,year:'numeric',month:'2-digit'}).formatToParts(new Date(service.periodStart)).map(p=>[p.type,p.value])); const month=parts.year+'-'+parts.month
    const current={month,status:service.status==='stale' ? 'stale' : 'current',source:service.source,scope:service.scope,value:item.used,projected:item.projected,asOf:service.asOf}
    rows.push(current)
    const peak=Math.max(1,...rows.flatMap(r=>[r.value??0,r.projected??0]))
    const previous=rows.at(-2), comparison=math.comparable(current,previous) ? deltaText(item.projected,previous.value) : '비교 자료 없음'
    byId('au-history-status').textContent=`${service.definition.description} · ${metric.name} · 단위 ${metric.unit} · 실선은 월 집계, 빗금은 이번 달 월말 예상`
    const labels={complete:'월 전체 조회',current:'이번 달 진행 중',partial:'일부 기간',provisional:'반영 대기',stale:'갱신 실패',unavailable:'미집계',error:'조회 실패'}
    const bars=rows.map(row=>`<div class="au-history-column"><span>${row.value==null ? '미집계' : number(row.value)}</span><div class="au-history-bar-space">${row.projected==null ? '' : `<i class="au-history-projection" style="height:${row.projected/peak*100}%" title="월말 예상 ${number(row.projected)}${escape(metric.unit)}"></i>`}${row.value==null ? '<b class="au-history-missing">—</b>' : `<i class="au-history-bar ${row.status!=='complete' ? 'partial' : ''}" style="height:${row.value===0 ? 0 : Math.max(.6,row.value/peak*100)}%" title="${escape(labels[row.status])} ${number(row.value)}${escape(metric.unit)}"></i>`}</div><b>${escape(row.month.slice(5))}월</b><small>${escape(labels[row.status])}</small></div>`).join('')
    const table=rows.map((row,index)=>{const prev=rows[index-1]; const growth=math.comparable(row,prev) ? deltaText(row.status==='current' ? row.projected : row.value,prev.value) : '—'; return `<tr><th scope="row">${escape(row.month)}</th><td>${row.value==null ? '—' : number(row.value)}</td><td>${escape(labels[row.status])}</td><td>${row.projected==null ? '—' : number(row.projected)}</td><td>${escape(growth)}${row.status==='current' && growth!=='—' ? ' (예상)' : ''}</td></tr>`}).join('')
    const eligible=rows.slice(0,-1).filter(row=>row.status==='complete'&&row.value!=null).length
    byId('au-history-content').innerHTML=`<div class="au-growth-stats"><div><span>이번 달 월말 예상</span><strong>${unitValue(item.projected,metric.unit)}</strong></div><div><span>전월 전체 대비 월말 예상 증감</span><strong>${escape(comparison)}</strong></div></div><div class="au-history-chart" role="img" aria-label="최근 6개월 ${escape(metric.name)} 사용량. 정확한 수치와 상태는 아래 표에서 확인할 수 있습니다.">${bars}</div><div class="au-table-wrap"><table class="au-table"><thead><tr><th scope="col">월</th><th scope="col">조회 사용량 (${escape(metric.unit)})</th><th scope="col">집계 범위</th><th scope="col">월말 예상</th><th scope="col">전월 대비</th></tr></thead><tbody>${table}</tbody></table></div>${eligible===0 ? '<p class="au-notice">비교할 수 있는 과거 월 전체 기록이 아직 없습니다. 확보한 월별 기록을 보관하며, 미집계 월은 0건으로 처리하지 않습니다.</p>' : ''}<p class="au-detail-meta">이번 달은 ${date(service.asOf)} KST까지의 누계와 월말 예상을 구분해 표시합니다. 전월 대비는 같은 집계 출처·범위가 확인된 월끼리만 계산합니다.</p>`
  }
  async function load() {
    if (!authorized || busy || events.signal.aborted) return
    busy = true; byId('api-usage-refresh').disabled = true
    try { data = await json('/api/admin/v1/api-usage'); if (!events.signal.aborted) render() }
    catch (error) {
      if (error.name !== 'AbortError' && !events.signal.aborted) {
        byId('au-status').textContent = data ? '최신 현황을 가져오지 못했습니다. 이전 조회 결과를 표시합니다. 새로고침으로 다시 시도해 주세요.' : 'API 사용량 정보를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.'
        byId('au-status').classList.add('is-error')
        byId('au-status').hidden = false
        byId('au-cards').setAttribute('aria-busy','false')
        byId('au-cards').querySelectorAll('.au-placeholder .au-state').forEach(s=>s.textContent='조회 실패')
      }
    } finally { busy = false; byId('api-usage-refresh').disabled = false }
  }
  function pricingRows(metric,currency) {
    if (metric.unlimited) return '<tr><td>모든 사용량</td><td>무제한 무료</td></tr>'
    let lower = metric.free
    const rows = [`<tr><td>${metric.period === 'day' ? '하루' : '한 달'} ${number(metric.free)}${escape(metric.unit)}까지</td><td>무료 대상인 경우 0</td></tr>`]
    for (const tier of metric.tiers) {
      rows.push(`<tr><td>${number(lower+1)}${escape(metric.unit)}${tier.through == null ? '부터' : ` ~ ${number(tier.through)}${escape(metric.unit)}`}</td><td>${tier.price == null ? '공식 요금 확인 필요' : `${money(tier.price,currency)} / ${number(metric.priceUnit)}${escape(metric.unit)}`}</td></tr>`)
      lower = tier.through
    }
    return rows.join('')
  }
  function renderMetric(service,id) {
    ++estimateSequence; clearTimeout(estimateTimer)
    const item = service.metrics.find(value => value.definition.id === id) || service.metrics[0]
    const metric = item.definition, currency = service.definition.currency
    const daily = metric.period === 'day'
    const q=quota(item,service), quotaLabel=q.kind==='unlimited' ? '무제한 무료' : q.kind==='none' ? '무료 제공량 없음' : `${daily ? '일' : '월'} ${number(metric.free)}${metric.unit}`
    byId('au-metric-detail').innerHTML=`<div class="au-detail-stats"><article><span>이번 달 현재 사용량</span><strong>${unitValue(item.used,metric.unit)}</strong><small>${date(service.asOf)} KST까지</small></article><article><span>월말 예상 사용량</span><strong>${unitValue(item.projected,metric.unit)}</strong><small>월초부터의 하루 평균 기준</small></article><article><span>기본 무료 쿼터</span><strong>${escape(quotaLabel)}</strong><small>${daily ? '매일 적용 · 월 누계와 직접 비교하지 않음' : '공유 한도·계정별 적용 조건 확인'}</small></article><article><span>${daily ? '일평균 예상 / 일 무료 쿼터' : '월말 예상 / 월 무료 쿼터'}</span><strong>${q.kind==='unlimited' ? '제한 없음' : q.kind==='none' ? '해당 없음' : escape(percent(q.projected))}</strong><small>${q.projected>100 ? '기본 무료 한도 초과 예상' : q.projected==null ? '백분율을 계산하지 않습니다.' : '현재 사용 추세 기준'}</small></article></div><section class="au-detail-section"><h3>무료 쿼터 사용 현황</h3>${meter(item,service)}<p>${daily ? '현재 월 누계에서 계산한 하루 평균입니다. 특정일의 급증이나 오늘 실제 사용률은 확인되지 않아, 일간 한도를 지킨다는 의미는 아닙니다.' : metric.unlimited ? '사용량을 추적하며 무료 한도 백분율은 계산하지 않습니다.' : metric.free===0 ? '이 항목에는 기본 무료 제공량이 없습니다. 체험 크레딧은 별도 혜택입니다.' : `현재 남은 기본 무료량 ${item.used==null ? '미확인' : number(Math.max(0,metric.free-item.used))+escape(metric.unit)} · 월말 ${item.projected==null ? '예상 대기' : item.projected>metric.free ? `예상 초과 ${number(item.projected-metric.free)}${escape(metric.unit)}` : `예상 잔여 ${number(metric.free-item.projected)}${escape(metric.unit)}`}`}</p><button class="au-history-link" id="au-show-history" type="button">이 항목의 월별 사용량 보기 ↗</button></section><details class="au-secondary"><summary>요금표와 초과 요금 계산</summary><section class="au-detail-section"><div class="au-pricing-head"><h3>요금표</h3><a href="${escape(service.definition.pricingUrl)}" target="_blank" rel="noreferrer">공식 요금표 ↗</a></div><div class="au-table-wrap"><table class="au-table"><thead><tr><th scope="col">${daily ? '일간' : '월간'} 사용 구간</th><th scope="col">단가 · ${escape(currency)}</th></tr></thead><tbody>${pricingRows(metric,currency)}</tbody></table></div></section><section class="au-detail-section au-calculator"><h3>직접 입력해 초과 요금 계산</h3><div class="au-calc-input"><label for="au-quantity">가정한 ${daily ? '하루' : '월'} 사용량 (${escape(metric.unit)})<input id="au-quantity" type="number" min="0" max="1000000000000" step="1" value="${Math.max(metric.free+10000,item.projected||0)}" /></label><label class="au-check"><input id="au-free" type="checkbox" checked />기본 무료 한도 적용</label></div><output id="au-estimate" aria-live="polite">계산 중...</output><p>직접 입력한 사용량의 요금표 계산입니다. 체험 크레딧·계약 할인·세금은 포함하지 않습니다.</p></section></details>`
    byId('au-show-history').addEventListener('click',async()=>{
      dialog.close(); selectTab(byId('au-tab-history')); byId('au-history-service').value=service.definition.id; await selectHistoryService(metric.id)
      if(!events.signal.aborted) byId('au-monthly-panel').scrollIntoView({behavior:'smooth',block:'start'})
    },{signal:events.signal})
    byId('au-quantity').addEventListener('input',scheduleEstimate,{signal:events.signal})
    byId('au-free').addEventListener('change',scheduleEstimate,{signal:events.signal})
    void calculate()
  }
  function openDetail(id,button) {
    const service = data.services.find(value => value.definition.id === id)
    if (!service) return
    selectedId = id; opener = button
    byId('au-detail-title').textContent = service.definition.name
    const period = new Intl.DateTimeFormat('ko-KR',{timeZone:service.definition.timeZone,year:'numeric',month:'long'}).format(new Date(service.periodStart))
    byId('au-detail-body').innerHTML = `${state(service)}<p class="au-notice" style="margin-top:14px">${escape(service.message)}</p><p class="au-detail-meta">${escape(period)} · ${escape(service.definition.timeZone)} 월 경계 기준<br>집계 기준: ${escape(service.source || '연결 전')}<br>범위: ${escape(service.scope || '연결 후 표시')}<br>마지막 집계: ${date(service.asOf)}${service.asOf ? ' KST' : ''}</p><label class="au-select-label" for="au-metric">확인할 API 항목<select id="au-metric">${service.metrics.map(item => `<option value="${escape(item.definition.id)}">${escape(item.definition.name)}</option>`).join('')}</select></label><div id="au-metric-detail"></div>${billingDetail(service)}<section class="au-detail-section"><h3>집계와 요금 적용 기준</h3><ul>${service.definition.notes.map(note=>`<li>${escape(note)}</li>`).join('')}</ul><p><a class="au-external" href="${escape(service.definition.consoleUrl)}" target="_blank" rel="noreferrer">공급자 콘솔에서 확인 ↗</a></p></section>`
    byId('au-metric').addEventListener('change',event=>renderMetric(service,event.target.value),{signal:events.signal})
    renderMetric(service,service.metrics[0].definition.id)
    dialog.showModal(); dialog.scrollTop = 0; byId('au-close').focus()
  }
  function scheduleEstimate() {
    ++estimateSequence; clearTimeout(estimateTimer)
    byId('au-estimate').textContent = '계산 중...'
    estimateTimer = setTimeout(calculate,200)
  }
  async function calculate() {
    const sequence = ++estimateSequence, output = byId('au-estimate')
    const raw = byId('au-quantity').value
    if (!/^\d+$/.test(raw) || Number(raw) > 1000000000000) { output.textContent = '0부터 1조까지의 정수를 입력해 주세요.'; return }
    const params = new URLSearchParams({metric:byId('au-metric').value,quantity:raw,includeFree:String(byId('au-free').checked)})
    try {
      const result = await json(`/api/admin/v1/api-usage/estimate?${params}`)
      if (sequence !== estimateSequence || events.signal.aborted) return
      output.innerHTML = `${result.period === 'day' ? '이 하루의' : '이 한 달의'} 예상 비용<strong>${result.cost == null ? '요금 확인 필요' : money(result.cost,result.currency)}</strong><small>무료 적용 ${number(result.freeApplied)} · 초과 ${number(result.overage)} · 세금·추가 크레딧 제외</small>`
    } catch (error) { if (sequence === estimateSequence && error.name !== 'AbortError') output.textContent = '요금을 계산하지 못했습니다. 사용량을 다시 입력해 주세요.' }
  }
  function showLogin(message) {
    main.hidden = true
    const loading = document.getElementById('loading-shell'), auth = document.getElementById('auth-shell')
    if (loading) loading.hidden = true
    if (auth) auth.hidden = false
    const description = document.getElementById('auth-description')
    if (description) description.textContent = message
  }
  async function bootstrap() {
    try {
      const profile = await json('https://api.geupddong.com/api/v1/auth/me')
      if (events.signal.aborted) return
      if (!profile.roles?.includes('ADMIN')) return showLogin('관리자 권한이 있는 계정으로 로그인해 주세요.')
      const loading = document.getElementById('loading-shell'), auth = document.getElementById('auth-shell')
      if (loading) loading.hidden = true
      if (auth) auth.hidden = true
      authorized = true
      main.hidden = false
      await load()
      if (!events.signal.aborted) timer = setInterval(()=>{ if (!document.hidden) void load() },300000)
    } catch (error) { if (error.name !== 'AbortError') showLogin('로그인 상태를 확인할 수 없습니다. 다시 로그인해 주세요.') }
  }
  main.addEventListener('click',event=>{
    const button = event.target.closest('[data-detail]')
    if (button) openDetail(button.dataset.detail,button)
  },{signal:events.signal})
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>selectTab(tab),{signal:events.signal})
    tab.addEventListener('keydown',event=>{
      const next = event.key==='ArrowRight' ? (index+1)%tabs.length : event.key==='ArrowLeft' ? (index+tabs.length-1)%tabs.length : event.key==='Home' ? 0 : event.key==='End' ? tabs.length-1 : -1
      if(next<0) return
      event.preventDefault()
      selectTab(tabs[next],true)
    },{signal:events.signal})
  })
  byId('au-close').addEventListener('click',()=>dialog.close(),{signal:events.signal})
  dialog.addEventListener('click',event=>{ if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close() } },{signal:events.signal})
  dialog.addEventListener('close',()=>{ ++estimateSequence; clearTimeout(estimateTimer); (opener?.isConnected ? opener : main.querySelector(`[data-detail="${selectedId}"]`))?.focus({preventScroll:true}) },{signal:events.signal})
  byId('api-usage-refresh').addEventListener('click',load,{signal:events.signal})
  document.addEventListener('admin:before-route-change',()=>{
    if (dialog.open) dialog.close()
    events.abort(); requests.abort(); clearInterval(timer); clearTimeout(estimateTimer)
  },{once:true,signal:events.signal})
  void bootstrap()
})()
