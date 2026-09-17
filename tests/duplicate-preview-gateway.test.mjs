import test from 'node:test'
import assert from 'node:assert/strict'
import gateway,{permitted} from '../preview/duplicate-gateway.mjs'
const origin='https://preview.geupddong.com/admin-duplicates'
const env=()=>({PREVIEW_EXPIRES_AT:String(Date.now()+60000),PREVIEW_ORIGIN:'https://fixture-only.trycloudflare.com',PREVIEW_GATEWAY_TOKEN:'a'.repeat(64),PREVIEW_ADMIN_TOKEN:'eyJfixture.payload.signature'})
test('gateway permits only isolated functionality and never operational account or setup writes',()=>{
  assert.equal(permitted('POST','/api/admin/v1/duplicate-names/hide'),true)
  assert.equal(permitted('POST','/api/admin/v1/duplicate-names/work-visibility'),true)
  assert.equal(permitted('POST','/api/admin/v1/duplicate-names/12/restore'),true)
  assert.equal(permitted('POST','/api/admin/v1/public-data-change-reviews/12/decisions'),true)
  for(const path of ['/api/v1/auth/logout','/api/v1/reviews','/preview/map-config','/../.env','/actuator/env'])assert.equal(permitted('POST',path),false)
})
test('gateway fails closed outside its host, route, expiry, or configured upstream',async()=>{
  for(const [url,config,status] of [
    ['https://geupddong.com/admin-duplicates/',env(),404],
    ['https://preview.geupddong.com/',env(),404],
    [origin+'/',{...env(),PREVIEW_EXPIRES_AT:'0'},410],
    [origin+'/',{...env(),PREVIEW_ORIGIN:'https://api.geupddong.com'},503],
  ])assert.equal((await gateway.fetch(new Request(url),config)).status,status)
})
test('cross-origin and oversized writes are blocked before forwarding',async()=>{
  assert.equal((await gateway.fetch(new Request(origin+'/preview/simulate-change',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}),env())).status,403)
  assert.equal((await gateway.fetch(new Request(origin+'/preview/simulate-change',{method:'POST',headers:{Origin:'https://preview.geupddong.com','Content-Type':'application/json'},body:'x'.repeat(16385)}),env())).status,413)
})
test('gateway strips user credentials and forbids redirect forwarding',async()=>{
  const original=globalThis.fetch;let forwarded
  globalThis.fetch=async(url,options)=>{forwarded={url,options};return new Response('{}',{headers:{'Content-Type':'application/json','Set-Cookie':'unsafe=1'}})}
  try{
    const response=await gateway.fetch(new Request(origin+'/api/v1/auth/me',{headers:{Cookie:'real=secret',Authorization:'Bearer user-secret','CF-Access-Jwt-Assertion':'private'}}),env())
    assert.equal(response.status,200);assert.equal(response.headers.get('Set-Cookie'),null)
    assert.equal(forwarded.url,'https://fixture-only.trycloudflare.com/api/v1/auth/me')
    assert.deepEqual(Object.keys(forwarded.options.headers).sort(),['Accept','Authorization','X-Preview-Gateway'])
    assert.equal(forwarded.options.headers.Authorization,'Bearer eyJfixture.payload.signature')
    assert.equal(forwarded.options.headers['X-Preview-Gateway'],'a'.repeat(64))
    assert.equal(forwarded.options.redirect,'manual')
    globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://api.geupddong.com'}})
    assert.equal((await gateway.fetch(new Request(origin+'/api/v1/auth/me'),env())).status,502)
  }finally{globalThis.fetch=original}
})
