const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const model = require('../src/main/resources/static/admin-home-model.js')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

assert.equal(model.REVIEW_SIZE, 7)
assert.equal(model.nextBatchInstant('2026-09-14T16:59:59Z').toISOString(), '2026-09-14T17:00:00.000Z')
assert.equal(model.nextBatchInstant('2026-09-14T17:00:00Z').toISOString(), '2026-09-15T17:00:00.000Z')
assert.equal(model.nextBatchInstant('2026-09-15T14:59:59Z').toISOString(), '2026-09-15T17:00:00.000Z')
assert.deepEqual(model.reviewPage(0, 0, 0), { start: 0, first: 0, last: 0, totalPages: 0 })
assert.deepEqual(model.reviewPage(1, 0, 1), { start: 0, first: 1, last: 1, totalPages: 1 })
assert.deepEqual(model.reviewPage(7, 0, 7), { start: 0, first: 1, last: 7, totalPages: 1 })
assert.deepEqual(model.reviewPage(8, 1, 1), { start: 7, first: 8, last: 8, totalPages: 2 })
assert.equal(model.reviewHref('reports', { id: 31 }), '/reports.html?reportId=31')
assert.equal(model.reviewHref('coordinates', { groupKey: '37.5, 127.0' }), '/data-quality.html?groupKey=37.5%2C%20127.0')
assert.equal(model.reviewHref('regions', { toiletId: 1111 }), '/regions.html?toiletId=1111')

const html = read('src/main/resources/static/index.html')
const css = read('src/main/resources/static/home.css')
const script = read('src/main/resources/static/dashboard.js')
const sharedCss = read('src/main/resources/static/admin-shell.css')
const regionHtml = read('src/main/resources/static/regions.html')
const regionCss = read('src/main/resources/static/regions.css')
const regionScript = read('src/main/resources/static/regions.js')
const adminPages = [
  'batch-syncs.html', 'cloudflare.html', 'data-quality.html', 'features.html',
  'members.html', 'notifications.html', 'operations.html', 'permissions.html',
  'regions.html', 'reports.html', 'toilets.html',
]

for (const page of adminPages) {
  const pageHtml = read(`src/main/resources/static/${page}`)
  const loader = pageHtml.match(/<main id="loading-shell"[^>]*>/)?.[0] || ''
  const workspace = pageHtml.match(/<main id="[^"]+"[^>]*data-admin-page="[^"]+"[^>]*>/)?.[0] || ''
  assert.match(loader, /\bhidden\b/, `${page} must not render a full-page loader while authentication is pending`)
  assert.doesNotMatch(workspace, /\bhidden\b/, `${page} must render its static workspace before data arrives`)
}

assert.match(html.match(/<main id="loading-shell"[^>]*>/)?.[0] || '', /\bhidden\b/)
assert.doesNotMatch(html.match(/<div id="dashboard-shell"[^>]*>/)?.[0] || '', /\bhidden\b/)
assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto/)
assert.match(sharedCss, /@view-transition\s*\{\s*navigation:\s*auto/)
assert.match(regionHtml, /<body class="admin-page region-page">/)
assert.match(regionHtml, /id="region-workspace"[^>]*aria-busy="true"/)
assert.match(regionHtml, /class="region-list-pane"/)
assert.match(regionHtml, /class="region-list-skeleton"/)
assert.doesNotMatch(regionHtml, /id="region-search"/)
assert.match(regionHtml, /class="region-list-head"[\s\S]*id="region-filter"[\s\S]*id="region-refresh"/)
assert.match(regionCss, /body\.region-page\s*\{\s*overflow:\s*hidden/)
assert.match(regionCss, /\.region-workspace[^}]*max-width:\s*1850px/s)
assert.match(regionCss, /\.region-layout[^}]*flex:\s*1 1 auto/s)
assert.match(regionCss, /\.region-layout[^}]*grid-template-columns:\s*minmax\(0,1fr\) minmax\(0,2fr\)/s)
assert.match(regionCss, /\.region-decision-layout[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s)
assert.match(regionCss, /\.region-list-pane[^}]*height:\s*100%/s)
assert.match(regionCss, /\.region-detail[^}]*overflow-y:\s*auto/s)
assert.match(regionCss, /\.region-item[^}]*min-height:\s*60px/s)
assert.match(regionCss, /@media \(max-width:\s*900px\)[\s\S]*body\.region-page\s*\{\s*overflow:\s*auto/)
assert.match(regionScript, /setAttribute\('aria-busy', 'true'\)/)
assert.match(regionScript, /setAttribute\('aria-busy', 'false'\)/)
assert.doesNotMatch(regionScript, /region-search/)
assert.match(regionScript, /class="region-item-meta"/)
assert.match(html, /<thead><tr><th scope="col">순번<\/th>/)
assert.ok(html.indexOf('/admin-home-model.js') < html.indexOf('/dashboard.js'))
assert.match(css, /\.review-table-shell[^}]*overflow-y:\s*hidden/s)
assert.match(css, /\.review-table strong,[^}]*\.review-context[^}]*text-overflow:\s*ellipsis/s)
assert.match(css, /@media \(max-width: 1050px\)/)
assert.match(css, /@media \(max-width: 900px\)/)
assert.match(css, /@media \(max-width: 760px\)/)
assert.match(css, /@media \(max-width: 460px\)/)
assert.match(script, /size:\s*String\(REVIEW_SIZE\)/)
assert.match(script, /window\.location\.assign\(row\.dataset\.href\)/)

console.log('Admin home acceptance contracts passed.')
