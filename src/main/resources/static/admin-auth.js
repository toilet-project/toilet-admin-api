/* One authentication lifecycle for initial entry, page navigation and session controls.
 * This gates presentation only; the servers remain responsible for API authorization.
 */
globalThis.AdminAuth = (() => {
  const API = 'https://api.geupddong.com/api/v1/auth'
  const listeners = new Set()
  let state = Object.freeze({ status: 'checking', profile: null })
  let activePage = null
  let profileUrl = `${API}/me`
  let credentials = 'include'
  let generation = 0
  let pending = null
  let controller = null
  let expiryTimer = null

  function render() {
    const authenticated = state.status === 'authenticated'
    document.documentElement.dataset.adminAuth = state.status
    document.querySelectorAll('.admin-frame').forEach(frame => { frame.hidden = !authenticated })
    if (activePage?.isConnected) activePage.hidden = !authenticated
    const loading = document.getElementById('loading-shell')
    if (loading) loading.hidden = state.status !== 'checking'
    const auth = document.getElementById('auth-shell')
    if (!auth) return
    auth.hidden = !['anonymous', 'forbidden', 'unavailable'].includes(state.status)
    const messages = {
      anonymous: ['관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.'],
      forbidden: ['관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.'],
      unavailable: ['로그인 상태를 확인하지 못했습니다', '연결 상태를 확인한 뒤 다시 시도해 주세요.'],
    }
    const message = messages[state.status]
    if (message) {
      document.getElementById('auth-title').textContent = message[0]
      document.getElementById('auth-description').textContent = message[1]
    }
    const actions = auth.querySelector('.login-actions')
    if (actions) actions.hidden = state.status === 'unavailable'
    let retry = document.getElementById('auth-retry')
    if (!retry) {
      retry = document.createElement('button')
      retry.id = 'auth-retry'
      retry.className = 'auth-retry'
      retry.type = 'button'
      retry.textContent = '다시 시도'
      retry.addEventListener('click', () => window.location.reload())
      auth.querySelector('.login-card').append(retry)
    }
    retry.hidden = state.status !== 'unavailable'
  }

  function expiresAt() {
    return state.profile?.accessTokenExpiresAt
      ? new Date(state.profile.accessTokenExpiresAt).getTime() : NaN
  }

  function publish(status, profile = null) {
    state = Object.freeze({ status, profile })
    clearTimeout(expiryTimer)
    render()
    for (const listener of listeners) listener(state)
    const remaining = expiresAt() - Date.now()
    if (status === 'authenticated' && Number.isFinite(remaining)) {
      expiryTimer = setTimeout(expire, Math.max(0, Math.min(remaining, 2147483647)))
    }
  }

  function cancelRequest() {
    ++generation
    controller?.abort()
    controller = null
    pending = null
  }

  function reject(status, page = activePage) {
    if (state.status !== 'authenticated' || ![401, 403].includes(status) || !page?.isConnected || page !== activePage) return false
    cancelRequest()
    publish(status === 403 ? 'forbidden' : 'anonymous')
    return true
  }

  function expire() {
    if (state.status === 'authenticated' && expiresAt() <= Date.now()) reject(401)
  }

  async function readProfile(signal) {
    const response = await fetch(profileUrl, { credentials, cache: 'no-store', signal })
    if (response.status === 401) return { status: 'anonymous' }
    if (response.status === 403) return { status: 'forbidden' }
    if (!response.ok) throw new Error('로그인 상태를 확인하지 못했습니다.')
    const profile = await response.json()
    if (!profile.roles?.includes('ADMIN')) return { status: 'forbidden' }
    if (profile.accessTokenExpiresAt && new Date(profile.accessTokenExpiresAt).getTime() <= Date.now()) return { status: 'anonymous' }
    return { status: 'authenticated', profile }
  }

  function check({ extend = false } = {}) {
    if (pending) return pending
    const current = ++generation
    controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
    if (!extend) publish('checking')
    const task = (async () => {
      try {
        if (extend) {
          const response = await fetch(`${API}/refresh`, { method: 'POST', credentials: 'include', signal })
          if (!response.ok) {
            if (current === generation) reject(response.status)
            throw new Error('로그인 연장에 실패했습니다.')
          }
        }
        const result = await readProfile(signal)
        if (current !== generation || !activePage?.isConnected) return null
        publish(result.status, result.profile)
        return result.profile || null
      } catch (error) {
        if (current !== generation || !activePage?.isConnected) return null
        // A transient refresh failure does not invalidate a still-valid session.
        if (extend) throw error
        publish('unavailable')
        return null
      } finally {
        if (current === generation) { pending = null; controller = null }
      }
    })()
    pending = task
    return task
  }

  async function start(page, options = {}) {
    if (!page?.isConnected) return null
    if (page !== activePage) {
      cancelRequest()
      activePage = page
    }
    profileUrl = options.profileUrl || `${API}/me`
    credentials = options.credentials || 'include'
    expire()
    // Navigation reuses the verified session. Protected APIs still enforce roles;
    // a full entry checks /me again.
    if (state.status === 'authenticated') {
      render()
      return state.profile
    }
    const profile = await check()
    return page === activePage && page.isConnected ? profile : null
  }

  function refresh() {
    expire()
    if (state.status !== 'authenticated') return Promise.resolve(null)
    return check({ extend: true })
  }

  function logout() {
    cancelRequest()
    const current = generation
    controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
    publish('checking')
    pending = (async () => {
      try {
        const response = await fetch(`${API}/logout`, { method: 'POST', credentials: 'include', signal })
        if (!response.ok) throw new Error('로그아웃 요청에 실패했습니다.')
        if (current === generation) publish('anonymous')
      } catch {
        if (current === generation) publish('unavailable')
      } finally {
        if (current === generation) { pending = null; controller = null }
      }
      return null
    })()
    return pending
  }

  function subscribe(listener) {
    listeners.add(listener)
    listener(state)
    return () => listeners.delete(listener)
  }

  // Do not allow a previous page's profile response to affect its replacement.
  document.addEventListener('admin:before-route-change', () => { cancelRequest(); activePage = null })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) expire() })
  return Object.freeze({ start, reject, refresh, logout, subscribe, getState: () => state })
})()
