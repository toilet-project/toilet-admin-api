/* Shared responsive controls. Panels are kept alive so drafts, maps and scroll positions survive. */
(() => {
  if (window.AdminResponsive) return
  const compact = matchMedia('(max-width: 1600px), (max-height: 760px)')
  const small = matchMedia('(max-width: 760px)')
  const cleanups = new Set()
  let routeObserver, queued = false, groups, toiletTabs
  let preference = null
  try { preference = localStorage.getItem('admin.sidebar.compact') } catch {}
  const root = document.documentElement
  const setCompact = () => {
    root.toggleAttribute('data-admin-compact', compact.matches)
    root.toggleAttribute('data-admin-nav-open', compact.matches && preference === 'open')
    const toggle = document.querySelector('.admin-menu-toggle')
    toggle?.setAttribute('aria-expanded', String(!compact.matches || preference === 'open'))
    document.querySelectorAll('[data-responsive-tabs]').forEach(el => el._responsiveTabs?.sync())
    document.querySelectorAll('.admin-disclosure').forEach(el => { el.open = compact.matches ? el._compactOpen || false : true })
    updateDocks()
  }
  function tabs(host, panels, labels, key, before = null) {
    if (!host || !panels.length || panels.some(p => !p)) return null
    const existing = host.querySelector(`[data-responsive-tabs="${key}"]`)
    if (existing) return existing._responsiveTabs
    const bar = document.createElement('div')
    bar.className = 'admin-view-tabs'
    bar.dataset.responsiveTabs = key
    bar.setAttribute('role', 'tablist')
    bar.setAttribute('aria-label', labels.join(' / '))
    let selected = 0
    const originalLabels = panels.map(panel => ({ role: panel.getAttribute('role'), labelledby: panel.getAttribute('aria-labelledby') }))
    const buttons = panels.map((panel, i) => {
      panel.id ||= `responsive-${key}-panel-${i}`
      const b = document.createElement('button')
      b.type = 'button'; b.id = `responsive-${key}-tab-${i}`; b.textContent = labels[i]
      b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', panel.id)
      b.addEventListener('click', () => select(i))
      b.addEventListener('keydown', event => {
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : event.key === 'ArrowRight' ? (i + 1) % panels.length : event.key === 'ArrowLeft' ? (i + panels.length - 1) % panels.length : -1
        if (target < 0) return
        event.preventDefault(); select(target); buttons[target].focus()
      })
      bar.append(b)
      return b
    })
    function sync() {
      panels.forEach((panel, i) => {
        const active = !compact.matches || i === selected
        panel.classList.toggle('admin-panel-inactive', !active)
        panel.inert = !active
        if (compact.matches) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', buttons[i].id) }
        else {
          for (const [attr, value] of [['role', originalLabels[i].role], ['aria-labelledby', originalLabels[i].labelledby]]) {
            if (value === null) panel.removeAttribute(attr)
            else panel.setAttribute(attr, value)
          }
        }
        buttons[i].setAttribute('aria-selected', String(i === selected)); buttons[i].tabIndex = i === selected ? 0 : -1
      })
    }
    function select(index) { selected = index; sync() }
    bar._responsiveTabs = { select, sync }
    host.insertBefore(bar, before || host.firstChild)
    sync()
    return bar._responsiveTabs
  }
  function disclosure(element, label) {
    if (!element || element.parentElement.classList.contains('admin-disclosure')) return
    const details = document.createElement('details')
    details.className = 'admin-disclosure'; details.open = !compact.matches
    details.addEventListener('toggle', () => { if (compact.matches) details._compactOpen = details.open })
    const summary = document.createElement('summary'); summary.textContent = label
    element.before(details); details.append(summary, element)
  }
  function dock(selector, targetSelector) {
    const main = document.querySelector('main[data-admin-page]')
    const action = main?.querySelector(selector), target = main?.querySelector(targetSelector)
    if (!action || !target || action.dataset.adminDocked) return
    action.dataset.adminDocked = 'true'
    const form = action.closest('form')
    if (form?.id) action.querySelectorAll('button[type="submit"], input[type="submit"]').forEach(button => button.setAttribute('form', form.id))
    const marker = document.createElement('span'); marker.hidden = true
    action.before(marker)
    const footer = document.createElement('footer'); footer.className = 'admin-action-dock'
    footer._action = action; footer._marker = marker
    target.append(footer)
  }
  function updateDocks() {
    document.querySelectorAll('.admin-action-dock').forEach(footer => {
      const { _action: action, _marker: marker } = footer
      if (!action || !marker?.isConnected) { footer.remove(); return }
      if (compact.matches && action.parentElement !== footer) footer.append(action)
      if (!compact.matches && action.parentElement === footer) marker.after(action)
    })
  }
  function enhanceContent() {
    queued = false
    const main = document.querySelector('main[data-admin-page]')
    if (!main) return
    disclosure(main.querySelector('.opening-hours-members'), '적용 대상 시설 확인')
    disclosure(main.querySelector('.opening-hours-history'), '변경 이력 확인')
    disclosure(main.querySelector('.analytics-filter-line'), '상세 필터')
    dock('.opening-hours-actions', '.opening-hours-detail')
    dock('#region-confirm', '.region-detail')
    dock('#change-decision-submit', '.change-detail-pane')
    updateDocks()
    main.querySelectorAll('.table-wrap, .hm-table-wrap').forEach(el => {
      if (!el.hasAttribute('tabindex')) { el.tabIndex = 0; el.setAttribute('role', 'region'); el.setAttribute('aria-label', '목록 · 가로로 스크롤하여 모든 항목 확인') }
    })
  }
  function queueEnhance() {
    if (queued) return
    queued = true; requestAnimationFrame(enhanceContent)
  }
  function initRoute() {
    routeObserver?.disconnect()
    groups = toiletTabs = null
    const main = document.querySelector('main[data-admin-page]')
    if (!main) return
    // Keep the common overrides after styles dynamically loaded by admin navigation.
    const sheet = document.querySelector('link[href*="admin-responsive.css"]')
    if (sheet && sheet !== document.head.lastElementChild) document.head.append(sheet)
    const stack = main.querySelector('.quality-stack')
    if (stack) groups = tabs(stack, [...stack.children].filter(p => p.matches('section')), ['그룹 목록', '선택 그룹 시설'], 'quality')
    const layout = main.querySelector('.toilet-data-layout')
    if (layout) toiletTabs = tabs(layout, [main.querySelector('.toilet-map-card'), main.querySelector('.toilet-editor-card')], ['지도', '정보 수정'], 'toilet')
    if (main.dataset.adminPage === 'permissions') tabs(main, [...main.querySelectorAll(':scope > .security-panel')], ['관리자 권한', '감사 이력'], 'permissions', main.querySelector('.security-panel'))
    enhanceContent()
    routeObserver = new MutationObserver(queueEnhance)
    routeObserver.observe(main, { childList: true, subtree: true })
  }
  function watchMap(map, target) {
    if (!target || !map?.relayout || typeof ResizeObserver !== 'function') return
    let width = 0, height = 0, pending = 0
    const observer = new ResizeObserver(entries => {
      if (!target.isConnected) { stop(); return }
      const rect = entries[0].contentRect
      if (!rect.width || !rect.height || (width === rect.width && height === rect.height)) return
      width = rect.width; height = rect.height
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => { if (target.isConnected) { const center = map.getCenter(); map.relayout(); map.setCenter(center) } })
    })
    const stop = () => { observer.disconnect(); cancelAnimationFrame(pending); cleanups.delete(stop) }
    observer.observe(target); cleanups.add(stop)
    return stop
  }
  function init() {
    const frame = document.querySelector('.admin-frame'), topbar = frame?.querySelector('.admin-topbar'), sidebar = frame?.querySelector('.admin-sidebar')
    if (!frame || !topbar || !sidebar) return
    sidebar.id ||= 'admin-sidebar'
    // Label wrappers let the compact rail retain accessible names and a visible hover label.
    sidebar.querySelectorAll('.admin-nav-link').forEach(link => {
      const label = link.textContent.trim(); link.setAttribute('aria-label', label); link.title = label
      const span = document.createElement('span'); span.className = 'admin-nav-label'
      for (const node of [...link.childNodes]) if (node.nodeType === Node.TEXT_NODE) span.append(node)
      link.querySelector('svg')?.after(span)
    })
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'admin-menu-toggle'; button.setAttribute('aria-label', '관리자 메뉴 펼치기 또는 접기'); button.setAttribute('aria-controls', sidebar.id)
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM10 5v14M6 9h2m-2 3h2m-2 3h2"/></svg>'
    topbar.prepend(button)
    button.addEventListener('click', () => {
      preference = root.hasAttribute('data-admin-nav-open') ? 'closed' : 'open'
      try { localStorage.setItem('admin.sidebar.compact', preference) } catch {}
      setCompact()
    })
    const backdrop = document.createElement('button'); backdrop.type = 'button'; backdrop.className = 'admin-menu-backdrop'; backdrop.tabIndex = -1; backdrop.setAttribute('aria-label', '메뉴 닫기')
    backdrop.addEventListener('click', () => { preference = 'closed'; setCompact(); button.focus() })
    frame.append(backdrop)
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && small.matches && root.hasAttribute('data-admin-nav-open')) { preference = 'closed'; setCompact(); button.focus() } })
    document.addEventListener('click', event => {
      if (event.target.closest('.quality-list-item')) groups?.select(1)
      if (event.target.closest('#quality-detail-close, #dn-clear-group')) groups?.select(0)
      if (event.target.closest('.admin-nav-link') && small.matches) { preference = 'closed'; setCompact() }
    })
    compact.addEventListener('change', () => { setCompact(); initRoute() })
    setCompact(); initRoute()
  }
  document.addEventListener('admin:before-route-change', () => { routeObserver?.disconnect(); for (const stop of [...cleanups]) stop() })
  document.addEventListener('admin:route-change', initRoute)
  window.AdminResponsive = Object.freeze({ watchMap })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
})()
