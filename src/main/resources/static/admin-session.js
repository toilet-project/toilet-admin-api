(() => {
  const API_BASE = 'https://api.geupddong.com'
  const actions = document.querySelector('.admin-topbar-actions')
  if (!actions || actions.querySelector('.admin-session-controls')) return

  const controls = document.createElement('div')
  controls.className = 'admin-session-controls'
  controls.hidden = true
  controls.innerHTML = `
    <span class="admin-session-time" title="현재 로그인 세션의 남은 시간">
      <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <span>로그인</span><strong data-session-remaining>--:--</strong>
    </span>
    <button class="admin-session-action" data-session-extend type="button">로그인 연장</button>
    <button class="admin-session-action is-logout" data-session-logout type="button">로그아웃</button>`
  const notification = actions.querySelector('.admin-notification')
  actions.insertBefore(controls, notification || actions.firstChild)

  const remaining = controls.querySelector('[data-session-remaining]')
  const extendButton = controls.querySelector('[data-session-extend]')
  const logoutButton = controls.querySelector('[data-session-logout]')
  let expiresAt = null
  let messageTimer = 0
  let expiryRedirectStarted = false

  function showMessage(message) {
    let target = document.querySelector('.admin-session-message')
    if (!target) {
      target = document.createElement('div')
      target.className = 'admin-session-message'
      target.setAttribute('role', 'status')
      document.querySelector('.admin-topbar')?.append(target)
    }
    target.textContent = message
    target.hidden = false
    window.clearTimeout(messageTimer)
    messageTimer = window.setTimeout(() => { target.hidden = true }, 2200)
  }

  function setExpiry(value) {
    const parsed = new Date(value)
    expiresAt = Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
    expiryRedirectStarted = false
    controls.hidden = false
    render()
  }

  function redirectToLogin() {
    if (expiryRedirectStarted) return
    expiryRedirectStarted = true
    extendButton.disabled = true
    extendButton.textContent = '세션 만료'
    window.setTimeout(() => window.location.reload(), 150)
  }

  function render() {
    if (expiresAt == null) {
      remaining.textContent = '--:--'
      controls.classList.remove('is-warning', 'is-expired')
      return
    }
    const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
    const minutes = Math.floor(seconds / 60)
    remaining.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    controls.classList.toggle('is-warning', seconds > 0 && seconds <= 300)
    controls.classList.toggle('is-expired', seconds === 0)
    if (seconds === 0) {
      remaining.textContent = '만료'
      redirectToLogin()
    }
  }

  async function profile() {
    const response = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
    if (!response.ok) return false
    const data = await response.json()
    if (!data.roles?.includes('ADMIN')) return false
    setExpiry(data.accessTokenExpiresAt)
    return true
  }

  extendButton.addEventListener('click', async () => {
    if (expiresAt == null || expiresAt <= Date.now()) {
      redirectToLogin()
      return
    }
    extendButton.disabled = true
    extendButton.textContent = '연장 중…'
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!response.ok || !await profile()) throw new Error('refresh failed')
      extendButton.textContent = '연장 완료'
      showMessage('로그인 시간이 30분으로 연장됐습니다.')
    } catch {
      extendButton.textContent = '연장 실패'
      showMessage('로그인 연장에 실패했습니다. 다시 로그인해 주세요.')
    } finally {
      window.setTimeout(() => { extendButton.textContent = '로그인 연장'; extendButton.disabled = false }, 1200)
    }
  })

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true
    logoutButton.textContent = '로그아웃 중…'
    try {
      await fetch(`${API_BASE}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' })
    } finally {
      window.location.assign('/')
    }
  })

  window.setInterval(render, 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render() })
  void profile().catch(() => {})
})()
