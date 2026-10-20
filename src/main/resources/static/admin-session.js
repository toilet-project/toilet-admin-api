(() => {
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
    controls.hidden = false
    render()
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
    }
  }

  AdminAuth.subscribe(({ status, profile }) => {
    controls.hidden = status !== 'authenticated'
    if (status === 'authenticated') setExpiry(profile.accessTokenExpiresAt)
    else expiresAt = null
  })

  extendButton.addEventListener('click', async () => {
    extendButton.disabled = true
    extendButton.textContent = '연장 중…'
    try {
      if (!await AdminAuth.refresh()) throw new Error('refresh failed')
      extendButton.textContent = '연장 완료'
      showMessage('로그인 시간이 연장됐습니다.')
    } catch {
      extendButton.textContent = '연장 실패'
      showMessage('로그인 연장에 실패했습니다. 연결 상태를 확인하고 다시 시도해 주세요.')
    } finally {
      window.setTimeout(() => { extendButton.textContent = '로그인 연장'; extendButton.disabled = false }, 1200)
    }
  })

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true
    logoutButton.textContent = '로그아웃 중…'
    try {
      await AdminAuth.logout()
    } finally {
      logoutButton.disabled = false
      logoutButton.textContent = '로그아웃'
    }
  })

  window.setInterval(render, 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render() })
})()
