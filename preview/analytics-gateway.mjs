export const PREFIX = '/admin-analytics'
const SITE = 'https://preview.geupddong.com'
export const AUTH_URL = 'https://api.geupddong.com/__analytics-preview-auth'
const SESSION = '__Secure-AnalyticsPreview'
const STATE = '__Secure-AnalyticsPreviewState'
const encoder = new TextEncoder()
const assets = new Set(['service-analytics.html', 'service-analytics.js', 'origin-bots.js', 'service-analytics.css', 'dashboard.css', 'admin-shell.js', 'admin-shell.css', 'admin-session.css'])
const endpoints = new Set(['/preview-auth', '/api/admin/v1/service-analytics/explore', '/api/admin/v1/service-analytics/realtime', '/api/admin/v1/service-analytics/origin-bots'])
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.geupddong.com; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" }
const reply = (status, message) => new Response(JSON.stringify({ message }), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } })
const cookie = (request, name) => (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1)
const cookieValue = (name, value, age) => `${name}=${value}; Path=${PREFIX}; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`
const random = size => crypto.getRandomValues(new Uint8Array(size))
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
const validToken = token => typeof token === 'string' && token.length <= 2200 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)
const same = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return diff === 0
}
async function key(env) {
  if (!/^[a-f0-9]{64}$/.test(env.PREVIEW_SESSION_KEY || '')) throw new Error('Missing session key')
  return crypto.subtle.importKey('raw', Uint8Array.from(env.PREVIEW_SESSION_KEY.match(/../g), h => parseInt(h, 16)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function seal(payload, env) {
  const iv = random(12)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(SITE + PREFIX) }, await key(env), encoder.encode(JSON.stringify(payload)))
  return encode(iv) + '.' + encode(new Uint8Array(encrypted))
}
async function open(value, env, purpose, time) {
  if (!value || value.length > 3800 || !/^[\w-]+\.[\w-]+$/.test(value)) return null
  try {
    const [iv, body] = value.split('.').map(decode)
    if (iv.length !== 12) return null
    const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(SITE + PREFIX) }, await key(env), body)
    const data = JSON.parse(new TextDecoder().decode(decoded))
    if (data.aud !== SITE + PREFIX || data.purpose !== purpose || !Number.isFinite(data.exp) || data.exp <= time || data.exp > Number(env.PREVIEW_EXPIRES_AT) || data.exp - time > 900000 || !validToken(data.token)) return null
    return data
  } catch { return null }
}
function login() {
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>관리자 로그인 · 분석 프리뷰</title><body style="font:16px system-ui;background:#f3f7f5;color:#173b2a;padding:8vh 24px"><main style="max-width:480px;margin:auto;padding:28px;background:white;border:1px solid #dce8e0;border-radius:16px"><h1>관리자 로그인이 필요합니다</h1><p>기존 관리자 계정으로 로그인한 뒤 아래 프리뷰 주소를 다시 열어 주세요.</p><p><a href="https://api.geupddong.com/api/v1/auth/login/google?returnTo=preview">Google 로그인</a> · <a href="https://api.geupddong.com/api/v1/auth/login/kakao?returnTo=preview">Kakao 로그인</a></p><a href="${SITE}${PREFIX}/">로그인 후 프리뷰 열기</a></main></body></html>`, { status: 401, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
}
function challenge() {
  return new Response(null, { status: 302, headers: { ...headers, Location: AUTH_URL + '?state=' + hex(random(32)), } })
}
async function identity(fetcher, token) {
  const response = await fetcher('https://api.geupddong.com/api/v1/auth/me', { method: 'GET', headers: { Cookie: 'geupddong_access=' + token, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8000) })
  if (!response.ok) { await response.body?.cancel(); return { status: response.status === 403 ? 403 : 401 } }
  const result = await response.json()
  if (!Array.isArray(result.roles) || !result.roles.includes('ADMIN')) return { status: 403 }
  return { status: 200, expiresAt: Date.parse(result.accessTokenExpiresAt) }
}

export function createHandler(fetcher = fetch, now = () => Date.now()) {
  return async (request, env) => {
    const url = new URL(request.url)
    const authPath = url.origin + url.pathname === AUTH_URL
    if (!authPath && (url.origin !== SITE || !(url.pathname === PREFIX || url.pathname.startsWith(PREFIX + '/')))) return reply(404, '프리뷰 경로가 아닙니다.')
    const expiry = Number(env.PREVIEW_EXPIRES_AT)
    if (!Number.isFinite(expiry) || expiry <= now() || expiry - now() > 86400000) return reply(410, '임시 프리뷰가 종료되었습니다.')
    if (url.search.length > 1500) return reply(400, '조회 조건이 너무 깁니다.')
    if (url.origin === SITE && url.pathname === PREFIX + '/__session' && request.method === 'POST') {
      // This callback changes only the preview's own cookie, never operational data.
      if (request.headers.get('Origin') !== new URL(AUTH_URL).origin || !request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return reply(403, '인증 요청 출처를 확인할 수 없습니다.')
      if (Number(request.headers.get('Content-Length')) > 5000) return reply(413, '인증 요청이 너무 큽니다.')
      const reader = request.body?.getReader()
      let body = ''
      if (!reader) return reply(400, '인증 요청이 없습니다.')
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        body += new TextDecoder().decode(value)
        if (body.length > 5000) { await reader.cancel(); return reply(413, '인증 요청이 너무 큽니다.') }
      }
      const ticket = await open(new URLSearchParams(body).get('ticket'), env, 'exchange', now())
      if (!ticket || !same(ticket.state, cookie(request, STATE)) || !Number.isFinite(ticket.sessionExp) || ticket.sessionExp <= now() || ticket.sessionExp > Math.min(expiry, now() + 900000)) return reply(403, '인증 연결이 만료되었습니다. 프리뷰를 다시 열어 주세요.')
      const session = await seal({ aud: SITE + PREFIX, purpose: 'session', exp: ticket.sessionExp, token: ticket.token }, env)
      const responseHeaders = new Headers({ ...headers, Location: SITE + PREFIX + '/' })
      responseHeaders.append('Set-Cookie', cookieValue(SESSION, session, Math.floor((ticket.sessionExp - now()) / 1000)))
      responseHeaders.append('Set-Cookie', cookieValue(STATE, '', 0))
      return new Response(null, { status: 303, headers: responseHeaders })
    }
    if (request.method !== 'GET') return reply(405, '읽기 전용 프리뷰입니다.')
    if (authPath) {
      if (!/^[a-f0-9]{64}$/.test(url.searchParams.get('state') || '')) return reply(400, '프리뷰 화면에서 다시 연결해 주세요.')
      const token = cookie(request, 'geupddong_access')
      if (!validToken(token)) return login()
      try {
        const result = await identity(fetcher, token)
        if (result.status === 401) return login()
        if (result.status !== 200) return reply(403, '관리자 권한이 필요합니다.')
        const sessionExp = Math.min(expiry, now() + 900000, result.expiresAt)
        if (!Number.isFinite(sessionExp) || sessionExp <= now() + 1000) return login()
        const ticket = await seal({ aud: SITE + PREFIX, purpose: 'exchange', state: url.searchParams.get('state'), token, exp: Math.min(sessionExp, now() + 60000), sessionExp }, env)
        const nonce = hex(random(16))
        // The encrypted, state-bound ticket travels in a POST body, never a URL.
        // no-referrer makes Chrome send Origin: null on navigation POSTs.
        // Send only the API origin (never query/state/token) so strict CSRF validation remains enabled.
        return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>분석 프리뷰 연결</title><body><p>관리자 인증을 확인했습니다. 프리뷰로 이동합니다.</p><form method="post" action="${SITE}${PREFIX}/__session"><input type="hidden" name="ticket" value="${ticket}"><button type="submit">프리뷰 열기</button></form><script nonce="${nonce}">document.forms[0].submit()</script></body></html>`, { headers: { ...headers, 'Referrer-Policy': 'origin', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${SITE}; base-uri 'none'; frame-ancestors 'none'` } })
      } catch { return reply(503, '프리뷰 인증 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.') }
    }
    const path = url.pathname.slice(PREFIX.length) || '/service-analytics.html'
    const target = path === '/' ? '/service-analytics.html' : path
    if (!assets.has(target.slice(1)) && !endpoints.has(target)) return reply(404, '지원하지 않는 경로입니다.')
    if (!/^[a-f0-9]{64}$/.test(env.PREVIEW_SESSION_KEY || '')) return reply(503, '프리뷰 인증 연결을 준비 중입니다.')
    const session = await open(cookie(request, SESSION), env, 'session', now())
    if (!session) {
      if (target.endsWith('.html')) {
        const response = challenge()
        response.headers.set('Set-Cookie', cookieValue(STATE, new URL(response.headers.get('Location')).searchParams.get('state'), 180))
        return response
      }
      return reply(401, '관리자 로그인이 필요합니다.')
    }
    try {
      // Verify the caller's current role with the existing API; never substitute a privileged service identity.
      const result = await identity(fetcher, session.token)
      if (result.status !== 200) return result.status === 401 && target.endsWith('.html') ? login() : reply(result.status, '관리자 로그인을 다시 확인해 주세요.')
      if (target === '/preview-auth') return new Response(JSON.stringify({ roles: ['ADMIN'], nickname: '관리자' }), { headers: { ...headers, 'Content-Type': 'application/json' } })
      if (!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com$/.test(env.PREVIEW_ORIGIN || '') || !/^[a-f0-9]{64}$/.test(env.PREVIEW_GATEWAY_TOKEN || '')) return reply(503, '프리뷰 연결을 준비 중입니다.')
      const upstream = await fetcher(env.PREVIEW_ORIGIN + target + url.search, { method: 'GET', headers: { 'X-Preview-Gateway': env.PREVIEW_GATEWAY_TOKEN, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(15000) })
      if (upstream.status >= 300 && upstream.status < 400) { await upstream.body?.cancel(); return reply(502, '예상하지 않은 프리뷰 응답입니다.') }
      const type = upstream.headers.get('Content-Type') || 'application/json'
      let body = await upstream.text()
      if (type.includes('text/html')) body = body.replaceAll('href="/', `href="${PREFIX}/`).replaceAll('src="/', `src="${PREFIX}/`)
      if (target === '/service-analytics.js' || target === '/origin-bots.js') body = body.replaceAll('`/api/admin/v1/service-analytics/', '`' + PREFIX + '/api/admin/v1/service-analytics/').replaceAll("'/api/admin/v1/service-analytics/", "'" + PREFIX + '/api/admin/v1/service-analytics/').replaceAll("'/preview-auth'", "'" + PREFIX + "/preview-auth'")
      return new Response(body, { status: upstream.status, headers: { ...headers, 'Content-Type': type } })
    } catch { return reply(503, '프리뷰 인증 또는 연결이 지연됩니다. 잠시 후 다시 시도해 주세요.') }
  }
}
export default { fetch: createHandler() }
