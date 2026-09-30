const assert=require('node:assert/strict')
const {ratio,exhaustion,assess}=require('../src/main/resources/static/cloudflare-monitor-model.js')
const usage={usagePeriodStart:'2026-09-29T00:00:00Z',usagePeriodEnd:'2026-10-28T00:00:00Z',metrics:[],costSummary:{observedSubtotalUsd:0,projectedSubtotalUsd:7}}
const metric={id:'r2-a',label:'R2 A',periodKind:'CYCLE',used:100,included:1000,status:'OK',measuredAt:'2026-09-30T00:00:00Z'}
assert.equal(ratio(0,0),null)
assert.equal(ratio(null,100),null)
assert.equal(exhaustion(metric,usage),'2026-10-09T00:00:00.000Z')
assert.equal(exhaustion({...metric,status:'STALE'},usage),null)
assert.equal(exhaustion({...metric,periodKind:'CURRENT'},usage),null)
assert.equal(exhaustion({...metric,measuredAt:'2026-09-29T01:00:00Z'},usage),null)
const empty={sections:{r2:{status:'OK',data:{lastHourPuts:0,previousHourPuts:0,getOk:0,getMissing:0,serverErrors:0}}}}
assert.equal(assess(usage,empty,null).length,0)
assert.ok(assess(usage,empty,5).some(a=>a.id==='budget'))
assert.ok(!assess({...usage,costSummary:{observedSubtotalUsd:null,projectedSubtotalUsd:null}},empty,5).some(a=>a.id==='budget'))
assert.ok(assess(null,empty,5).some(a=>a.id==='cost-unavailable'))
const spike={sections:{r2:{status:'OK',data:{lastHourPuts:1000,previousHourPuts:0,getOk:40,getMissing:60,serverErrors:1}}}}
assert.deepEqual(assess(usage,spike,null).map(a=>a.id),['put-spike','r2-miss','r2-errors'])
assert.ok(assess(usage,{sections:{traffic:{status:'UNAVAILABLE',data:null}}},null).some(a=>a.id==='coverage'))
assert.ok(assess({...usage,metrics:[metric]},empty,null).some(a=>a.id==='r2-a'))
const late={checkedAt:'2026-09-30T12:00:00Z',sections:{refresh:{status:'OK',data:{lastSuccessAt:'2026-09-29T05:00:00Z',runs:[{status:'completed',conclusion:'failure'}]}}}}
assert.deepEqual(assess(usage,late,null).map(a=>a.id),['refresh-failure','refresh-late'])
console.log('Cloudflare monitor calculations and alert boundaries passed.')
