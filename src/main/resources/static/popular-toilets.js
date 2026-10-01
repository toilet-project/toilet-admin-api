(() => {
  let controller, epoch = 0, host, query = {}, report, search = '', sort = 'views', page = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => new Intl.NumberFormat('ko-KR').format(value);
  const cancel = () => { epoch++; controller?.abort(); host = null; };
  function shell() {
    host.innerHTML = `<section class="analytics-panel popular-toilets"><header><div><h2>인기 화장실</h2><p>실제로 상세 화면을 본 조회를 화장실별로 확인합니다.</p></div><span class="popular-range"></span></header><div class="analytics-table-controls"><form class="popular-search"><input type="search" maxlength="80" aria-label="화장실명 또는 주소 검색" placeholder="화장실명 또는 주소" value="${esc(search)}"><button type="submit">검색</button></form><select class="popular-sort" aria-label="인기 화장실 정렬"><option value="views">기간 조회수 높은 순</option><option value="likes">현재 좋아요 많은 순</option><option value="name">이름순</option></select></div><div class="popular-results" aria-live="polite"><p class="analytics-empty">화장실별 조회를 불러오고 있습니다.</p></div></section>`;
    host.querySelector('.popular-sort').value = sort;
    host.querySelector('form').addEventListener('submit', e => { e.preventDefault(); search = host.querySelector('input').value.trim(); page = 0; void load(); });
    host.querySelector('select').addEventListener('change', e => { sort = e.target.value; page = 0; void load(); });
    host.querySelector('.popular-results').addEventListener('click', e => {
      const b = e.target.closest('button[data-popular-page],button[data-popular-retry]');
      if (!b) return;
      if (b.dataset.popularPage !== undefined) page = Number(b.dataset.popularPage);
      void load();
    });
  }
  function render() {
    host.querySelector('.popular-range').textContent = `${report.from} ~ ${report.to} · 한국시간`;
    const results = host.querySelector('.popular-results');
    if (report.status === 'NOT_READY') {
      results.innerHTML = '<p class="analytics-empty">화장실별 조회 수집을 준비 중입니다. 수집 기능 적용 후부터 기록이 쌓입니다.</p>';return;
    }
    const since = report.collectedSince ? new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(report.collectedSince)) : '첫 조회 대기 중';
    results.innerHTML = `<div class="popular-summary"><div><span>선택 기간 조회</span><strong>${num(report.views)}<small>회</small></strong></div><div><span>조회된 화장실</span><strong>${num(report.facilities)}<small>곳</small></strong></div><p>이 브라우저 세션에서 같은 화장실은 30분에 1회 집계합니다.<br>식별된 봇은 수집에서 제외하며, 사람임을 완전히 보장하는 수치는 아닙니다.</p></div><div class="analytics-table-wrap"><table><thead><tr><th>순서</th><th>화장실</th><th>기간 조회</th><th>누적 조회</th><th>현재 좋아요</th></tr></thead><tbody>${report.items.map((r,i)=>`<tr><td>${report.page*report.size+i+1}</td><td><a class="analytics-link" href="https://geupddong.com/toilet/${r.toiletId}" target="_blank" rel="noopener noreferrer">${esc(r.name || '이름 없음')} ↗</a><small>${esc(r.address)}</small></td><td><strong>${num(r.views)}</strong></td><td>${num(r.totalViews)}</td><td>♡ ${num(r.likes)}</td></tr>`).join('') || '<tr><td colspan="5">선택한 기간과 검색 조건에 해당하는 조회가 없습니다.</td></tr>'}</tbody></table></div><footer class="analytics-table-footer"><span>${num(report.facilities)}곳 · ${num(report.page+1)}페이지</span><div><button data-popular-page="${report.page-1}" ${report.page===0?'disabled':''}>이전</button><button data-popular-page="${report.page+1}" ${report.hasMore?'':'disabled'}>다음</button></div></footer><p class="analytics-section-note">첫 집계: ${esc(since)}. 이전의 페이지 유형 통계는 화장실별 조회수로 소급 변환하지 않습니다. 좋아요는 선택 기간과 관계없이 현재 활성 회원의 합계입니다.</p>`;
  }
  async function load() {
    const token = ++epoch, target = host;
    controller?.abort();controller = new AbortController();
    const results = target.querySelector('.popular-results');
    results.setAttribute('aria-busy','true');results.innerHTML='<p class="analytics-empty">화장실별 조회를 불러오고 있습니다.</p>';
    const params = new URLSearchParams({...query,q:search,sort,page:String(page),size:'15'});
    try {
      const response = await fetch(`/api/admin/v1/service-analytics/popular-toilets?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal});
      if (!response.ok) throw new Error(response.status===401 || response.status===403?'auth':'load');
      const value = await response.json();
      if (token!==epoch || host!==target) return;
      if (!['READY','NOT_READY'].includes(value.status) || !Array.isArray(value.items) || value.items.some(r=>!Number.isSafeInteger(r.toiletId) || r.toiletId<=0)) throw new Error('load');
      report=value;render();
    } catch(e) {
      if (token!==epoch || e.name==='AbortError' || host!==target) return;
      results.innerHTML=`<p class="analytics-empty" role="alert">${e.message==='auth'?'관리자 로그인 상태를 확인해 주세요.':'인기 화장실을 불러오지 못했습니다. 조회 실패를 0건으로 표시하지 않습니다.'} <button data-popular-retry>다시 시도</button></p>`;
    } finally { if(token===epoch && host===target) results.setAttribute('aria-busy','false'); }
  }
  window.PopularToiletsAnalytics = { cancel, show(target, next) { cancel();host=target;query=next;page=0;shell();void load(); } };
})();
