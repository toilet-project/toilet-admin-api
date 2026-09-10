import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/main/resources/static/reports.js', import.meta.url), 'utf8')
  .replace(/bootstrap\(\)\s*$/, '')

function fixture(payload) {
  const nodes = new Map()
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', handlers: {}, replaceChildren() {},
      addEventListener(event, handler) { this.handlers[event] = handler } })
    return nodes.get(id)
  }
  const requests = []
  const context = vm.createContext({ URL, document: { getElementById: node },
    window: { location: { href: 'https://admin.example.invalid/reports.html' }, history: { replaceState() {} } },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => payload } },
  })
  vm.runInContext(source, context)
  return { context, node, requests }
}

test('author markup escapes user controlled HTML and quotes', () => {
  const { context } = fixture()
  const html = context.reporterMarkup('<img src=x onerror="alert(1)"> & \'')
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img/)
  assert.match(html, /&quot;/)
  assert.match(html, /&amp;/)
  assert.match(html, /&#39;/)
  assert.match(html, /overflow-wrap:anywhere/)
})

test('older API response never invents a withdrawal state', () => {
  const { context } = fixture()
  for (const name of [undefined, null, '', '   ', {}]) {
    assert.match(context.reporterMarkup(name), /작성자 정보 없음/)
    assert.doesNotMatch(context.reporterMarkup(name), /탈퇴한 사용자/)
  }
})

for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) {
  test(`detail renders safe author label and closes without writes: ${status}`, async () => {
    const f = fixture({ report: { id: 1, toiletId: 2, toiletName: '합성 화장실', reportType: 'OPEN_TIME_CORRECTION',
      status, reason: '합성 사유', openTime: '09:00' }, toilet: { openTime: '10:00' }, reporterDisplayName: '탈퇴한 사용자' })
    await f.context.selectReport(1)
    assert.match(f.node('report-detail').innerHTML, /작성자 · 탈퇴한 사용자/)
    assert.match(f.node('report-detail').innerHTML, /합성 사유/)
    assert.equal(f.requests.length, 1)
    assert.equal(f.requests[0].options.method, undefined)
    f.node('report-detail-close').handlers.click()
    assert.match(f.node('report-detail').innerHTML, /왼쪽 목록에서/)
    assert.equal(f.requests.length, 1)
  })
}

test('restored and changed nickname is displayed on the next detail read', async () => {
  const payload = { report: { id: 1, toiletId: 2, reportType: 'OPEN_TIME_CORRECTION', status: 'PENDING' },
    toilet: {}, reporterDisplayName: '탈퇴한 사용자' }
  const f = fixture(payload)
  await f.context.selectReport(1)
  payload.reporterDisplayName = '복구한 닉네임'
  await f.context.selectReport(1)
  assert.match(f.node('report-detail').innerHTML, /작성자 · 복구한 닉네임/)
  assert.doesNotMatch(f.node('report-detail').innerHTML, /탈퇴한 사용자/)
})
