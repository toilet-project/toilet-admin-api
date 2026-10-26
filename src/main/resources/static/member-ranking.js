(() => {
  window.MemberExperienceRanking?.dispose?.();
  const endpoint='https://api.geupddong.com/api/admin/v1/growth/ranking';
  const ranks=[['white','흰색 휴지','01-sprout'],['green','초록 휴지','02-heart'],['yellow','노랑 휴지','03-flame'],['blue','파랑 휴지','04-bolt'],['red','빨강 휴지','05-star'],['pink','핑크 휴지','06-crown'],['black','검정 휴지','07-legend']];
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num=value=>new Intl.NumberFormat('ko-KR').format(value);
  const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
  const icon=rank=>`<img src="/growth/rank-icons/v14/compact/${ranks.find(item=>item[0]===rank)[2]}.svg" alt="" width="24" height="24">`;
  let host,listController,distributionController,listEpoch=0,distributionEpoch=0,keyword='',sort='xp_desc',page=0,report,unsubscribe;
  function cancel(){++listEpoch;++distributionEpoch;listController?.abort();distributionController?.abort();if(host)host.replaceChildren();host=null;keyword='';report=null;}
  function dispose(){cancel();document.removeEventListener('admin:before-route-change',dispose);unsubscribe?.();}
  function reject(status){cancel();AdminAuth.reject(status,document.getElementById('members-shell'));}
  function current(target,token,kind){return host===target&&target.isConnected&&token===(kind==='distribution'?distributionEpoch:listEpoch);}
  function shell(){
    host.innerHTML=`<section class="panel member-ranking-panel" aria-labelledby="member-ranking-distribution-title"><div class="member-ranking-summary"><div><h2 id="member-ranking-distribution-title">휴지 등급별 회원 분포</h2><p>활성·정지 회원 전체 기준 · 경험치 0 포함 · 탈퇴·동의 대기 회원 제외</p></div><strong class="member-ranking-total"></strong></div><div class="member-ranking-distribution" aria-live="polite"></div></section><section class="panel member-ranking-panel"><div class="panel-title"><div><h2>경험치 랭킹</h2><p class="member-ranking-note">이름 일부 또는 전체 이메일 주소로 검색합니다. 이메일은 마스킹하여 표시합니다.</p></div></div><div class="member-rank-toolbar"><form class="member-rank-search"><label>이름 또는 전체 이메일<input name="keyword" type="search" maxlength="320" autocomplete="off" placeholder="이름 일부 또는 전체 이메일 입력"></label><button type="submit">검색</button><button type="button" data-ranking-clear>초기화</button></form><label class="member-rank-sort">경험치 정렬<select aria-label="경험치 정렬"><option value="xp_desc">높은 순</option><option value="xp_asc">낮은 순</option></select></label></div><p class="member-ranking-note">순위는 전체 대상 회원의 경험치 높은 순을 기준으로 합니다. 동점은 공동 순위(1, 1, 3)이며, 검색·정렬을 바꿔도 순위와 위 분포의 기준은 같습니다.</p><div class="member-rank-results" aria-live="polite"></div></section>`;
    host.querySelector('.member-rank-search').addEventListener('submit',event=>{event.preventDefault();keyword=host.querySelector('input[name="keyword"]').value.trim();void loadRanking(0);});
    host.querySelector('input[name="keyword"]').addEventListener('input',()=>{++listEpoch;listController?.abort();host.querySelector('.member-rank-results').setAttribute('aria-busy','false');host.querySelector('.member-rank-results').innerHTML='<p class="member-rank-loading">검색 버튼을 눌러 입력한 조건으로 조회해 주세요.</p>';});
    host.querySelector('.member-rank-sort select').addEventListener('change',event=>{sort=event.target.value;keyword=host.querySelector('input[name="keyword"]').value.trim();void loadRanking(0);});
    host.addEventListener('click',click);
  }
  function click(event){
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-ranking-clear')){host.querySelector('input[name="keyword"]').value='';keyword='';void loadRanking(0);}
    else if(button.hasAttribute('data-ranking-distribution-retry'))void loadDistribution();
    else if(button.hasAttribute('data-ranking-retry'))void loadRanking(page);
    else if(button.dataset.rankingPage!==undefined)void loadRanking(Number(button.dataset.rankingPage));
  }
  function error(target,kind){
    const region=target.querySelector(kind==='distribution'?'.member-ranking-distribution':'.member-rank-results');
    region.innerHTML=`<div class="member-rank-error" role="alert">${kind==='distribution'?'등급별 분포':'경험치 랭킹'}를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요. <button type="button" ${kind==='distribution'?'data-ranking-distribution-retry':'data-ranking-retry'}>다시 시도</button></div>`;
  }
  async function loadDistribution(){
    const target=host;if(!target?.isConnected)return;const token=++distributionEpoch;distributionController?.abort();distributionController=new AbortController();const controller=distributionController;
    const region=target.querySelector('.member-ranking-distribution');region.setAttribute('aria-busy','true');region.innerHTML='<p class="member-rank-loading">등급별 분포를 불러오고 있습니다.</p>';target.querySelector('.member-ranking-total').textContent='';
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(endpoint+'/distribution',{credentials:'include',cache:'no-store',signal:controller.signal});if(!current(target,token,'distribution'))return;
      if([401,403].includes(response.status)){reject(response.status);return;}if(!response.ok)throw new Error('load');
      const value=await response.json();if(!current(target,token,'distribution'))return;
      if(value.scope!=='ACTIVE_AND_SUSPENDED'||!integer(value.totalMembers)||!Array.isArray(value.buckets)||value.buckets.length!==7||new Set(value.buckets.map(item=>item.rank)).size!==7||value.buckets.some(item=>!ranks.some(rank=>rank[0]===item.rank)||!integer(item.count)||typeof item.rankName!=='string')||value.buckets.reduce((sum,item)=>sum+item.count,0)!==value.totalMembers)throw new Error('load');
      target.querySelector('.member-ranking-total').textContent=`전체 ${num(value.totalMembers)}명`;
      region.innerHTML=`<div class="member-rank-distribution">${ranks.map(([rank,name])=>{const item=value.buckets.find(bucket=>bucket.rank===rank),percent=value.totalMembers?item.count/value.totalMembers*100:0;return `<article class="member-rank-bucket"><div class="member-rank-bucket-title">${icon(rank)}<span>${esc(name)}</span></div><strong>${num(item.count)}<small>명 · ${percent.toFixed(1)}%</small></strong><meter min="0" max="100" value="${percent}" aria-label="${esc(name)} 회원 비율 ${percent.toFixed(1)}%"></meter></article>`;}).join('')}</div>`;
    }catch{if(current(target,token,'distribution'))error(target,'distribution');}
    finally{clearTimeout(timeout);if(current(target,token,'distribution'))region.setAttribute('aria-busy','false');}
  }
  function validItem(item){return item&&typeof item.id==='string'&&/^\d+$/.test(item.id)&&(typeof item.displayName==='string'||item.displayName===null)&&(typeof item.email==='string'||item.email===null)&&['ACTIVE','SUSPENDED'].includes(item.status)&&integer(item.totalXp)&&integer(item.level,1)&&integer(item.position,1)&&ranks.some(rank=>rank[0]===item.rank)&&typeof item.rankName==='string';}
  function render(){
    const region=host.querySelector('.member-rank-results');
    if(!report.items.length){region.innerHTML='<p class="member-rank-empty">조건에 맞는 회원이 없습니다.</p>';return;}
    region.innerHTML=`<div class="member-rank-table" tabindex="0" role="region" aria-label="경험치 랭킹 목록"><table><thead><tr><th scope="col">순위</th><th scope="col">회원</th><th scope="col" class="member-rank-desktop-email">이메일</th><th scope="col">휴지 등급</th><th scope="col">경험치</th></tr></thead><tbody>${report.items.map(item=>`<tr><td><strong>${num(item.position)}</strong></td><td><span class="member-rank-name">${esc(item.displayName||'이름 없음')}</span><small class="member-rank-mobile-email">${esc(item.email||'-')}</small>${item.status==='SUSPENDED'?'<small class="member-rank-status">정지</small>':''}</td><td class="member-rank-desktop-email">${esc(item.email||'-')}</td><td><span class="member-rank-badge">${icon(item.rank)}${esc(item.rankName)}</span></td><td><strong>${num(item.totalXp)}</strong><small class="member-rank-xp-unit"> XP</small></td></tr>`).join('')}</tbody></table></div><nav class="member-rank-pagination" aria-label="랭킹 페이지 이동"><span>검색 결과 ${num(report.totalElements)}명 · ${num(page+1)} / ${num(report.totalPages)}페이지</span><div><button type="button" data-ranking-page="${page-1}" ${page===0?'disabled':''}>이전</button><button type="button" data-ranking-page="${page+1}" ${page+1>=report.totalPages?'disabled':''}>다음</button></div></nav>`;
  }
  async function loadRanking(nextPage){
    const target=host;if(!target?.isConnected)return;const token=++listEpoch;listController?.abort();listController=new AbortController();const controller=listController;
    page=nextPage;const region=target.querySelector('.member-rank-results');region.setAttribute('aria-busy','true');region.innerHTML='<p class="member-rank-loading">경험치 랭킹을 불러오고 있습니다.</p>';
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(endpoint+'/search',{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({keyword,sort,page,size:10})});if(!current(target,token,'list'))return;
      if([401,403].includes(response.status)){reject(response.status);return;}if(!response.ok)throw new Error('load');
      const value=await response.json();if(!current(target,token,'list'))return;
      if(!Array.isArray(value.items)||value.items.length>10||!value.items.every(validItem)||!integer(value.page)||!integer(value.totalElements)||!integer(value.totalPages)||value.size!==10)throw new Error('load');
      if(value.page>0&&value.items.length===0&&value.totalPages>0&&value.page>=value.totalPages){void loadRanking(value.totalPages-1);return;}
      if(value.page!==page||(value.items.length>0&&value.page>=value.totalPages))throw new Error('load');
      report=value;render();
    }catch{if(current(target,token,'list'))error(target,'list');}
    finally{clearTimeout(timeout);if(current(target,token,'list'))region.setAttribute('aria-busy','false');}
  }
  window.MemberExperienceRanking={cancel,dispose,show(target){cancel();host=target;sort='xp_desc';page=0;shell();void loadDistribution();void loadRanking(0);},refresh(){if(!host)return;keyword=host.querySelector('input[name="keyword"]').value.trim();void loadDistribution();void loadRanking(0);}};
  document.addEventListener('admin:before-route-change',dispose);
  unsubscribe=AdminAuth.subscribe(state=>{if(state.status!=='authenticated')cancel();});
})();
