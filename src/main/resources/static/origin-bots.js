(() => {
  const escape = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = v => new Intl.NumberFormat('ko-KR').format(v || 0);
  const when = v => v ? new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)) : '—';
  const verification = {verified:'공식 IP 확인', declared:'이름만 확인', unmatched:'공식 IP 불일치'};
  const paths = {home:'홈',toilet_detail:'화장실 상세',regions:'지역 페이지',sitemap:'사이트맵',robots:'robots.txt',toilets_api:'화장실 API',analytics_api:'분석 이벤트 API',auth_api:'인증 API',admin:'관리자 API',assets:'정적 파일',other:'기타 경로'};
  let controller;
  function cancel() { controller?.abort(); }
  async function show(host, query) {
    cancel(); controller = new AbortController(); const current = controller;
    host.innerHTML = '<section data-automation-statistics></section><section data-origin-log><p class="analytics-empty" role="status">미니 PC 봇 접근 기록을 불러오고 있습니다.</p></section>';
    const originHost=host.querySelector('[data-origin-log]');
    void showAutomation(host.querySelector('[data-automation-statistics]'),query,current);
    try {
      const response = await fetch(`/api/admin/v1/service-analytics/origin-bots?${new URLSearchParams(query)}`, {credentials:'include', signal:current.signal});
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'auth' : 'load');
      const report = await response.json();
      if (current !== controller || current.signal.aborted) return;
      if (!['OK','STALE'].includes(report.status)) {
        originHost.innerHTML = `<article class="analytics-panel"><header><h2>미니 PC 봇 접근</h2></header><p class="analytics-empty">${escape(report.message)}</p><p>Cloudflare 차단 요청은 포함하지 않습니다. 수집기 미연결 상태는 봇 0건이 아닙니다.</p></article>`;
        return;
      }
      let bot = '', check = '';
      const draw = () => {
        const rows = report.rows.filter(r => (!bot || r.bot === bot) && (!check || r.verification === check));
        const sum = key => rows.filter(r => !key || r.verification === key).reduce((n,r) => n+r.count,0);
        const group = (key) => {
          const result = new Map();
          for (const r of rows) {
            const k = key(r), v = result.get(k) || {key:k,count:0,first:r.first,last:r.last,errors:0};
            v.count += r.count; v.errors += r.status >= 4 ? r.count : 0;
            if (r.first < v.first) v.first = r.first; if (r.last > v.last) v.last = r.last;
            result.set(k,v);
          }
          return [...result.values()].sort((a,b) => b.count-a.count || a.key.localeCompare(b.key));
        };
        const groups = group(r => `${r.bot}|${r.verification}`);
        const byPath = group(r => r.path);
        const hourly = report.from === report.to;
        const times = group(r => hourly ? r.hour : r.day).sort((a,b) => a.key.localeCompare(b.key));
        const max = Math.max(1,...times.map(r => r.count));
        originHost.innerHTML = `<p class="analytics-section-note">${escape(report.message)}<br>조회: ${escape(report.from)} ~ ${escape(report.to)} · 마지막 수집 ${when(report.generatedAt)} KST · 기기·유입·방문 페이지 필터와 별도입니다.</p>
          ${report.partial ? '<p class="analytics-range-note">부분 기록입니다. 수집 시작·로그 교체·보관 기간·처리 지연으로 빠진 구간이 있을 수 있습니다. 빈 구간을 0건으로 해석하지 마세요.</p>' : ''}
          <article class="analytics-panel"><div class="analytics-table-controls"><label>봇 <select id="origin-bot-name"><option value="">전체 봇</option>${[...new Set(report.rows.map(r => r.bot))].sort().map(name => `<option ${bot===name?'selected':''}>${escape(name)}</option>`).join('')}</select></label><label>식별 상태 <select id="origin-bot-check"><option value="">전체 상태</option>${Object.entries(verification).map(([key,label]) => `<option value="${key}" ${key===check?'selected':''}>${label}</option>`).join('')}</select></label></div>
          <div class="analytics-live origin-bot-stats"><strong>${number(sum())}<small>서버 도착 요청</small></strong><strong>${number(sum('verified'))}<small>공식 IP 확인</small></strong><strong>${number(sum('declared'))}<small>이름만 확인</small></strong><strong>${number(sum('unmatched'))}<small>공식 IP 불일치</small></strong></div>
          <p>‘이름만 확인’은 요청이 해당 봇이라고 표명한 상태입니다. IP 불일치만으로 악성·사칭을 확정하지 않습니다. 일반 브라우저처럼 행동하는 미식별 봇은 이 목록에서 빠질 수 있습니다.</p></article>
          <article class="analytics-panel"><header><h2>어떤 봇이 들어왔나요?</h2><span>행을 선택하면 해당 봇만 보기</span></header><div class="analytics-table-wrap"><table><thead><tr><th>봇 이름</th><th>식별 상태</th><th>요청</th><th>4xx·5xx</th><th>최초 접근</th><th>마지막 접근</th></tr></thead><tbody>${groups.map(r => {const [name,kind]=r.key.split('|');return `<tr><td><button type="button" class="analytics-link" data-origin-bot="${escape(name)}">${escape(name)}</button></td><td><span class="origin-bot-badge is-${kind}">${verification[kind]}</span></td><td>${number(r.count)}</td><td>${number(r.errors)}</td><td>${when(r.first)}</td><td>${when(r.last)}</td></tr>`;}).join('') || '<tr><td colspan="6">선택 조건에서 식별된 봇 요청이 없습니다.</td></tr>'}</tbody></table></div></article>
          <div class="analytics-two-column"><article class="analytics-panel"><header><h2>언제 접근했나요?</h2><span>${hourly?'시간대별':'날짜별'} · KST</span></header><div class="origin-bot-times">${times.map(r => `<div><span>${escape(hourly ? when(r.key) : r.key)}</span><meter min="0" max="${max}" value="${r.count}" aria-label="${escape(r.key)} 요청 ${r.count}건"></meter><b>${number(r.count)}</b></div>`).join('') || '<p class="analytics-empty">표시할 접근 기록이 없습니다.</p>'}</div></article>
          <article class="analytics-panel"><header><h2>어디에 접근했나요?</h2><span>원문 URL 없이 경로 유형만</span></header><div class="analytics-table-wrap"><table><thead><tr><th>경로</th><th>요청</th><th>마지막 접근</th></tr></thead><tbody>${byPath.map(r => `<tr><td>${paths[r.key] || '기타 경로'}</td><td>${number(r.count)}</td><td>${when(r.last)}</td></tr>`).join('') || '<tr><td colspan="3">표시할 접근 기록이 없습니다.</td></tr>'}</tbody></table></div></article></div>
          <p class="analytics-section-note">서버 응답 기록이며 실제 색인·학습 여부를 증명하지 않습니다. 2xx에는 ‘접수했으나 저장하지 않은 분석 이벤트’도 포함될 수 있습니다. 봇 요청 건수를 기존 방문 통계에서 그대로 빼지 않습니다.</p>`;
        originHost.querySelector('#origin-bot-name').onchange = e => { bot=e.target.value; draw(); };
        originHost.querySelector('#origin-bot-check').onchange = e => { check=e.target.value; draw(); };
        originHost.querySelectorAll('[data-origin-bot]').forEach(b => b.onclick = () => { bot=b.dataset.originBot; draw(); });
      };
      draw();
    } catch(error) {
      if (error.name === 'AbortError' || current !== controller) return;
      originHost.innerHTML = `<p class="analytics-error" role="alert">${error.message==='auth'?'관리자 로그인이 필요합니다.':'봇 접근 기록을 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.'}</p>`;
    }
  }
  const automationReasons={UA_SIGNAL:'요청 브라우저 정보의 자동화 표시',DISTRIBUTED_PASSIVE_PROFILE:'분산 접속 · 반복 브라우저 패턴 · 단일 조회',DISTRIBUTED_MOBILE_PASSIVE_PROFILE:'분산 모바일 접속 · 반복 브라우저 패턴 · 단일 조회',KNOWN_BULK_CLIENT:'반복 수집 클라이언트 패턴'};
  const automationKinds={UA_SIGNAL:'자동화 표시 있음 · 신원 인증 아님',PATTERN_INFERRED:'패턴 판별 · 운영 주체 미확인'};
  function sourceCatalog(report) {
    const sources=report.officialSources||[];
    const states={OK:'확인 완료',STALE:'과거 대조',UNAVAILABLE:'조회 실패',NOT_REPORTED:'조회 상태 미보고'};
    return `<details class="analytics-panel automation-source-catalog"><summary>공개 IP 대조 범위 · 전체 봇 목록 아님${sources.length?` · ${number(sources.length)}개 파일 / ${number(new Set(sources.map(source=>source.provider)).size)}개 제공처`:''}</summary><p class="analytics-section-note">공개한 IP 목록이 있는 일부 서비스와 대조하는 범위입니다. 인터넷의 모든 검색·AI·자동화 도구 목록이 아닙니다. 목록에 없다는 이유만으로 악의적 접속·사칭이나 자동화라고 판정하지 않습니다. IP 대역 일치와 운영 주체의 신원 확인도 구분합니다.</p><div class="analytics-table-wrap"><table><thead><tr><th>제공처 · 목록</th><th>공식 출처</th><th>조회 상태</th><th>대역 개수</th><th>대조 파일 조회 시각</th></tr></thead><tbody>${sources.map(source=>`<tr><td>${escape(source.provider)}<small>${escape(source.title)}</small></td><td><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.url)}</a></td><td>${escape(states[source.status]||'미확인')}</td><td>${source.prefixCount===null||source.prefixCount===undefined?'—':number(source.prefixCount)}</td><td>${when(source.fetchedAt)} KST<small>${escape(source.fetchedAt||'실제 조회 시각이 보고되지 않았습니다.')}</small></td></tr>`).join('')||'<tr><td colspan="5">이 응답은 출처 목록을 아직 제공하지 않습니다.</td></tr>'}</tbody></table></div></details>`;
  }
  async function showAutomation(host,query,current) {
    host.innerHTML='<p class="analytics-empty" role="status">통계 자동화 분류 상태를 불러오고 있습니다.</p>';
    try {
      const response=await fetch(`/api/admin/v1/service-analytics/automation-statistics?${new URLSearchParams(query)}`,{credentials:'include',signal:current.signal});
      if(!response.ok)throw new Error(response.status===401||response.status===403?'auth':'load');
      const report=await response.json();
      if(current!==controller||current.signal.aborted)return;
      if(!report.job||!report.coverage||!Array.isArray(report.rows)) {
        host.innerHTML=`<article class="analytics-panel"><header><h2>통계에서 분리한 자동화</h2></header><p>${escape(report.message||'분류 집계를 준비하고 있습니다. 0건을 뜻하지 않습니다.')}</p></article>${sourceCatalog(report)}`;return;
      }
      const plan=report.status==='PLAN'||report.job.applyMode==='plan',sum=(kind,key)=>report.rows.filter(row=>row.classification===kind).reduce((n,row)=>n+row[key],0);
      const groups=new Map();
      for(const row of report.rows) {
        const key=row.classification+'|'+row.reason,value=groups.get(key)||{classification:row.classification,reason:row.reason,sessions:0,events:0,views:0};
        for(const metric of ['sessions','events','views'])value[metric]+=row[metric];groups.set(key,value);
      }
      let status={READY:'통계 분리 적용',PLAN:'계획 검토 · 미반영',PARTIAL:'부분 기록',ERROR:'최근 작업 오류',STALE:'분류 작업 지연'}[report.status]||'상태 확인 필요';
      if(plan&&report.status!=='PLAN')status+=' · 계획 검토 · 미반영';
      const job=report.job,c=report.coverage;
      host.innerHTML=`<article class="analytics-panel automation-statistics"><header><h2>통계에서 분리한 자동화</h2><span>${escape(status)}</span></header>
      <p class="analytics-section-note">${escape(report.message)}<br>조회 ${escape(report.from)} ~ ${escape(report.to)} · 집계 갱신 ${when(report.generatedAt)} KST · ${plan?'예정 주기':'작업 주기'} ${number(job.intervalSeconds/60)}분 · 마지막 완료 ${when(job.lastCompletedAt)} KST</p>
      ${report.partial?'<p class="analytics-range-note">부분 범위 또는 대조하지 못한 기록이 있습니다. 일반 방문이나 봇 0건으로 단정하지 않습니다.</p>':''}
      <div class="analytics-live"><strong>${number(sum('UA_SIGNAL','sessions'))}<small>요청 자동화 표시 · 세션</small></strong><strong>${number(sum('PATTERN_INFERRED','sessions'))}<small>${plan?'패턴 분리 예정':'패턴으로 분리한'} 세션</small></strong><strong>${number(sum('PATTERN_INFERRED','views'))}<small>${plan?'분리 예정':'분리한'} 조회</small></strong><strong>${number(sum('PATTERN_INFERRED','events'))}<small>${plan?'분리 예정':'분리한'} 이벤트</small></strong></div>
      <div class="analytics-table-wrap"><table><thead><tr><th>분류 · 확인 근거</th><th>세션</th><th>조회</th><th>이벤트</th></tr></thead><tbody>${[...groups.values()].map(row=>`<tr><td>${escape(automationKinds[row.classification]||'미확인')}<small>${escape(automationReasons[row.reason]||'근거 확인 필요')}</small></td><td>${number(row.sessions)}</td><td>${number(row.views)}</td><td>${number(row.events)}</td></tr>`).join('')||'<tr><td colspan="4">이 기간의 분류 집계가 없습니다. 작업 범위와 완료 상태를 함께 확인하세요.</td></tr>'}</tbody></table></div>
      <p class="analytics-section-note">작업 대조 범위 ${escape(c.from)} ~ ${escape(c.to)}: 이벤트 ${number(c.matchedEvents)} / ${number(c.totalEvents)}건 대조 · 미대조 ${number(c.unmatchedEvents)}건 · 연결 모호 ${number(c.ambiguousEvents)}건 · 범위 미확인 ${number(c.unaccountedEvents)}건. 아래 표의 공식 IP 확인은 별도의 서버 요청 신원 검증입니다. 패턴 판별은 운영 주체의 신원을 확인했다는 뜻이 아닙니다. 접속 제한 없이 통계만 분리하며 원본 이벤트는 보존합니다.</p></article>${sourceCatalog(report)}`;
    } catch(error) {
      if(error.name==='AbortError'||current!==controller)return;
      host.innerHTML=`<article class="analytics-panel"><header><h2>통계에서 분리한 자동화</h2></header><p class="analytics-error">${error.message==='auth'?'관리자 로그인이 필요합니다.':'자동화 분류 집계를 읽지 못했습니다. 0건이나 분류 완료를 뜻하지 않습니다.'}</p></article>`;
    }
  }
  window.OriginBotAnalytics = {show,cancel};
})();
