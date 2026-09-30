import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler, AUTH_URL } from '../preview/api-usage-gateway.mjs'

const site = 'https://preview.geupddong.com/admin-api-usage'
const url = site + '/api/admin/v1/api-usage'
const env = { PREVIEW_EXPIRES_AT: '1000000', PREVIEW_ORIGIN: 'https://safe-preview-test.trycloudflare.com', PREVIEW_GATEWAY_TOKEN: 'a'.repeat(64), PREVIEW_SESSION_KEY: 'b'.repeat(64) }
const token = 'example.jwt.value'
const fakeIdentity = { roles: ['ADMIN'], email: 'must-not-return@example.invalid', accessTokenExpiresAt: new Date(950000).toISOString() }
const stateCookie = value => '__Secure-ApiUsagePreviewState=' + value
const sessionCookie = value => '__Secure-ApiUsagePreview=' + value
function setup() {
  const calls = []
  const state = { time: 10000, status: 200, roles: ['ADMIN'] }
  const handle = createHandler(async (target, options) => {
    calls.push([target, options])
    return target.includes('/api/v1/auth/me') ? Response.json({ ...fakeIdentity, roles: state.roles }, { status: state.status }) : state.assetBody ? new Response(state.assetBody, { headers: { 'Content-Type': state.assetType } }) : Response.json({ current: { views: 4 } })
  }, () => state.time)
  return { handle, calls, state }
}
async function getTicket(handle) {
  const response = await handle(new Request(site + '/'), env)
  assert.equal(response.status, 302)
  const redirect = response.headers.get('Location')
  const state = new URL(redirect).searchParams.get('state')
  assert.match(state, /^[a-f0-9]{64}$/)
  assert.match(response.headers.get('Set-Cookie'), /Path=\/admin-api-usage; Max-Age=180; HttpOnly; Secure; SameSite=Lax/)
  assert.equal(response.headers.get('Set-Cookie').includes('Domain='), false)
  const exchange = await handle(new Request(redirect, { headers: { Cookie: 'unrelated=never-forward; geupddong_access=' + token } }), env)
  assert.equal(exchange.status, 200)
  assert.equal(exchange.headers.get('Referrer-Policy'), 'origin')
  const html = await exchange.text()
  assert.equal(html.includes(token), false)
  assert.equal(html.includes(fakeIdentity.email), false)
  assert.match(exchange.headers.get('Content-Security-Policy'), /form-action https:\/\/preview.geupddong.com/)
  return { state, ticket: html.match(/name="ticket" value="([\w.-]+)"/)[1] }
}
const callback = (ticket, state, origin = 'https://api.geupddong.com') => new Request(site + '/__session', { method: 'POST', headers: { Origin: origin, Cookie: stateCookie(state), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket }) })
async function connect(handle) {
  const { ticket, state } = await getTicket(handle)
  const response = await handle(callback(ticket, state), env)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('Location'), site + '/')
  const cookies = response.headers.getSetCookie()
  assert.equal(cookies.length, 2)
  assert.equal(cookies.some(c => c.includes('Domain=')), false)
  assert.equal(cookies.join().includes(token), false)
  return cookies[0].match(/^__Secure-ApiUsagePreview=([^;]+)/)[1]
}
test('anonymous API, expired preview, non-admin and writes never reach private snapshot', async () => {
  const { handle, calls, state } = setup()
  assert.equal((await handle(new Request(url), env)).status, 401)
  assert.equal((await handle(new Request(url + '/history?service=naver'), env)).status, 401)
  assert.equal((await handle(new Request(site + '/api/admin/v1/api-usage/estimate?metric=naver-map&quantity=100'), env)).status, 401)
  assert.equal((await handle(new Request(url), { ...env, PREVIEW_EXPIRES_AT: '9999' })).status, 410)
  assert.equal((await handle(new Request(url, { method: 'POST' }), env)).status, 405)
  assert.equal((await handle(new Request(AUTH_URL + '?state=' + 'c'.repeat(64)), env)).status, 401)
  assert.equal(calls.length, 0)
  state.roles = ['USER']
  assert.equal((await handle(new Request(AUTH_URL + '?state=' + 'c'.repeat(64), { headers: { Cookie: 'geupddong_access=' + token } }), env)).status, 403)
  assert.equal(calls.length, 1)
})
test('host-only encrypted session connects via state-bound POST and backend never receives user token', async () => {
  const { handle, calls } = setup()
  const session = await connect(handle)
  calls.length = 0
  const response = await handle(new Request(url, { headers: { Cookie: sessionCookie(session) } }), env)
  assert.equal(response.status, 200)
  assert.deepEqual(calls[0][1].headers, { Cookie: 'geupddong_access=' + token, Accept: 'application/json' })
  assert.equal(calls[1][1].headers.Cookie, undefined)
  assert.equal(calls[1][1].headers.Authorization, undefined)
  assert.equal(calls[1][1].headers['X-Preview-Gateway'], env.PREVIEW_GATEWAY_TOKEN)
  assert.match(response.headers.get('cache-control'), /no-store/)
  assert.deepEqual(await response.json(), { current: { views: 4 } })
  calls.length=0
  assert.equal((await handle(new Request(url+'/history?service=naver', {headers:{Cookie:sessionCookie(session)}}),env)).status,200)
  assert.equal(calls[1][0],env.PREVIEW_ORIGIN+'/api/admin/v1/api-usage/history?service=naver')
})

test('brand images remain authenticated and preserve binary bytes', async () => {
  const { handle, calls, state } = setup()
  const imageUrl = site + '/brand/hangul-point-v1/favicon.svg'
  assert.equal((await handle(new Request(imageUrl), env)).status, 401)
  assert.equal(calls.length, 0)
  const session = await connect(handle)
  state.assetBody = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128])
  state.assetType = 'image/svg+xml'
  calls.length = 0
  const response = await handle(new Request(imageUrl, { headers: { Cookie: sessionCookie(session) } }), env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'image/svg+xml')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), state.assetBody)
  assert.equal(calls[1][0], env.PREVIEW_ORIGIN + '/brand/hangul-point-v1/favicon.svg')
  assert.equal((await handle(new Request(site + '/brand/private.png', { headers: { Cookie: sessionCookie(session) } }), env)).status, 404)
})
test('wrong origin, state, ciphertext and expired exchange fail closed', async () => {
  const { handle, calls, state: clock } = setup()
  const { ticket, state } = await getTicket(handle)
  calls.length = 0
  assert.equal((await handle(callback(ticket, state, 'https://evil.invalid'), env)).status, 403)
  assert.equal((await handle(callback(ticket, 'd'.repeat(64)), env)).status, 403)
  const tamperedTicket = (ticket[0] === 'x' ? 'y' : 'x') + ticket.slice(1)
  assert.notEqual(tamperedTicket, ticket)
  assert.equal((await handle(callback(tamperedTicket, state), env)).status, 403)
  assert.equal((await handle(callback(ticket, ''), env)).status, 403)
  clock.time = 71000
  assert.equal((await handle(callback(ticket, state), env)).status, 403)
  assert.equal(calls.length, 0)
})
test('revoked API authorization and expired session cannot reach snapshot', async () => {
  const { handle, calls, state } = setup()
  const session = await connect(handle)
  calls.length = 0
  const request = () => new Request(url, { headers: { Cookie: sessionCookie(session) } })
  state.status = 401
  assert.equal((await handle(request(), env)).status, 401)
  state.status = 200; state.roles = ['USER']
  assert.equal((await handle(request(), env)).status, 403)
  assert.equal(calls.length, 2)
  state.time = 920000
  assert.equal((await handle(request(), env)).status, 401)
  assert.equal(calls.length, 2)
})
test('raw data paths, open redirects, missing secret and invalid upstream cannot be used', async () => {
  const { handle, calls } = setup()
  for (const path of ['/snapshot.ndjson', '/api/v1/members', '/../snapshot.ndjson']) assert.equal((await handle(new Request(site + path), env)).status, 404)
  assert.equal((await handle(new Request(AUTH_URL + '/unexpected'), env)).status, 404)
  assert.equal((await handle(new Request(site + '/'), { ...env, PREVIEW_SESSION_KEY: '' })).status, 503)
  assert.equal(calls.length, 0)
  const session = await connect(handle)
  assert.equal((await handle(new Request(url, { headers: { Cookie: sessionCookie(session) } }), { ...env, PREVIEW_ORIGIN: 'https://example.invalid' })).status, 503)
})
test('session callback is bounded and all other methods remain blocked', async () => {
  const { handle, calls } = setup()
  assert.equal((await handle(callback('x'.repeat(5001), 'c'.repeat(64)), env)).status, 413)
  assert.equal((await handle(new Request(site + '/__session', { method: 'PUT' }), env)).status, 405)
  assert.equal((await handle(new Request(AUTH_URL, { method: 'POST' }), env)).status, 405)
  assert.equal(calls.length, 0)
})
