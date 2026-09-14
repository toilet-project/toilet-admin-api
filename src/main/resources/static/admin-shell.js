(() => {
  const main = document.querySelector('main[data-admin-page]')
  if (!main || main.closest('.admin-frame')) return

  const page = main.dataset.adminPage || 'home'
  const title = main.dataset.adminTitle || main.querySelector('h1')?.textContent || '관리자'
  const icon = (name, extra = '') => `<svg class="admin-icon ${extra}" aria-hidden="true"><use href="#admin-icon-${name}"/></svg>`
  const nav = (key, href, name, iconName, meta = '') => `<a class="admin-nav-link${page === key ? ' is-current' : ''}" href="${href}"${page === key ? ' aria-current="page"' : ''}>${icon(iconName)}${name}${meta ? `<span class="admin-nav-meta">${meta}</span>` : ''}</a>`
  const frame = document.createElement('div')
  frame.className = 'admin-frame'
  frame.hidden = main.hidden
  frame.innerHTML = `
    <svg class="admin-icon-sprite" aria-hidden="true">
      <symbol id="admin-icon-map-pin" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></symbol>
      <symbol id="admin-icon-dashboard" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></symbol>
      <symbol id="admin-icon-inbox" viewBox="0 0 24 24"><path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 16h5l2 2h6l2-2h5"/></symbol>
      <symbol id="admin-icon-map" viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/><circle cx="15" cy="10" r="2"/></symbol>
      <symbol id="admin-icon-scan" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/></symbol>
      <symbol id="admin-icon-activity" viewBox="0 0 24 24"><path d="M3 12h4l2-7 4 14 2-7h6"/></symbol>
      <symbol id="admin-icon-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
      <symbol id="admin-icon-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></symbol>
      <symbol id="admin-icon-history" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></symbol>
      <symbol id="admin-icon-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></symbol>
      <symbol id="admin-icon-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></symbol>
      <symbol id="admin-icon-cloud" viewBox="0 0 24 24"><path d="M17.5 19H7a5 5 0 1 1 1-9.9A7 7 0 0 1 21 12.5 4.5 4.5 0 0 1 17.5 19Z"/></symbol>
      <symbol id="admin-icon-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></symbol>
    </svg>
    <aside class="admin-sidebar" aria-label="관리자 메뉴">
      <a class="admin-brand" href="/" aria-label="급똥 관리자 운영 홈"><span class="admin-brand-mark">${icon('map-pin')}</span><span><strong>급똥</strong><small>WORKSPACE</small></span></a>
      <nav class="admin-nav" aria-label="업무별 탐색">
        <div class="admin-nav-group">${nav('home','/','운영 홈','dashboard')}</div>
        <div class="admin-nav-group"><p>데이터 관리</p>${nav('toilets','/toilets.html','화장실 데이터','map')}${nav('reports','/reports.html','제보 검토','inbox')}${nav('quality','/data-quality.html','중복 좌표 품질 관리','scan')}${nav('regions','/regions.html','행정구역 검토','map')}</div>
        <div class="admin-nav-group"><p>서비스 운영</p>${nav('operations','/operations.html','수집·서비스 상태','activity')}${nav('members','/members.html','회원 관리','users')}${nav('permissions','/permissions.html','권한 관리','shield')}${nav('history','/batch-syncs.html','배치 실행 이력','history')}</div>
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
})()
