import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../src/main/resources/static/', import.meta.url)

test('admin navigation and home link to the analytics workspace', async () => {
  const [shell, home] = await Promise.all([
    readFile(new URL('admin-shell.js', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
  ])
  assert.match(shell, /서비스 이용 분석/)
  assert.match(shell, /\/service-analytics\.html/)
  assert.match(home, /id="analytics-realtime-users"/)
  assert.match(home, /id="analytics-mini-chart"/)
})

test('analytics detail keeps a static shell and replaces only async data regions', async () => {
  const [page, script] = await Promise.all([
    readFile(new URL('service-analytics.html', root), 'utf8'),
    readFile(new URL('service-analytics.js', root), 'utf8'),
  ])
  for (const id of ['analytics-view', 'analytics-kpis', 'analytics-filter-chips', 'analytics-error', 'analytics-export']) {
    assert.match(page, new RegExp(`id="${id}"`))
  }
  assert.match(script, /\/api\/admin\/v1\/service-analytics\/explore/)
  assert.match(script, /AbortController/)
  assert.doesNotMatch(script, /innerHTML\s*=\s*await\s+response\.text/)
})
