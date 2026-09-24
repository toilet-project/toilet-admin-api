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
    host.innerHTML = '<p class="analytics-empty" role="status">미니 PC 봇 접근 기록을 불러오고 있습니다.</p>';
    try {
      const response = await fetch(`/api/admin/v1/service-analytics/origin-bots?${new URLSearchParams(query)}`, {credentials:'include', signal:current.signal});
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'auth' : 'load');
      const report = await response.json();
      if (current !== controller || current.signal.aborted) return;
      if (!['OK','STALE'].includes(report.status)) {
        host.innerHTML = `<article class="analytics-panel"><header><h2>미니 PC 봇 접근</h2></header><p class="analytics-empty">${escape(report.message)}</p><p>Cloudflare 차단 요청은 포함하지 않습니다. 수집기 미연결 상태는 봇 0건이 아닙니다.</p></article>`;
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
        host.innerHTML = `<p class="analytics-section-note">${escape(report.message)}<br>조회: ${escape(report.from)} ~ ${escape(report.to)} · 마지막 수집 ${when(report.generatedAt)} KST · 기기·유입·방문 페이지 필터와 별도입니다.</p>
          ${report.partial ? '<p class="analytics-range-note">부분 기록입니다. 수집 시작·로그 교체·보관 기간·처리 지연으로 빠진 구간이 있을 수 있습니다. 빈 구간을 0건으로 해석하지 마세요.</p>' : ''}
          <article class="analytics-panel"><div class="analytics-table-controls"><label>봇 <select id="origin-bot-name"><option value="">전체 봇</option>${[...new Set(report.rows.map(r => r.bot))].sort().map(name => `<option ${bot===name?'selected':''}>${escape(name)}</option>`).join('')}</select></label><label>식별 상태 <select id="origin-bot-check"><option value="">전체 상태</option>${Object.entries(verification).map(([key,label]) => `<option value="${key}" ${key===check?'selected':''}>${label}</option>`).join('')}</select></label></div>
          <div class="analytics-live origin-bot-stats"><strong>${number(sum())}<small>서버 도착 요청</small></strong><strong>${number(sum('verified'))}<small>공식 IP 확인</small></strong><strong>${number(sum('declared'))}<small>이름만 확인</small></strong><strong>${number(sum('unmatched'))}<small>공식 IP 불일치</small></strong></div>
          <p>‘이름만 확인’은 요청이 해당 봇이라고 표명한 상태입니다. IP 불일치만으로 악성·사칭을 확정하지 않습니다. 일반 브라우저처럼 행동하는 미식별 봇은 이 목록에서 빠질 수 있습니다.</p></article>
          <article class="analytics-panel"><header><h2>어떤 봇이 들어왔나요?</h2><span>행을 선택하면 해당 봇만 보기</span></header><div class="analytics-table-wrap"><table><thead><tr><th>봇 이름</th><th>식별 상태</th><th>요청</th><th>4xx·5xx</th><th>최초 접근</th><th>마지막 접근</th></tr></thead><tbody>${groups.map(r => {const [name,kind]=r.key.split('|');return `<tr><td><button type="button" class="analytics-link" data-origin-bot="${escape(name)}">${escape(name)}</button></td><td><span class="origin-bot-badge is-${kind}">${verification[kind]}</span></td><td>${number(r.count)}</td><td>${number(r.errors)}</td><td>${when(r.first)}</td><td>${when(r.last)}</td></tr>`;}).join('') || '<tr><td colspan="6">선택 조건에서 식별된 봇 요청이 없습니다.</td></tr>'}</tbody></table></div></article>
          <div class="analytics-two-column"><article class="analytics-panel"><header><h2>언제 접근했나요?</h2><span>${hourly?'시간대별':'날짜별'} · KST</span></header><div class="origin-bot-times">${times.map(r => `<div><span>${escape(hourly ? when(r.key) : r.key)}</span><meter min="0" max="${max}" value="${r.count}" aria-label="${escape(r.key)} 요청 ${r.count}건"></meter><b>${number(r.count)}</b></div>`).join('') || '<p class="analytics-empty">표시할 접근 기록이 없습니다.</p>'}</div></article>
          <article class="analytics-panel"><header><h2>어디에 접근했나요?</h2><span>원문 URL 없이 경로 유형만</span></header><div class="analytics-table-wrap"><table><thead><tr><th>경로</th><th>요청</th><th>마지막 접근</th></tr></thead><tbody>${byPath.map(r => `<tr><td>${paths[r.key] || '기타 경로'}</td><td>${number(r.count)}</td><td>${when(r.last)}</td></tr>`).join('') || '<tr><td colspan="3">표시할 접근 기록이 없습니다.</td></tr>'}</tbody></table></div></article></div>
          <p class="analytics-section-note">서버 응답 기록이며 실제 색인·학습 여부를 증명하지 않습니다. 2xx에는 ‘접수했으나 저장하지 않은 분석 이벤트’도 포함될 수 있습니다. 봇 요청 건수를 기존 방문 통계에서 그대로 빼지 않습니다.</p>`;
        host.querySelector('#origin-bot-name').onchange = e => { bot=e.target.value; draw(); };
        host.querySelector('#origin-bot-check').onchange = e => { check=e.target.value; draw(); };
        host.querySelectorAll('[data-origin-bot]').forEach(b => b.onclick = () => { bot=b.dataset.originBot; draw(); });
      };
      draw();
    } catch(error) {
      if (error.name === 'AbortError' || current !== controller) return;
      host.innerHTML = `<p class="analytics-error" role="alert">${error.message==='auth'?'관리자 로그인이 필요합니다.':'봇 접근 기록을 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.'}</p>`;
    }
  }
  window.OriginBotAnalytics = {show,cancel};
})();
