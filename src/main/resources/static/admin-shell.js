(() => {
  const main = document.querySelector('main[data-admin-page]')
  if (!main || main.closest('.admin-frame')) return

  const page = main.dataset.adminPage || 'home'
  const title = main.dataset.adminTitle || main.querySelector('h1')?.textContent || '관리자'
  const icon = (name, extra = '') => `<svg class="admin-icon ${extra}" aria-hidden="true"><use href="#admin-icon-${name}"/></svg>`
  const nav = (key, href, name, iconName, meta = '') => `<a class="admin-nav-link${page === key ? ' is-current' : ''}" href="${href}"${page === key ? ' aria-current="page"' : ''}>${icon(iconName)}${name}${meta ? `<span class="admin-nav-meta">${meta}</span>` : ''}</a>`
  const frame = document.createElement('div')
  frame.id = 'dashboard-shell'
  frame.className = 'admin-frame'
  frame.hidden = main.hidden
  frame.innerHTML = `
    <svg class="admin-icon-sprite" aria-hidden="true">
      <symbol id="admin-icon-map-pin" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></symbol>
      <symbol id="admin-icon-dashboard" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></symbol>
      <symbol id="admin-icon-inbox" viewBox="0 0 24 24"><path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 16h5l2 2h6l2-2h5"/></symbol>
      <symbol id="admin-icon-map" viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/><circle cx="15" cy="10" r="2"/></symbol>
      <symbol id="admin-icon-scan" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/></symbol>
      <symbol id="admin-icon-compare" viewBox="0 0 24 24"><path d="M4 7h13M14 4l3 3-3 3M20 17H7M10 14l-3 3 3 3"/></symbol>
      <symbol id="admin-icon-activity" viewBox="0 0 24 24"><path d="M3 12h4l2-7 4 14 2-7h6"/></symbol>
      <symbol id="admin-icon-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
      <symbol id="admin-icon-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></symbol>
      <symbol id="admin-icon-history" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></symbol>
      <symbol id="admin-icon-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></symbol>
      <symbol id="admin-icon-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></symbol>
      <symbol id="admin-icon-cloud" viewBox="0 0 24 24"><path d="M17.5 19H7a5 5 0 1 1 1-9.9A7 7 0 0 1 21 12.5 4.5 4.5 0 0 1 17.5 19Z"/></symbol>
      <symbol id="admin-icon-chart" viewBox="0 0 24 24"><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/><circle cx="7" cy="15" r="1"/><circle cx="11" cy="11" r="1"/><circle cx="14" cy="13" r="1"/><circle cx="19" cy="7" r="1"/></symbol>
      <symbol id="admin-icon-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></symbol>
    </svg>
    <aside class="admin-sidebar" aria-label="관리자 메뉴">
      <a class="admin-brand" href="/" aria-label="급똥 관리자 운영 홈"><span class="admin-brand-mark">${icon('map-pin')}</span><span><strong>급똥</strong><small>WORKSPACE</small></span></a>
      <nav class="admin-nav" aria-label="업무별 탐색">
        <div class="admin-nav-group">${nav('home','/','운영 홈','dashboard')}</div>
        <div class="admin-nav-group"><p>데이터 관리</p>${nav('toilets','/toilets.html','화장실 데이터','map')}${nav('reports','/reports.html','제보 검토','inbox')}${nav('public-data-changes','/public-data-changes.html','공공데이터 변경 검토','compare')}${nav('quality','/data-quality.html','중복 좌표 품질 관리','scan')}${nav('regions','/regions.html','행정구역 검토','map')}</div>
        <div class="admin-nav-group"><p>서비스 운영</p>${nav('operations','/operations.html','수집·서비스 상태','activity')}${nav('analytics','/service-analytics.html','서비스 이용 분석','chart')}${nav('members','/members.html','회원 관리','users')}${nav('permissions','/permissions.html','권한 관리','shield')}${nav('history','/batch-syncs.html','배치 실행 이력','history')}</div>
        <div class="admin-nav-group"><p>워크스페이스</p>${nav('features','/features.html','전체 기능','grid')}${nav('cloudflare','/cloudflare.html','Cloudflare','cloud')}${nav('notifications','/notifications.html','알림 센터','bell','기초')}</div>
      </nav>
      <div class="admin-sidebar-footer"><span class="admin-avatar">운</span><span><strong>관리자</strong><small>운영 워크스페이스</small></span></div>
    </aside>
    <div class="admin-workspace">
      <header class="admin-topbar">
        <div class="admin-breadcrumb"><span>워크스페이스</span><i>/</i><strong>${title}</strong></div>
        <div class="admin-topbar-actions"><div class="admin-search-wrap"><label class="admin-search">${icon('search')}<input type="search" placeholder="메뉴·기능 검색" aria-label="관리자 메뉴 검색" autocomplete="off" /></label><div class="admin-search-results" hidden></div></div><a class="admin-notification" href="/notifications.html" aria-label="알림 센터">${icon('bell')}<i></i></a></div>
      </header>
    </div>`

  frame.querySelector('a[href="/data-quality.html"]')?.insertAdjacentHTML('afterend', nav('duplicate-names','/duplicate-names.html','중복 이름 품질 관리','scan'))
  main.parentNode.insertBefore(frame, main)
  frame.querySelector('.admin-workspace').append(main)
  const syncVisibility = () => { frame.hidden = main.hidden }
  new MutationObserver(syncVisibility).observe(main, { attributes: true, attributeFilter: ['hidden'] })
  syncVisibility()

  const input = frame.querySelector('.admin-search input')
  const results = frame.querySelector('.admin-search-results')
  const links = [...frame.querySelectorAll('.admin-nav-link[href]')]
  const close = () => { results.hidden = true; results.replaceChildren() }
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase('ko-KR')
    if (!query) return close()
    const matches = links.filter((link) => link.textContent.toLocaleLowerCase('ko-KR').includes(query)).slice(0, 7)
    results.replaceChildren(...(matches.length ? matches.map((link) => {
      const result = document.createElement('a')
      result.href = link.href
      result.textContent = link.textContent.trim()
      return result
    }) : [Object.assign(document.createElement('span'), { textContent: '일치하는 메뉴가 없습니다.' })]))
    results.hidden = false
  })
  input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { input.value = ''; close() } })
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.admin-search-wrap')) close() })
})();

(() => {
  const frame = document.querySelector('.admin-frame')
  let main = document.querySelector('main[data-admin-page]')
  if (!frame || !main || window.AdminNavigation) return
  frame.dataset.adminNavigation = 'initializing'

  const pageCache = new Map()
  const pageStyleNames = new Set(['home.css', 'regions.css', 'quality-review-shell.css', 'public-data-changes.css', 'service-analytics.css', 'toilets.css'])
  const rootRoute = String.fromCharCode(47)
  const routeNames = new Set([rootRoute, '/toilets', '/reports', '/public-data-changes', '/data-quality', '/regions', '/operations', '/service-analytics', '/members', '/permissions', '/batch-syncs', '/features', '/cloudflare', '/notifications'])
  let navigationSequence = 0
  routeNames.add('/duplicate-names')
  pageStyleNames.add('duplicate-names.css')
  let visibilityObserver = null

  const normalizedRoute = (pathname) => {
    const withoutPreview = pathname.replace(/^\/preview(?=\/|$)/, '') || rootRoute
    const withoutDocument = withoutPreview.replace(/\/index\.html$/, rootRoute).replace(/\.html$/, '')
    return withoutDocument.length > 1 ? withoutDocument.replace(/\/$/, '') : rootRoute
  }
  const routeUrl = (value) => new URL(value, window.location.href)
  const isInternalRoute = (url) => url.origin === window.location.origin && routeNames.has(normalizedRoute(url.pathname))
  const routeKey = (url) => `${url.origin}${url.pathname}`
  const assetName = (pathname) => pathname.slice(pathname.lastIndexOf(rootRoute) + 1)

  const observeVisibility = (target) => {
    visibilityObserver?.disconnect()
    const sync = () => { frame.hidden = target.hidden }
    visibilityObserver = new MutationObserver(sync)
    visibilityObserver.observe(target, { attributes: true, attributeFilter: ['hidden'] })
    sync()
  }

  const ensureIconAliases = () => {
    const sprite = frame.querySelector('.admin-icon-sprite')
    if (!sprite) return
    const aliases = [
      ['admin-icon-map-pin', 'icon-map-pin'], ['admin-icon-dashboard', 'icon-layout-dashboard'],
      ['admin-icon-inbox', 'icon-inbox'], ['admin-icon-map', 'icon-map-pinned'],
      ['admin-icon-scan', 'icon-scan-line'], ['admin-icon-compare', 'icon-compare'], ['admin-icon-activity', 'icon-activity'],
      ['admin-icon-users', 'icon-users'], ['admin-icon-shield', 'icon-shield'],
      ['admin-icon-history', 'icon-history'], ['admin-icon-grid', 'icon-layout-grid'],
      ['admin-icon-bell', 'icon-bell'], ['admin-icon-cloud', 'icon-cloud'], ['admin-icon-chart', 'icon-chart'],
      ['admin-icon-search', 'icon-search']
    ]
    for (const [adminId, homeId] of aliases) {
      const source = document.getElementById(adminId) || document.getElementById(homeId)
      if (!source) continue
      for (const targetId of [adminId, homeId]) {
        if (document.getElementById(targetId)) continue
        const clone = source.cloneNode(true)
        clone.id = targetId
        sprite.append(clone)
      }
    }
  }

  const pageDocument = async (url) => {
    const key = routeKey(url)
    if (!pageCache.has(key)) {
      pageCache.set(key, fetch(key, { credentials: 'same-origin' }).then(async (response) => {
        if (!response.ok) throw new Error(`관리자 화면을 불러오지 못했습니다. (${response.status})`)
        return new DOMParser().parseFromString(await response.text(), 'text/html')
      }).catch((error) => { pageCache.delete(key); throw error }))
    }
    return pageCache.get(key)
  }

  const styleUrl = (link, baseUrl) => new URL(link.getAttribute('href'), baseUrl)
  const loadRouteStyles = async (nextDocument, destination) => {
    const requested = [...nextDocument.querySelectorAll('link[rel="stylesheet"][href]')]
      .map(link => styleUrl(link, destination))
    const requiredPageStyles = new Set(requested.filter(url => pageStyleNames.has(assetName(url.pathname))).map(url => url.pathname))
    const loading = requested.map(url => {
      const exists = [...document.querySelectorAll('link[rel="stylesheet"][href]')].some(link => new URL(link.href).pathname === url.pathname)
      if (exists) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = url.href
        if (pageStyleNames.has(assetName(url.pathname))) link.dataset.adminRouteStyle = 'true'
        link.onload = resolve
        link.onerror = () => reject(new Error(`${url.pathname} 스타일을 불러오지 못했습니다.`))
        document.head.append(link)
      })
    })
    await Promise.all(loading)
    return () => document.querySelectorAll('link[data-admin-route-style]').forEach((link) => {
      if (!requiredPageStyles.has(new URL(link.href).pathname)) link.remove()
    })
  }

  const pageScripts = (nextDocument, destination) => [...nextDocument.querySelectorAll('script[src]')]
    .map(script => new URL(script.getAttribute('src'), destination))
    .filter(url => !['admin-shell.js', 'admin-session.js'].includes(assetName(url.pathname)))

  const executePageScripts = async (nextDocument, destination, sequence) => {
    for (const original of pageScripts(nextDocument, destination)) {
      const url = new URL(original)
      url.searchParams.set('adminRoute', String(sequence))
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.type = 'module'
        script.src = url.href
        script.onload = () => { script.remove(); resolve() }
        script.onerror = () => { script.remove(); reject(new Error(`${url.pathname} 기능을 불러오지 못했습니다.`)) }
        document.head.append(script)
      })
    }
  }

  const syncChrome = (destination, nextMain, nextDocument) => {
    document.title = nextDocument.title
    document.body.className = nextDocument.body.className
    const route = normalizedRoute(destination.pathname)
    frame.querySelectorAll('.admin-nav-link[href]').forEach((link) => {
      const current = normalizedRoute(new URL(link.href).pathname) === route
      link.classList.toggle('is-current', current)
      if (current) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
    const title = nextMain.dataset.adminTitle || nextMain.querySelector('h1')?.textContent || '관리자'
    const breadcrumb = frame.querySelector('.admin-breadcrumb strong')
    if (breadcrumb) breadcrumb.textContent = title
  }

  const go = async (value, options = {}) => {
    const destination = routeUrl(value)
    if (!isInternalRoute(destination)) { window.location.assign(destination.href); return }
    if (!options.fromHistory && destination.href === window.location.href) return
    const sequence = ++navigationSequence
    frame.setAttribute('aria-busy', 'true')
    try {
      const nextDocument = await pageDocument(destination)
      if (sequence !== navigationSequence) return
      const parsedMain = nextDocument.querySelector('main[data-admin-page]')
      if (!parsedMain) throw new Error('관리자 본문을 찾지 못했습니다.')
      const removeOldStyles = await loadRouteStyles(nextDocument, destination)
      if (sequence !== navigationSequence) return
      const nextMain = document.importNode(parsedMain, true)
      document.dispatchEvent(new CustomEvent('admin:before-route-change'))
      if (!options.fromHistory) window.history.pushState({ adminRoute: true }, '', destination)
      main.replaceWith(nextMain)
      main = nextMain
      syncChrome(destination, nextMain, nextDocument)
      observeVisibility(nextMain)
      ensureIconAliases()
      removeOldStyles()
      window.scrollTo({ top: 0, behavior: 'instant' })
      await executePageScripts(nextDocument, destination, sequence)
      document.dispatchEvent(new CustomEvent('admin:route-change', { detail: { url: destination.href } }))
    } catch (error) {
      if (sequence === navigationSequence) window.location.assign(destination.href)
    } finally {
      if (sequence === navigationSequence) frame.removeAttribute('aria-busy')
    }
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target.closest('a[href]')
    if (!link || link.target || link.hasAttribute('download')) return
    const destination = routeUrl(link.href)
    if (!isInternalRoute(destination)) return
    event.preventDefault()
    void go(destination)
  })
  window.addEventListener('popstate', () => void go(window.location.href, { fromHistory: true }))

  const warm = (link) => {
    const destination = routeUrl(link.href)
    if (isInternalRoute(destination)) void pageDocument(destination).catch(() => {})
  }
  frame.addEventListener('pointerover', (event) => { const link = event.target.closest('a[href]'); if (link) warm(link) })
  frame.addEventListener('focusin', (event) => { const link = event.target.closest('a[href]'); if (link) warm(link) })

  document.querySelectorAll('link[rel="stylesheet"][href]').forEach((link) => {
    if (pageStyleNames.has(assetName(new URL(link.href).pathname))) link.dataset.adminRouteStyle = 'true'
  })
  ensureIconAliases()
  observeVisibility(main)
  window.AdminNavigation = Object.freeze({ go })
  frame.dataset.adminNavigation = 'ready'
})()
