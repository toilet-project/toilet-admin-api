(() => {
  const M=globalThis.CloudflareMonitorModel
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const num=v=>v==null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(v)
  const pct=v=>v==null?'확인 필요':v>0&&v<.01?'<0.01%':num(v)+'%'
  const money=v=>globalThis.CloudflareCostView.money(v)
  const bytes=v=>globalThis.CloudflareCostView.format(v,'bytes')
  const date=v=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(v)?v:v+'+09:00')):'—'
  const budgetKey='geupddong.cloudflare.excessBudgetUsd.v1'
  let active='overview',bundle={},pending=false,timer, budget=null
  try {const v=Number(localStorage.getItem(budgetKey));if(Number.isFinite(v)&&v>0)budget=v} catch {}
  const data=key=>M.section(bundle.monitoring,key)
  const missing=key=>`<div class="cm-unavailable"><strong>확인 필요</strong><p>${esc(bundle.monitoring?.sections?.[key]?.message||'현재 수집값이 없습니다. 0건을 뜻하지 않습니다.')}</p></div>`
  const tile=(label,value,note,tone='')=>`<article class="cm-stat ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`
  const panel=(title,note,body)=>`<section class="cf-panel cm-panel"><header><h2>${esc(title)}</h2><p class="cf-muted">${esc(note)}</p></header>${body}</section>`
  const table=(headers,rows)=>`<div class="cf-table-wrap"><table class="cf-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">조회된 활동이 없습니다.</td></tr>`}</tbody></table></div>`
  const sectionNames={r2:'R2 시간별 요청',writes:'캐시 종류별 PUT',workers:'Workers 성능',d1:'D1 쿼리 사용',storage:'D1 저장량 변화',traffic:'CDN·봇 트래픽',objects:'Durable Objects 오류',refresh:'정기 캐시 갱신 실행'}
  function overview() {
    const u=bundle.usage,r2=data('r2'),workers=data('workers'),cost=u?.costSummary
    const alerts=M.assess(u,bundle.monitoring,budget)
    const workerRequests=workers?.reduce((a,w)=>a+w.requests,0),workerErrors=workers?.reduce((a,w)=>a+w.errors,0)
    return `<div class="cm-summary">${tile('현재 예상 초과액 · 산출 항목',money(cost?.observedSubtotalUsd),'기본요금·저장 기간·미산출 비용 제외','cm-primary')}${tile('청구 종료 시 예상 초과액',money(cost?.projectedSubtotalUsd),'현재 주기 평균 속도를 유지할 때')}${tile('R2 PUT · 최근 완료 24시간',r2?num(r2.puts24h)+'회':'확인 필요',r2?'이전 24시간 '+num(r2.previousPuts24h)+'회':'시간별 수집 상태 확인')}${tile('Workers 실행 오류율 · 24시간',pct(M.ratio(workerErrors,workerRequests)),workers?`${num(workerErrors)}건 / ${num(workerRequests)}회`:'수집 상태 확인')}</div>
      ${panel('지금 확인할 항목',`화면 내 점검 알림 ${alerts.length}개 · 외부 알림 발송은 설정하지 않았습니다.`,alerts.length?`<div class="cm-alerts">${alerts.map(a=>`<button type="button" class="cm-alert ${esc(a.level)}" data-go="${esc(a.tab)}"><span class="cm-alert-dot"></span><span><strong>${esc(a.title)}</strong><small>${esc(a.detail.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g,v=>date(v)+' KST'))}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</div>`:'<p class="cm-clear">조회된 지표에서 설정된 주의 조건이 발견되지 않았습니다. 미산출 비용과 미연결 점검은 별도입니다.</p>')}
      <div class="cm-two">${panel('어떤 캐시에서 저장이 발생했나','운영 R2 버킷의 PUT 요청 · 최근 완료 24시간',writeBars())}${panel('연결 상태','집계 실패와 실제 0건을 구분합니다.',coverage())}</div>
      ${panel('점검 기준','현재 경고는 참고 기준입니다. 서비스별 정상 패턴과 함께 판단하세요.',`<div class="cm-rules"><span>비용: 포함량 80%·초과 예상</span><span>PUT: 직전 시간의 2배 + 1,000회 이상</span><span>R2 404: 조회 100회 이상·20% 이상</span><span>Workers 오류: 요청 100회 이상·오류율 1% 이상</span><span>응답 p95: 요청 100회 이상·1초 이상</span><span>D1: 100쿼리 이상·쿼리당 1,000행 이상</span></div>`)}
      <p class="cf-muted">Cloudflare 지표는 5분간 서버에서 재사용합니다. 모니터링을 위해 R2에 캐시 파일을 만들거나 새 로그를 저장하지 않습니다.</p>`
  }
  function coverage() {
    return `<div class="cm-coverage">${Object.entries(sectionNames).map(([key,name])=>`<div><span>${esc(name)}</span><b class="cf-badge ${data(key)==null?'unknown':''}">${data(key)==null?'확인 필요':'연결됨'}</b></div>`).join('')}<div><span>비용 산출 범위</span><strong>${num(bundle.usage?.costSummary?.pricedMetrics)}개 / ${num(bundle.usage?.metrics?.length)}개</strong></div></div>`
  }
  function writeBars() {
    const writes=data('writes');if(!writes)return missing('writes')
    const max=Math.max(1,...writes.categories.map(c=>c.requests||0))
    return `<div class="cm-bars">${writes.categories.map(c=>`<div><div class="cm-bar-label"><span>${esc(c.label)}</span><strong>${num(c.requests)}회</strong></div><div class="cm-bar-track"><i style="width:${(Math.max(0,c.requests||0)/max*100).toFixed(2)}%"></i></div></div>`).join('')}</div><p class="cf-muted">${esc(writes.bucket)} · 합계 ${num(writes.total)}회. 처음 생성과 같은 키의 덮어쓰기는 이 집계만으로 구분하지 않습니다.</p>`
  }
  function cost() {
    const u=bundle.usage
    const dates=(u?.metrics||[]).filter(m=>M.exhaustion(m,u)).map(m=>[m.label,m.used>m.included?'이미 포함량 초과':date(M.exhaustion(m,u))+' KST',money(m.projectedOverageUsd)])
    return panel('추가요금 예산','기본요금과 미산출 비용을 제외한, 이 화면의 초과액 소계에만 적용됩니다.',`<form id="cm-budget-form" class="cm-budget"><label for="cm-budget">청구 주기 추가요금 예산 (USD)</label><div><span aria-hidden="true">$</span><input id="cm-budget" type="number" inputmode="decimal" min="0.01" max="1000000000" step="0.01" placeholder="예산 입력" value="${budget??''}"><button type="submit">저장</button><button type="button" id="cm-budget-clear" class="cm-quiet">해제</button></div><p id="cm-budget-status" role="status">${budget?`설정 예산 $${num(budget)}`:'예산을 설정하면 접근·초과 예상을 화면에서 알려드립니다.'} · 이 브라우저에만 저장 · 이메일·카카오 알림 없음</p></form>`)+
      panel('포함량 소진 예상','주기 시작 후 24시간 이상의 평균 속도로 계산합니다. 현재 저장량에는 적용하지 않습니다.',dates.length?table(['항목','포함량 소진 예상','종료 예상 초과액'],dates):'<p class="cf-muted">산출 가능한 항목에서 이번 주기 내 소진 예상이 없거나, 아직 관측 기간이 부족합니다.</p>')+
      '<div id="cf-cost-monitor"></div>'
  }
  function chart() {
    const r=data('r2');if(!r)return missing('r2')
    return `<div class="cm-chart-tools"><label>그래프 지표 <select id="cm-chart-metric"><option value="puts">PUT 저장 요청</option><option value="classA">Class A 전체</option><option value="classB">Class B 전체</option></select></label><span>KST · 막대를 누르면 해당 시간 값을 확인합니다.</span></div><div id="cm-chart"></div><p id="cm-chart-reading" class="cm-chart-reading" aria-live="polite">각 막대는 완료된 1시간의 요청 수입니다.</p><details class="cm-details"><summary>시간별 수치 표 보기</summary>${table(['시간 (KST)','PUT','Class A','Class B','R2 5xx'],r.hours.map(h=>[date(h.at),num(h.puts),num(h.classA),num(h.classB),num(h.serverErrors)]))}</details>`
  }
  function cache() {
    const r=data('r2'),t=data('traffic'),w=data('writes')
    return panel('R2 시간별 요청','최근 완료 24시간 · 모든 저장 등급·버킷 합계. 청구용 Class A/B와 PUT 작업 수를 따로 봅니다.',chart())+
      `<div class="cm-summary cm-three">${tile('최근 완료 1시간 PUT',r?num(r.lastHourPuts)+'회':'확인 필요',r?'직전 1시간 '+num(r.previousHourPuts)+'회':'')}${tile('R2 GET 조회 성공 비율',pct(r?M.ratio(r.getOk,r.getOk+r.getMissing):null),'2xx ÷ (2xx + 404) · CDN 적중률과 별개')}${tile('R2 404 / 서버 5xx',r?`${num(r.getMissing)} / ${num(r.serverErrors)}`:'확인 필요','최근 완료 24시간')}</div>`+
      panel('캐시 종류별 저장 요청','운영 버킷 · 요청 수에는 실패도 포함하며, 성공(2xx)을 별도 표시합니다.',writeBars()+(w?table(['종류','키 접두어','PUT 요청','성공 (2xx)'],w.categories.map(c=>[c.label,c.prefix||'그 외',num(c.requests),num(c.successful)])):''))+
      panel('CDN · 웹 트래픽',t?`${t.domain} 영역의 모든 호스트 · 사용자 측 요청 · 최근 완료 24시간`:'Cloudflare 영역 트래픽 연결 상태를 확인하세요.',t?`<div class="cm-summary cm-three">${tile('CDN HIT / 전체 요청',pct(M.ratio(t.cdnHits,t.requests)),`${num(t.cdnHits)} / ${num(t.requests)}회 · dynamic·bypass도 분모에 포함`)}${tile('확인된 봇 요청 비중',pct(M.ratio(t.verifiedBots,t.requests)),`${num(t.verifiedBots)}회 · 분류되지 않은 요청이 사람이라는 뜻은 아닙니다.`)}${tile('엣지 5xx / 원본 5xx',`${num(t.edgeErrors)} / ${num(t.originErrors)}`,'같은 요청이 양쪽에 포함될 수 있어 합산하지 않습니다.')}</div><div class="cm-two">${table(['CDN 캐시 상태','요청 수'],Object.entries(t.cacheStatuses).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,num(v)]))}${table(['확인된 봇 분류','요청 수'],Object.entries(t.botCategories).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,num(v)]))}</div><p class="cf-muted">CDN HIT가 낮아도 동적 페이지·Workers 응답 특성 때문일 수 있습니다. R2 내부 재사용 여부를 이 값으로 판단하지 않습니다.</p>`:missing('traffic'))+
      panel('원본 서버에 도착한 봇','기존 관리자 수집기 · 오늘(KST)의 Nginx 요청. CDN에서 끝난 요청은 포함하지 않습니다.',originBots())
  }
  function originBots() {
    const b=bundle.bots
    if(!b || !['OK','STALE'].includes(b.status))return `<p class="cm-unavailable">${esc(b?.message||'원본 봇 기록을 불러오지 못했습니다.')}</p>`
    const totals={};for(const r of b.rows||[])totals[r.bot]=(totals[r.bot]||0)+r.count
    return `<p class="cf-muted">${esc(b.message)} ${b.partial?'일부 구간만 수집됨.':''} 수집 ${date(b.generatedAt)}</p>`+table(['봇 이름','원본 도달 요청'],Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,num(v)]))
  }
  function health() {
    const workers=data('workers'),dbs=data('d1'),growth=data('storage'),objects=data('objects'),refresh=data('refresh'),ops=bundle.operations,host=bundle.host
    const status=s=>({UP:'정상',DOWN:'점검 필요',WARN:'주의',STALE:'수집 지연',UNKNOWN:'확인 필요'}[s]||'확인 필요')
    const opsRows=ops?.admin?[['관리자',status(ops.admin?.status),ops.admin?.message],['MySQL',status(ops.database?.status),ops.database?.message],['공개 API',status(ops.publicApi?.status),ops.publicApi?.message],['공공데이터 수집 배치',status(ops.batch?.status),`${ops.batch?.message||''} · 완료 ${date(ops.batch?.completedAt)}`]]:[]
    if(host?.latest)opsRows.push(['원본 서버 인터넷',host.status==='OK'?(host.latest.internetOk===true?'연결됨':host.latest.internetOk===false?'점검 필요':'미측정'):'수집 지연',`수집 ${date(host.generatedAt)}`])
    return panel('Workers 실행 상태','최근 완료 24시간 · CPU 사용량이 많은 순. p95는 해당 Worker의 실제 분포이며 합산·평균하지 않습니다.',workers?table(['Worker','요청','오류 / 오류율','CPU 합계 (ms)','CPU p95 (ms)','요청시간 p95 (ms)'],workers.map(w=>[w.name,num(w.requests),`${num(w.errors)} / ${pct(M.ratio(w.errors,w.requests))}`,num(w.cpuMs),num(w.cpuP95Ms),num(w.responseP95Ms)])):missing('workers'))+
      panel('D1 쿼리 효율','쿼리당 읽은 행 = 스캔 행 ÷ (읽기 + 쓰기 쿼리). 반환 행 수나 개별 SQL 실행 계획은 별도 확인이 필요합니다.',dbs?table(['DB ID','쿼리 수','읽은 행 / 쓴 행','쿼리당 읽은 행','배치 지연 p95 (ms)'],dbs.map(d=>[d.id,num(d.queries),`${num(d.rowsRead)} / ${num(d.rowsWritten)}`,num(d.queries>0?d.rowsRead/d.queries:null),num(d.queryP95Ms)])):missing('d1'))+
      panel('D1 저장량 변화','현재와 24시간 구간 시작 직전의 마지막 관측값을 비교합니다. 관측 시각이 다르므로 정확히 24시간 간격이 아닐 수 있습니다.',growth?table(['DB ID','최근 저장량','이전 관측 대비','최근 관측 (KST)','이전 관측 (KST)'],growth.map(d=>[d.id,bytes(d.bytes),d.previousBytes==null?'비교 기록 없음':`${d.bytes>=d.previousBytes?'+':'−'}${bytes(Math.abs(d.bytes-d.previousBytes))}`,date(d.observedAt),date(d.previousAt)])):missing('storage'))+
      panel('Durable Objects 오류','최근 완료 24시간 · 실행 오류와 제한 오류가 중복될 수 있습니다.',objects?table(['요청','실행 오류','CPU 제한','메모리 제한','내부 오류'],[[num(objects.requests),num(objects.errors),num(objects.cpuErrors),num(objects.memoryErrors),num(objects.internalErrors)]]):missing('objects'))+
      panel('정기 캐시 갱신 실행','28일 분할 갱신 · GitHub의 공개 실행 기록 최근 5개. 작업 성공은 모든 개별 데이터의 최신성을 보장하지 않습니다.',refresh?`<p class="cf-muted">마지막 성공 ${date(refresh.lastSuccessAt)} KST</p>`+table(['시작 (KST)','실행 상태','결과','최종 갱신 (KST)'],refresh.runs.map(r=>[date(r.startedAt),({completed:'완료',in_progress:'실행 중',queued:'대기'}[r.status]||r.status),({success:'성공',failure:'실패',cancelled:'취소',timed_out:'시간 초과',skipped:'건너뜀'}[r.conclusion]||r.conclusion||'진행 중'),date(r.updatedAt)]))+`<div class="cf-links">${refresh.runs.slice(0,1).map(r=>`<a href="${esc(r.url)}" target="_blank" rel="noreferrer">최근 실행 기록 열기 ↗</a>`).join('')}</div>`:missing('refresh'))+
      panel('기존 운영 점검 연결','공공데이터 수집 배치는 R2의 28일 순환 갱신 작업과 별개입니다.',opsRows.length?table(['대상','상태','기준'],opsRows):'<p class="cm-unavailable">운영 상태를 불러오지 못했습니다. 서비스 장애로 단정하지 않습니다.</p>')+
      panel('추가 계측이 필요한 구간','확인 근거가 없는 항목은 정상으로 표시하지 않습니다.',table(['항목','현재 확인 범위','추가로 필요한 정보'],[
        ['28일 R2 순환 갱신 상세','실행 성공·실패·30시간 지연 확인','개별 대상 수·성공/실패·누락 기록'],
        ['변경 알림 대기열','Durable Objects 실행 오류 확인','미처리 건수·가장 오래된 항목·재시도 횟수'],
        ['Cloudflare Tunnel','공개 API·원본 응답 상태 확인','Tunnel 연결 상태·연결 끊김 횟수'],
        ['캐시 재생성 원인','키 접두어별 저장 요청 확인','최초 생성·내용 변경·기간 갱신·동일 내용 덮어쓰기 구분'],
        ['미산출 비용','현재 저장량과 포함량 확인','GB-month 이력·Workers Logs·DO 저장 과금'],
      ])+'<div class="cf-links"><a href="/operations.html">수집·서비스 상태 보기 ↗</a><a href="/service-analytics.html">서비스 이용 분석 보기 ↗</a><a href="https://developers.cloudflare.com/billing/manage/billable-usage/" target="_blank" rel="noreferrer">실제 청구 사용량 확인 방법 ↗</a></div>')
  }
  function drawChart() {
    const target=document.getElementById('cm-chart'),r=data('r2');if(!target||!r)return
    const metric=document.getElementById('cm-chart-metric').value,peak=Math.max(0,...r.hours.map(h=>h[metric])),max=Math.max(1,peak),label={puts:'PUT',classA:'Class A',classB:'Class B'}[metric]
    target.innerHTML=`<div class="cm-hour-chart" role="group" aria-label="시간별 ${label} 요청"><span class="cm-chart-max">최대 ${num(peak)}회</span>${r.hours.map((h,i)=>`<button type="button" class="cm-hour" data-hour="${i}" aria-label="${esc(date(h.at))} ${label} ${num(h[metric])}회" title="${esc(date(h.at))} · ${num(h[metric])}회"><i style="height:${Math.max(1,h[metric]/max*140)}px"></i><span>${i%4===0?esc(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',hour12:false}).format(new Date(h.at))):''}</span></button>`).join('')}</div>`
    target.querySelectorAll('[data-hour]').forEach(b=>b.addEventListener('click',()=>{const h=r.hours[Number(b.dataset.hour)];document.getElementById('cm-chart-reading').textContent=`${date(h.at)}–${date(new Date(Date.parse(h.at)+36e5).toISOString())} KST · ${label} ${num(h[metric])}회`}))
  }
  function choose(tab,focus=false) {
    active=tab
    document.querySelectorAll('[data-cm-tab]').forEach(b=>{const yes=b.dataset.cmTab===tab;b.setAttribute('aria-selected',yes);b.tabIndex=yes?0:-1;if(yes&&focus)b.focus()})
    document.querySelectorAll('[data-cm-panel]').forEach(p=>p.hidden=p.dataset.cmPanel!==tab)
  }
  function render(next) {
    bundle=next
    const root=document.getElementById('cf-monitor-root');if(!root)return
    const tabs=[['overview','한눈에 보기'],['cost','비용 · 예산'],['cache','R2 · 트래픽'],['health','성능 · 운영']]
    root.innerHTML=`<div class="cm-context"><span>비용: ${date(bundle.usage?.usagePeriodStart).split(' ').slice(0,2).join(' ')}–${date(bundle.usage?.usagePeriodEnd).split(' ').slice(0,2).join(' ')} 청구 주기 · 상태: ${date(bundle.monitoring?.start)}–${date(bundle.monitoring?.end)} KST</span><button type="button" id="cm-refresh">새로 조회</button></div><nav class="cm-tabs" role="tablist" aria-label="Cloudflare 모니터링">${tabs.map(([id,label])=>`<button type="button" role="tab" id="cm-tab-${id}" data-cm-tab="${id}" aria-controls="cm-panel-${id}" aria-selected="false">${label}</button>`).join('')}</nav>${tabs.map(([id])=>`<div role="tabpanel" id="cm-panel-${id}" data-cm-panel="${id}" aria-labelledby="cm-tab-${id}" tabindex="0" hidden>${({overview,cost,cache,health})[id]()}</div>`).join('')}`
    if(bundle.usage) {globalThis.CloudflareCostView.render(bundle.usage);document.querySelector('#cf-monitor-suggestions')?.remove()}
    else document.getElementById('cf-cost-monitor').innerHTML='<p class="cm-unavailable">비용 데이터를 불러오지 못했습니다. 0원으로 판단하지 마세요.</p>'
    root.querySelectorAll('[data-cm-tab]').forEach(b=>{
      b.addEventListener('click',()=>choose(b.dataset.cmTab))
      b.addEventListener('keydown',e=>{const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(e.key))return;e.preventDefault();const i=tabs.findIndex(([id])=>id===active);choose(tabs[e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4][0],true)})
    })
    root.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.go,true)))
    root.querySelector('#cm-budget-form').addEventListener('submit',e=>{
      e.preventDefault();const input=document.getElementById('cm-budget');if(!input.reportValidity())return
      const v=input.value===''?null:Number(input.value);if(v!=null&&(!Number.isFinite(v)||v<=0))return
      budget=v;let persisted=true;try{if(v==null)localStorage.removeItem(budgetKey);else localStorage.setItem(budgetKey,String(v))}catch{persisted=false}
      render(bundle);document.getElementById('cm-budget-status').textContent=(persisted?'이 브라우저에 예산 설정을 저장했습니다.':'브라우저 저장이 차단되어 현재 화면에서만 적용합니다.')+' 기본요금·미산출 비용 제외 · 외부 알림 없음'
    })
    root.querySelector('#cm-budget-clear').addEventListener('click',()=>{budget=null;try{localStorage.removeItem(budgetKey)}catch{}render(bundle)})
    root.querySelector('#cm-refresh').addEventListener('click',refresh)
    root.querySelector('#cm-chart-metric')?.addEventListener('change',drawChart)
    choose(active);drawChart()
  }
  async function fetchJson(url) {
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)})
    if(!response.ok)throw new Error('unavailable');return response.json()
  }
  async function refresh() {
    if(pending)return;pending=true
    const button=document.getElementById('cm-refresh');if(button){button.disabled=true;button.textContent='조회 중…'}
    const status=document.getElementById('workspace-status')
    const endpoints={usage:'/api/admin/v1/cloudflare/usage',monitoring:'/api/admin/v1/cloudflare/monitoring',operations:'/api/admin/v1/operations/status',bots:'/api/admin/v1/service-analytics/origin-bots?range=today',host:'/api/admin/v1/operations/host?days=7'}
    try {
      const result=await Promise.allSettled(Object.values(endpoints).map(fetchJson)),next={}
      Object.keys(endpoints).forEach((key,i)=>next[key]=result[i].status==='fulfilled'?result[i].value:null)
      render(next)
      if(status)status.textContent=`최근 조회 ${date(next.monitoring?.checkedAt||next.usage?.checkedAt)} KST · 반영 지연을 고려해 15분 전까지 수집하고, 상태 비교에서는 불완전한 시간대를 제외합니다.`
    } finally {pending=false;const current=document.getElementById('cm-refresh');if(current){current.disabled=false;current.textContent='새로 조회'}}
  }
  function start() {
    refresh();clearInterval(timer)
    timer=setInterval(()=>{if(!document.hidden&&!document.querySelector('#cf-monitor-root input:focus'))refresh()},300000)
  }
  globalThis.CloudflareMonitorView={render,start}
})()
