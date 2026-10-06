import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/main/resources/static/report-facility-info.js',import.meta.url),'utf8')
function fixture(inputs = []) {
  const context = vm.createContext({document:{getElementById:()=>({querySelectorAll:()=>inputs})}})
  vm.runInContext(source,context); return context.ReportFacilityInfo
}
test('new report keeps proposed evidence separate from editable confirmation, with escaped values', () => {
  const info = fixture(), report = {reportType:'NEW_FACILITY',toiletName:'기존 신규',facilityInfo:{name:'<img src=x>',openTime:'24시간',cctv:false}}
  const html = info.markup(report,true)
  assert.match(html,/제보 원문/); assert.match(html,/등록할 기본 정보/)
  assert.match(html,/&lt;img src=x&gt;/); assert.doesNotMatch(html,/<img/)
  assert.match(html,/data-facility-field="openTime"/)
  assert.equal(info.markup({reportType:'FACILITY_MISSING'},true),'')
  assert.doesNotMatch(info.markup(report,false),/data-facility-field/)
})
test('legacy new reports still offer optional empty fields; unknown is not no', () => {
  assert.match(fixture().markup({reportType:'NEW_FACILITY',toiletName:'이름'},true),/value="이름"/)
  const input = (key,value) => ({dataset:{facilityField:key},value,checkValidity:()=>true})
  const result = fixture([input('name',' 새 이름 '),input('cctv','false'),input('diaperTable',''),input('femaleDisabledToiletCount','0')]).read()
  assert.equal(result.name,'새 이름'); assert.equal(result.cctv,false)
  assert.equal(result.diaperTable,null); assert.equal(result.femaleDisabledToiletCount,0)
})
test('invalid count or missing name cannot reach the decision request', () => {
  assert.throws(()=>fixture([{dataset:{facilityField:'maleDisabledToiletCount'},value:'-1',checkValidity:()=>false,reportValidity(){}}]).read(),/입력/)
  assert.throws(()=>fixture([]).read(),/이름/)
})
