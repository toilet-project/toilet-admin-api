(() => {
  const API_BASE = 'https://api.geupddong.com'
  const root = document.getElementById('analytics-shell')
  if (!root) return
  const byId = (id) => document.getElementById(id)
  const number = (value) => new Intl.NumberFormat('ko-KR').format(Number(value || 0))
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
  const state = { range: '7d', from: '', to: '' }

  function parseDate(value) {
    if (!value) return null
    const parsed = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+09:00`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  function dateTime(value) {
    const parsed = parseDate(value)
    return parsed ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed) : '—'
  }

  function duration(value) {
    const seconds = Math.max(0, Number(value || 0))
    const minutes = Math.floor(seconds / 60)
    const remains = Math.round(seconds % 60)
    return minutes ? `${minutes}분 ${remains}초` : `${remains}초`
  }

  function percent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`
  }

  function currentQuery() {
    const query = new URLSearchParams({ range: state.range })
    if (state.range === 'custom') {
      query.set('from', state.from)
      query.set('to', state.to)
    }
    return query
  }

  async function json(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  function statusLabel(value) {
    return ({ UP: '정상', NO_DATA: '데이터 대기', NOT_CONFIGURED: '연동 필요', WAITING_FOR_DATA: '첫 집계 대기', STALE: '수집 지연', AUTH_ERROR: '권한 확인', QUOTA_LIMITED: '한도 확인', API_UNAVAILABLE: 'API 지연', QUERY_ERROR: '지표 확인' })[value] || '확인 필요'
  }

  function setCollectionState(status, updatedAt) {
    byId('ga-state-text').textContent = statusLabel(status)
    byId('ga-updated-at').textContent = updatedAt ? `마지막 성공 ${dateTime(updatedAt)}` : '아직 성공 데이터 없음'
    const dot = byId('ga-state-dot')
    dot.className = status === 'UP' || status === 'NO_DATA' ? 'is-good' : 'is-warn'
  }

  function renderTrend(rows) {
    const target = byId('ga-trend-chart')
    const data = [...(rows || [])].sort((left, right) => String(left.date).localeCompare(String(right.date)))
    if (!data.length) {
      target.innerHTML = '<p class="analytics-empty">선택한 기간의 추이 데이터가 없습니다.</p>'
      return
    }
    const width = 820
    const height = 230
    const left = 42
    const right = 12
    const top = 14
    const bottom = 32
    const chartHeight = height - top - bottom
    const max = Math.max(...data.flatMap((item) => [Number(item.activeUsers || 0), Number(item.views || 0)]), 1)
    const niceMax = Math.max(5, Math.ceil(max / 5) * 5)
    const x = (index) => left + (width - left - right) * (data.length === 1 ? .5 : index / (data.length - 1))
    const y = (value) => top + chartHeight - Number(value || 0) / niceMax * chartHeight
    const grid = [0, .5, 1].map((part) => {
      const value = Math.round(niceMax * part)
      const pos = y(value)
      return `<line class="ga-grid" x1="${left}" y1="${pos}" x2="${width - right}" y2="${pos}"/><text x="${left - 8}" y="${pos + 3}" text-anchor="end">${value}</text>`
    }).join('')
    const path = (key) => data.map((item, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(item[key]).toFixed(1)}`).join(' ')
    const labels = data.map((item, index) => {
      const show = data.length <= 8 || index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 6) === 0
      return show ? `<text x="${x(index)}" y="${height - 7}" text-anchor="middle">${escapeHtml(String(item.date).slice(5).replace('-', '.'))}</text>` : ''
    }).join('')
    const points = data.length <= 8 ? data.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.activeUsers)}" r="3"><title>${escapeHtml(item.date)} 활성 ${number(item.activeUsers)}명 · 조회 ${number(item.views)}회</title></circle>`).join('') : ''
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="활성 사용자와 페이지뷰 기간 추이">${grid}<path class="ga-views" d="${path('views')}"/><path class="ga-active" d="${path('activeUsers')}"/>${points}${labels}</svg>`
  }

  function translated(value, type) {
    const maps = {
      device: { mobile: '모바일', desktop: '데스크톱', tablet: '태블릿' },
      channel: { Direct: '직접 유입', 'Organic Search': '검색', Referral: '외부 링크', 'Organic Social': '소셜', Unassigned: '미분류' },
    }
    return maps[type]?.[value] || value || '(값 없음)'
  }

  function renderTable(id, rows, kind) {
    const target = byId(id)
    const values = (rows || []).slice(0, kind === 'event' ? 8 : 7)
    if (!values.length) {
      target.innerHTML = '<tr><td colspan="4">선택한 기간의 데이터가 없습니다.</td></tr>'
      return
    }
    target.innerHTML = values.map((item) => kind === 'page'
      ? `<tr><td><strong>${escapeHtml(item.label || item.key)}</strong><small>${escapeHtml(item.detail || item.key)}</small></td><td>${number(item.views)}</td><td>${number(item.activeUsers)}</td><td>${duration(item.averageEngagementSeconds)}</td></tr>`
      : `<tr><td><strong>${escapeHtml(item.label || item.key)}</strong></td><td>${number(item.eventCount)}</td><td>${number(item.activeUsers)}</td><td>${number(item.keyEvents)}</td></tr>`).join('')
  }

  function renderBars(id, rows, metric, labelType) {
    const target = byId(id)
    const values = (rows || []).slice(0, 6)
    const maximum = Math.max(...values.map((item) => Number(item[metric] || 0)), 1)
    target.innerHTML = values.length ? values.map((item) => `<div class="analytics-bar-item"><span>${escapeHtml(translated(item.label || item.key, labelType))}</span><strong>${number(item[metric])}</strong><div><i style="width:${Math.max(2, Number(item[metric] || 0) * 100 / maximum)}%"></i></div></div>`).join('') : '<p class="analytics-empty">데이터가 없습니다.</p>'
  }

  function renderCompact(id, rows, metric, labelType) {
    const target = byId(id)
    const values = (rows || []).slice(0, 5)
    target.innerHTML = values.length ? values.map((item) => `<div><span>${escapeHtml(translated(item.label || item.key, labelType))}</span><strong>${number(item[metric])}</strong></div>`).join('') : '<p class="analytics-empty">데이터가 없습니다.</p>'
  }

  function renderDevices(rows) {
    const values = (rows || []).slice(0, 4)
    const total = values.reduce((sum, item) => sum + Number(item.activeUsers || 0), 0) || 1
    let cursor = 0
    const colors = ['#26734e', '#78b18e', '#b7d5c2', '#dae8de']
    const stops = values.map((item, index) => {
      const start = cursor
      cursor += Number(item.activeUsers || 0) * 100 / total
      return `${colors[index]} ${start}% ${cursor}%`
    }).join(',') || '#e9efeb 0 100%'
    byId('ga-devices').innerHTML = `<div class="analytics-donut" style="background:conic-gradient(${stops})"></div><div class="analytics-distribution-list">${values.map((item, index) => `<div><span><i style="display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:2px;background:${colors[index]}"></i>${escapeHtml(translated(item.label || item.key, 'device'))}</span><strong>${(Number(item.activeUsers || 0) * 100 / total).toFixed(1)}%</strong></div>`).join('') || '<p class="analytics-empty">데이터가 없습니다.</p>'}</div>`
  }

  function renderReport(response) {
    const data = response.data || {}
    const current = data.current || {}
    byId('ga-kpi-active').textContent = number(current.activeUsers)
    byId('ga-kpi-views').textContent = number(current.views)
    byId('ga-kpi-sessions').textContent = number(current.sessions)
    byId('ga-kpi-time').textContent = duration(current.averageEngagementSeconds)
    byId('ga-kpi-events').textContent = number(current.keyEvents)
    byId('ga-kpi-views-user').textContent = `사용자당 ${current.activeUsers ? (current.views / current.activeUsers).toFixed(1) : '—'}`
    byId('ga-kpi-engagement').textContent = `참여율 ${percent(current.engagementRate)}`
    byId('ga-kpi-new').textContent = `신규 사용자 ${number(current.newUsers)}`
    const change = data.activeUsersChangePercent
    const changeTarget = byId('ga-kpi-change')
    changeTarget.className = ''
    if (change == null) changeTarget.textContent = '이전 기간 비교 없음'
    else {
      const label = Math.abs(change) >= 10 ? Math.round(change) : Number(change).toFixed(1)
      changeTarget.textContent = `이전 기간 대비 ${change >= 0 ? '+' : ''}${label}%`
      changeTarget.className = change >= 0 ? 'is-up' : 'is-down'
    }
    renderTrend(data.trend)
    renderTable('ga-pages', data.pages, 'page')
    renderTable('ga-events', data.events, 'event')
    renderBars('ga-channels', data.channels, 'sessions', 'channel')
    renderCompact('ga-sources', data.sources, 'sessions')
    renderDevices(data.devices)
    renderBars('ga-os', data.operatingSystems, 'activeUsers')
    renderBars('ga-browsers', data.browsers, 'activeUsers')
    renderCompact('ga-countries', data.countries, 'activeUsers')
    renderCompact('ga-cities', data.cities, 'activeUsers')
    setCollectionState(response.status, response.lastSuccessfulAt)
    byId('ga-connection').hidden = response.status !== 'NOT_CONFIGURED'
  }

  function renderRealtime(response) {
    const data = response.data || {}
    byId('ga-live-users').textContent = number(data.activeUsers)
    byId('ga-live-views').textContent = number(data.views)
    byId('ga-live-events').textContent = number(data.events)
    byId('ga-live-key-events').textContent = number(data.keyEvents)
    byId('ga-realtime-note').textContent = `${response.message || '최근 30분 집계입니다.'}${response.lastSuccessfulAt ? ` · ${dateTime(response.lastSuccessfulAt)} 조회` : ''}`
  }

  function renderStatus(response) {
    byId('ga-health-status').textContent = statusLabel(response.status)
    byId('ga-last-attempt').textContent = dateTime(response.lastAttemptAt)
    byId('ga-last-success').textContent = dateTime(response.lastSuccessfulAt)
    byId('ga-next-refresh').textContent = dateTime(response.nextScheduledAt)
    byId('ga-quota-hour').textContent = response.quotaRemaining?.tokensPerHour == null ? '—' : number(response.quotaRemaining.tokensPerHour)
    byId('ga-health-message').textContent = response.message
    if (response.dashboardUrl) byId('ga-dashboard-link').href = response.dashboardUrl
    byId('ga-connection').hidden = response.configured
  }

  async function loadAll(force = false) {
    root.classList.add('is-loading')
    byId('ga-refresh').disabled = true
    try {
      const query = currentQuery()
      const reportRequest = force
        ? json(`/api/admin/v1/google-analytics/refresh?${query}`, { method: 'POST' })
        : json(`/api/admin/v1/google-analytics/trend?${query}`)
      const [report, realtime, status] = await Promise.all([
        reportRequest,
        json('/api/admin/v1/google-analytics/realtime'),
        json('/api/admin/v1/google-analytics/collection-status'),
      ])
      renderReport(report)
      renderRealtime(realtime)
      renderStatus(status)
    } catch {
      setCollectionState('API_UNAVAILABLE')
      byId('ga-health-status').textContent = '조회 실패'
      byId('ga-health-message').textContent = '관리자 분석 데이터를 불러오지 못했습니다. 다른 운영 기능에는 영향이 없습니다.'
    } finally {
      root.classList.remove('is-loading')
      byId('ga-refresh').disabled = false
    }
  }

  function bind() {
    byId('ga-refresh').addEventListener('click', () => loadAll(true))
    document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => {
      const range = button.dataset.range
      document.querySelectorAll('[data-range]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
      byId('ga-custom-range').hidden = range !== 'custom'
      if (range === 'custom') return
      state.range = range
      loadAll()
    }))
    byId('ga-custom-range').addEventListener('submit', (event) => {
      event.preventDefault()
      state.range = 'custom'
      state.from = byId('ga-from').value
      state.to = byId('ga-to').value
      if (state.from && state.to) loadAll()
    })
  }

  function showLogin(forbidden) {
    root.hidden = true
    byId('auth-shell').hidden = false
    byId('auth-title').textContent = forbidden ? '관리자 권한이 필요합니다' : '관리자 로그인'
    byId('auth-description').textContent = forbidden ? '다른 관리자 계정으로 로그인하거나 권한을 확인해 주세요.' : '승인된 관리자 계정으로 로그인해 주세요.'
  }

  async function bootstrap() {
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
      if (response.status === 401) return showLogin(false)
      if (!response.ok) return showLogin(true)
      const profile = await response.json()
      if (!profile.roles?.includes('ADMIN')) return showLogin(true)
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
      const start = new Date(`${today}T00:00:00+09:00`)
      start.setDate(start.getDate() - 6)
      byId('ga-to').value = today
      byId('ga-to').max = today
      byId('ga-from').value = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(start)
      byId('ga-from').max = today
      bind()
      await loadAll()
    } catch {
      showLogin(false)
    }
  }

  bootstrap()
})()
