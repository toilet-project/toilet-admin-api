const test=require('node:test')
const assert=require('node:assert/strict')
const {quota,change,comparable}=require('../src/main/resources/static/api-usage-math.js')
const start='2026-09-01T00:00:00Z', asOf='2026-09-16T00:00:00Z', end='2026-10-01T00:00:00Z'
test('monthly forecast compares the same monthly allowance, including over 100%',()=>{
  const q=quota({period:'month',free:10000},8000,16000,start,asOf,end)
  assert.equal(q.current,80); assert.equal(q.projected,160)
})
test('daily free quota compares average daily use, never monthly total',()=>{
  const q=quota({period:'day',free:100000},900000,1800000,start,asOf,end)
  assert.equal(q.current,null); assert.equal(q.dailyAverage,60000); assert.equal(q.projected,60)
})
test('unknown, unlimited and absent free allowance have no invented percentage',()=>{
  assert.equal(quota({period:'month',free:0,unlimited:true},100,200,start,asOf,end).kind,'unlimited')
  assert.equal(quota({period:'month',free:0},100,200,start,asOf,end).projected,null)
  assert.equal(quota({period:'month',free:10000},null,null,start,asOf,end).current,null)
  assert.equal(quota({period:'day',free:10000},100,null,start,asOf,end).projected,null)
})
test('zero baseline is new use, missing baseline is unknown, decline is retained',()=>{
  assert.equal(change(100,0).kind,'new'); assert.equal(change(100,0).percent,null)
  assert.equal(change(0,0).percent,0); assert.equal(change(10,null).kind,'unknown')
  assert.equal(change(50,100).percent,-50)
})
test('only comparable complete periods can support monthly growth',()=>{
  const previous={status:'complete',source:'Monitoring',scope:'project-one'}
  const current={...previous,status:'current'}
  assert.equal(comparable(current,previous),true)
  for(const status of ['partial','provisional','unavailable','stale','error']) assert.equal(comparable(current,{...previous,status}),false)
  assert.equal(comparable({...current,source:'Billing'},previous),false)
  assert.equal(comparable({...current,scope:'project-two'},previous),false)
})
