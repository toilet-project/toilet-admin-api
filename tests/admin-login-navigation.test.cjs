const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { test } = require('node:test')

const staticRoot = path.resolve(__dirname, '../src/main/resources/static')
const html = fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf8')
const source = fs.readFileSync(path.join(staticRoot, 'dashboard.js'), 'utf8')
const model = fs.readFileSync(path.join(staticRoot, 'admin-home-model.js'), 'utf8')
const homeMarkup = html.slice(html.indexOf('<main class="dashboard-shell home-shell"'), html.lastIndexOf('</main>'))
const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
const homeIds = [...homeMarkup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
const destinationHtml = fs.readFileSync(path.join(staticRoot, 'toilets.html'), 'utf8')
const destinationMarkup = destinationHtml.slice(destinationHtml.indexOf('<main id="toilet-shell"'), destinationHtml.lastIndexOf('</main>'))
const destinationIds = [...destinationMarkup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
const homeEndpoints = [
  '/api/admin/v1/cloudflare/usage', '/api/admin/v1/service-analytics/overview',
  '/api/admin/v1/dashboard', '/api/admin/v1/reports/summary',
  '/api/admin/v1/data-quality/duplicate-coordinates', '/api/admin/v1/regions',
]

function element() {
  return {
    hidden: false, disabled: false, textContent: '', innerHTML: '', value: '',
    isConnected: true, dataset: {}, style: { setProperty() {} },
    classList: { add() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, replaceChildren() {},
    closest() { return this },
  }
}

function dataFor(pathname) {
  switch (pathname) {
    case '/api/v1/auth/me': return { roles: ['ADMIN'], accessTokenExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
    case '/api/admin/v1/operations/status': return { admin: {status: 'UP'}, publicApi: {status: 'UP'}, database: {status: 'UP'}, batch: {status: 'UP'} }
    case '/api/admin/v1/operations/host': return { status: 'OK', generatedAt: new Date().toISOString(), latest: {cpuPercent: 1, memoryPercent: 1, diskPercent: 1} }
    case '/api/admin/v1/cloudflare/usage': return { available: true, metrics: [], message: 'OK' }
    case '/api/admin/v1/service-analytics/overview': return { status: 'UP', available: true, data: {} }
    case '/api/admin/v1/dashboard': return { from: '2026-10-03', to: '2026-10-09', batch: {successfulRuns: 1, failedRuns: 0, insertedRecords: 0, updatedRecords: 0} }
    case '/api/admin/v1/reports/summary': return { pendingCount: 0, recentReports: [], overdueCount: 0 }
    case '/api/admin/v1/data-quality/duplicate-coordinates':
    case '/api/admin/v1/regions': return { items: [], page: 0, totalElements: 0, totalPages: 0 }
    default: throw new Error(`Unexpected request: ${pathname}`)
  }
}

// Run the shipped code unchanged apart from observing its bootstrap promise.
// Deferred requests deliberately ignore cancellation to model an already queued response.
async function workspace({delayedPath, delayJson = false, delayedStatus = 200, authStatus = 200, authError, roles = ['ADMIN']} = {}) {
  const elements = new Map(allIds.map(id => [id, element()]))
  elements.get('auth-shell').hidden = true
  const homeRoot = element(), card = element(), events = new Map(), requests = [], missingLookups = [], timers = new Map()
  let currentHomeRoot = homeRoot, release, timerId = 0, delayUsed = false
  const authReply = {status: authStatus, error: authError, roles}
  const delay = new Promise(resolve => { release = resolve })
  const document = {
    hidden: false,
    getElementById(id) {
      const target = elements.get(id) || null
      if (!target) missingLookups.push(id)
      return target
    },
    querySelector(selector) {
      if (selector === 'main[data-admin-page="home"]') return currentHomeRoot.isConnected ? currentHomeRoot : null
      if (selector === '.analytics-home-card') return currentHomeRoot.isConnected ? card : null
      return null
    },
    querySelectorAll() { return [] },
    addEventListener(name, handler, options) {
      if (!events.has(name)) events.set(name, [])
      events.get(name).push({handler, once: options?.once})
    },
    createElement: element,
  }
  const context = vm.createContext({
    document, window: {}, console, URL, URLSearchParams, AbortSignal, AbortController, DOMException,
    setTimeout(handler) { timers.set(++timerId, handler); return timerId },
    clearTimeout(id) { timers.delete(id) },
    fetch: async (url, options) => {
      const pathname = new URL(url, 'https://admin.geupddong.com').pathname
      requests.push({pathname, signal: options?.signal})
      const isDelayed = pathname === delayedPath && !delayUsed
      if (isDelayed) delayUsed = true
      if (isDelayed && !delayJson) await delay
      if (pathname === '/api/v1/auth/me' && authReply.error) throw authReply.error
      const status = pathname === '/api/v1/auth/me' ? authReply.status : isDelayed ? delayedStatus : 200
      return { status, ok: status === 200, json: async () => {
        if (isDelayed && delayJson) await delay
        return pathname === '/api/v1/auth/me' ? {roles: authReply.roles} : dataFor(pathname)
      } }
    },
  })
  vm.runInContext(model, context, {filename: 'admin-home-model.js'})
  assert(/\bbootstrap\(\)\s*$/.test(source))
  vm.runInContext(source.replace(/\bbootstrap\(\)\s*$/, 'globalThis.bootstrapResult = bootstrap()'), context, {filename: 'dashboard.js'})
  const initialBootstrap = context.bootstrapResult
  const flush = () => new Promise(setImmediate)
  await flush()
  return {
    elements, requests, missingLookups, timers, context, homeRoot, release, flush,
    finished: () => initialBootstrap,
    setAuthentication(reply) { Object.assign(authReply, reply) },
    async revisitHome() {
      for (const id of destinationIds) elements.delete(id)
      for (const id of homeIds) elements.set(id, element())
      currentHomeRoot = element()
      // PJAX loads revisited scripts as modules, with a fresh lexical scope.
      vm.runInContext(`(() => {${source.replace(/\bbootstrap\(\)\s*$/, 'globalThis.revisitResult = bootstrap()')}\n})()`, context, {filename: 'dashboard.js?adminRoute=2'})
      await context.revisitResult
    },
    navigate() {
      for (const event of events.get('admin:before-route-change') || []) event.handler()
      events.set('admin:before-route-change', (events.get('admin:before-route-change') || []).filter(event => !event.once))
      homeRoot.isConnected = false
      for (const id of homeIds) elements.delete(id)
      for (const id of destinationIds) elements.set(id, element())
      // The destination's ADMIN authentication is successful.
      elements.get('auth-shell').hidden = true
      elements.get('dashboard-shell').hidden = false
    },
  }
}

test('loaded home continues to render data and permits navigation', async () => {
  const view = await workspace()
  await view.finished()
  assert.match(view.elements.get('home-status').textContent, /최신 상태/)
  assert.equal(view.elements.get('refresh').disabled, false)
  assert.equal(view.elements.get('auth-shell').hidden, true)
  assert.equal(view.timers.size, 1, 'Host polling is scheduled while home is active')
  view.navigate()
  assert.equal(view.elements.get('auth-shell').hidden, true)
  assert.equal(view.timers.size, 0, 'Home polling is removed when leaving')
})

for (const delayedPath of homeEndpoints) {
  test(`navigation ignores a late successful home response: ${delayedPath}`, async () => {
    const view = await workspace({delayedPath})
    assert(view.requests.some(request => request.pathname === delayedPath))
    assert.equal(view.elements.get('auth-shell').hidden, true)
    view.navigate()
    assert.equal(view.elements.get('refresh').disabled, false, 'The shared refresh button remains usable on the destination')
    assert(view.requests.every(request => request.signal?.aborted), 'All home requests are cancelled')
    view.release()
    await view.finished()
    assert.equal(view.elements.get('auth-shell').hidden, true)
    assert.equal(view.elements.get('dashboard-shell').hidden, false)
    assert.deepEqual(view.missingLookups, [], 'No disconnected home element is accessed')
    assert.equal(view.timers.size, 0)
  })
}

test('revisited home is not changed by an earlier home instance or its late authorization failure', async () => {
  const view = await workspace({delayedPath: '/api/admin/v1/reports/summary', delayedStatus: 401})
  view.navigate()
  await view.revisitHome()
  const currentStatus = view.elements.get('home-status').textContent
  assert.match(currentStatus, /최신 상태/)
  view.release()
  await view.finished()
  assert.equal(view.elements.get('home-status').textContent, currentStatus)
  assert.equal(view.elements.get('auth-shell').hidden, true)
  assert.equal(view.elements.get('dashboard-shell').hidden, false)
  assert.equal(view.timers.size, 1, 'Only the new home instance polls')
})

test('retry after an authentication connection failure rechecks the profile and loads home', async () => {
  const view = await workspace({authStatus: 503})
  await view.finished()
  assert.equal(view.requests.length, 1)
  view.setAuthentication({status: 200})
  await view.context.window.AdminHomeRefresh()
  assert.match(view.elements.get('home-status').textContent, /최신 상태/)
  assert.equal(view.elements.get('auth-shell').hidden, true)
  assert.equal(view.requests.filter(request => request.pathname === '/api/v1/auth/me').length, 2)
})

test('navigation also ignores a response whose JSON parsing completes late', async () => {
  const view = await workspace({delayedPath: homeEndpoints[0], delayJson: true})
  view.navigate()
  view.release()
  await view.finished()
  assert.equal(view.elements.get('auth-shell').hidden, true)
  assert.deepEqual(view.missingLookups, [])
})

for (const authStatus of [200, 401, 403]) {
  test(`a previous home's late authentication response cannot change the next page (${authStatus})`, async () => {
    const view = await workspace({delayedPath: '/api/v1/auth/me', authStatus})
    view.navigate()
    view.release()
    await view.finished()
    assert.equal(view.elements.get('auth-shell').hidden, true)
    assert.equal(view.elements.get('dashboard-shell').hidden, false)
    assert.equal(view.requests.length, 1, 'Stale authentication starts no home data requests')
    assert.deepEqual(view.missingLookups, [])
  })
}

for (const options of [{authStatus: 503}, {authError: new TypeError('Network unavailable')}]) {
  test(`authentication connection failure keeps retry available without requesting a second login (${options.authStatus || 'network'})`, async () => {
    const view = await workspace(options)
    await view.finished()
    assert.equal(view.elements.get('auth-shell').hidden, true)
    assert.equal(view.elements.get('dashboard-shell').hidden, false)
    assert.match(view.elements.get('home-status').textContent, /로그인 상태.*확인.*새로고침/)
    assert.equal(view.elements.get('refresh').disabled, false)
    assert.equal(typeof view.context.window.AdminHomeRefresh, 'function')
    assert.equal(view.requests.length, 1, 'Home data is not fetched before ADMIN authentication')
  })
}

for (const [options, title] of [
  [{authStatus: 401}, '관리자 로그인'],
  [{authStatus: 403}, '관리자 권한이 필요합니다'],
  [{roles: ['USER']}, '관리자 권한이 필요합니다'],
]) {
  test(`current authentication failure remains enforced: ${JSON.stringify(options)}`, async () => {
    const view = await workspace(options)
    await view.finished()
    assert.equal(view.elements.get('auth-shell').hidden, false)
    assert.equal(view.elements.get('dashboard-shell').hidden, true)
    assert.equal(view.elements.get('auth-title').textContent, title)
    assert.equal(view.requests.length, 1)
  })
}
