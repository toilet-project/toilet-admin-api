const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const { installAuth, element } = require('./helpers/admin-auth.cjs')

const response = (status = 200, profile = { roles: ['ADMIN'] }) => ({
  status, ok: status >= 200 && status < 300, json: async () => profile,
})
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function fixture(fetch = async () => response()) {
  const events = new Map(), calls = [], timers = new Map(), page = element()
  let timer = 0, reloads = 0
  const context = vm.createContext({
    document: { hidden: false, getElementById: () => null,
      addEventListener(name, handler) { events.set(name, handler) } },
    window: { location: { reload() { reloads++ } } },
    fetch: (...args) => { calls.push(args); return fetch(...args) },
    setTimeout(handler) { timers.set(++timer, handler); return timer },
    clearTimeout(id) { timers.delete(id) },
  })
  const chrome = installAuth(context)
  return { ...chrome, page, calls, timers, context,
    reloads: () => reloads,
    emit: name => events.get(name)?.(),
    start: () => chrome.auth.start(page),
  }
}

test('pending authentication keeps the workspace closed and coalesces profile requests', async () => {
  const reply = deferred(), view = fixture(() => reply.promise)
  const first = view.start(), second = view.start()
  assert.equal(view.frame.hidden, true)
  assert.equal(view.page.hidden, true)
  assert.equal(view.node('loading-shell').hidden, false)
  assert.equal(view.node('auth-shell').hidden, true)
  assert.equal(view.calls.length, 1)
  reply.resolve(response())
  await Promise.all([first, second])
  assert.equal(view.frame.hidden, false)
  assert.equal(view.page.hidden, false)
  assert.equal(view.node('loading-shell').hidden, true)
})

for (const [reply, expected] of [
  [response(401), 'anonymous'], [response(403), 'forbidden'],
  [response(200, { roles: ['USER'] }), 'forbidden'],
  [response(200, { roles: ['ADMIN'], accessTokenExpiresAt: '2000-01-01T00:00:00Z' }), 'anonymous'],
]) {
  test(`access decision is enforced: ${expected} (${JSON.stringify(reply)})`, async () => {
    const view = fixture(async () => reply)
    assert.equal(await view.start(), null)
    assert.equal(view.auth.getState().status, expected)
    assert.equal(view.frame.hidden, true)
    assert.equal(view.page.hidden, true)
    assert.equal(view.node('auth-shell').hidden, false)
  })
}

for (const cause of [503, 'network', 'timeout']) {
  test(`authentication ${cause} offers retry without pretending the user is logged out`, async () => {
    const view = fixture(async () => {
      if (cause === 503) return response(503)
      throw new Error(cause)
    })
    await view.start()
    assert.equal(view.auth.getState().status, 'unavailable')
    assert.equal(view.frame.hidden, true)
    assert.equal(view.actions.hidden, true)
    assert.equal(view.node('auth-retry').hidden, false)
    assert.match(view.node('auth-title').textContent, /확인하지 못했습니다/)
  })
}

test('navigation shares verified identity and late failures from detached pages are ignored', async () => {
  const view = fixture()
  await view.start()
  view.emit('admin:before-route-change')
  view.page.isConnected = false
  const next = element()
  await view.auth.start(next)
  assert.equal(view.calls.length, 1, 'Navigation and session subscribers do not duplicate /me')
  assert.equal(next.hidden, false)
  assert.equal(view.auth.reject(401, view.page), false)
  assert.equal(view.auth.getState().status, 'authenticated')
})

test('late profile response cannot change the replacement page, even if abort is ignored', async () => {
  const old = deferred()
  let count = 0
  const view = fixture(() => ++count === 1 ? old.promise : Promise.resolve(response()))
  const pending = view.start()
  view.emit('admin:before-route-change')
  view.page.isConnected = false
  await view.auth.start(element())
  old.resolve(response(401))
  await pending
  assert.equal(view.calls[0][1].signal.aborted, true)
  assert.equal(view.auth.getState().status, 'authenticated')
  assert.equal(view.frame.hidden, false)
})

test('concurrent refresh is deduplicated and updates the verified expiry', async () => {
  const refreshed = { roles: ['ADMIN'], accessTokenExpiresAt: '2099-01-01T00:00:00Z' }
  const refresh = deferred()
  const view = fixture(url => url.endsWith('/refresh') ? refresh.promise : Promise.resolve(response(200, refreshed)))
  await view.start()
  const first = view.auth.refresh(), second = view.auth.refresh()
  refresh.resolve(response(204))
  await Promise.all([first, second])
  assert.equal(view.calls.filter(([url]) => url.endsWith('/refresh')).length, 1)
  assert.equal(view.auth.getState().profile.accessTokenExpiresAt, refreshed.accessTokenExpiresAt)
})

test('transient refresh failure preserves the valid session, while a 401 closes it', async () => {
  let status = 503
  const view = fixture(async url => response(url.endsWith('/refresh') ? status : 200))
  await view.start()
  await assert.rejects(view.auth.refresh(), /연장/)
  assert.equal(view.auth.getState().status, 'authenticated')
  status = 401
  await view.auth.refresh()
  assert.equal(view.auth.getState().status, 'anonymous')
  assert.equal(view.frame.hidden, true)
})

test('logout invalidates a pending profile; a failed logout remains distinguishable', async () => {
  const profile = deferred()
  let logoutStatus = 204
  const view = fixture(url => url.endsWith('/logout') ? Promise.resolve(response(logoutStatus)) : profile.promise)
  const entering = view.start()
  await view.auth.logout()
  profile.resolve(response())
  await entering
  assert.equal(view.auth.getState().status, 'anonymous')
  assert.equal(view.frame.hidden, true)
  logoutStatus = 503
  await view.auth.logout()
  assert.equal(view.auth.getState().status, 'unavailable')
})

test('a late protected request cannot interrupt logout or replace its result', async () => {
  const logout = deferred()
  const view = fixture(url => url.endsWith('/logout') ? logout.promise : Promise.resolve(response()))
  await view.start()
  const pending = view.auth.logout()
  assert.equal(view.auth.reject(403, view.page), false)
  assert.equal(view.auth.getState().status, 'checking')
  logout.resolve(response(204))
  await pending
  assert.equal(view.auth.getState().status, 'anonymous')
  assert.equal(view.auth.reject(401, view.page), false)
})

test('the session toolbar subscribes to authentication without another profile request', async () => {
  const view = fixture()
  const controls = element(), actions = element(), children = new Map()
  controls.querySelector = selector => {
    if (!children.has(selector)) children.set(selector, element())
    return children.get(selector)
  }
  actions.querySelector = () => null
  actions.insertBefore = () => {}
  view.context.document.querySelector = selector => selector === '.admin-topbar-actions' ? actions : null
  view.context.document.createElement = () => controls
  view.context.window.setInterval = () => 1
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main/resources/static/admin-session.js'), 'utf8'), view.context)
  assert.equal(view.calls.length, 0)
  await view.start()
  assert.equal(view.calls.length, 1)
  assert.equal(controls.hidden, false)
  view.auth.reject(401)
  assert.equal(controls.hidden, true)
})

test('expiry on return to a sleeping tab closes the workspace without a reload loop', async () => {
  const profile = { roles: ['ADMIN'], accessTokenExpiresAt: '2099-01-01T00:00:00Z' }
  const view = fixture(async () => response(200, profile))
  await view.start()
  // Simulate elapsed wall time without waiting for a real session to expire.
  vm.runInContext("Date.now = () => new Date('2100-01-01T00:00:00Z').getTime()", view.context)
  view.emit('visibilitychange')
  assert.equal(view.auth.getState().status, 'anonymous')
  assert.equal(view.frame.hidden, true)
  assert.equal(view.timers.size, 0)
  assert.equal(view.reloads(), 0)
})
