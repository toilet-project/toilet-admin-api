import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../src/main/resources/static/', import.meta.url)

test('admin navigation and home link to the analytics workspace', async () => {
  const [shell, home] = await Promise.all([
    readFile(new URL('admin-shell.js', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
  ])
  assert.match(shell, /Google Analytics/)
  assert.match(shell, /\/google-analytics\.html/)
  assert.match(home, /id="ga-realtime-users"/)
  assert.match(home, /id="ga-mini-chart"/)
})

test('analytics detail keeps a static shell and replaces only async data regions', async () => {
  const [page, script] = await Promise.all([
    readFile(new URL('google-analytics.html', root), 'utf8'),
    readFile(new URL('google-analytics.js', root), 'utf8'),
  ])
  for (const id of ['ga-trend-chart', 'ga-pages', 'ga-channels', 'ga-devices', 'ga-events', 'ga-health-status']) {
    assert.match(page, new RegExp(`id="${id}"`))
  }
  assert.match(script, /\/api\/admin\/v1\/google-analytics\/trend/)
  assert.match(script, /Promise\.all/)
  assert.doesNotMatch(script, /innerHTML\s*=\s*await\s+response\.text/)
})
