import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createContext, runInContext} from 'node:vm'
import test from 'node:test'

const root = new URL('../src/main/resources/static/', import.meta.url)
const qualitySource = readFileSync(new URL('data-quality.js', root), 'utf8')
const dashboardStyles = readFileSync(new URL('dashboard.css', root), 'utf8')
function fixture(file, fetch, kakao) {
  const nodes = new Map()
  const parse = html => { for (const [,id] of html.matchAll(/\bid="([^"]+)"/g)) if (!nodes.has(id)) nodes.set(id, make(id)) }
  function make(id) {
    return {id,value:'',textContent:'',hidden:false,disabled:false,open:false,children:[],handlers:{},dataset:{},attrs:{},isConnected:true,
      classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this.handlers[k]=fn},
      append(child){this.children.push(child)},replaceChildren(){this.children=[];this.html=''},scrollIntoView(){},
      querySelectorAll(){return []},querySelector(){return make('child')},
      set innerHTML(html){this.html=html;parse(html)},get innerHTML(){return this.html||''}}
  }
  parse(readFileSync(new URL(file+'.html',root),'utf8'))
  const location={href:'https://admin.example/'+file+'.html',search:'',hostname:'admin.example',pathname:'/'+file+'.html'}
  const window={location,history:{replaceState(){}},matchMedia:()=>({matches:false}),setTimeout,clearTimeout,confirm:()=>true,alert(){},kakao}
  const context=createContext({window,location,fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,
    document:{getElementById:id=>nodes.get(id)||null,createElement:()=>make('new'),querySelectorAll:()=>[]}})
  runInContext(readFileSync(new URL(file+'.js',root),'utf8').replace(/(?:void start\(\)|bootstrap\(\))\s*;?\s*$/,''),context)
  return {context,node:id=>nodes.get(id),state:expression=>runInContext(expression,context)}
}
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data})

test('duplicate coordinate editor uses the district review stem markers', () => {
  assert.match(qualitySource, /coordinatePositionMarkerImage\(kakao\.maps, '#157d48'\)/)
  assert.match(qualitySource, /coordinatePositionMarkerImage\(kakao\.maps, '#ee872c'\)/)
  assert.match(qualitySource, /M12 11V36/)
  assert.match(qualitySource, /const marker = new kakao\.maps\.Marker\(\{ position: initial,[\s\S]*'#ee872c'/)
  assert.match(qualitySource, /marker\.setMap\(map\)/)
  assert.doesNotMatch(qualitySource, /quality-map-origin-marker/)
  assert.doesNotMatch(dashboardStyles, /\.quality-map-origin-marker/)
})

test('coordinate search aborts obsolete requests and ignores late authentication errors', async()=>{
  const pending=[]
  const h=fixture('data-quality',(path,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal})))
  const first=h.context.loadGroups()
  const second=h.context.loadGroups()
  assert.equal(pending[0].signal.aborted,true)
  pending[1].resolve(response({items:[],page:0,totalPages:0,totalElements:0}))
  await second
  const status=h.node('quality-status-text').textContent
  pending[0].resolve(response({},401));await first
  assert.equal(h.node('quality-status-text').textContent,status)
  assert.notEqual(h.node('quality-shell').hidden,true)
})

test('Korean composition waits until completion and Enter cancels the pending debounce',async()=>{
  const h=qualityFixture(),timers=new Map();let next=0
  h.context.window.setTimeout=fn=>{timers.set(++next,fn);return next}
  h.context.window.clearTimeout=id=>timers.delete(id)
  h.context.bindQualitySearch()
  const input=h.node('quality-search')
  input.handlers.compositionstart();input.value='대';input.handlers.input({isComposing:true})
  assert.equal(timers.size,0);assert.equal(h.data.calls.length,0)
  input.value='대학';input.handlers.compositionend();input.handlers.input({isComposing:false})
  assert.equal(timers.size,1)
  input.handlers.keydown({key:'Enter',isComposing:false,preventDefault(){}})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(timers.size,0);assert.equal(h.data.calls.length,1)
  assert.match(h.data.calls[0],/keyword=%EB%8C%80%ED%95%99/)
})

test('new input immediately invalidates old results before its debounce fires',async()=>{
  let finish
  const h=fixture('data-quality',()=>new Promise(resolve=>{finish=resolve}))
  h.context.window.setTimeout=()=>1;h.context.window.clearTimeout=()=>{}
  h.context.bindQualitySearch()
  const first=h.context.loadGroups()
  h.node('quality-search').handlers.input({isComposing:false})
  finish(response({items:[],page:0,totalPages:1,totalElements:99}));await first
  assert.notEqual(h.state('totalElements'),99)
})

function qualityFixture() {
  const group={groupKey:'a',latitude:37,longitude:127,toiletCount:3,status:'PENDING',region:'시험 주소',representativeName:'시험 시설'}
  const data={list:[group],count:3,totalPages:2,totalElements:21,fail:false,calls:[]}
  const h=fixture('data-quality',async path=>{
    data.calls.push(path)
    if(path.endsWith('/duplicate-coordinates/a'))return data.fail?response({},500):data.count===0?response({},404):response({group:{...group,toiletCount:data.count},toilets:Array.from({length:data.count},(_,i)=>({id:i+1,name:'시설',latitude:37,longitude:127})),pendingReports:[],revisions:[]})
    const page=Number(new URL(path).searchParams.get('page'))
    return response({items:data.list,page,totalPages:data.totalPages,totalElements:data.totalElements})
  })
  return {...h,data}
}

test('coordinate workspace follows its key after its rank moves off the current page and down to zero',async()=>{
  const h=qualityFixture();await h.context.loadGroups();await h.context.selectGroup('a')
  h.data.list=[];h.data.count=1
  await h.context.refreshWorkingGroup('a')
  assert.equal(h.state('selectedGroupKey'),'a')
  assert.match(h.node('quality-detail').innerHTML,/1개 화장실/)
  h.data.count=0;await h.context.refreshWorkingGroup('a')
  assert.match(h.node('quality-detail').innerHTML,/남은 작업 0개/)
})

test('manual pagination leaves the active detail and coordinate draft in place',async()=>{
  const h=qualityFixture();await h.context.loadGroups();await h.context.selectGroup('a')
  const markup=h.node('quality-detail').innerHTML
  h.state('coordinateDraft = {latitude:36,longitude:128}')
  h.data.list=[];await h.context.loadGroups(1)
  assert.equal(h.node('quality-detail').innerHTML,markup)
  assert.equal(h.state('coordinateDraft.latitude'),36)
})

test('a removed last page is clamped without abandoning the current group',async()=>{
  const h=qualityFixture();await h.context.loadGroups(1);await h.context.selectGroup('a')
  h.data.totalPages=1;h.data.totalElements=1;h.data.count=1
  await h.context.refreshWorkingGroup('a')
  assert.equal(h.state('page'),0);assert.equal(h.state('selectedGroupKey'),'a')
  assert.match(h.node('quality-detail').innerHTML,/1개 화장실/)
})

test('server failure is not mistaken for group completion',async()=>{
  const h=qualityFixture();await h.context.loadGroups();await h.context.selectGroup('a');h.data.fail=true
  await h.context.refreshWorkingGroup('a')
  assert.match(h.node('quality-detail').innerHTML,/상세를 불러오지 못했습니다/)
  assert.doesNotMatch(h.node('quality-detail').innerHTML,/남은 작업 0개/)
})

function regionFixture() {
  const maps=[],lookups=[],writes=[]
  const region={sidoName:'대전광역시',sigunguName:'유성구',sigunguCode:'30200'}
  const detail={toilet:{toiletId:1,name:'시험 시설',status:'NO_COORDINATE',location:{latitude:null,longitude:null,roadAddress:null,jibunAddress:'대전광역시 유성구'}},confirmation:{region,note:'이전 확인',confirmedAt:'2026-09-17T01:00:00Z'}}
  const server={detail,items:[],page:0,totalPages:0,totalElements:0,failWrite:false,onWrite(){},listReply:null}
  class LatLng {constructor(lat,lng){this.lat=lat;this.lng=lng}getLat(){return this.lat}getLng(){return this.lng}}
  const kakao={maps:{LatLng,Map:class{constructor(){this.handlers={};maps.push(this)}setCenter(){}setLevel(){}},
    Marker:class{constructor({position}){this.position=position;this.handlers={}}setPosition(p){this.position=p}getPosition(){return this.position}setMap(){}setZIndex(){}},
    MarkerImage:class{},Size:class{},Point:class{},event:{addListener(target,event,fn){target.handlers[event]=fn}},
    services:{Status:{OK:'OK'},Geocoder:class{coord2Address(lng,lat,fn){lookups.push(fn)}},Places:class{}}}}
  const h=fixture('regions',async (path,options={})=>{
    if(path.endsWith('/map-config'))return response({enabled:true,javascriptKey:'synthetic-only'})
    if(options.method){
      const body=JSON.parse(options.body);writes.push({path,body})
      if(server.failWrite)return response({message:'저장 실패'},500)
      server.onWrite(path,body)
      return response({region,note:body.note,confirmedAt:'2026-09-17T02:00:00Z'})
    }
    if(/\/regions\/\d+$/.test(path))return response(structuredClone({...server.detail,toilet:{...server.detail.toilet,toiletId:Number(path.split('/').pop())}}))
    if(server.listReply)return server.listReply(path)
    return response(structuredClone({items:server.items,page:server.page,totalPages:server.totalPages,totalElements:server.totalElements}))
  },kakao)
  h.node('auth-shell').hidden=true
  return {...h,server,maps,lookups,writes,choose:(lat=37,lng=127)=>maps.at(-1).handlers.click({latLng:new LatLng(lat,lng)})}
}

test('missing-coordinate map selection opens its editor and enables save after address lookup',async()=>{
  const h=regionFixture();await h.context.loadDetail(1);h.choose()
  assert.equal(h.node('region-coordinate-edit').open,true)
  h.lookups[0]([{address:{address_name:'시험 지번'}}],'OK')
  assert.equal(h.node('region-save').disabled,false)
  h.node('region-coordinate-note').value='현장 확인'
  await h.node('region-save').handlers.click()
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].body.latitude,37)
  assert.equal(h.writes[0].body.expectedLocation.latitude,null)
})

test('district confirmation keeps the active panel, map, coordinate draft and note despite list removal',async()=>{
  const h=regionFixture();await h.context.loadDetail(1);h.choose()
  h.lookups[0]([{address:{address_name:'시험 지번'}}],'OK')
  h.node('region-coordinate-note').value='좌표 확인 중'
  h.node('region-note').value='시군구 확인'
  await h.node('region-confirm').handlers.click()
  assert.equal(h.maps.length,1)
  assert.equal(h.state('selected'),1)
  assert.equal(h.node('region-coordinate-note').value,'좌표 확인 중')
  assert.equal(h.node('region-save').disabled,false)
  assert.match(h.node('region-current-status').innerHTML,/좌표 없음/)
  await h.node('region-save').handlers.click()
  assert.equal(h.writes[1].body.latitude,37)
})

test('late reverse lookup does not overwrite a newer selected coordinate',async()=>{
  const h=regionFixture();await h.context.loadDetail(1);h.choose(37,127);h.choose(36,128)
  h.lookups[1]([{address:{address_name:'최신 주소'}}],'OK');h.lookups[0]([{address:{address_name:'이전 주소'}}],'OK')
  assert.match(h.node('region-draft').textContent,/36.0000000.*최신 주소/)
})

const row=(id,status='NO_COORDINATE')=>({toiletId:id,name:`시설 ${id}`,status,location:{latitude:null,longitude:null}})
const rows=h=>h.node('region-list').children.map(node=>node.dataset.id)

test('district save keeps the working row in its original position when the server reorders it',async()=>{
  const h=regionFixture();h.server.items=[row(2),row(1),row(3)];h.server.totalElements=30;h.server.totalPages=2
  await h.context.loadList();await h.context.loadDetail(1)
  h.node('region-list').scrollTop=120
  h.server.onWrite=()=>{h.server.items=[row(2),row(3),row(4)]}
  h.node('region-note').value='시군구 확인';await h.node('region-confirm').handlers.click()
  assert.deepEqual(rows(h),[2,1,3,4])
  assert.equal(h.node('region-list').scrollTop,120)
  assert.match(h.node('region-status').innerHTML,/검토 대상 30건/)
  assert.match(h.node('region-work-progress').innerHTML,/좌표 입력 필요/)
  assert.equal(h.maps.length,1)
})

test('completed row remains separate from the decreased count until another facility is selected',async()=>{
  const h=regionFixture();h.server.detail.toilet.location={latitude:37,longitude:127};h.server.detail.toilet.status='STALE'
  h.server.items=[row(2),row(1,'STALE'),row(3)];h.server.totalElements=3;h.server.totalPages=1
  await h.context.loadList();await h.context.loadDetail(1)
  h.server.onWrite=()=>{h.server.items=[row(2),row(3)];h.server.totalElements=2}
  h.node('region-note').value='현재 위치 확인';await h.node('region-confirm').handlers.click()
  assert.deepEqual(rows(h),[2,1,3])
  assert.match(h.node('region-status').innerHTML,/검토 대상 2건/)
  assert.doesNotMatch(h.node('region-list').children[1].innerHTML,/검토 완료|집계 제외|작업 중|현재 위치 유지/)
  assert.equal(h.node('region-list').children[1].attrs['aria-pressed'],'true')
  assert.match(h.node('region-work-progress').innerHTML,/검토를 완료했습니다/)
  await h.context.loadDetail(3)
  assert.deepEqual(rows(h),[2,3])
})

test('coordinate save keeps a row outside the missing-coordinate filter and asks for fresh district confirmation',async()=>{
  const h=regionFixture();h.state("filterStatus='NO_COORDINATE'")
  h.server.items=[row(1)];h.server.totalElements=1;h.server.totalPages=1
  await h.context.loadList();await h.context.loadDetail(1)
  h.server.onWrite=()=>{
    h.server.detail.toilet={...row(1,'STALE'),location:{latitude:37,longitude:127}}
    h.server.detail.confirmation=null;h.server.items=[];h.server.totalElements=0;h.server.totalPages=0
  }
  h.choose();h.lookups[0]([{address:{address_name:'시험 주소'}}],'OK');h.node('region-coordinate-note').value='좌표 확인'
  await h.node('region-save').handlers.click()
  assert.deepEqual(rows(h),[1])
  assert.match(h.node('region-status').innerHTML,/좌표 없음 0건/)
  assert.doesNotMatch(h.node('region-list').children[0].innerHTML,/검토 완료|집계 제외|작업 중|현재 위치 유지/)
  assert.equal(h.node('region-list').children[0].attrs['aria-pressed'],'true')
  assert.match(h.node('region-detail').innerHTML,/좌표 입력됨.*시·군·구 확인 필요/)
  assert.doesNotMatch(h.node('region-detail').innerHTML,/검토를 완료했습니다/)
  assert.equal(h.writes.length,1,'coordinate save must not silently reconfirm the previous district')
})

test('empty completed last page keeps the active row after page clamping',async()=>{
  const h=regionFixture();h.server.items=[row(1)];h.server.page=1;h.server.totalPages=2;h.server.totalElements=16
  await h.context.loadList(1);await h.context.loadDetail(1)
  h.server.listReply=path=>response({items:[],page:Number(new URL(path).searchParams.get('page')),totalPages:0,totalElements:0})
  h.context.updateWorkingItem({...row(1,'VERIFIED'),location:{latitude:37,longitude:127}})
  await h.context.loadList(1)
  assert.equal(h.state('page'),0);assert.deepEqual(rows(h),[1])
  assert.match(h.node('region-status').innerHTML,/검토 대상 0건/)
})

test('page and filter navigation do not inject a pinned row into unrelated results',async()=>{
  const h=regionFixture();h.server.items=[row(1)];h.server.totalPages=2;h.server.totalElements=16
  await h.context.loadList();await h.context.loadDetail(1)
  const detail=h.node('region-detail').innerHTML
  h.server.items=[row(2)];h.server.page=1;await h.context.loadList(1)
  assert.deepEqual(rows(h),[2]);assert.equal(h.node('region-detail').innerHTML,detail)
  h.server.page=0;h.state("filterStatus='VERIFIED'");await h.context.loadList(0)
  assert.deepEqual(rows(h),[2]);assert.equal(h.node('region-detail').innerHTML,detail)
})

test('failed saves preserve the row, count and draft without claiming completion',async()=>{
  const h=regionFixture();h.server.items=[row(1)];h.server.totalElements=1;h.server.totalPages=1
  await h.context.loadList();await h.context.loadDetail(1);h.choose()
  h.lookups[0]([{address:{address_name:'시험 주소'}}],'OK');h.node('region-coordinate-note').value='입력 유지'
  h.server.failWrite=true;await h.node('region-save').handlers.click()
  assert.deepEqual(rows(h),[1]);assert.match(h.node('region-status').innerHTML,/검토 대상 1건/)
  assert.equal(h.node('region-coordinate-note').value,'입력 유지');assert.equal(h.maps.length,1)
  assert.match(h.node('region-save-status').textContent,/저장 실패/)
  assert.doesNotMatch(h.node('region-detail').innerHTML,/검토를 완료했습니다/)
})

test('late list responses cannot replace a newer page',async()=>{
  const h=regionFixture();let resolveOld
  h.server.listReply=()=>new Promise(resolve=>{resolveOld=resolve})
  const old=h.context.loadList(0)
  h.server.listReply=()=>response({items:[row(2)],page:1,totalPages:2,totalElements:16})
  await h.context.loadList(1)
  resolveOld(response({items:[row(1)],page:0,totalPages:2,totalElements:16}));await old
  assert.equal(h.state('page'),1);assert.deepEqual(rows(h),[2])
})

test('a working row is not duplicated when it remains in the server page at a new position',async()=>{
  const h=regionFixture();h.server.items=[row(2),row(1),row(3)];h.server.totalElements=3;h.server.totalPages=1
  await h.context.loadList();await h.context.loadDetail(1)
  h.server.items=[row(2),row(3),row(1)];await h.context.loadList()
  assert.deepEqual(rows(h),[2,1,3]);assert.equal(rows(h).filter(id=>id===1).length,1)
})

test('authentication loss clears working rows and invalidates late list responses',async()=>{
  const h=regionFixture();h.server.items=[row(1)];h.server.totalElements=1;h.server.totalPages=1
  await h.context.loadList();await h.context.loadDetail(1)
  let resolveOld;h.server.listReply=()=>new Promise(resolve=>{resolveOld=resolve})
  const pending=h.context.loadList();h.context.showLogin(401)
  resolveOld(response({items:[row(1)],page:0,totalPages:1,totalElements:1}));await pending
  assert.deepEqual(rows(h),[]);assert.equal(h.state('workingRow'),null)
  assert.equal(h.state('selected'),null)
})
