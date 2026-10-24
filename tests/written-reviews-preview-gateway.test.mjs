import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { createHandler, AUTH_URL, PREFIX } from '../preview/written-reviews-gateway.mjs'

const site = 'https://preview.geupddong.com' + PREFIX
const url = site + '/api/admin/v1/reviews?size=20'
const env = { PREVIEW_EXPIRES_AT: '1000000', PREVIEW_ORIGIN: 'https://safe-preview-test.trycloudflare.com', PREVIEW_GATEWAY_TOKEN: 'a'.repeat(64), PREVIEW_SESSION_KEY: 'b'.repeat(64) }
const token = 'example.jwt.value'
const profile = { roles: ['ADMIN'], email: 'never-display@example.invalid', accessTokenExpiresAt: new Date(950000).toISOString() }
const stateCookie = value => '__Secure-WrittenReviewsPreviewState=' + value
const sessionCookie = value => '__Secure-WrittenReviewsPreview=' + value
function setup() {
  const calls = []
  const state = { time: 10000, status: 200, roles: ['ADMIN'], body: { items: [] }, type: 'application/json' }
  const handle = createHandler(async (target, options) => {
    calls.push([target, options])
    if (target.includes('/api/v1/auth/me')) return Response.json({ ...profile, roles: state.roles, accessTokenExpiresAt: state.expiresAt || profile.accessTokenExpiresAt }, { status: state.status })
    return typeof state.body === 'object' && !(state.body instanceof Uint8Array) ? Response.json(state.body) : new Response(state.body, { status: state.upstreamStatus || 200, headers: { 'Content-Type': state.type } })
  }, () => state.time)
  env.ASSETS = { fetch: async request => {
    calls.push(['asset:' + new URL(request.url).pathname, {}])
    return new Response(state.body, { status: state.upstreamStatus || 200, headers: { 'Content-Type': state.type } })
  } }
  return { handle, calls, state }
}
async function getTicket(handle) {
  const response = await handle(new Request(site + '/?tab=reviews'), env)
  assert.equal(response.status, 302)
  const redirect = response.headers.get('Location')
  const state = new URL(redirect).searchParams.get('state')
  assert.match(state, /^[a-f0-9]{64}$/)
  assert.match(response.headers.get('Set-Cookie'), /Path=\/admin-written-reviews; Max-Age=180; HttpOnly; Secure; SameSite=Lax/)
  assert.equal(response.headers.get('Set-Cookie').includes('Domain='), false)
  const exchange = await handle(new Request(redirect, { headers: { Cookie: 'irrelevant=never-forward; geupddong_access=' + token } }), env)
  assert.equal(exchange.status, 200)
  const html = await exchange.text()
  assert.equal(html.includes(token), false)
  assert.equal(html.includes(profile.email), false)
  assert.equal(exchange.headers.get('Referrer-Policy'), 'origin')
  return { state, ticket: html.match(/name="ticket" value="([\w.-]+)"/)[1] }
}
const callback = (ticket, state, origin = 'https://api.geupddong.com') => new Request(site + '/__session', { method: 'POST', headers: { Origin: origin, Cookie: stateCookie(state), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket }) })
async function connect(handle) {
  const { ticket, state } = await getTicket(handle)
  const response = await handle(callback(ticket, state), env)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('Location'), site + '/?tab=reviews')
  const cookies = response.headers.getSetCookie()
  assert.equal(cookies.length, 2)
  assert.equal(cookies.join().includes('Domain='), false)
  assert.equal(cookies.join().includes(token), false)
  return cookies[0].match(/^__Secure-WrittenReviewsPreview=([^;]+)/)[1]
}
test('anonymous, wrong host, expired preview, non-admin and all writes cannot reach live reviews', async () => {
  const { handle, calls, state } = setup()
  assert.equal((await handle(new Request(url), env)).status, 401)
  assert.equal((await handle(new Request(url), { ...env, PREVIEW_EXPIRES_AT: '9999' })).status, 410)
  assert.equal((await handle(new Request(url), { ...env, PREVIEW_EXPIRES_AT: '8000000' })).status, 410)
  assert.equal((await handle(new Request(url, { method: 'POST' }), env)).status, 405)
  assert.equal((await handle(new Request(site + '/api/admin/v1/reviews/17', { method: 'DELETE' }), env)).status, 405)
  assert.equal((await handle(new Request(url.replace('preview.geupddong.com', 'attacker.invalid')), env)).status, 404)
  assert.equal((await handle(new Request(AUTH_URL + '?state=' + 'c'.repeat(64)), env)).status, 401)
  assert.equal(calls.length, 0)
  state.roles = ['USER']
  assert.equal((await handle(new Request(AUTH_URL + '?state=' + 'c'.repeat(64), { headers: { Cookie: 'geupddong_access=' + token } }), env)).status, 403)
  assert.equal(calls.length, 1)
})
test('state-bound encrypted host-only session rechecks ADMIN and forwards only isolated key', async () => {
  const { handle, calls } = setup()
  const session = await connect(handle)
  calls.length = 0
  const response = await handle(new Request(url, { headers: { Cookie: sessionCookie(session) } }), env)
  assert.equal(response.status, 200)
  assert.deepEqual(calls[0][1].headers, { Cookie: 'geupddong_access=' + token, Accept: 'application/json' })
  assert.deepEqual(calls[1][1].headers, { 'X-Preview-Gateway': env.PREVIEW_GATEWAY_TOKEN, Accept: 'application/json' })
  assert.equal(calls[1][0], env.PREVIEW_ORIGIN + '/api/admin/v1/reviews?size=20')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow')
})
test('wrong state/origin, ciphertext corruption and expired exchange fail without upstream access', async () => {
  const { handle, calls, state: clock } = setup()
  const { ticket, state } = await getTicket(handle)
  calls.length = 0
  assert.equal((await handle(callback(ticket, state, 'https://attacker.invalid'), env)).status, 403)
  assert.equal((await handle(callback(ticket, 'd'.repeat(64)), env)).status, 403)
  const corrupted = (ticket[0] === 'x' ? 'y' : 'x') + ticket.slice(1)
  assert.equal((await handle(callback(corrupted, state), env)).status, 403)
  assert.equal((await handle(callback(ticket, ''), env)).status, 403)
  clock.time = 71000
  assert.equal((await handle(callback(ticket, state), env)).status, 403)
  assert.equal(calls.length, 0)
})
test('role revocation, login expiry and session expiry stop live review access immediately', async () => {
  const { handle, calls, state } = setup()
  const session = await connect(handle)
  calls.length = 0
  const request = () => new Request(url, { headers: { Cookie: sessionCookie(session) } })
  state.status = 401
  assert.equal((await handle(request(), env)).status, 401)
  state.status = 200; state.roles = ['USER']
  assert.equal((await handle(request(), env)).status, 403)
  state.roles = ['ADMIN']; state.expiresAt = new Date(9000).toISOString()
  assert.equal((await handle(request(), env)).status, 401)
  state.time = 920000
  assert.equal((await handle(request(), env)).status, 401)
  assert.equal(calls.length, 3)
})
test('snapshot files, unrelated APIs, malformed review IDs and redirects fail closed', async () => {
  const { handle, calls, state } = setup()
  for (const path of ['/snapshot.json', '/api/v1/members', '/api/admin/v1/reviews/01', '/api/admin/v1/reviews/1/actions', '/api/admin/v1/service-analytics/explore', '/../snapshot.json']) assert.equal((await handle(new Request(site + path), env)).status, 404)
  assert.equal((await handle(new Request(AUTH_URL + '/unexpected'), env)).status, 404)
  assert.equal((await handle(new Request(site + '/'), { ...env, PREVIEW_SESSION_KEY: '' })).status, 503)
  assert.equal(calls.length, 0)
  const session = await connect(handle)
  const request = () => new Request(url, { headers: { Cookie: sessionCookie(session) } })
  assert.equal((await handle(request(), { ...env, PREVIEW_ORIGIN: 'https://attacker.invalid' })).status, 503)
  state.body = 'redirect'; state.type = 'text/plain'; state.upstreamStatus = 302
  assert.equal((await handle(request(), env)).status, 502)
})
test('callback body byte size, query length and methods are bounded', async () => {
  const { handle, calls } = setup()
  assert.equal((await handle(callback('x'.repeat(5001), 'c'.repeat(64)), env)).status, 413)
  const unicode = new Request(site + '/__session', { method: 'POST', headers: { Origin: 'https://api.geupddong.com', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x='.repeat(3) + '한'.repeat(1800) })
  assert.equal((await handle(unicode, env)).status, 413)
  assert.equal((await handle(new Request(site + '/?x=' + 'a'.repeat(1500)), env)).status, 400)
  assert.equal((await handle(new Request(site + '/__session', { method: 'PUT' }), env)).status, 405)
  assert.equal((await handle(new Request(AUTH_URL, { method: 'POST' }), env)).status, 405)
  assert.equal(calls.length, 0)
})
test('authenticated binary assets preserve bytes and CSS fonts resolve inside preview', async () => {
  const { handle, calls, state } = setup()
  const imageUrl = site + '/brand/hangul-point-v1/favicon-32.png'
  assert.equal((await handle(new Request(imageUrl), env)).status, 401)
  const session = await connect(handle)
  state.body = new Uint8Array([137, 80, 78, 71, 0, 255, 128]); state.type = 'image/png'
  const response = await handle(new Request(imageUrl, { headers: { Cookie: sessionCookie(session) } }), env)
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), state.body)
  state.body = "@font-face{src:url('/brand/jua/geupddong.ttf')}"; state.type = 'text/css'
  const css = await handle(new Request(site + '/brand.css', { headers: { Cookie: sessionCookie(session) } }), env)
  assert.match(await css.text(), /url\('\/admin-written-reviews\/brand\/jua\/geupddong.ttf'\)/)
  assert.equal(calls.at(-1)[0], 'asset:/brand.css')
})
test('HTML inserts early read-only runtime, strips operational session controls and prefixes assets', async () => {
  const { handle, state } = setup()
  const session = await connect(handle)
  state.body = '<!doctype html><html><head><link href="/written-reviews.css"></head><body><script src="/admin-session.js?v=3"></script><script src="/written-reviews.js"></script></body></html>'; state.type = 'text/html'
  const response = await handle(new Request(site + '/', { headers: { Cookie: sessionCookie(session) } }), env)
  const body = await response.text()
  assert.match(body, /<head><script src="\/admin-written-reviews\/preview-runtime.js"><\/script>/)
  assert.equal(body.includes('admin-session.js'), false)
  assert.match(body, /src="\/admin-written-reviews\/written-reviews.js"/)
  assert.equal(body.includes('운영 실데이터'), true)
  assert.equal(body.includes('원문 복사본을 저장하지 않습니다'), true)
  assert.equal(body.includes('프리뷰에서는 리뷰를 삭제할 수 없습니다'), true)
})
test('runtime forwards relative review reads and identity only; operational writes and unrelated APIs are blocked', async () => {
  const { handle } = setup()
  const session = await connect(handle)
  const response = await handle(new Request(site + '/preview-runtime.js', { headers: { Cookie: sessionCookie(session) } }), env)
  const calls = []
  const window = { fetch: async (...args) => { calls.push(args); return Response.json({ ok: true }) } }
  vm.runInNewContext(await response.text(), { window, location: { href: site + '/?tab=reviews', origin: 'https://preview.geupddong.com' }, document: { addEventListener() {} }, URL, Request, Response })
  assert.equal(window.AdminWrittenReviewsPreview.readOnly, true)
  assert.equal(window.AdminWrittenReviewsPreview.moderationAllowed, false)
  assert.equal(Object.isFrozen(window.AdminWrittenReviewsPreview), true)
  await window.fetch('/api/admin/v1/reviews?size=20')
  assert.equal(String(calls[0][0]), site + '/api/admin/v1/reviews?size=20')
  await window.fetch('https://api.geupddong.com/api/v1/auth/me')
  assert.equal(String(calls[1][0]), site + '/preview-auth')
  await window.fetch('https://api.geupddong.com/api/admin/v1/reviews/17')
  assert.equal(String(calls[2][0]), site + '/api/admin/v1/reviews/17')
  assert.equal((await window.fetch('https://api.geupddong.com/api/v1/auth/refresh', { method: 'POST' })).status, 405)
  assert.equal((await window.fetch('https://api.geupddong.com/api/admin/v1/reviews/17', { method: 'DELETE', body: JSON.stringify({ reason: 'synthetic' }) })).status, 405)
  assert.equal((await window.fetch('/api/admin/v1/service-analytics/explore')).status, 503)
  assert.equal((await window.fetch('https://attacker.invalid/reviews')).status, 503)
  assert.equal(calls.length, 3)
})
