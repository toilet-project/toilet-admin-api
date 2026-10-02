import test from 'node:test'
import assert from 'node:assert/strict'
import {createHandler,permitted,PREFIX} from '../preview/report-gateway.mjs'
const site='https://preview.geupddong.com',now=1801465200000
const config={origin:'https://fixture-only.trycloudflare.com',gatewayToken:'a'.repeat(64),accessToken:'b'.repeat(64),localOrigin:'http://127.0.0.1:54321',expiresAt:new Date(now+3600000).toISOString()}
const env={ADMIN_REPORT_CONNECTION:JSON.stringify(config)},cookie=`__Secure-ReportReview=${config.accessToken}`
test('only report reads and decisions are allowed',()=>{
  for(const [method,path] of [['GET','/api/admin/v1/reports/3'],['GET','/api/admin/v1/reports/search'],['POST','/api/admin/v1/reports/3/approve'],['POST','/api/admin/v1/reports/3/reject']])assert.equal(permitted(method,path),true)
  for(const [method,path] of [['POST','/api/admin/preview/source'],['GET','/api/admin/v1/members'],['DELETE','/api/admin/v1/reports/3'],['POST','/api/v1/reports/guest']])assert.equal(permitted(method,path),false)
})
test('anonymous and malformed credentials never reach the origin',async()=>{
  const handler=createHandler(()=>{throw Error('must not forward')},()=>now)
  assert.equal((await handler(new Request(site+PREFIX+'/api/admin/v1/reports/3'),env)).status,401)
  assert.equal((await handler(new Request('https://geupddong.com'+PREFIX+'/'),env)).status,404)
  assert.equal((await handler(new Request(site+PREFIX+'/'),{ADMIN_REPORT_CONNECTION:JSON.stringify({...config,expiresAt:new Date(now-1).toISOString()})})).status,410)
  assert.equal((await handler(new Request(site+PREFIX+'/__session',{method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/x-www-form-urlencoded'},body:'access='+config.accessToken}),env)).status,403)
})
test('loopback handoff uses POST and an expiring HttpOnly same-site cookie',async()=>{
  const response=await createHandler(()=>{},()=>now)(new Request(site+PREFIX+'/__session',{method:'POST',headers:{Origin:config.localOrigin,'Content-Type':'application/x-www-form-urlencoded'},body:'access='+config.accessToken}),env)
  assert.equal(response.status,303);assert.equal(response.headers.get('Location'),site+PREFIX+'/')
  assert.match(response.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/)
  assert.match(response.headers.get('Set-Cookie'),/Max-Age=3600/)
})
test('review forwards only an isolated gateway key and bounded JSON, never production identity',async()=>{
  let called=0
  const handler=createHandler(async(url,options)=>{called++;assert.equal(url,config.origin+'/api/admin/v1/reports/3/approve');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers['X-Report-Review-Key'],config.gatewayToken);return new Response('{"status":"APPROVED"}',{headers:{'Content-Type':'application/json'}})},()=>now)
  const make=(origin,body='{}')=>new Request(site+PREFIX+'/api/admin/v1/reports/3/approve',{method:'POST',headers:{Cookie:cookie+'; geupddong_access=do-not-forward',Authorization:'Bearer do-not-forward',Origin:origin,'Content-Type':'application/json'},body})
  assert.equal((await handler(make('https://untrusted.invalid'),env)).status,403)
  assert.equal((await handler(make(site,'x'.repeat(9000)),env)).status,413)
  const response=await handler(make(site),env);assert.equal(response.status,200);assert.equal(called,1);assert.match(response.headers.get('Cache-Control'),/no-store/)
})
