(() => {
  const PREVIEW_ORIGIN = 'https://admin.geupddong.com'
  const API_ORIGIN = 'https://api.geupddong.com'
  const ADMIN_ORIGIN = 'https://admin.geupddong.com'
  const PREFIX = '/preview'
  const DISPLAY_GROUP_DEMO = new URLSearchParams(window.location.search).get('demo') === 'display-group'

  if (window.location.origin !== PREVIEW_ORIGIN || !window.location.pathname.startsWith(PREFIX)) return

  if (DISPLAY_GROUP_DEMO) window.PREVIEW_DATA = true

  const nativeFetch = window.fetch.bind(window)
  const allowedWrites = new Set([
    `${API_ORIGIN}/api/v1/auth/refresh`,
    `${API_ORIGIN}/api/v1/auth/logout`,
  ])
  const demoGroupKey = 'display-group-demo'
  let demoDisplayGroupId = 31
  const demoToilets = [
    { id: 4101, name: '한빛문화원 1층', toiletType: '개방화장실', latitude: 37.4998237, longitude: 126.9784084, coordinateSource: 'GEOCODED_LEGACY', displayGroupId: 31, displayGroupName: '한빛문화원' },
    { id: 4102, name: '한빛문화원 2층', toiletType: '개방화장실', latitude: 37.4998237, longitude: 126.9784084, coordinateSource: 'GEOCODED_LEGACY', displayGroupId: 31, displayGroupName: '한빛문화원' },
    { id: 4103, name: '한빛문화원 3층', toiletType: '개방화장실', latitude: 37.4998237, longitude: 126.9784084, coordinateSource: 'GEOCODED_LEGACY', displayGroupId: 31, displayGroupName: '한빛문화원' },
    { id: 4104, name: '한빛문화원 별관', toiletType: '개방화장실', latitude: 37.4998237, longitude: 126.9784084, coordinateSource: 'GEOCODED_LEGACY' },
    { id: 4105, name: '한빛문화원 야외화장실', toiletType: '공중화장실', latitude: 37.4998237, longitude: 126.9784084, coordinateSource: 'PUBLIC_DATA' },
  ]

  function jsonResponse(body, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  }

  function demoResponse(target, method, init) {
    if (!DISPLAY_GROUP_DEMO || target.origin !== API_ORIGIN) return null
    if (method === 'GET' && target.pathname === '/api/v1/auth/me') {
      return jsonResponse({ userId: 'preview-admin', displayName: '프리뷰 관리자', roles: ['ADMIN'], accessTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
    }
    if (method === 'GET' && target.pathname === '/api/admin/v1/data-quality/duplicate-coordinates') {
      return jsonResponse({ items: [{ groupKey: demoGroupKey, latitude: 37.4998237, longitude: 126.9784084, toiletCount: demoToilets.length, representativeName: '한빛문화원 1층', region: '서울특별시 중구', status: 'PENDING', pendingReportCount: 0 }], page: 0, size: 20, totalElements: 1, totalPages: 1 })
    }
    if (method === 'GET' && target.pathname === `/api/admin/v1/data-quality/duplicate-coordinates/${demoGroupKey}`) {
      return jsonResponse({ group: { groupKey: demoGroupKey, latitude: 37.4998237, longitude: 126.9784084, toiletCount: demoToilets.length, representativeName: '한빛문화원 1층', region: '서울특별시 중구', status: 'PENDING', pendingReportCount: 0 }, toilets: demoToilets, pendingReports: [], revisions: [] })
    }
    if (method === 'PUT' && target.pathname === `/api/admin/v1/data-quality/duplicate-coordinates/${demoGroupKey}/display-group`) {
      let body
      try { body = JSON.parse(String(init.body || '{}')) } catch { return jsonResponse({ error: { message: '그룹 요청을 확인해 주세요.' } }, 400) }
      if (!body.displayName?.trim() || !Array.isArray(body.toiletIds) || body.toiletIds.length < 2) return jsonResponse({ error: { message: '두 개 이상 선택하고 그룹명을 입력해 주세요.' } }, 400)
      demoDisplayGroupId = Number(body.displayGroupId) || demoDisplayGroupId + 1
      demoToilets.forEach((toilet) => {
        if (body.toiletIds.includes(toilet.id)) {
          toilet.displayGroupId = demoDisplayGroupId
          toilet.displayGroupName = body.displayName.trim()
        } else if (Number(toilet.displayGroupId) === demoDisplayGroupId) {
          delete toilet.displayGroupId
          delete toilet.displayGroupName
        }
      })
      window.dispatchEvent(new CustomEvent('admin-preview-demo-saved'))
      return jsonResponse({ id: demoDisplayGroupId, displayName: body.displayName.trim(), toiletIds: body.toiletIds })
    }
    if (method === 'DELETE' && target.pathname.startsWith('/api/admin/v1/data-quality/display-groups/')) {
      const groupId = Number(target.pathname.split('/').pop())
      demoToilets.forEach((toilet) => {
        if (Number(toilet.displayGroupId) === groupId) {
          delete toilet.displayGroupId
          delete toilet.displayGroupName
        }
      })
      window.dispatchEvent(new CustomEvent('admin-preview-demo-deleted'))
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return null
  }

  function requestUrl(input) {
    const value = input instanceof Request ? input.url : String(input)
    return new URL(value, window.location.href)
  }

  window.fetch = (input, init = {}) => {
    const target = requestUrl(input)
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const isOperationalOrigin = target.origin === API_ORIGIN || target.origin === ADMIN_ORIGIN
    const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    const demo = demoResponse(target, method, init)
    if (demo) return demo

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
      badge.textContent = DISPLAY_GROUP_DEMO ? '디자인 데이터 · 기능 체험' : '실데이터 · 읽기 전용'
      actions.prepend(badge)
    }
  }

  function bindLoginLinks() {
    document.querySelectorAll('a[href*="/api/v1/auth/login/"]').forEach((link) => {
      if (link.dataset.previewLoginBound) return
      const loginUrl = new URL(link.href)
      loginUrl.searchParams.set('returnTo', 'adminPreview')
      link.href = loginUrl.toString()
      link.dataset.previewLoginBound = 'true'
    })
  }

  function enhance() {
    addPreviewChrome()
    bindLoginLinks()
  }

  window.addEventListener('admin-preview-write-blocked', () => notice('프리뷰는 읽기 전용입니다. 변경 작업은 운영 관리자 화면에서 진행해 주세요.'))
  window.addEventListener('admin-preview-demo-saved', () => notice('프리뷰 그룹이 저장되었습니다. 운영 데이터에는 반영되지 않습니다.'))
  window.addEventListener('admin-preview-demo-deleted', () => notice('프리뷰 그룹이 해제되었습니다. 운영 데이터에는 반영되지 않습니다.'))
  document.addEventListener('DOMContentLoaded', enhance)
})()
