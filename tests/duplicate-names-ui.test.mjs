import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
const root=new URL('../src/main/resources/static/',import.meta.url)
test('duplicate management preserves service analytics navigation',async()=>{
  const shell=await readFile(new URL('admin-shell.js',root),'utf8')
  for(const route of ['service-analytics','duplicate-names','public-data-changes']) assert.ok(shell.includes(route))
})
test('preview writes are loopback scoped and separate from production credentials',async()=>{
  const js=await readFile(new URL('duplicate-names.js',root),'utf8')
  assert.ok(js.includes("location.hostname==='127.0.0.1' && location.port==='8796'"))
  assert.ok(js.includes("credentials:isolatedPreview?'omit':'include'"))
  assert.ok(js.includes('if(isolatedPreview&&hidden)'))
  assert.ok(js.includes('expectedVersions:'))
  assert.ok(js.includes('showModal()'))
  assert.ok(js.includes('esc(f.hiddenReason)'))
})
test('change review exposes frozen hiding evidence without automatic visibility release',async()=>{
  const js=await readFile(new URL('public-data-changes.js',root),'utf8')
  assert.ok(js.includes('escapeHtml(hidden.reason)'))
  assert.ok(js.includes('hidden.hiddenAt'))
  assert.ok(js.includes('변경을 반영해도 숨김은 유지됩니다'))
})

test('preview public-read check accepts an omitted empty marker array without hiding malformed metadata',async()=>{
  const js=await readFile(new URL('duplicate-names.js',root),'utf8')
  assert.ok(js.includes('if(!result.meta)throw Error'))
  assert.ok(js.includes('(result.toilets||[]).some'))
  assert.ok(js.includes('/api/v1/toilets/sitemap/ids?shard='))
})
