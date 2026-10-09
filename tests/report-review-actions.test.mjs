import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/main/resources/static/reports.js',import.meta.url),'utf8').replace(/bootstrap\(\)\s*$/,'')
function fixture({confirm=true,ok=true}={}){
  const requests=[],buttons=[{disabled:false},{disabled:false}],errors=[]
  const detail={innerHTML:'original',querySelectorAll:()=>buttons,insertAdjacentHTML:(_where,html)=>errors.push(html)}
  const context=vm.createContext({ReportFacilityInfo:{read:()=>({name:'등록 이름',openTime:'24시간',cctv:false})},document:{getElementById:id=>id==='report-detail'?detail:id==='review-note'?{value:'  검증 메모  '}:{}},window:{confirm:()=>confirm},fetch:async(url,options)=>{requests.push({url,options});return {ok,json:async()=>({error:{message:'<provider unavailable>'}})}}})
  vm.runInContext(source,context)
  vm.runInContext('updateUrl=()=>{}; loadReports=async()=>{}; selectedReportId=7; locationConfirmation={latitude:36.3,longitude:127.3,roadAddress:"주소"}',context)
  return {context,requests,buttons,detail,errors}
}
test('cancelling the decision dialog performs no request or UI mutation',async()=>{
  const f=fixture({confirm:false});await f.context.reviewReport({id:7,reportType:'NEW_FACILITY'},'approve')
  assert.equal(f.requests.length,0);assert.equal(f.detail.innerHTML,'original');assert.ok(f.buttons.every(b=>!b.disabled))
})
test('new facility and coordinate decisions submit reviewed coordinates only after confirmation',async()=>{
  for(const reportType of ['NEW_FACILITY','COORDINATE_CORRECTION']){
    const f=fixture();await f.context.reviewReport({id:7,reportType},'approve')
    assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/\/reports\/7\/approve$/)
    assert.equal(f.requests[0].options.credentials,'include')
    assert.deepEqual(JSON.parse(f.requests[0].options.body),{note:'검증 메모',confirmedLatitude:36.3,confirmedLongitude:127.3,confirmedRoadAddress:'주소',...(reportType==='NEW_FACILITY'?{confirmedFacilityInfo:{name:'등록 이름',openTime:'24시간',cctv:false}}:{})})
    assert.equal(vm.runInContext('selectedReportId',f.context),null);assert.match(f.detail.innerHTML,/제보가 처리되었습니다/)
  }
})
test('observation decisions and rejection do not carry coordinate changes',async()=>{
  for(const [reportType,action] of [['FACILITY_MISSING','approve'],['TEMPORARILY_CLOSED','approve'],['NEW_FACILITY','reject']]){
    const f=fixture();await f.context.reviewReport({id:7,reportType},action)
    assert.deepEqual(JSON.parse(f.requests[0].options.body),{note:'검증 메모'})
    assert.ok(f.requests[0].url.endsWith('/'+action))
  }
})
test('provider failure preserves the selected report and coordinates and restores buttons',async()=>{
  const f=fixture({ok:false});await f.context.reviewReport({id:7,reportType:'NEW_FACILITY'},'approve')
  assert.equal(vm.runInContext('selectedReportId',f.context),7);assert.equal(vm.runInContext('locationConfirmation.latitude',f.context),36.3)
  assert.equal(f.detail.innerHTML,'original');assert.ok(f.buttons.every(b=>!b.disabled));assert.match(f.errors[0],/&lt;provider unavailable&gt;/)
})

test('validation failure and cancellation preserve unavailable weekday buttons',async()=>{
  for (const confirm of [false,true]) {
    const f=fixture({confirm,ok:false}); f.buttons[1].disabled=true
    await f.context.reviewReport({id:7,reportType:'NEW_FACILITY'},'approve')
    assert.equal(f.buttons[0].disabled,false); assert.equal(f.buttons[1].disabled,true)
  }
})
