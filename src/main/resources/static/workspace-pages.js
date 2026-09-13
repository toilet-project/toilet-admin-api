(() => {
  const API_BASE = 'https://api.geupddong.com'
  const main = document.querySelector('#workspace-shell')
  const page = main?.dataset.adminPage
  const byId = (id) => document.getElementById(id)
  const number = (value) => value == null ? '—' : new Intl.NumberFormat('ko-KR').format(value)
  const parseKoreanDate = (value) => new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+09:00`)
  const dateTime = (value) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(parseKoreanDate(value)) : '—'
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())

  function showLogin(title, description) {
    byId('loading-shell').hidden = true
    main.hidden = true
    byId('auth-shell').hidden = false
    byId('auth-title').textContent = title
    byId('auth-description').textContent = description
  }

  async function json(url) {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  function setText(id, value) {
    if (byId(id)) byId(id).textContent = value
  }

  function statusLabel(value) {
    return value === 'UP' || value === 'SUCCESS' ? '정상' : value === 'STALE' ? '지연' : value === 'UNKNOWN' ? '확인 필요' : '이상'
  }

  async function loadInbox() {
    const targets = [
      ['inbox-report-count', `${API_BASE}/api/admin/v1/reports/summary`, (data) => data.pendingCount, '건'],
      ['inbox-quality-count', `${API_BASE}/api/admin/v1/data-quality/duplicate-coordinates?page=0&size=1`, (data) => data.totalElements, '그룹'],
      ['inbox-region-count', `${API_BASE}/api/admin/v1/regions?status=REVIEW&page=0&size=1`, (data) => data.totalElements, '건'],
    ]
    const results = await Promise.allSettled(targets.map(([, url]) => json(url)))
    results.forEach((result, index) => {
      const [id, , pick, unit] = targets[index]
      setText(id, result.status === 'fulfilled' ? `${number(pick(result.value))}${unit}` : '확인 필요')
    })
    setText('workspace-status', results.every((result) => result.status === 'fulfilled') ? '현재 검토 대상을 불러왔습니다.' : '권한 또는 연동 상태에 따라 일부 건수는 상세 화면에서 확인해 주세요.')
  }

  async function loadToilets() {
    const day = today()
    try {
      const data = await json(`/api/admin/v1/dashboard?from=${day}&to=${day}`)
      setText('toilet-total', `${number(data.batch.totalToiletCount)}곳`)
      setText('toilet-last-sync', dateTime(data.batch.lastSuccessAt))
      setText('workspace-status', '현재 등록 데이터 기준입니다.')
    } catch {
      setText('workspace-status', '등록 현황을 불러오지 못했습니다. 사용자 지도와 데이터 품질 화면은 사용할 수 있습니다.')
    }
  }

  function renderServiceRows(data) {
    const rows = [['관리자 서비스', data.admin], ['공개 API', data.publicApi], ['데이터베이스', data.database], ['디스크', data.disk]]
    const target = byId('operations-services')
    target.replaceChildren(...rows.map(([label, item]) => {
      const row = document.createElement('div')
      row.innerHTML = `<span>${label}</span><strong>${statusLabel(item.status)}</strong>`
      return row
    }))
  }

  async function loadOperations() {
    const day = today()
    const [operations, dashboard, cloudflare] = await Promise.allSettled([
      json('/api/admin/v1/operations/status'),
      json(`/api/admin/v1/dashboard?from=${day}&to=${day}`),
      json('/api/admin/v1/cloudflare/usage'),
    ])
    if (operations.status === 'fulfilled') renderServiceRows(operations.value)
    if (dashboard.status === 'fulfilled') {
      const batch = dashboard.value.batch
      setText('operations-batch-status', batch.failedRuns ? '실패 확인' : '정상')
      setText('operations-batch-time', dateTime(batch.lastSuccessAt))
      setText('operations-batch-count', `${number(batch.insertedRecords + batch.updatedRecords)}건 반영`)
    }
    if (cloudflare.status === 'fulfilled') {
      const data = cloudflare.value
      setText('operations-cloudflare-status', data.available ? '정상' : '확인 필요')
      setText('operations-cloudflare-max', `${Math.max(data.workersRequests.usedPercent, data.d1RowsRead.usedPercent, data.r2StorageBytes.usedPercent)}%`)
    }
    setText('workspace-status', [operations, dashboard, cloudflare].every((result) => result.status === 'fulfilled') ? '운영 상태를 최신 값으로 확인했습니다.' : '일부 운영 지표를 불러오지 못했습니다.')
  }

  async function loadCloudflare() {
    try {
      const data = await json('/api/admin/v1/cloudflare/usage')
      const metrics = [
        ['cf-workers', data.workersRequests, '회'],
        ['cf-d1', data.d1RowsRead, '행'],
        ['cf-r2', data.r2StorageBytes, 'byte'],
      ]
      metrics.forEach(([prefix, metric, unit]) => {
        const used = unit === 'byte' ? `${(metric.used / 1024 ** 3).toFixed(2)} GB` : `${number(metric.used)}${unit}`
        const limit = unit === 'byte' ? `${(metric.limit / 1024 ** 3).toFixed(0)} GB` : `${number(metric.limit)}${unit}`
        setText(`${prefix}-value`, used)
        setText(`${prefix}-limit`, `한도 ${limit} · ${metric.usedPercent}% 사용`)
        const bar = byId(`${prefix}-bar`)
        if (bar) bar.style.width = `${Math.min(metric.usedPercent, 100)}%`
      })
      const link = byId('cloudflare-dashboard-link')
      if (link && data.dashboardUrl) link.href = data.dashboardUrl
      setText('workspace-status', `${dateTime(data.queriedAt)} 기준 이용량입니다.`)
    } catch {
      setText('workspace-status', 'Cloudflare 이용량을 불러오지 못했습니다.')
    }
  }

  async function bootstrap() {
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
      if (response.status === 401) return showLogin('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.')
      if (!response.ok) return showLogin('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.')
      const profile = await response.json()
      if (!profile.roles?.includes('ADMIN')) return showLogin('관리자 권한이 필요합니다', '다른 관리자 계정으로 로그인하거나 관리자 권한을 확인해 주세요.')
      byId('loading-shell').hidden = true
      main.hidden = false
      if (page === 'inbox') await loadInbox()
      if (page === 'toilets') await loadToilets()
      if (page === 'operations') await loadOperations()
      if (page === 'cloudflare') await loadCloudflare()
    } catch {
      showLogin('관리자 로그인', '승인된 관리자 계정으로 로그인해 주세요.')
    }
  }

  bootstrap()
})()
