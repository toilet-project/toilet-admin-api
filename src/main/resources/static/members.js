(() => {
  window.MemberManagementWorkspace?.dispose?.();
  const root=document.getElementById('members-shell');if(!root)return;
  const el=id=>root.querySelector('#'+id);
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const statuses={ACTIVE:'활성',SUSPENDED:'정지',WITHDRAWN:'탈퇴',PENDING_CONSENT:'동의 대기'};
  let disposed=false,controller,epoch=0,searchTimer,currentPage=0,totalPages=0,unsubscribe;
  let tab=new URLSearchParams(window.location.search).get('tab')==='ranking'?'ranking':'members';
  const alive=()=>!disposed&&root.isConnected;
  const cancel=()=>{++epoch;controller?.abort();clearTimeout(searchTimer);};
  function clearPrivate(){cancel();el('member-keyword').value='';el('member-list').replaceChildren();el('member-pagination').replaceChildren();window.MemberExperienceRanking?.cancel();el('members-ranking-panel').replaceChildren();}
  function reject(status){clearPrivate();AdminAuth.reject(status,root);}
  function renderPagination(){
    const target=el('member-pagination');target.replaceChildren();if(totalPages<=1)return;
    [['이전',currentPage>0,currentPage-1],[`${currentPage+1} / ${totalPages}`,false],['다음',currentPage<totalPages-1,currentPage+1]].forEach(([label,enabled,page],index)=>{
      const node=document.createElement(index===1?'span':'button');node.textContent=label;
      if(index!==1){node.type='button';node.className='secondary-button';node.disabled=!enabled;node.addEventListener('click',()=>void loadMembers(page));}target.append(node);
    });
  }
  function renderMembers(items){
    el('member-list').innerHTML=items.map(member=>`<tr><td><strong>${esc(member.displayName||`회원 #${member.id}`)}</strong><small>#${esc(member.id)}</small></td><td>${esc(member.email||'-')}</td><td><span class="account-status ${Object.hasOwn(statuses,member.status)?member.status.toLowerCase():''}">${esc(statuses[member.status]||'알 수 없음')}</span></td><td>${member.roles.map(role=>`<span class="role-badge ${['ADMIN','USER'].includes(role)?role.toLowerCase():''}">${esc(role)}</span>`).join(' ')}</td><td>${esc(member.lastLoginAt?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(member.lastLoginAt)?member.lastLoginAt:member.lastLoginAt+'+09:00')):'-')}</td></tr>`).join('')||'<tr><td colspan="5">조건에 맞는 회원이 없습니다.</td></tr>';
  }
  function pending(){el('member-list').replaceChildren();el('member-pagination').replaceChildren();el('member-status-text').className='status';el('member-status-text').textContent='회원을 불러오는 중입니다.';}
  async function loadMembers(page=0){
    if(!alive()||tab!=='members')return;
    if(window.AdminExperienceRankingPreview?.readOnly){el('member-list').replaceChildren();el('member-pagination').replaceChildren();el('member-status-text').textContent='이 프리뷰는 경험치 랭킹을 확인하는 화면입니다. 회원 목록은 운영 관리자에서 확인해 주세요.';return;}
    cancel();const token=++epoch;controller=new AbortController();const requestController=controller;
    pending();el('members-list-panel').setAttribute('aria-busy','true');const timeout=setTimeout(()=>requestController.abort(),15000);
    try{
      const query=new URLSearchParams({keyword:el('member-keyword').value.trim(),role:'',status:el('member-status').value,page:String(Math.max(page,0)),size:'20'});
      const response=await fetch(`https://api.geupddong.com/api/admin/v1/security/users?${query}`,{credentials:'include',cache:'no-store',signal:requestController.signal});
      if(!alive()||token!==epoch)return;
      if([401,403].includes(response.status)){reject(response.status);return;}if(!response.ok)throw new Error('load');
      const data=await response.json();if(!alive()||token!==epoch)return;
      if(!Array.isArray(data.items)||!Number.isSafeInteger(data.page)||!Number.isSafeInteger(data.totalPages)||!Number.isSafeInteger(data.totalElements)||data.items.some(item=>!Array.isArray(item.roles)))throw new Error('load');
      currentPage=data.page;totalPages=data.totalPages;renderMembers(data.items);renderPagination();el('member-status-text').textContent=data.totalElements?`회원 ${data.totalElements}명 · ${currentPage+1}페이지`:'조건에 맞는 회원이 없습니다.';
    }catch{if(alive()&&token===epoch){el('member-status-text').className='status is-error';el('member-status-text').textContent='회원 목록을 불러오지 못했습니다. 조회 버튼으로 다시 시도해 주세요.';}}
    finally{clearTimeout(timeout);if(alive()&&token===epoch)el('members-list-panel').setAttribute('aria-busy','false');}
  }
  function select(next,updateUrl=true){
    if(!alive())return;cancel();window.MemberExperienceRanking?.cancel();tab=next;
    el('members-list-panel').hidden=tab!=='members';el('members-ranking-panel').hidden=tab!=='ranking';
    root.querySelectorAll('[data-members-tab]').forEach(button=>{const selected=button.dataset.membersTab===tab;button.setAttribute('aria-current',selected?'page':'false');button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected)button.scrollIntoView?.({block:'nearest',inline:'nearest'});});
    if(updateUrl){const params=new URLSearchParams(window.location.search);if(tab==='ranking')params.set('tab','ranking');else params.delete('tab');window.history.replaceState(null,'',`${window.location.pathname}${params.size?'?'+params:''}${window.location.hash}`);}
    if(tab==='ranking')window.MemberExperienceRanking.show(el('members-ranking-panel'));else void loadMembers();
  }
  root.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.membersTab)select(button.dataset.membersTab);else if(button.id==='members-refresh'){if(tab==='ranking')window.MemberExperienceRanking.refresh();else void loadMembers();}});
  root.querySelector('.members-tabs').addEventListener('keydown',event=>{const buttons=[...root.querySelectorAll('[data-members-tab]')];const index=buttons.indexOf(event.target);if(index<0)return;const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowRight'?(index+1)%buttons.length:event.key==='ArrowLeft'?(index+buttons.length-1)%buttons.length:-1;if(next<0)return;event.preventDefault();select(buttons[next].dataset.membersTab);buttons[next].focus();});
  el('member-search').addEventListener('submit',event=>{event.preventDefault();void loadMembers();});el('member-status').addEventListener('change',()=>void loadMembers());
  function schedule(event){cancel();if(tab!=='members')return;pending();if(!event.isComposing)searchTimer=setTimeout(()=>void loadMembers(),250);}
  el('member-keyword').addEventListener('input',schedule);el('member-keyword').addEventListener('compositionend',schedule);
  function dispose(){if(disposed)return;clearPrivate();disposed=true;document.removeEventListener('admin:before-route-change',dispose);unsubscribe?.();}
  document.addEventListener('admin:before-route-change',dispose);window.MemberManagementWorkspace={dispose};
  unsubscribe=AdminAuth.subscribe(state=>{if(state.status!=='authenticated'&&alive())clearPrivate();});
  void AdminAuth.start(root).then(profile=>{if(profile&&alive())select(tab,false);});
})();
