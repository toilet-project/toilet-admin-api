import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { previewHtml, previewJavaScript } from './build-admin-preview.mjs'

test('moves static navigation and assets below the isolated admin preview path', () => {
  const html = previewHtml('<body><a href="/reports.html">검토</a><script src="/dashboard.js"></script><a href="https://api.geupddong.com/api/v1/auth/login/google?returnTo=admin">로그인</a></body>')
  assert.match(html, /src="\/preview\/admin-preview-runtime\.js\?v=3"/)
  assert.match(html, /href="\/preview\/reports\.html"/)
  assert.match(html, /src="\/preview\/dashboard\.js"/)
  assert.match(html, /returnTo=admin/)
})

test('moves JavaScript page navigation without rewriting API paths', () => {
  const source = "location.assign('/'); const page='/reports.html?id=1'; const api='/api/admin/v1/dashboard'"
  const output = previewJavaScript(source)
  assert.match(output, /assign\('\/preview\/'\)/)
  assert.match(output, /'\/preview\/reports\.html\?id=1'/)
  assert.match(output, /'\/api\/admin\/v1\/dashboard'/)
})

test('deployment route is limited to the preview path on the admin host', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.admin-preview.jsonc', import.meta.url), 'utf8'))
  assert.equal(config.name, 'geupddong-admin-preview')
  assert.deepEqual(config.routes, [{ pattern: 'admin.geupddong.com/preview*', zone_name: 'geupddong.com' }])
  assert.equal(config.workers_dev, false)
  assert.equal(config.preview_urls, false)
})
