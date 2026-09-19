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

test('suggestions start quickly and reuse the closest cached prefix while typing', () => {
  const state = pureContext()
  state(`rememberSuggestions('충남', [
    { id:1, name:'충남대학교병원', address:'대전광역시 중구' },
    { id:2, name:'충남도청 남문화장실', address:'충청남도 홍성군' }
  ])`)
  assert.equal(state('SUGGESTION_DELAY_MS'), 60)
  assert.equal(state(`JSON.stringify(cachedSuggestions('충남대'))`), JSON.stringify({
    exact:false,
    items:[{ id:1, name:'충남대학교병원', address:'대전광역시 중구' }]
  }))
})

test('Korean IME input schedules suggestions before composition ends', () => {
  assert.match(source, /input\.addEventListener\('input', event => schedule\(\{ includeList: !event\.isComposing && !composing \}\)\)/)
  assert.match(source, /if \(includeList\) searchTimer = window\.setTimeout/)
  assert.doesNotMatch(source, /if \(composing\) return/)
})

test('map loads nearby public toilet markers and opens their editor on click', () => {
  assert.match(source, /\/api\/v1\/toilets\?\$\{query\}/)
  assert.match(source, /includeList:'true'/)
  assert.match(source, /toilet-public-marker/)
  assert.match(source, /toilet-marker-logo\.svg/)
  assert.match(source, /label\.textContent = name/)
  assert.match(source, /selectToilet\(Number\(toilet\.id\)\)/)
  assert.match(source, /map\.getLevel\(\) > 6/)
})

test('list shows ten readable address cards per page', () => {
  assert.match(source, /const PAGE_SIZE = 10/)
  assert.match(css, /\.toilet-list-address\s*\{[^}]*-webkit-line-clamp:\s*2/)
  assert.match(css, /\.toilet-list-item\s*\{[^}]*min-height:\s*82px/)
})

test('page exposes the requested search, region, list, map and comparison workspaces', () => {
  for (const id of ['toilet-search','toilet-suggestions','toilet-sido','toilet-sigungu','toilet-list','toilet-pagination','toilet-map-card','toilet-editor-card']) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(html, /toilet-list-pane[\s\S]*toilet-map-card[\s\S]*toilet-editor-card/)
  assert.match(css, /grid-template-columns:\s*minmax\(320px,.68fr\)\s*minmax\(460px,1.18fr\)\s*minmax\(450px,1.14fr\)/)
  assert.doesNotMatch(html, /toilet-detail-pane/)
  assert.match(source, /\/api\/admin\/v1\/toilets\/suggestions/)
  assert.match(source, /compositionstart/)
  assert.match(source, /snapshotToken/)
})

test('data management navigation places toilet data after report review', () => {
  const shell = readFileSync(new URL('admin-shell.js', root), 'utf8')
  assert.ok(shell.indexOf("nav('reports'") < shell.indexOf("nav('toilets'"))
})

test('pre-deployment preview falls back to existing real-data reads without allowing writes', () => {
  assert.match(source, /error\.status !== 404/)
  assert.match(source, /api\/admin\/v1\/regions\?/)
  assert.match(source, /api\/v1\/toilets\/\$\{id\}/)
  assert.match(source, /프리뷰 저장 차단/)
  assert.match(source, /if \(legacyPreview\) return/)
})
