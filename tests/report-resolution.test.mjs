import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {permitted} from '../preview/report-gateway.mjs'
const source=readFileSync(new URL('../src/main/resources/static/report-resolution.js',import.meta.url),'utf8')
const context=vm.createContext({date:value=>value})
vm.runInContext(readFileSync(new URL('../src/main/resources/static/opening-hours-editor.js',import.meta.url),'utf8'),context)
vm.runInContext(source,context)
const api=context.ReportResolution
test('report scoped actions only, no general facility write exposure',()=>{
  for(const method of ['GET','POST'])assert.equal(permitted(method,'/api/admin/v1/reports/1/actions'),true)
  assert.equal(permitted('PUT','/api/admin/v1/toilets/1'),false)
  assert.equal(permitted('GET','/report-resolution.js'),true)
})
test('hours preserve multiple slots, holiday policy and overnight semantics',()=>{
  const result=api.scheduleRequest('SCHEDULED','CLOSED',[
    {dayOfWeek:1,startTime:'09:00',endTime:'12:00',closed:false},
    {dayOfWeek:1,startTime:'20:00',endTime:'02:00',closed:false},
    {dayOfWeek:7,startTime:'09:00',endTime:'18:00',closed:true}])
  assert.equal(result.schedules[1].slotIndex,1);assert.equal(result.schedules[1].crossesMidnight,true)
  assert.equal(result.schedules[2].startTime,null);assert.equal(result.holidayPolicy,'CLOSED')
  assert.equal(api.scheduleRequest('ALWAYS','OPEN',[]).open24h,true)
  assert.throws(()=>api.scheduleRequest('SCHEDULED','UNKNOWN',[{dayOfWeek:1,startTime:'09:00',endTime:'09:00'}]))
})
test('current hours prefer confirmed schedule to public raw source',()=>{
  assert.equal(api.hoursText({openingPolicy:'ALWAYS',open24h:true},{sourceOpenTime:'09:00~18:00'}),'24시간')
  assert.equal(api.hoursText(null,{sourceOpenTime:'09:00~18:00'}),'09:00~18:00')
})
test('history escapes user input and shows before/after with related report',()=>{
  const html=api.historyMarkup([{action:'HIDE_TEMPORARILY',reason:'<img src=x>',reportId:3,actorUserId:1,createdAt:'2026-10-02',beforeJson:'{"visibilityStatus":"VISIBLE"}',afterJson:'{"visibilityStatus":"HIDDEN_TEMPORARY"}'}])
  assert.doesNotMatch(html,/<img/);assert.match(html,/이전 · 공개/);assert.match(html,/변경 · 임시 숨김/);assert.match(html,/제보 #3/)
})
test('stale responses and duplicate saves are guarded, errors retain the form',()=>{
  assert.match(source,/root.isConnected && context.isSelected\(\)/)
  assert.match(source,/if \(busy \|\| !active\(\)/)
  assert.match(source,/signature !== requestSignature/)
  assert.match(source,/if \(!result.ok\) throw new Error/)
  assert.ok(source.indexOf('if (!result.ok) throw new Error')<source.indexOf('await reload()'))
})
test('anonymous actions mount after ES-module navigation without lexical page globals', async () => {
  const root = {isConnected:true,innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[]}
  const calls = []
  const isolated = vm.createContext({document:{getElementById:()=>root},fetch:async(url)=>{
    calls.push(url); return {ok:true,json:async()=>({facility:{visibilityStatus:'VISIBLE'},openingHours:null,actionable:false,history:[]})}
  }})
  vm.runInContext(source,isolated)
  await isolated.ReportResolution.mount({id:21,toiletId:10,reporterKind:'GUEST',status:'PENDING'},()=>{},
    {apiBase:'https://preview.invalid',isSelected:()=>true,hasCoordinates:()=>false,loadMaps:()=>{}})
  assert.deepEqual(calls,['https://preview.invalid/api/admin/v1/reports/21/actions'])
  assert.match(root.innerHTML,/시설 조치/); assert.doesNotMatch(root.innerHTML,/not defined/)
})
