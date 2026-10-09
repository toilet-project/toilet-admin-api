import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = name => readFileSync(new URL('../src/main/resources/static/'+name,import.meta.url),'utf8')
const context = vm.createContext({})
vm.runInContext(source('opening-hours-editor.js'),context)
const editor = context.OpeningHoursEditor
const plain = value => JSON.parse(JSON.stringify(value))

test('unconfirmed text never becomes a 24-hour confirmation or a closed weekday', () => {
  assert.equal(editor.request('',false,'UNKNOWN',[],true),null)
  assert.throws(() => editor.request('',false,'UNKNOWN',[]),/정책/)
  const html = editor.markup(null,{id:'new',allowUnknown:true})
  assert.equal((html.match(/data-day="/g) || []).length,7)
  assert.doesNotMatch(html,/data-enabled checked|data-closed checked|value="true" checked/)
})

test('confirmed weekly schedule keeps multiple slots, holiday, closed days and overnight times', () => {
  const hours = editor.request('SCHEDULED',false,'CLOSED',[
    {dayOfWeek:1,startTime:'09:00',endTime:'12:00',closed:false},
    {dayOfWeek:1,startTime:'20:00',endTime:'02:00',closed:false},
    {dayOfWeek:7,closed:true},
  ])
  assert.deepEqual(plain(hours), {openingPolicy:'SCHEDULED',open24h:false,holidayPolicy:'CLOSED',schedules:[
    {dayOfWeek:1,slotIndex:0,startTime:'09:00',endTime:'12:00',closed:false,crossesMidnight:false},
    {dayOfWeek:1,slotIndex:1,startTime:'20:00',endTime:'02:00',closed:false,crossesMidnight:true},
    {dayOfWeek:7,slotIndex:0,startTime:null,endTime:null,closed:true,crossesMidnight:false},
  ]})
  const html = editor.markup(hours)
  for (const value of ['09:00','12:00','20:00','02:00']) assert.ok(html.includes(`value="${value}"`))
  assert.equal((html.match(/data-enabled checked/g)||[]).length,2)
  assert.equal((html.match(/data-closed checked/g)||[]).length,1)
})

test('empty, incomplete, equal-time and contradictory schedules fail before submission', () => {
  for (const rows of [[],[{dayOfWeek:1,startTime:'',endTime:'18:00'}],[{dayOfWeek:1,startTime:'09:00',endTime:'09:00'}],[{dayOfWeek:1,startTime:'25:00',endTime:'18:00'}],[{dayOfWeek:1,closed:true},{dayOfWeek:1,startTime:'09:00',endTime:'18:00'}]]) assert.throws(() => editor.request('SCHEDULED',false,'UNKNOWN',rows))
  assert.throws(() => editor.request('SCHEDULED',true,'UNKNOWN',[]),/24시간/)
  for (const policy of ['ALWAYS','IRREGULAR','CLOSED']) assert.deepEqual(plain(editor.request(policy,policy === 'ALWAYS','UNKNOWN',[{dayOfWeek:1,startTime:'09:00',endTime:'18:00'}])).schedules,[])
  assert.equal(editor.request('ALWAYS',false,'UNKNOWN',[]).open24h,false)
})

test('new approval sends structured hours and preserves raw evidence; rejection ignores drafts', async () => {
  const requests=[], raw='평일 운영\n공휴일은 확인 필요', hours=editor.request('SCHEDULED',false,'UNKNOWN',[{dayOfWeek:6,startTime:'10:00',endTime:'18:00'}])
  const input={dataset:{facilityField:'name'},value:'시설 이름',checkValidity:()=>true}
  const fields={dataset:{sourceOpenTime:'정시',sourceOpenTimeDetail:raw},querySelectorAll:()=>[input]}
  const detail={querySelectorAll:()=>[],insertAdjacentHTML(){},innerHTML:''}
  const ctx=vm.createContext({document:{getElementById:id=>id==='new-facility-fields'?fields:id==='report-detail'?detail:{value:''}},window:{confirm:()=>true},fetch:async(url,init)=>{requests.push(JSON.parse(init.body));return {ok:true}}})
  vm.runInContext(source('report-facility-info.js'),ctx)
  ctx.ReportResolution={readProposalHours:()=>hours}
  vm.runInContext(source('reports.js').replace(/bootstrap\(\)\s*$/,''),ctx)
  vm.runInContext('updateUrl=()=>{};loadReports=async()=>{}',ctx)
  await ctx.reviewReport({id:24,reportType:'NEW_FACILITY'},'approve')
  assert.equal(requests[0].confirmedFacilityInfo.openTimeDetail,raw)
  assert.equal(requests[0].confirmedFacilityInfo.openTime,'정시')
  assert.deepEqual(requests[0].confirmedFacilityInfo.openingHours,plain(hours))
  ctx.ReportResolution.readProposalHours=()=>{throw new Error('invalid draft')}
  await ctx.reviewReport({id:24,reportType:'NEW_FACILITY'},'approve')
  assert.equal(requests.length,1)
  await ctx.reviewReport({id:24,reportType:'NEW_FACILITY'},'reject')
  assert.deepEqual(requests[1],{note:''})
})

test('both review pages load the shared editor before dependent scripts', () => {
  for (const [page,dependent] of [['reports.html','report-resolution.js'],['opening-hours.html','opening-hours.js']]) {
    const html=source(page)
    assert.ok(html.indexOf('/opening-hours-editor.js') < html.indexOf('/'+dependent))
    assert.match(html,/opening-hours-editor.css/)
  }
})
