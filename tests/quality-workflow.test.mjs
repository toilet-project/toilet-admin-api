import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createContext, runInContext} from 'node:vm'
import test from 'node:test'

const root = new URL('../src/main/resources/static/', import.meta.url)
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
  const window={location,history:{replaceState(){}},matchMedia:()=>({matches:false}),clearTimeout,confirm:()=>true,alert(){},kakao}
  const context=createContext({window,location,fetch,URL,URLSearchParams,setTimeout,clearTimeout,console,
    document:{getElementById:id=>nodes.get(id)||null,createElement:()=>make('new'),querySelectorAll:()=>[]}})
  runInContext(readFileSync(new URL(file+'.js',root),'utf8').replace(/(?:void start\(\)|bootstrap\(\))\s*;?\s*$/,''),context)
  return {context,node:id=>nodes.get(id),state:expression=>runInContext(expression,context)}
}
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data})

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
  class LatLng {constructor(lat,lng){this.lat=lat;this.lng=lng}getLat(){return this.lat}getLng(){return this.lng}}
  const kakao={maps:{LatLng,Map:class{constructor(){this.handlers={};maps.push(this)}setCenter(){}setLevel(){}},
    Marker:class{constructor({position}){this.position=position;this.handlers={}}setPosition(p){this.position=p}getPosition(){return this.position}setMap(){}setZIndex(){}},
    MarkerImage:class{},Size:class{},Point:class{},event:{addListener(target,event,fn){target.handlers[event]=fn}},
    services:{Status:{OK:'OK'},Geocoder:class{coord2Address(lng,lat,fn){lookups.push(fn)}},Places:class{}}}}
  const h=fixture('regions',async (path,options={})=>{
    if(path.endsWith('/map-config'))return response({enabled:true,javascriptKey:'synthetic-only'})
    if(options.method){const body=JSON.parse(options.body);writes.push({path,body});return response({region,note:body.note,confirmedAt:'2026-09-17T02:00:00Z'})}
    if(path.endsWith('/regions/1'))return response(detail)
    return response({items:[],page:0,totalPages:0,totalElements:0})
  },kakao)
  h.node('auth-shell').hidden=true
  return {...h,maps,lookups,writes,choose:(lat=37,lng=127)=>maps[0].handlers.click({latLng:new LatLng(lat,lng)})}
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
