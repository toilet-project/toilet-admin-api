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
assert.equal(assess(null,{sections:{}},null,{usagePending:true,monitoringPending:true}).length,0)
assert.ok(assess(usage,empty,null,{states:{r2:{status:'error'}}}).some(a=>a.id==='coverage'))
async function verifyProgressiveLoading() {
  const {create}=require('../src/main/resources/static/cloudflare-monitor-loader.js')
  const requests=[],updates=[]
  const loader=create({fetchJson:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
    onChange:(bundle,states)=>updates.push(structuredClone({bundle,states}))})
  assert.equal(requests.length,0,'Constructing the static shell must not request protected data')
  const loading=loader.load(['r2','traffic'])
  assert.equal(updates.at(-1).states.r2.status,'loading')
  const report={checkedAt:'2026-09-30T06:30:00Z',start:'2026-09-29T06:00:00Z',end:'2026-09-30T06:00:00Z',sections:{r2:{status:'OK',data:{puts24h:0}}}}
  requests[0].resolve(report)
  await new Promise(setImmediate)
  assert.equal(updates.at(-1).bundle.monitoring.sections.r2.data.puts24h,0,'Real zero is usable before a slow sibling finishes')
  assert.equal(updates.at(-1).states.traffic.status,'loading')
  await loader.load(['traffic'])
  assert.equal(requests.length,2,'An in-flight source must not be requested twice')
  requests[1].reject(new Error('isolated failure'))
  await loading
  assert.equal(loader.states.traffic.status,'error')
  assert.equal(loader.states.r2.status,'loaded')
  const retry=loader.load(['traffic'])
  requests[2].resolve({...report,sections:{traffic:{status:'OK',data:{requests:50}}}})
  await retry
  assert.equal(loader.states.traffic.status,'loaded')
  assert.equal(requests.length,3,'A retry must request only the failed source')
  const refresh=loader.load(['r2'])
  assert.equal(loader.bundle.monitoring.sections.r2.data.puts24h,0,'Background refresh preserves the previous value')
  requests[3].resolve({...report,sections:{r2:{status:'UNAVAILABLE',message:'Provider unavailable',data:null}}})
  await refresh
  assert.equal(loader.states.r2.status,'error')
  assert.equal(loader.bundle.monitoring.sections.r2.data.puts24h,0,'A failed refresh must retain the last known value with error status')
  console.log('Progressive loading, isolated failure/retry, deduplication and stale retention passed.')
}
verifyProgressiveLoading().catch(error=>{console.error(error);process.exitCode=1})
