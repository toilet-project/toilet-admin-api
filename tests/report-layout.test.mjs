import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const css = readFileSync(new URL('../src/main/resources/static/reports.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../src/main/resources/static/reports.html', import.meta.url), 'utf8')

test('report queue has a bounded desktop width without overriding the mobile stack', () => {
  const desktop = css.slice(css.indexOf('@media (min-width: 761px)'), css.indexOf('.report-resolution {'))
  assert.match(desktop, /\.admin-page \.report-review-shell \{ max-width: 1600px; \}/)
  assert.match(desktop, /\.report-review-shell \.review-layout \{ grid-template-columns: 260px minmax\(0, 1fr\); \}/)
  assert.match(desktop, /:root\[data-admin-compact\] \.report-review-shell \.review-layout \{ grid-template-columns: 240px minmax\(0, 1fr\); \}/)
  assert.equal(css.replace(desktop, '').includes('.review-layout'), false)
})

test('narrow queue keeps full names and metadata wrapped and styles load last', () => {
  assert.match(css, /\.report-list-item > strong \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/)
  assert.match(css, /\.report-list-meta \{[^}]*flex-wrap: wrap;/)
  assert.match(css, /\.review-detail-column \{ min-width: 0; \}/)
  assert.ok(html.indexOf('/reports.css?v=') > html.indexOf('/admin-responsive.css'))
})
