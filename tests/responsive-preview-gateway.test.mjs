import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const build=mkdtempSync(join(tmpdir(),'admin-responsive-test-'))
execFileSync(process.execPath,['scripts/build-responsive-preview.cjs',build])
const {createHandler,AUTH_URL}=await import(pathToFileURL(join(build,'worker.mjs')))
test.after(()=>rmSync(build,{recursive:true,force:true}))
const site='https://preview.geupddong.com/admin-responsive',token='example.jwt.value'
function setup() {
  const calls=[],state={now:10000,roles:['ADMIN'],assets:0}
  const env={PREVIEW_EXPIRES_AT:'1000000',PREVIEW_SESSION_KEY:'b'.repeat(64),ASSETS:{fetch:async()=>{state.assets++;return new Response('private UI')}}}
  const handle=createHandler(async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/api/v1/auth/me')?{roles:state.roles,accessTokenExpiresAt:new Date(950000).toISOString()}:{items:[]})},()=>state.now)
  const req=(path,session,method='GET')=>new Request(site+path,{method,headers:session?{Cookie:'__Secure-ResponsivePreview='+session}:{}})
  async function connect() {
    const start=await handle(req('/'),env);assert.equal(start.status,302)
    const auth=start.headers.get('location'),nonce=new URL(auth).searchParams.get('state')
    const exchange=await handle(new Request(auth,{headers:{Cookie:'geupddong_access='+token}}),env)
    const html=await exchange.text();assert.equal(html.includes(token),false)
    const ticket=html.match(/name="ticket" value="([\w.-]+)"/)[1]
    const callback=(origin='https://api.geupddong.com',state=nonce)=>new Request(site+'/__session',{method:'POST',headers:{Origin:origin,Cookie:'__Secure-ResponsivePreviewState='+state,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket})})
    assert.equal((await handle(callback('https://evil.invalid'),env)).status,403)
    assert.equal((await handle(callback(undefined,'wrong'),env)).status,403)
    const done=await handle(callback(),env);assert.equal(done.status,303)
    assert.match(done.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/)
    return done.headers.getSetCookie()[0].match(/^__Secure-ResponsivePreview=([^;]+)/)[1]
  }
  return {calls,state,env,handle,req,connect}
}
test('anonymous, non-admin and expired requests never expose assets or data',async()=>{
 const {calls,state,env,handle,req}=setup()
 assert.equal((await handle(req('/backend/api/admin/v1/toilets'),env)).status,401)
 assert.equal((await handle(req('/admin-responsive.css'),env)).status,401)
 assert.equal(state.assets,0);assert.equal(calls.length,0)
 state.roles=['USER'];assert.equal((await handle(new Request(AUTH_URL+'?state='+'c'.repeat(64),{headers:{Cookie:'geupddong_access='+token}}),env)).status,403)
 assert.equal((await handle(req('/'),{...env,PREVIEW_EXPIRES_AT:'9999'})).status,410)
})
test('authenticated reads use only the selected admin/API host and caller identity',async()=>{
 const {calls,state,env,handle,req,connect}=setup(),session=await connect();calls.length=0
 for(const [path,expected]of [['/backend/api/admin/v1/data-quality/duplicate-coordinates/37.5%2C%20127.0','https://api.geupddong.com/api/admin/v1/data-quality/duplicate-coordinates/37.5%2C%20127.0'],['/server/api/admin/v1/operations/host','https://admin.geupddong.com/api/admin/v1/operations/host']]){
  assert.equal((await handle(req(path,session),env)).status,200)
  assert.equal(calls.at(-1).url,expected);assert.equal(calls.at(-1).options.method,'GET');assert.deepEqual(calls.at(-1).options.headers,{Cookie:'geupddong_access='+token,Accept:'application/json'})
 }
 const asset=await handle(req('/admin-responsive.css',session),env);assert.equal(await asset.text(),'private UI');assert.equal(state.assets,1);assert.match(asset.headers.get('cache-control'),/no-store/)
 state.roles=['USER'];assert.equal((await handle(req('/admin-responsive.css',session),env)).status,403);assert.equal(state.assets,1)
 state.now=960000;assert.equal((await handle(req('/server/api/admin/v1/dashboard',session),env)).status,401)
})
test('writes, unknown routes and redirect/path injection remain blocked after authentication',async()=>{
 const {calls,env,handle,req,connect}=setup(),session=await connect();calls.length=0
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await handle(req('/backend/api/admin/v1/toilets/1',session,method),env)).status,405)
 for(const path of ['/backend/api/v1/auth/logout','/backend/api/admin/v1/secrets','/server/api/admin/v1/toilets/%5c..%5csecret','/secrets.json'])assert.equal((await handle(req(path,session),env)).status,404)
 assert.equal(calls.length,0)
})
