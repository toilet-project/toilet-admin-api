(() => {
  const PREVIEW_ORIGIN = 'https://preview.geupddong.com'
  const API_ORIGIN = 'https://api.geupddong.com'
  const ADMIN_ORIGIN = 'https://admin.geupddong.com'
  const PREFIX = '/admin'

  if (window.location.origin !== PREVIEW_ORIGIN || !window.location.pathname.startsWith(PREFIX)) return

  const nativeFetch = window.fetch.bind(window)
  const allowedWrites = new Set([
    `${API_ORIGIN}/api/v1/auth/refresh`,
    `${API_ORIGIN}/api/v1/auth/logout`,
  ])

  function requestUrl(input) {
    const value = input instanceof Request ? input.url : String(input)
    if (value.startsWith('/api/admin/')) return new URL(value, ADMIN_ORIGIN)
    return new URL(value, window.location.href)
  }

  window.fetch = (input, init = {}) => {
    const target = requestUrl(input)
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const isOperationalOrigin = target.origin === API_ORIGIN || target.origin === ADMIN_ORIGIN
    const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'

    if (isOperationalOrigin && !isRead && !allowedWrites.has(`${target.origin}${target.pathname}`)) {
      window.dispatchEvent(new CustomEvent('admin-preview-write-blocked'))
      return Promise.resolve(new Response(JSON.stringify({
        error: { message: '프리뷰에서는 운영 데이터 변경이 차단됩니다.' },
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }))
    }

    if (!isOperationalOrigin) return nativeFetch(input, init)
    const options = { ...init, credentials: 'include' }
    if (input instanceof Request) return nativeFetch(new Request(target, input), options)
    return nativeFetch(target, options)
  }

  let noticeTimer = 0
  function notice(message) {
    let target = document.querySelector('.admin-preview-notice')
    if (!target) {
      target = document.createElement('div')
      target.className = 'admin-preview-notice'
      target.setAttribute('role', 'status')
      document.body.append(target)
    }
    target.textContent = message
    target.hidden = false
    window.clearTimeout(noticeTimer)
    noticeTimer = window.setTimeout(() => { target.hidden = true }, 3200)
  }

  function addPreviewChrome() {
    if (!document.getElementById('admin-preview-style')) {
      const style = document.createElement('style')
      style.id = 'admin-preview-style'
      style.textContent = `
        .admin-preview-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid #b8d8c5;border-radius:999px;background:#edf8f1;color:#17643c;font-size:12px;font-weight:700;white-space:nowrap}
        .admin-preview-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:#2f9d61}
        .admin-preview-notice{position:fixed;right:24px;bottom:24px;z-index:9999;max-width:360px;padding:12px 15px;border:1px solid #d6e3da;border-radius:10px;background:#173c2a;color:#fff;box-shadow:0 12px 30px rgba(18,45,31,.2);font-size:13px}
        .admin-preview-notice[hidden]{display:none}
      `
      document.head.append(style)
    }

    const actions = document.querySelector('.admin-topbar-actions')
    if (actions && !actions.querySelector('.admin-preview-badge')) {
      const badge = document.createElement('span')
      badge.className = 'admin-preview-badge'
      badge.textContent = '실데이터 · 읽기 전용'
      actions.prepend(badge)
    }
  }

  function bindLoginLinks() {
    document.querySelectorAll('a[href*="/api/v1/auth/login/"]').forEach((link) => {
      if (link.dataset.previewLoginBound) return
      const loginUrl = new URL(link.href)
      loginUrl.searchParams.set('returnTo', 'preview')
      link.href = loginUrl.toString()
      link.dataset.previewLoginBound = 'true'
      link.addEventListener('click', (event) => {
        event.preventDefault()
        const popup = window.open(link.href, 'geupddong-admin-preview-login', 'popup,width=520,height=720')
        if (!popup) {
          notice('팝업을 허용한 뒤 다시 로그인해 주세요.')
          return
        }

        const timer = window.setInterval(() => {
          if (popup.closed) {
            window.clearInterval(timer)
            return
          }
          try {
            const returned = new URL(popup.location.href)
            if (returned.origin !== PREVIEW_ORIGIN || returned.pathname.startsWith(PREFIX)) return
            const succeeded = returned.searchParams.get('login') === 'success'
            popup.close()
            window.clearInterval(timer)
            if (succeeded) window.location.reload()
            else notice('로그인이 완료되지 않았습니다. 다시 시도해 주세요.')
          } catch {
            // The provider and API pages are cross-origin until OAuth returns to the preview origin.
          }
        }, 400)
      })
    })
  }

  function enhance() {
    addPreviewChrome()
    bindLoginLinks()
  }

  window.addEventListener('admin-preview-write-blocked', () => notice('프리뷰는 읽기 전용입니다. 변경 작업은 운영 관리자 화면에서 진행해 주세요.'))
  document.addEventListener('DOMContentLoaded', enhance)
})()
