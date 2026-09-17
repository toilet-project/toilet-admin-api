import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
import test from 'node:test'
import {permitted} from '../preview/duplicate-gateway.mjs'
const root=new URL('../src/main/resources/static/',import.meta.url)
const source=await readFile(new URL('coordinate-visibility.js',root),'utf8')
function harness({fail=false,confirm=true}={}){
  function node(){return {isConnected:true,value:'',disabled:false,checked:false,hidden:false,handlers:{},children:[],queries:{},setAttribute(){},append(n){this.children.push(n)},prepend(n){this.children.unshift(n)},remove(){this.isConnected=false},addEventListener(k,fn){this.handlers[k]=fn},querySelector(s){return this.queries[s]??=node()}}}
  const container=node(),created=[],writes=[];let refreshed=0
  const rows=[{id:1,name:'시설 A',version:3,visibilityStatus:'VISIBLE'},{id:2,name:'시설 B',version:5,visibilityStatus:'VISIBLE'}]
  const context={window:{confirm:()=>confirm},document:{createElement:()=>{const n=node();created.push(n);return n}},URLSearchParams,Set,Object,
    fetch:async(path,options)=>{if(options.method){writes.push(JSON.parse(options.body));return {ok:!fail,json:async()=>({message:'충돌 안내'})}}return {ok:true,json:async()=>rows}}}
  runInNewContext(source,context)
  return {created,writes,get refreshed(){return refreshed},mount:()=>context.window.CoordinateVisibility.mount({container,group:{latitude:37.1,longitude:127.1},base:'/admin-duplicates',refresh:async()=>{refreshed++}})}
}
test('coordinate controls require representative, other target, and reason; send versioned hide only',async()=>{
  const h=harness();await h.mount();const [host,a,b]=h.created,save=host.querySelector('[data-hide-save]')
  assert.ok(save.disabled)
  a.querySelector('[type="radio"]').handlers.change();assert.ok(a.querySelector('[type="checkbox"]').disabled)
  b.querySelector('[type="checkbox"]').checked=true;b.querySelector('[type="checkbox"]').handlers.change();assert.ok(save.disabled)
  host.querySelector('textarea').value='주소 확인';host.querySelector('textarea').handlers.input();assert.equal(save.disabled,false)
  await save.handlers.click();assert.equal(h.refreshed,1)
  assert.deepEqual(h.writes,[{representativeId:1,toiletIds:[2],expectedVersions:{1:3,2:5},reason:'주소 확인'}])
})
test('switching representative removes it from targets; failed save retains input for retry',async()=>{
  const h=harness({fail:true});await h.mount();const [host,a,b]=h.created
  b.querySelector('[type="checkbox"]').checked=true;b.querySelector('[type="checkbox"]').handlers.change()
  b.querySelector('[type="radio"]').handlers.change();assert.equal(b.querySelector('[type="checkbox"]').checked,false)
  a.querySelector('[type="checkbox"]').checked=true;a.querySelector('[type="checkbox"]').handlers.change()
  host.querySelector('textarea').value='근거 유지';host.querySelector('textarea').handlers.input()
  await host.querySelector('[data-hide-save]').handlers.click()
  assert.equal(host.querySelector('textarea').value,'근거 유지');assert.equal(host.querySelector('[role="status"]').textContent,'충돌 안내')
  assert.equal(host.querySelector('[data-hide-save]').disabled,false);assert.equal(h.refreshed,0)
})
test('preview allows coordinate reads and hiding but not correction, grouping or review writes',()=>{
  assert.ok(permitted('GET','/data-quality.html'))
  assert.ok(permitted('GET','/api/admin/v1/data-quality/duplicate-coordinates'))
  assert.ok(permitted('POST','/api/admin/v1/duplicate-names/coordinate-hide'))
  for(const [method,path] of [['POST','/api/admin/v1/data-quality/toilets/1/coordinates'],['PUT','/api/admin/v1/data-quality/duplicate-coordinates/a/display-group'],['PATCH','/api/admin/v1/data-quality/duplicate-coordinates/a/review']])assert.equal(permitted(method,path),false)
})
test('name and coordinate forms remove visible reason heading and place textarea beside compact button',async()=>{
  const html=await readFile(new URL('duplicate-names.html',root),'utf8')
  assert.match(html,/class="dn-hide-form"><textarea[^>]+rows="1"[^>]+aria-label="숨김 처리 근거"/)
  assert.doesNotMatch(html,/>숨김 근거<|>선택 항목 숨기기</)
  assert.match(source,/coordinate-hide-form/);assert.match(source,/aria-label="숨김 처리 근거"/)
})
