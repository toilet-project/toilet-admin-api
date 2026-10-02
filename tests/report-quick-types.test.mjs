import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/main/resources/static/reports.js', import.meta.url), 'utf8').replace(/bootstrap\(\)\s*$/, '')
const context = vm.createContext({ document: { getElementById() {} } })
vm.runInContext(source, context)
test('all quick report types are labelled without confusing observations with hour corrections', () => {
  for (const [type, label] of Object.entries({ FACILITY_MISSING: '시설 없음', COORDINATE_CORRECTION: '위치 수정', TEMPORARILY_CLOSED: '현재 미개방', NEW_FACILITY: '신규 등록', OPEN_TIME_CORRECTION: '개방 시간 수정' })) {
    assert.equal(vm.runInContext(`reportTypeLabel('${type}')`, context), label)
  }
})
test('observation confirmation explicitly promises no automatic hiding or hour changes', () => {
  const html = context.observationMarkup({ latitude: 36.3, longitude: 127.3, roadAddress: '<img src=x>', openTime: '09:00~18:00' })
  assert.match(html, /접수 당시/)
  assert.match(html, /시설이 숨겨지거나 개방시간이 변경되지 않습니다/)
  assert.doesNotMatch(html, /<img/)
  assert.equal(vm.runInContext("approvalLabel({reportType:'TEMPORARILY_CLOSED'})", context), '확인 완료')
  assert.equal(vm.runInContext("approvalLabel({reportType:'NEW_FACILITY'})", context), '승인 후 신규 등록')
})
test('new facilities share the reviewed-coordinate flow and hide the nonexistent current location', () => {
  assert.equal(vm.runInContext("coordinateReport({reportType:'NEW_FACILITY'})", context), true)
  assert.match(source, /report\.reportType === 'NEW_FACILITY' \? \{ \.\.\.toilet, latitude: null, longitude: null \}/)
  assert.match(source, /if \(selectedReportId !== id\) return/)
})
test('observation retains detailed hours and formats the unzoned API timestamp as Korean time', () => {
  const html = context.observationMarkup({openTime:'정시',openTimeDetail:'09:00~18:00',observedAt:'2026-10-02T19:30:00'})
  assert.match(html,/정시 · 09:00~18:00/)
  assert.match(html,/오후 7:30/)
  assert.match(context.observationMarkup({openTimeDetail:'<script>alert(1)</script>'}),/&lt;script&gt;/)
})
