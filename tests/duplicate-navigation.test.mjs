import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

for (const page of ['index.html','features.html']) {
  test(`duplicate names remains reachable from ${page}`, () => {
    const html=readFileSync(new URL('../src/main/resources/static/'+page,import.meta.url),'utf8')
    assert.match(html, /href="\/duplicate-names\.html"[^>]*>[\s\S]*?중복 이름 품질 관리/)
    assert.equal((html.match(/href="\/duplicate-names\.html"/g)||[]).length,1)
    assert.ok(html.indexOf('href="/duplicate-names.html"') > html.indexOf('href="/data-quality.html"'))
  })
}
