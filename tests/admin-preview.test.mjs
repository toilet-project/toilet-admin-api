import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {runInNewContext} from 'node:vm'
import redirect from '../preview/responsive-gateway.mjs'

const source = readFileSync(new URL('../preview/admin-preview-runtime.js',import.meta.url),'utf8')
function runtime() {
  const events = {}, requests = []
  const location = new URL('https://admin.geupddong.com/preview/toilets')
  const link = {href:'https://api.geupddong.com/api/v1/auth/login/google?returnTo=admin',dataset:{}}
  const document = {
    head:{append(){}}, body:{append(){}},
    addEventListener(name,fn){events[name]=fn},
    getElementById(){return true},
    querySelector(){return null},
    querySelectorAll(){return [link]},
  }
  const window = {location,document,fetch:async(...args)=>{requests.push(args);return new Response('{}')},addEventListener(){},dispatchEvent(){},parent:{postMessage(){}}}
  runInNewContext(source,{window,document,location,Request,Response,URL,URLSearchParams,CustomEvent:class{},localStorage:{getItem(){return null}}})
  return {window,events,requests,link}
}
test('preview reads use existing credentials; operational writes never reach the server', async()=>{
  const {window,requests}=runtime()
  await window.fetch('/api/admin/cloudflare/usage')
  assert.equal(requests[0][0].href,'https://admin.geupddong.com/api/admin/cloudflare/usage')
  assert.equal(requests[0][1].credentials,'include')
  await window.fetch('https://api.geupddong.com/api/v1/admin/toilets')
  assert.equal(requests[1][1].credentials,'include')
  for(const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await window.fetch('/api/admin/batch-syncs',{method})).status,403)
  assert.equal(requests.length,2)
  await window.fetch('https://api.geupddong.com/api/v1/auth/refresh',{method:'POST'})
  assert.equal(requests.length,3)
  assert.equal((await window.fetch('https://api.geupddong.com/api/v1/auth/refresh',{method:'DELETE'})).status,403)
})
test('login returns to existing admin preview at the top level',()=>{
  const {events,link}=runtime();events.DOMContentLoaded()
  assert.equal(new URL(link.href).searchParams.get('returnTo'),'adminPreview')
  assert.equal(link.target,'_top')
})
test('old preview links redirect to the existing preview; auth/API paths are retired',async()=>{
  const response = await redirect.fetch(new Request('https://preview.geupddong.com/admin-responsive/responsive-screen.html?size=15&page=cloudflare.html'))
  const location = new URL(response.headers.get('Location'))
  assert.equal(location.origin,'https://admin.geupddong.com')
  assert.equal(location.pathname,'/preview/responsive-screen.html')
  assert.equal(location.searchParams.get('page'),'cloudflare.html')
  assert.equal(location.searchParams.get('size'),'15')
  for(const path of ['/admin-responsive/api/admin','/admin-responsive/auth','/admin-responsiveevil']) assert.equal((await redirect.fetch(new Request('https://preview.geupddong.com'+path))).status,404)
})
test('build preserves API routes while keeping navigation, fonts and runtime in preview',()=>{
  const output = mkdtempSync(join(tmpdir(),'admin-preview-'))
  execFileSync(process.execPath,['scripts/build-admin-preview.mjs',output])
  const html=readFileSync(join(output,'preview/toilets.html'),'utf8')
  assert.ok(html.indexOf('admin-preview-runtime.js')<html.indexOf('admin-shell.js'))
  assert.match(html,/returnTo=adminPreview/)
  const shell=readFileSync(join(output,'preview/admin-shell.js'),'utf8')
  assert.match(shell,/\/preview\/cloudflare.html/)
  assert.doesNotMatch(shell,/\/preview\/api\//)
  assert.match(readFileSync(join(output,'preview/brand.css'),'utf8'),/\/preview\/brand\/jua/)
  assert.ok(readFileSync(join(output,'preview/brand/jua/geupddong.ttf')).length>100)
})
