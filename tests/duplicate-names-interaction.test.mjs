import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
import test from 'node:test'

const source=await readFile(new URL('../src/main/resources/static/duplicate-names.js',import.meta.url),'utf8')
const settle=()=>new Promise(resolve=>setImmediate(resolve))
function harness({holdFacilities=false,failWorkWrite=false,failReload=false,maps,pagedGroups=null,facilitiesByName={},groupResponse={totalElements:1,items:[{name:'시험 시설',total:2,hidden:0}]},facilities=[{id:1,name:'시험 시설',visibilityStatus:'VISIBLE',version:0,latitude:null,longitude:null}]}={}) {
  const nodes=new Map(), calls=[], pending=[],writes=[]
  const preferences=new Map()
  let renderedGroups=[]
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,innerHTML:'',textContent:'',disabled:false,dataset:{},isConnected:true,children:[],attrs:{},scrollTop:0,classList:{add(){},remove(){}},setAttribute(k,v){this.attrs[k]=v},append(child){this.children.push(child)},replaceChildren(){this.children=[]},getBoundingClientRect(){return {top:0}}})
    return nodes.get(id)
  }
  node('dn-filter').value='false'
  node('dn-facilities').innerHTML='GROUP_EMPTY'
  node('dn-detail').innerHTML='DETAIL_EMPTY'
  const group=node('group-0');group.dataset.index='0'
  const work=node('work-0');work.dataset.workHide='0'
  const detail=node('facility');detail.dataset.detail='1'
  const buttons=type=>renderedGroups.map((g,index)=>{const b=node(type+'-'+index);b.dataset[type==='group'?'index':'workHide']=String(index);return b})
  const pageButtons=()=>[...node('dn-pagination').innerHTML.matchAll(/<button[^>]*data-page="(-?\d+)"([^>]*)>/g)].map(([,target,attributes],index)=>{const b=node('page-'+index);b.dataset.page=target;b.disabled=attributes.includes('disabled');return b})
  runInNewContext(source,{
    document:{getElementById:node,createElement:()=>node('created-'+nodes.size),querySelector:()=>detail,querySelectorAll:selector=>selector==='.dn-group'?buttons('group'):selector==='[data-detail]'?[detail]:selector==='[data-work-hide]'?buttons('work'):selector==='.dn-page-button'?pageButtons():[]},
    window:{kakao:maps?{maps}:undefined},
    location:{hostname:'example.test',port:'',search:''},URLSearchParams,Set,setTimeout,clearTimeout,
    fetch:async(path,options)=>{
      calls.push(path)
      if(path.endsWith('/work-visibility')){
        writes.push(JSON.parse(options.body));if(failWorkWrite)return {ok:false,json:async()=>({message:'시험 저장 실패'})}
        const write=writes.at(-1),version=(preferences.get(write.name)?.workVersion||0)+1
        preferences.set(write.name,{workHidden:write.hidden,workVersion:version});return {ok:true,json:async()=>({hidden:write.hidden,version})}
      }
      if(path.endsWith('/auth/me'))return {ok:true,json:async()=>({roles:['ADMIN']})}
      if(path.includes('/facilities?')){
        const requestedName=new URLSearchParams(path.split('?')[1]).get('name'),items=facilitiesByName[requestedName]||facilities
        if(holdFacilities) return new Promise(resolve=>pending.push(()=>resolve({ok:true,json:async()=>items})))
        return {ok:true,json:async()=>items}
      }
      if(path.endsWith('/history'))return {ok:true,json:async()=>[]}
      if(failReload&&writes.length)return {ok:false,json:async()=>({message:'목록 새로고침 실패'})}
      const query=new URLSearchParams(path.split('?')[1]),scope=query.get('workVisibility')||'VISIBLE'
      const items=(pagedGroups||groupResponse.items).map(g=>({workHidden:false,workVersion:0,...g,...preferences.get(g.name)})).filter(g=>scope==='ALL'||(scope==='HIDDEN'?g.workHidden:!g.workHidden))
      renderedGroups=pagedGroups?items.slice(Number(query.get('page')||0)*20,Number(query.get('page')||0)*20+20):items
      return {ok:true,json:async()=>({totalElements:pagedGroups?items.length:items.length?groupResponse.totalElements:0,items:renderedGroups})}
    }
  })
  return {node,group,detail,work,writes,calls,pending,goPage:target=>pageButtons().find(b=>b.dataset.page===String(target)&&!b.disabled).onclick()}
}

test('work hide saves only preference, hides row, and can be switched off from hidden view',async()=>{
  const h=harness();await settle();h.group.onclick();await settle();h.work.onclick();h.work.onclick();await settle()
  assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0],{name:'시험 시설',hidden:true,expectedVersion:0})
  assert.match(h.node('dn-groups').innerHTML,/조건에 맞는 중복 그룹이 없습니다/)
  assert.equal(h.node('dn-selection').hidden,true)
  h.node('dn-work-filter').onclick();await settle()
  assert.equal(h.node('dn-work-filter').attrs['aria-pressed'],'true')
  assert.match(h.calls.at(-1),/workVisibility=ALL/)
  assert.match(h.node('dn-groups').innerHTML,/aria-checked="true"/)
  h.work.onclick();await settle();assert.deepEqual(h.writes[1],{name:'시험 시설',hidden:false,expectedVersion:1})
  assert.match(h.node('dn-groups').innerHTML,/aria-checked="false"/)
  h.node('dn-work-filter').onclick();await settle()
  assert.equal(h.node('dn-work-filter').attrs['aria-pressed'],'false')
  assert.match(h.calls.at(-1),/workVisibility=VISIBLE/)
  assert.match(h.node('dn-groups').innerHTML,/aria-checked="false"/)
  assert.equal(h.calls.some(p=>p.endsWith('/hide')||p.endsWith('/restore')),false)
})
test('failed preference write keeps the row and enables retry',async()=>{
  const h=harness({failWorkWrite:true});await settle();h.work.onclick();await settle()
  assert.match(h.node('dn-groups').innerHTML,/aria-checked="false"/)
  assert.match(h.node('dn-status').textContent,/작업 숨김을 저장하지 못했습니다/)
  assert.equal(h.work.disabled,false)
})

test('work visibility controls use icon and switch only while keeping accessible state',async()=>{
  const h=harness();await settle()
  assert.doesNotMatch(h.node('dn-groups').innerHTML,/>HIDE<|>ON<|>OFF</)
  assert.match(h.node('dn-groups').innerHTML,/role="switch" aria-checked="false" aria-label="시험 시설 작업 숨김"/)
  const html=await readFile(new URL('../src/main/resources/static/duplicate-names.html',import.meta.url),'utf8')
  assert.doesNotMatch(html,/class="dn-work-filter"|HIDE는 내 작업 목록/)
  assert.match(html,/class="dn-group-tools".*id="dn-work-filter".*aria-label="작업 숨김 포함 보기"/)
})

test('top comparison changes request server-side filtered totals and coordinate-style pagination',async()=>{
  const h=harness({groupResponse:{totalElements:120,items:[{name:'시험 시설',total:2,hidden:0}]}});await settle()
  for(const label of ['맨앞','이전','다음','맨뒤'])assert.ok(h.node('dn-pagination').innerHTML.includes(`aria-label="${label}"`))
  assert.match(h.node('dn-pagination').innerHTML,/quality-page-number.*aria-current="page"/)
  assert.equal((h.node('dn-pagination').innerHTML.match(/class="dn-page-button quality-page-number"/g)||[]).length,5)
  h.node('dn-match').value='DISTRICT';h.node('dn-match').onchange();await settle()
  assert.match(h.calls.at(-1),/match=DISTRICT&page=0&size=20/)
  assert.equal(h.node('dn-selection').hidden,true)
})

function mapFixture(){
  const overlays=[],views=[]
  const maps={LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng}},LatLngBounds:class{extend(){}},
    Map:class{constructor(){views.push(this)}relayout(){}setBounds(){this.fit=true}setCenter(){}setLevel(){}},
    CustomOverlay:class{constructor(options){Object.assign(this,options);overlays.push(this)}setMap(map){this.map=map}}}
  return {maps,overlays,views}
}
test('overview numbers agree with full group ordinals, combine identical coordinates and exclude unknown/hidden rows',async()=>{
  const m=mapFixture(),facilities=[
    {id:1,latitude:37,longitude:127}, {id:2,latitude:37,longitude:127,visibilityStatus:'HIDDEN_DUPLICATE'},
    {id:3,latitude:37,longitude:127}, {id:4,latitude:38,longitude:128},
    {id:5,latitude:null,longitude:null}, {id:6,latitude:0,longitude:0},
  ].map(f=>({name:'시험 시설',visibilityStatus:'VISIBLE',version:0,...f}))
  const h=harness({facilities,maps:m.maps});await settle();h.group.onclick();await settle()
  assert.match(h.node('dn-detail').innerHTML,/현재 목록 5개 · 지도 표시 3개/)
  assert.match(h.node('dn-detail').innerHTML,/좌표 미확인 2개 · 순번 5, 6/)
  assert.equal(m.overlays.length,2);assert.deepEqual(m.overlays[0].content.children.map(b=>b.textContent),['1','3'])
  assert.deepEqual(m.overlays[1].content.children.map(b=>b.textContent),['4']);assert.equal(m.views[0].fit,true)
  m.overlays[0].content.children[1].onclick();assert.match(h.node('dn-map-picked').innerHTML,/3번 · 시험 시설/)
  assert.equal(h.node('dn-group-map').attrs['aria-pressed'],'true');assert.equal(h.calls.some(p=>p.endsWith('/history')),false)
  h.node('dn-clear-detail').onclick();assert.ok(m.overlays.every(o=>o.map===null));assert.equal(h.node('dn-detail').innerHTML,'DETAIL_EMPTY')
  assert.equal(h.calls.some(p=>p.endsWith('/hide')||p.endsWith('/restore')),false)
})
test('closing immediately after selection does not paint a stale overview',async()=>{
  const m=mapFixture(),h=harness({maps:m.maps,facilities:[{id:1,name:'시험 시설',visibilityStatus:'VISIBLE',latitude:37,longitude:127}]})
  await settle();h.group.onclick();h.node('dn-clear-group').onclick();await settle()
  assert.equal(m.overlays.length,0);assert.equal(h.node('dn-detail').innerHTML,'DETAIL_EMPTY')
})
test('overview with no valid coordinates keeps the list and does not load the SDK',async()=>{
  const h=harness();await settle();h.group.onclick();await settle()
  assert.match(h.node('dn-detail').innerHTML,/표시할 유효한 좌표가 없습니다/)
  assert.equal(h.calls.some(p=>p.includes('map-config')),false)
})

test('member filters partition exact coordinates and canonical district codes and clear selections',async()=>{
  const facilities=[
    {id:1,latitude:37.1,longitude:127.1,sigunguCode:'11140',regionName:'서울특별시 중구'},
    {id:2,latitude:37.1,longitude:127.1,sigunguCode:'11140',regionName:'서울특별시 중구'},
    {id:3,latitude:35.1,longitude:129.1,sigunguCode:'26110',regionName:'부산광역시 중구'},
    {id:4,latitude:35.1,longitude:129.1,sigunguCode:'26110',regionName:'부산광역시 중구'},
    {id:5,latitude:null,longitude:null},
  ].map(f=>({...f,name:'시험 시설',visibilityStatus:'VISIBLE',version:0}))
  const h=harness({facilities});await settle();h.group.onclick();await settle()
  h.node('dn-member-match').value='DISTRICT';h.node('dn-member-match').onchange()
  assert.equal(h.node('dn-member-scope').hidden,false)
  assert.match(h.node('dn-member-scope').innerHTML,/서울특별시 중구 · 2개/)
  assert.match(h.node('dn-member-scope').innerHTML,/부산광역시 중구 · 2개/)
  assert.match(h.node('dn-facilities').innerHTML,/data-detail="1"/)
  assert.doesNotMatch(h.node('dn-facilities').innerHTML,/data-detail="[345]"/)
  h.node('dn-reason').value='previous selection';h.node('dn-member-scope').value='26110';h.node('dn-member-scope').onchange()
  assert.match(h.node('dn-facilities').innerHTML,/data-detail="3"/)
  assert.doesNotMatch(h.node('dn-facilities').innerHTML,/data-detail="[125]"/)
  assert.equal(h.node('dn-reason').value,'');assert.equal(h.node('dn-hide').disabled,true)
  h.node('dn-member-match').value='COORDINATES';h.node('dn-member-match').onchange()
  assert.match(h.node('dn-member-scope').innerHTML,/37.1000000, 127.1000000 · 2개/)
  assert.doesNotMatch(h.node('dn-facilities').innerHTML,/data-detail="[345]"/)
})
test('opening the page does not auto-select a group or request a facility map',async()=>{
  const h=harness();await settle()
  assert.equal(h.calls.some(x=>x.includes('/facilities?')),false)
  assert.equal(h.node('dn-detail').innerHTML,'DETAIL_EMPTY')
  assert.equal(h.node('dn-selection').hidden,true)
})
test('explicit group then facility selection shows detail; close clears it without writes',async()=>{
  const h=harness();await settle();h.group.onclick();await settle()
  assert.equal(h.node('dn-selection').hidden,false)
  assert.match(h.node('dn-detail').innerHTML,/표시할 유효한 좌표가 없습니다/)
  h.detail.onclick();await settle()
  assert.match(h.node('dn-detail').innerHTML,/등록된 좌표가 없어/)
  assert.equal(h.node('dn-detail-head').hidden,false)
  h.node('dn-clear-detail').onclick()
  assert.equal(h.node('dn-detail').innerHTML,'DETAIL_EMPTY')
  h.node('dn-clear-group').onclick()
  assert.equal(h.node('dn-facilities').innerHTML,'GROUP_EMPTY')
  assert.equal(h.node('dn-hide').disabled,true)
  assert.equal(h.calls.some(x=>x.endsWith('/hide')||x.endsWith('/restore')),false)
})
test('closing a group invalidates a late facility response',async()=>{
  const h=harness({holdFacilities:true});await settle();h.group.onclick();await settle()
  h.node('dn-clear-group').onclick();h.pending[0]();await settle()
  assert.equal(h.node('dn-facilities').innerHTML,'GROUP_EMPTY')
  assert.equal(h.node('dn-selection').hidden,true)
  assert.equal(h.node('dn-detail').innerHTML,'DETAIL_EMPTY')
})

const groupList=count=>Array.from({length:count},(_,i)=>({name:`시설 ${i+1}`,total:2,hidden:0}))
const assertOverview=(h,name)=>{
  assert.match(h.node('dn-group-name').textContent,new RegExp(`^${name} ·`))
  assert.equal(h.node('dn-group-map').attrs['aria-pressed'],'true')
  assert.match(h.node('dn-detail').innerHTML,/dn-map-summary/)
}

test('hide selects the next group and opens its overview without facility visibility writes',async()=>{
  const h=harness({pagedGroups:groupList(3)});await settle()
  h.group.onclick();await settle();h.work.onclick();await settle()
  assertOverview(h,'시설 2');assert.equal(h.node('group-0').attrs['aria-pressed'],'true')
  assert.equal(h.writes.length,1);assert.equal(h.calls.some(p=>p.endsWith('/hide')||p.endsWith('/restore')),false)
})

test('include-hidden view skips hidden groups while keeping their rows',async()=>{
  const items=groupList(4);items[1].workHidden=true
  const h=harness({pagedGroups:items});await settle();h.node('dn-work-filter').onclick();await settle()
  h.group.onclick();await settle();h.work.onclick();await settle()
  assertOverview(h,'시설 3');assert.match(h.node('dn-groups').innerHTML,/시설 1/)
  assert.equal(h.node('group-2').attrs['aria-pressed'],'true')
})

test('last visible row advances to the row refilled from the following page',async()=>{
  const h=harness({pagedGroups:groupList(21)});await settle()
  h.node('group-19').onclick();await settle();h.node('work-19').onclick();await settle()
  assertOverview(h,'시설 21');assert.equal(h.node('dn-total').textContent,'20개')
})

test('last row advances across pages when hidden rows remain visible',async()=>{
  const h=harness({pagedGroups:groupList(21)});await settle();h.node('dn-work-filter').onclick();await settle()
  h.node('work-19').onclick();await settle()
  assertOverview(h,'시설 21');assert.match(h.node('dn-pagination').innerHTML,/data-page="1" disabled aria-current="page"/)
})

test('hiding the final row of the final page falls back to the preceding group',async()=>{
  const h=harness({pagedGroups:groupList(21)});await settle();h.goPage(1);await settle()
  h.work.onclick();await settle();assertOverview(h,'시설 20')
  assert.equal(h.node('dn-pagination').innerHTML,'')
})

test('include-hidden last page falls back to an earlier page when no eligible row remains',async()=>{
  const h=harness({pagedGroups:groupList(21)});await settle();h.node('dn-work-filter').onclick();await settle()
  h.goPage(1);await settle();h.work.onclick();await settle()
  assertOverview(h,'시설 20')
})

test('name-scoped hide skips every coordinate bucket belonging to that name',async()=>{
  const h=harness({pagedGroups:[{name:'공원',latitude:37,longitude:127,total:2,hidden:0},{name:'공원',latitude:38,longitude:128,total:2,hidden:0},...groupList(1)]})
  await settle();h.work.onclick();await settle();assertOverview(h,'시설 1')
  assert.doesNotMatch(h.node('dn-groups').innerHTML,/공원/)
})

test('failed hide preserves the current overview and does not advance',async()=>{
  const h=harness({pagedGroups:groupList(2),failWorkWrite:true});await settle();h.group.onclick();await settle()
  h.work.onclick();await settle();assertOverview(h,'시설 1')
  assert.equal(h.calls.filter(p=>p.includes('/facilities?')).length,1)
})

test('reload failure after successful hide is not overwritten by a success message',async()=>{
  const h=harness({pagedGroups:groupList(2),failReload:true});await settle();h.work.onclick();await settle()
  assert.equal(h.node('dn-status').textContent,'목록 새로고침 실패')
  assert.equal(h.node('dn-detail').innerHTML,'DETAIL_EMPTY');assert.equal(h.work.disabled,false)
})

test('refresh retains overview or explicit individual detail mode',async()=>{
  const h=harness();await settle();h.group.onclick();await settle()
  h.node('dn-refresh').onclick();await settle();assertOverview(h,'시험 시설')
  h.detail.onclick();await settle();h.node('dn-refresh').onclick();await settle()
  assert.equal(h.node('dn-group-map').attrs['aria-pressed'],'false')
  assert.match(h.node('dn-detail').innerHTML,/등록된 좌표가 없어/)
})

test('rapid group selection ignores the earlier response and preserves the latest overview',async()=>{
  const h=harness({pagedGroups:groupList(2),holdFacilities:true});await settle()
  h.group.onclick();h.node('group-1').onclick();await settle()
  h.pending[1]();await settle();assertOverview(h,'시설 2')
  h.pending[0]();await settle();assertOverview(h,'시설 2')
})

test('auto-advance removes old map overlays and fits the next group markers',async()=>{
  const m=mapFixture(),h=harness({pagedGroups:groupList(2),maps:m.maps,facilitiesByName:{
    '시설 1':[{id:1,name:'첫 시설',visibilityStatus:'VISIBLE',latitude:37,longitude:127}],
    '시설 2':[{id:2,name:'다음 시설',visibilityStatus:'VISIBLE',latitude:36,longitude:128},{id:3,name:'다음 시설',visibilityStatus:'VISIBLE',latitude:35,longitude:129}],
  }})
  await settle();h.group.onclick();await settle();h.work.onclick();await settle()
  assertOverview(h,'시설 2');assert.equal(m.overlays.length,3)
  assert.equal(m.overlays[0].map,null);assert.equal(m.views[1].fit,true)
  assert.deepEqual(m.overlays.slice(1).map(o=>o.content.children[0].textContent),['1','2'])
  assert.equal(h.node('dn-search').disabled,false)
})
