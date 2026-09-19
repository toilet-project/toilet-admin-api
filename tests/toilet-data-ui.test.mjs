import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import test from 'node:test'

const root = new URL('../src/main/resources/static/', import.meta.url)
const source = readFileSync(new URL('toilets.js', root), 'utf8')
const html = readFileSync(new URL('toilets.html', root), 'utf8')
const css = readFileSync(new URL('toilets.css', root), 'utf8')

function pureContext() {
  const trimmed = source.replace(/document\.addEventListener\('admin:before-route-change'[\s\S]*?bootstrap\(\)\s*$/, '')
  const context = createContext({ URL, URLSearchParams, window:{ location:{ href:'https://admin.example/toilets.html', search:'' }, history:{ replaceState(){} } }, console })
  runInContext(trimmed, context)
  return expression => runInContext(expression, context)
}

test('pagination keeps the current page near the center and stays inside bounds', () => {
  const state = pureContext()
  assert.deepEqual([...state('pageWindow(0, 12)')], [0,1,2,3,4])
  assert.deepEqual([...state('pageWindow(6, 12)')], [4,5,6,7,8])
  assert.deepEqual([...state('pageWindow(11, 12)')], [7,8,9,10,11])
})

test('page exposes the requested search, region, list, map and comparison workspaces', () => {
  for (const id of ['toilet-search','toilet-suggestions','toilet-sido','toilet-sigungu','toilet-list','toilet-pagination','toilet-map-card','toilet-editor-card']) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(css, /grid-template-columns:\s*minmax\(350px,.72fr\)\s*minmax\(0,2.28fr\)/)
  assert.match(source, /\/api\/admin\/v1\/toilets\/suggestions/)
  assert.match(source, /compositionstart/)
  assert.match(source, /snapshotToken/)
})

test('pre-deployment preview falls back to existing real-data reads without allowing writes', () => {
  assert.match(source, /error\.status !== 404/)
  assert.match(source, /api\/admin\/v1\/regions\?/)
  assert.match(source, /api\/v1\/toilets\/\$\{id\}/)
  assert.match(source, /프리뷰 저장 차단/)
  assert.match(source, /if \(legacyPreview\) return/)
})
