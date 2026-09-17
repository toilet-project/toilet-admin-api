(() => {
  const $=id=>document.getElementById(id)
  const localPreview=location.hostname==='127.0.0.1' && location.port==='8796'
  const previewRoot=location.hostname==='preview.geupddong.com'&&location.pathname.startsWith('/admin-duplicates/')?'/admin-duplicates':''
  const isolatedPreview=localPreview||!!previewRoot
  const base=previewRoot||(localPreview?'':'https://api.geupddong.com')
  const endpoint='/api/admin/v1/duplicate-names'
  $('dn-search').value=new URLSearchParams(location.search).get('keyword')||''
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  let page=0,total=0,name='',rows=[],detailId=null,representative=null,selected=new Set(),sequence=0,detailSequence=0,saving=false,timer
  let activeGroup=null,groupItems=[],groupMapMode=false,mapGeneration=0,mapCleanup=()=>{}
  const ordinal=f=>rows.findIndex(r=>r.id===f.id)+1
  function releaseMap(){++mapGeneration;mapCleanup();mapCleanup=()=>{}}
  const match=()=>$('dn-match').value||'ALL'
  const coordinateKey=f=>f.latitude!=null&&f.longitude!=null&&Number.isFinite(Number(f.latitude))&&Number.isFinite(Number(f.longitude))&&Math.abs(Number(f.latitude))<=90&&Math.abs(Number(f.longitude))<=180&&(Number(f.latitude)!==0||Number(f.longitude)!==0)?`${Number(f.latitude).toFixed(7)}, ${Number(f.longitude).toFixed(7)}`:null
  const regionKey=f=>/^\d{5}$/.test(f.sigunguCode||'')?f.sigunguCode:null
  const bucketKey=(f,mode)=>mode==='COORDINATES'?coordinateKey(f):mode==='DISTRICT'?regionKey(f):null
  const groupKey=g=>JSON.stringify([g.name,g.latitude??null,g.longitude??null,g.sigunguCode??null])
  async function request(path,options={}){
    const r=await fetch(base+path,{credentials:isolatedPreview?'omit':'include',...options});const data=await r.json().catch(()=>null)
    if(!r.ok)throw new Error(data?.message||data?.error?.message||`요청 실패 (${r.status})`)
    return data
  }
  const post=(path,data)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  let mapsReady
  async function loadMaps(){
      mapsReady ||= (async()=>{
        if(window.kakao?.maps?.LatLng)return window.kakao.maps
        const response=await fetch(previewRoot+'/api/admin/v1/map-config',{credentials:isolatedPreview?'omit':'same-origin'}), config=await response.json()
        if(!response.ok||!config.enabled||!config.javascriptKey)throw Error(localPreview?'상단 프리뷰 카카오 지도 설정에서 연결해 주세요.':'지도 설정을 불러오지 못했습니다.')
        await new Promise((resolve,reject)=>{const script=document.createElement('script');const timeout=setTimeout(()=>{script.remove();reject(Error('카카오 지도 연결 시간이 초과되었습니다.'))},10000);script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.javascriptKey)}&autoload=false`;script.onload=()=>{clearTimeout(timeout);resolve()};script.onerror=()=>{clearTimeout(timeout);script.remove();reject(Error('카카오 지도 연결을 확인해 주세요. 현재 웹 주소의 SDK 도메인 등록이 필요할 수 있습니다.'))};document.head.append(script)})
        if(!window.kakao?.maps?.load)throw Error('현재 웹 주소에서 카카오 지도를 사용할 수 없습니다. SDK 도메인 등록을 확인해 주세요.')
        await new Promise(resolve=>window.kakao.maps.load(resolve));return window.kakao.maps
      })()
      try{return await mapsReady}catch(e){mapsReady=null;throw e}
  }
  async function facilityMap(lat,lng,id){
    const target=$('dn-map'),generation=mapGeneration;if(!target)return
    try {
      const maps=await loadMaps();if(generation!==mapGeneration||id!==detailId||!target.isConnected)return
      target.replaceChildren()
      const position=new maps.LatLng(lat,lng);const map=new maps.Map(target,{center:position,level:3});new maps.Marker({map,position})
    }catch(e){if(generation===mapGeneration&&id===detailId&&target.isConnected)target.innerHTML=`<p>${esc(e.message)} 아래 좌표와 시설 정보는 계속 확인할 수 있습니다.</p>`}
  }
  const message=text=>$('dn-status').textContent=text
  const groupEmpty=$('dn-facilities').innerHTML, detailEmpty=$('dn-detail').innerHTML
  function clearDetail(){releaseMap();groupMapMode=false;detailId=null;$('dn-group-map').setAttribute('aria-pressed','false');$('dn-detail-head').hidden=true;$('dn-detail').classList.remove('dn-overview');$('dn-detail').classList.add('dn-unselected');$('dn-detail').innerHTML=detailEmpty}
  function clearGroup(){
    ++detailSequence;name='';activeGroup=null;rows=[];representative=null;selected.clear();$('dn-reason').value=''
    $('dn-group-head').hidden=true;$('dn-selection').hidden=true;$('dn-facilities').classList.add('dn-unselected');$('dn-facilities').innerHTML=groupEmpty
    document.querySelectorAll('.dn-group').forEach(b=>b.setAttribute('aria-pressed','false'));clearDetail();controls()
  }
  function controls(){ $('dn-selection-text').textContent=`대표 ${representative?'#'+representative:'미선택'} · 숨김 ${selected.size}개`; $('dn-hide').disabled=saving||!representative||!selected.size||!$('dn-reason').value.trim();for(const id of ['dn-match','dn-member-match','dn-member-scope','dn-filter','dn-search','dn-work-filter'])$(id).disabled=saving;document.querySelectorAll('[data-work-hide]').forEach(b=>b.disabled=saving) }
  function pagination(){
    const pages=Math.ceil(total/20),current=Math.min(page,Math.max(0,pages-1)),count=Math.min(5,pages),start=Math.min(Math.max(current-Math.floor(count/2),0),pages-count)
    if(pages<=1){$('dn-pagination').innerHTML='';return}
    const icons={first:'m11 7-5 5 5 5M18 7l-5 5 5 5',previous:'m15 7-5 5 5 5',next:'m9 7 5 5-5 5',last:'m6 7 5 5-5 5M13 7l5 5-5 5'}
    const button=(label,target,disabled,icon)=>`<button type="button" class="dn-page-button ${icon?'quality-page-move':'quality-page-number'}" data-page="${target}" ${disabled?'disabled':''} ${!icon&&target===current?'aria-current="page"':''} aria-label="${icon?label:label+'페이지'}">${icon?`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[icon]}"/></svg>`:label}</button>`
    $('dn-pagination').innerHTML=button('맨앞',0,current===0,'first')+button('이전',current-1,current===0,'previous')+Array.from({length:count},(_,i)=>button(String(start+i+1),start+i,start+i===current)).join('')+button('다음',current+1,current===pages-1,'next')+button('맨뒤',pages-1,current===pages-1,'last')
    document.querySelectorAll('.dn-page-button').forEach(b=>b.onclick=()=>{if(saving||b.disabled)return;page=Number(b.dataset.page);void groups()})
  }
  async function groups(keep=false,advance=null){
    if(saving&&!keep)return
    const token=++sequence
    if(!keep)clearGroup()
    try{
      const data=await request(`${endpoint}?keyword=${encodeURIComponent($('dn-search').value.trim())}&includeHidden=${$('dn-filter').value}&workVisibility=${$('dn-work-filter').value||'VISIBLE'}&match=${match()}&page=${page}&size=20`)
      if(token!==sequence)return false
      total=data.totalElements;groupItems=data.items;if(page>0&&page>=Math.ceil(total/20)){page=Math.max(0,Math.ceil(total/20)-1);return groups(keep,advance)}
      $('dn-total').textContent=total.toLocaleString('ko-KR')+'개';pagination()
      $('dn-groups').innerHTML=groupItems.map((g,index)=>`<div class="dn-group-row ${g.workHidden?'is-work-hidden':''}"><button type="button" class="dn-group quality-list-item" data-index="${index}" aria-pressed="${!!activeGroup&&groupKey(activeGroup)===groupKey(g)}"><span class="quality-count">${g.total}</span><span class="quality-main"><strong>${esc(g.name)}</strong>${match()!=='ALL'?`<small>${esc(match()==='DISTRICT'?g.regionName:coordinateKey(g))}</small>`:''}<small>표시 ${g.total-g.hidden} · 시설 숨김 ${g.hidden}</small></span></button><button type="button" class="dn-work-toggle" role="switch" aria-checked="${!!g.workHidden}" aria-label="${esc(g.name)} 작업 숨김" data-work-hide="${index}" title="${g.workHidden?'작업 숨김 해제':'내 작업 목록에서 숨기기'}"><i aria-hidden="true"></i></button></div>`).join('')||`<p class="dn-empty">${$('dn-work-filter').value==='HIDDEN'?'작업에서 숨긴 그룹이 없습니다.':'조건에 맞는 중복 그룹이 없습니다.'}</p>`
      document.querySelectorAll('.dn-group').forEach(b=>b.onclick=()=>{if(!saving)void facilities(groupItems[Number(b.dataset.index)])})
      document.querySelectorAll('[data-work-hide]').forEach(b=>b.onclick=()=>void toggleWorkVisibility(groupItems[Number(b.dataset.workHide)]))
      message(`${match()==='ALL'?'중복 이름':match()==='COORDINATES'?'같은 이름·좌표':'같은 이름·지역구'} 그룹 ${total.toLocaleString('ko-KR')}건 · ${match()==='DISTRICT'?'확인된 시·군·구 코드 기준입니다.':'같은 이름만으로 동일 시설을 판단하지 마세요.'}`)
      if(advance){
        // Work hiding is name-scoped, including coordinate/district buckets with that name.
        const eligible=g=>g.name!==advance.name&&!g.workHidden
        const previous=groupItems.filter(eligible).at(-1)
        if(advance.returning){
          const target=groupItems.find(g=>eligible(g)&&groupKey(g)===advance.fallback.key)||previous
          if(target)return facilities(target)
          if(page>0){page--;return groups(true,advance)}
          clearGroup();return true
        }
        const target=page>advance.page?groupItems.find(eligible):page===advance.page?
          groupItems.find(g=>eligible(g)&&advance.nextKeys.includes(groupKey(g)))||
          ($('dn-work-filter').value!=='ALL'?groupItems.slice(advance.position).find(eligible):null):null
        if(target)return facilities(target)
        const fallback=previous?{page,key:groupKey(previous)}:advance.fallback
        if(page+1<Math.ceil(total/20)){page++;return groups(true,{...advance,fallback})}
        if(fallback){page=fallback.page;return groups(true,{...advance,fallback,returning:true})}
        if(page>0){page--;return groups(true,{...advance,fallback:{key:null},returning:true})}
        clearGroup()
      }
      else if(keep&&activeGroup)return facilities(activeGroup,true)
      else clearGroup()
      return true
    }catch(e){message(e.message);return false}
  }
  async function toggleWorkVisibility(group){
    if(saving||!group)return
    saving=true;++sequence;controls();const hidden=!group.workHidden
    const index=groupItems.findIndex(g=>groupKey(g)===groupKey(group))
    const advance=hidden?{name:group.name,page,position:groupItems.slice(0,index).filter(g=>g.name!==group.name).length,nextKeys:groupItems.slice(index+1).map(groupKey)}:null
    try{
      await post(endpoint+'/work-visibility',{name:group.name,hidden,expectedVersion:group.workVersion||0})
      clearGroup();const loaded=await groups(true,advance)
      if(loaded)message(hidden?`${group.name} · 작업에서 숨겼습니다. 제목 오른쪽 눈 아이콘으로 다시 볼 수 있어요.`:`${group.name} · 작업 숨김을 해제했습니다.`)
    }catch(e){message(`작업 숨김을 저장하지 못했습니다. ${e.message}`)}finally{saving=false;controls()}
  }
  async function facilities(value,keep=false){
    const previousDetail=keep?detailId:null
    const showOverview=!keep||groupMapMode
    const previousMode=keep?$('dn-member-match').value:match(),previousScope=keep?$('dn-member-scope').value:bucketKey(value,match())
    clearGroup()
    const token=++detailSequence;activeGroup=value;name=value.name
    document.querySelectorAll('.dn-group').forEach(b=>b.setAttribute('aria-pressed',String(groupKey(groupItems[Number(b.dataset.index)])===groupKey(value))))
    $('dn-facilities').innerHTML='<p class="quality-panel-loading dn-empty">그룹 화장실을 불러오는 중입니다.</p>'
    try{const result=await request(`${endpoint}/facilities?name=${encodeURIComponent(name)}`);if(token!==detailSequence)return false
      rows=result;selected.clear();representative=null;$('dn-reason').value='';$('dn-group-name').textContent=`${name} · ${rows.length}개`
      $('dn-group-head').hidden=false;$('dn-selection').hidden=false;$('dn-facilities').classList.remove('dn-unselected')
      $('dn-member-match').value=previousMode;memberScopes(previousScope)
      const visible=shown();detailId=visible.some(x=>x.id===previousDetail)?previousDetail:null
      // Start the overview immediately without keeping the write lock during SDK loading.
      renderRows();if(showOverview)void groupMap(true);else await detail()
      return true
    }catch(e){if(token!==detailSequence)return false;message(e.message);$('dn-facilities').innerHTML='<div class="quality-empty-panel"><span>불러오기 실패</span><strong>그룹을 다시 선택해 주세요</strong><p>상단 새로고침으로 다시 시도할 수도 있습니다.</p></div>';return false}
  }
  function available(){return rows.filter(r=>$('dn-filter').value==='true'||r.visibilityStatus==='VISIBLE')}
  function memberScopes(preferred){
    const mode=$('dn-member-match').value||'ALL',buckets=new Map()
    for(const row of available()){const key=bucketKey(row,mode);if(key){const b=buckets.get(key)||{count:0,label:mode==='DISTRICT'?row.regionName:key};b.count++;buckets.set(key,b)}}
    const options=[...buckets].filter(([,b])=>b.count>=2)
    $('dn-member-scope').hidden=mode==='ALL'
    $('dn-member-scope').innerHTML=options.map(([key,b])=>`<option value="${esc(key)}">${esc(b.label||key)} · ${b.count}개</option>`).join('')||'<option value="">일치하는 시설 없음</option>'
    $('dn-member-scope').value=options.some(([key])=>key===preferred)?preferred:(options[0]?.[0]||'')
    $('dn-member-hint').textContent=mode==='ALL'?'같은 이름의 시설 전체를 표시합니다.':mode==='DISTRICT'?'확인된 시·군·구가 같은 시설만 표시합니다. 미확인 지역은 제외합니다.':'위도·경도가 모두 같은 시설만 표시합니다. 좌표 없음은 제외합니다.'
  }
  function shown(){const mode=$('dn-member-match').value||'ALL';return available().filter(r=>mode==='ALL'||(!!$('dn-member-scope').value&&bucketKey(r,mode)===$('dn-member-scope').value))}
  function renderRows(){
    $('dn-group-name').textContent=`${name} · ${shown().length}개${shown().length!==rows.length?' / 전체 '+rows.length+'개':''}`
    $('dn-facilities').innerHTML=shown().map(f=>`<div class="dn-facility ${f.id===detailId?'selected':''} ${f.visibilityStatus!=='VISIBLE'?'is-hidden':''}"><button type="button" data-detail="${f.id}" aria-pressed="${f.id===detailId}"><strong>${esc(f.name)}</strong><small>ID ${f.id} · ${f.latitude!=null&&f.longitude!=null?'좌표 있음':'좌표 없음'} ${f.visibilityStatus!=='VISIBLE'?'<span class="dn-tag">숨김</span>':''}</small><small>${esc(f.roadAddress||f.jibunAddress||'주소 정보 없음')}</small></button>${f.visibilityStatus==='VISIBLE'?`<div class="dn-controls"><label><input type="radio" name="dn-representative" value="${f.id}" ${representative===f.id?'checked':''}>대표</label><label><input type="checkbox" data-hide="${f.id}" ${selected.has(f.id)?'checked':''} ${representative===f.id?'disabled':''}>숨김 선택</label></div>`:''}</div>`).join('')||'<p class="dn-empty">표시할 시설이 없습니다.</p>'
    document.querySelectorAll('[data-detail]').forEach(b=>{const f=rows.find(x=>x.id===Number(b.dataset.detail));if(f){b.insertAdjacentHTML?.('afterbegin',`<span class="dn-ordinal" aria-label="순번 ${ordinal(f)}">${ordinal(f)}</span>`);b.insertAdjacentHTML?.('beforeend',`<small class="dn-region-label">${esc(f.regionName||'지역구 미확인')}</small><small>${esc(coordinateKey(f)||'좌표 미확인')}</small>`)}b.onclick=()=>{if(saving)return;detailId=Number(b.dataset.detail);renderRows();void detail()}})
    document.querySelectorAll('input[name="dn-representative"]').forEach(r=>r.onchange=()=>{if(saving)return;representative=Number(r.value);selected.delete(representative);renderRows()})
    document.querySelectorAll('[data-hide]').forEach(c=>c.onchange=()=>{if(saving)return;c.checked?selected.add(Number(c.dataset.hide)):selected.delete(Number(c.dataset.hide));controls()});controls()
  }
  async function detail(){
    releaseMap();groupMapMode=false;$('dn-group-map').setAttribute('aria-pressed','false');$('dn-detail').classList.remove('dn-overview')
    const generation=mapGeneration
    const f=rows.find(r=>r.id===detailId),id=detailId
    if(!f){clearDetail();return}
    $('dn-detail-head').hidden=false;$('dn-detail').classList.remove('dn-unselected')
    $('dn-detail-name').textContent=f.name
    const valid=!!coordinateKey(f)
    const lat=Number(f.latitude),lng=Number(f.longitude)
    const map=valid?'<div id="dn-map" class="dn-detail-map" aria-label="화장실 위치 지도"><p>카카오 지도를 불러오는 중입니다.</p></div>':'<p class="dn-empty">등록된 좌표가 없어 시설 정보를 표시합니다.</p>'
    const hidden=f.visibilityStatus!=='VISIBLE'
    $('dn-detail').innerHTML=`${hidden?`<section class="dn-hidden-context"><strong>중복 숨김 · 대표 #${f.representativeToiletId}</strong><p>${esc(f.hiddenReason)}</p><small>${esc(f.hiddenAt)}</small></section>`:''}${map}<dl class="dn-detail-grid"><dt>시설 ID</dt><dd>${f.id}</dd><dt>관리번호</dt><dd>${esc(f.managementNumber||'미확인')}</dd><dt>도로명주소</dt><dd>${esc(f.roadAddress||'없음')}</dd><dt>지번주소</dt><dd>${esc(f.jibunAddress||'없음')}</dd><dt>위도 · 경도</dt><dd>${valid?`${f.latitude}, ${f.longitude}`:'없음'}</dd><dt>좌표 상태</dt><dd>${esc(f.coordinateSource||'미확인')}</dd><dt>개방시간</dt><dd>${esc(f.openTime||'미확인')}</dd><dt>자료 출처</dt><dd>${esc(f.dataSource||'공개 시설 데이터')}</dd></dl>${hidden?'<button type="button" id="dn-restore">숨김 해제</button>':''}<details class="dn-history"><summary>숨김·해제 처리 이력</summary><div id="dn-history-content">불러오는 중…</div></details>${isolatedPreview&&hidden?'<section class="dn-preview-actions"><strong>시험 데이터 변경 수신</strong><p>실제 공공데이터 변경이 아닙니다. 숨김 근거 연결을 시험합니다.</p><label for="dn-proposed-name">시험용 수신 이름</label><input id="dn-proposed-name" type="text" maxlength="100"><button id="dn-simulate" type="button">변경 검토에 시험 후보 만들기</button></section>':''}`
    if(valid)void facilityMap(lat,lng,id)
    if(previewRoot){
      $('dn-detail').insertAdjacentHTML('beforeend','<section class="dn-preview-actions"><button type="button" id="dn-check-public">사용자 공개 조회 확인</button><p id="dn-public-result" aria-live="polite">이 사본을 사용하는 실제 공개 API로 확인합니다.</p></section>')
      $('dn-check-public').onclick=async()=>{
        const output=$('dn-public-result'),button=$('dn-check-public');button.disabled=true;output.textContent='실제 공개 API를 확인하고 있어요…'
        try{
          const response=await fetch(base+'/api/v1/toilets/'+id,{credentials:'omit'})
          if(![200,404].includes(response.status))throw Error('공개 상세 조회 실패')
          const ids=await request('/api/v1/toilets/sitemap/ids?shard='+Math.floor((id-1)/10000))
          let mapText='좌표 없음'
          if(valid){const result=await request(`/api/v1/toilets?southLat=${lat-.001}&northLat=${lat+.001}&westLng=${lng-.001}&eastLng=${lng+.001}&zoom=3`);if(!result.meta)throw Error('지도 조회 결과를 확인하지 못했습니다.');mapText=(result.toilets||[]).some(x=>x.id===id)?'표시':'제외'}
          output.textContent=`상세 ${response.status===404?'숨김':'표시'} · 지도 ${mapText} · 사이트맵 ${ids.includes(id)?'포함':'제외'}`
        }catch(e){output.textContent=e.message}finally{button.disabled=false}
      }
    }
    if(hidden)$('dn-restore').onclick=async()=>{const reason=prompt('숨김을 해제하는 근거를 입력해 주세요.');if(!reason?.trim()||saving)return;saving=true;try{await post(`${endpoint}/${f.id}/restore`,{expectedVersion:f.version,reason});await groups(true)}catch(e){message(e.message)}finally{saving=false;controls()}}
    if(isolatedPreview&&hidden){$('dn-proposed-name').value=f.name+' (변경 시험)';if(previewRoot){$('dn-simulate').textContent='실제 배치 로직으로 변경 수신 시험';$('dn-simulate').closest('section').querySelector('p').textContent='시험 입력을 실제 upsert 코드로 처리합니다. 공공데이터의 실제 변경 수신은 아닙니다.'}$('dn-simulate').onclick=async()=>{const button=$('dn-simulate');if(button.disabled)return;button.disabled=true;try{const review=await post('/preview/simulate-change',{toiletId:f.id,name:$('dn-proposed-name').value});location.href=previewRoot+'/public-data-changes.html?reviewId='+review.id}catch(e){message(e.message);button.disabled=false}}}
    try{const events=await request(`${endpoint}/${id}/history`);if(detailId!==id||groupMapMode||generation!==mapGeneration)return;$('dn-history-content').innerHTML=events.length?events.map(e=>`<div><strong>${e.action==='HIDE'?'숨김':'숨김 해제'}</strong> · ${esc(e.occurredAt)}<p>${esc(e.reason)}</p><small>당시 시설명 ${esc(e.snapshotName)} · ${esc(e.snapshotRoadAddress||'주소 없음')}</small></div>`).join(''):'처리 이력이 없습니다.'}catch(e){if(detailId===id&&!groupMapMode&&generation===mapGeneration)$('dn-history-content').textContent=e.message}
  }
  async function groupMap(allowSaving=false){
    if((saving&&!allowSaving)||!activeGroup)return
    clearDetail();groupMapMode=true;const generation=mapGeneration
    $('dn-group-map').setAttribute('aria-pressed','true');$('dn-detail-head').hidden=false
    $('dn-detail-name').textContent=name+' · 전체 지도';$('dn-detail').classList.remove('dn-unselected');$('dn-detail').classList.add('dn-overview')
    const visible=shown(),located=visible.filter(f=>coordinateKey(f)),missing=visible.filter(f=>!coordinateKey(f))
    $('dn-detail').innerHTML=`<div class="dn-map-summary"><div><strong>현재 목록 ${visible.length}개 · 지도 표시 ${located.length}개</strong><p>목록과 같은 순번입니다. 필터·숨김 조회 범위를 따릅니다.</p></div><button type="button" id="dn-fit-map" class="dn-map-button" ${located.length?'':'disabled'}>전체 맞춤</button></div><div id="dn-group-map-canvas" class="dn-overview-map" aria-label="그룹 화장실 전체 지도"><p class="dn-empty">${located.length?'카카오 지도를 불러오는 중입니다.':'표시할 유효한 좌표가 없습니다.'}</p></div><p class="dn-map-help">번호를 누르면 목록에서 해당 시설을 확인할 수 있어요. 같은 좌표의 번호는 한곳에 함께 표시합니다. 좌표가 다르다는 이유만으로 서로 다른 시설로 확정하지 않습니다.</p>${missing.length?`<p class="dn-map-missing">좌표 미확인 ${missing.length}개 · 순번 ${missing.map(ordinal).join(', ')} (지도 제외, 목록 유지)</p>`:''}<div id="dn-map-picked" class="dn-map-picked" aria-live="polite">지도에서 번호를 선택해 주세요.</div>`
    renderRows();if(!located.length)return
    const target=$('dn-group-map-canvas'),overlays=[]
    try{
      const maps=await loadMaps();if(generation!==mapGeneration||!groupMapMode||!target.isConnected)return
      target.replaceChildren();const first=located[0],map=new maps.Map(target,{center:new maps.LatLng(first.latitude,first.longitude),level:5})
      if(maps.ZoomControl)map.addControl(new maps.ZoomControl(),maps.ControlPosition.RIGHT)
      const bounds=new maps.LatLngBounds(),buckets=new Map(),markerButtons=[]
      for(const f of located){const key=coordinateKey(f);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(f)}
      for(const bucket of buckets.values()){
        const position=new maps.LatLng(bucket[0].latitude,bucket[0].longitude);bounds.extend(position)
        const content=document.createElement('div');content.className='dn-number-pin';content.setAttribute('aria-label',bucket.length>1?'같은 좌표의 시설':'시설 위치')
        for(const f of bucket){
          const button=document.createElement('button');button.type='button';button.textContent=String(ordinal(f));button.className='dn-marker-number'+(f.visibilityStatus==='VISIBLE'?'':' is-hidden')
          button.setAttribute('aria-label',`${ordinal(f)}번 ${f.name} 위치 선택`);button.setAttribute('aria-pressed','false');markerButtons.push({button,id:f.id})
          button.onclick=()=>{if(saving||generation!==mapGeneration)return;detailId=f.id;renderRows();for(const m of markerButtons)m.button.setAttribute('aria-pressed',String(m.id===f.id))
            const card=document.querySelector(`[data-detail="${f.id}"]`),list=$('dn-facilities');if(card)list.scrollTop+=card.getBoundingClientRect().top-list.getBoundingClientRect().top-8
            $('dn-map-picked').innerHTML=`<div><strong>${ordinal(f)}번 · ${esc(f.name)}</strong><small>${esc(f.regionName||'지역구 미확인')} · ${esc(coordinateKey(f))}</small></div><button id="dn-map-open-detail" class="dn-map-button" type="button">개별 보기</button>`
            $('dn-map-open-detail').onclick=()=>{if(!saving)void detail()}
          };content.append(button)
        }
        overlays.push(new maps.CustomOverlay({map,position,content,clickable:true,yAnchor:1.15,zIndex:2}))
      }
      const fit=()=>{map.relayout();if(buckets.size>1)map.setBounds(bounds,64,90,64,90);else{map.setCenter(new maps.LatLng(first.latitude,first.longitude));map.setLevel(3)}}
      $('dn-fit-map').onclick=fit;fit()
      const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(target.isConnected)map.relayout()}):null;observer?.observe(target)
      mapCleanup=()=>{observer?.disconnect();for(const overlay of overlays)overlay.setMap(null)}
    }catch(e){for(const overlay of overlays)overlay.setMap(null);if(generation===mapGeneration&&target.isConnected){target.innerHTML=`<p class="dn-empty">${esc(e.message)} 전체 지도 버튼으로 다시 시도해 주세요.</p>`;$('dn-fit-map').disabled=true}}
  }
  $('dn-group-map').onclick=()=>void groupMap()
  $('dn-hide').onclick=()=>{$('dn-confirm-message').textContent=`대표 #${representative} 유지 · 숨길 시설 ${Array.from(selected).map(id=>'#'+id).join(', ')}`;$('dn-confirm').showModal()}
  $('dn-confirm').onclose=async()=>{if($('dn-confirm').returnValue!=='confirm'||saving)return;saving=true;controls();try{const ids=[representative,...selected];await post(endpoint+'/hide',{representativeId:representative,toiletIds:Array.from(selected),expectedVersions:Object.fromEntries(rows.filter(f=>ids.includes(f.id)).map(f=>[f.id,f.version])),reason:$('dn-reason').value.trim()});$('dn-filter').value='true';await groups(true)}catch(e){message(e.message)}finally{saving=false;controls()}}
  $('dn-reason').oninput=controls;$('dn-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=0;void groups()},250)};$('dn-filter').onchange=$('dn-match').onchange=()=>{if(saving)return;page=0;void groups()};$('dn-refresh').onclick=()=>{if(!saving)void groups(true)}
  $('dn-work-filter').onclick=()=>{if(saving)return;const button=$('dn-work-filter'),include=button.value!=='ALL';button.value=include?'ALL':'VISIBLE';button.setAttribute('aria-pressed',String(include));button.title=include?'숨긴 그룹 제외':'숨긴 그룹도 표시';page=0;void groups()}
  function resetMemberSelection(){const keepMap=groupMapMode;representative=null;selected.clear();$('dn-reason').value='';clearDetail();renderRows();if(keepMap)void groupMap()}
  $('dn-member-match').onchange=()=>{if(saving)return;memberScopes();resetMemberSelection()}
  $('dn-member-scope').onchange=()=>{if(saving)return;resetMemberSelection()}
  $('dn-clear-group').onclick=()=>{if(!saving)clearGroup()}
  $('dn-clear-detail').onclick=()=>{if(saving)return;clearDetail();renderRows()}
  $('dn-clear-selection').onclick=()=>{if(saving)return;representative=null;selected.clear();renderRows()}
  if(localPreview)$('dn-map-form').onsubmit=async event=>{event.preventDefault();try{await post('/preview/map-config',{javascriptKey:$('dn-map-key').value.trim()});$('dn-map-key').value='';mapsReady=null;$('dn-map-status').textContent='기존 JavaScript 지도 설정을 연결했습니다.';$('dn-map-settings').open=false;if(detailId)await detail()}catch(e){$('dn-map-status').textContent=e.message}}
  async function start(){try{if(isolatedPreview){const meta=await request('/preview/status');$('dn-preview').hidden=false;$('dn-preview').textContent=meta.realApi?`실제 API·배치 코드 + 별도 MySQL · 공개 시설 ${meta.facilityCount.toLocaleString()}개 사본 · 지역 검증 자료 ${meta.regionSourceDate||'미연결'} 기준 · 시험 관리자 · 운영 DB 변경 없음`:`실제 공개 시설 정보 기반 · ${meta.sourceDate} 수집본 · 가상 관리자 / 시험 저장만 가능 · 운영 DB 연결 없음`;$('dn-map-settings').hidden=!localPreview}
    const me=await request('/api/v1/auth/me');if(!me.roles?.includes('ADMIN'))throw new Error('관리자 권한이 필요합니다.');await groups()
  }catch(e){message(e.message)}}
  void start()
})();
