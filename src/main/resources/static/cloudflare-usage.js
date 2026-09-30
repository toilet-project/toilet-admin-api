
(() => {
  const n = value => value == null ? '—' : new Intl.NumberFormat('ko-KR', {maximumFractionDigits:2}).format(value)
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const money = value => value == null ? '산출 보류' : value > 0 && value < .01 ? '< $0.01' : '$' + Number(value).toFixed(2)
  const stamp = value => value ? new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : '—'
  const format = (value, unit) => value == null ? '확인 필요' : unit === 'bytes' ? (value >= 1e9 ? n(value / 1e9) + ' GB' : value >= 1e6 ? n(value / 1e6) + ' MB' : value >= 1e3 ? n(value / 1e3) + ' kB' : n(value) + ' B') : n(value) + ({requests:'회',rows:'행',ms:' ms','GB-s':' GB-s'}[unit] || '')
  const percent = m => !m.included || m.used == null ? null : m.used / m.included * 100
  const status = m => ({OK:['포함량 이내',''],WARN:['주의 · 추이 확인','warn'],OVER:['포함량 초과','over'],STALE:['지난 조회값','unknown'],UNAVAILABLE:['확인 필요','unknown']}[m.status] || ['확인 필요','unknown'])
  const safeSource = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'developers.cloudflare.com' ? u.href : 'https://developers.cloudflare.com/r2/pricing/' } catch { return 'https://developers.cloudflare.com/r2/pricing/' } }
  function card(m) {
    const [baseBadge, tone] = status(m), p = percent(m)
    const badge = m.periodKind === 'CURRENT' && m.used != null && m.status !== 'STALE' ? '현재 용량 참고' : baseBadge
    const ratio = p == null ? '' : p > 0 && p < .1 ? '<0.1%' : n(p) + '%'
    const allowance = m.included > 0 ? (m.periodKind === 'CURRENT' ? '현재 용량 참고선 ' : '포함량 ') + format(m.included, m.unit) + ' · ' + ratio : m.used == null ? '확인 전까지 사용량·요금 산출 보류' : '월 무료 포함량 없음'
    const stock = m.periodKind === 'CURRENT'
    return '<article class="cf-meter is-' + tone + '" data-metric="' + esc(m.id) + '"><header><div><span class="cf-service">' + esc(m.service) + (stock ? ' · 현재 관측' : ' · 청구 주기') + '</span><h3>' + esc(m.label) + '</h3></div><span class="cf-badge ' + tone + '">' + esc(badge) + '</span></header><div class="cf-number">' + esc(format(m.used,m.unit)) + '</div><p class="cf-limit">' + esc(allowance) + '</p>' +
      (p == null ? '' : '<div class="cf-track" role="progressbar" aria-label="' + esc(m.label) + ' 포함량 대비" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(p,100).toFixed(1) + '" aria-valuetext="' + esc(ratio) + '"><i style="width:' + Math.min(p,100).toFixed(2) + '%"></i></div>') +
      '<div class="cf-prices"><div><span>현재 사용량의 예상 초과액</span><strong>' + esc(money(m.estimatedOverageUsd)) + '</strong></div><div><span>청구 종료 시 예상 초과액</span><strong>' + esc(money(m.projectedOverageUsd)) + '</strong></div></div><p class="cf-rate">' + esc(m.rateLabel) + '</p><details><summary>집계·계산 기준</summary><p>' + esc(m.note) + '</p>' +
      (m.projectedUsage == null ? '' : '<p>현재 평균 속도가 유지되면 종료 시 ' + esc(format(m.projectedUsage,m.unit)) + '</p>') +
      '<p>조회 기준 ' + esc(stamp(m.measuredAt)) + ' KST</p><a href="' + esc(safeSource(m.sourceUrl)) + '" target="_blank" rel="noreferrer">공식 요금표 ↗</a></details></article>'
  }
  function render(data) {
    const root = document.getElementById('cf-cost-monitor')
    if (!root) return
    const selectedService=root.querySelector('[data-service][aria-pressed="true"]')?.dataset.service||'전체'
    const includeZero=root.querySelector('#cf-include-zero')?.checked||false
    const metrics = data.metrics || [], summary = data.costSummary || {}
    root.innerHTML = '<div class="cf-summary"><article class="cf-summary-card"><p>현재까지 예상 초과액 · 확인 항목 소계</p><strong>' + esc(money(summary.observedSubtotalUsd)) + '</strong><small>Workers 기본요금 $' + n(summary.baseFeeUsd ?? 5) + ' 별도 · 세금·할인 제외</small></article><article class="cf-summary-card"><p>청구 종료 시 예상 초과액 · 동일 항목</p><strong>' + esc(money(summary.projectedSubtotalUsd)) + '</strong><small>현재 주기 평균 사용 속도 기준. 캐시 최초 생성이나 봇 방문이 줄면 달라집니다.</small></article><article class="cf-summary-card"><p>요금 집계 범위</p><strong>' + n(summary.pricedMetrics || 0) + '<span style="font-size:17px">개 산출 · ' + n(summary.unpricedMetrics || 0) + '개 미산출</span></strong><small>미산출 항목은 무료라는 뜻이 아닙니다. 운영·미리보기·다른 앱을 포함한 계정 전체입니다.</small></article></div><div class="cf-notice" role="status">' + esc(data.message) + '<br>' + esc(summary.note || '요금 집계 응답이 없습니다. API 연결 상태를 확인하세요.') + '</div><div class="cf-toolbar"><h2>서비스별 사용량과 예상 요금</h2><label><input type="checkbox" id="cf-include-zero"> 사용량 0인 항목도 보기</label></div><div class="cf-filter" aria-label="서비스 필터">' + ['전체','R2','Workers','D1','Durable Objects'].map((s,i) => '<button type="button" data-service="' + esc(s) + '" aria-pressed="' + (i === 0) + '">' + esc(s) + '</button>').join('') + '</div><section class="cf-meters" id="cf-meters" aria-live="polite"></section><section class="cf-panel"><h2>실제로 사용한 리소스</h2><p class="cf-muted">같은 계정의 다른 앱도 포함량을 함께 사용합니다. 저장량은 최근 관측값이고 나머지는 청구 주기 누계입니다.</p><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>서비스</th><th>리소스</th><th>요청 / 작업</th><th>CPU 시간</th><th>행 읽기 / 쓰기</th><th>현재 저장량</th><th>오류</th></tr></thead><tbody>' +
      (data.resources || []).filter(r => [r.requests,r.cpuMs,r.rowsRead,r.rowsWritten,r.storageBytes,r.errors].some(v => v > 0)).map(r => '<tr><td>' + esc(r.service) + '</td><td class="cf-resource-name">' + esc(r.name) + '</td><td>' + n(r.requests) + '</td><td>' + (r.cpuMs == null ? '—' : n(r.cpuMs) + ' ms') + '</td><td>' + n(r.rowsRead) + ' / ' + n(r.rowsWritten) + '</td><td>' + (r.storageBytes == null ? '—' : format(r.storageBytes,'bytes')) + '</td><td>' + n(r.errors) + '</td></tr>').join('') +
      '</tbody></table></div></section><section class="cf-panel"><h2>R2 요청 종류별 집계</h2><p class="cf-muted">Class A는 저장·목록, Class B는 읽기·조회입니다. 단위 올림을 적용하며, 요청 수는 Analytics 표본 기반 추정치입니다. 미분류 요청은 비용 소계에서 제외합니다.</p><div class="cf-table-wrap"><table class="cf-table"><thead><tr><th>작업</th><th>저장 등급</th><th>과금 분류</th><th>요청 수</th></tr></thead><tbody>' +
      [...(data.r2Operations || [])].sort((a,b) => b.requests-a.requests).map(o => '<tr><td>' + esc(o.action) + '</td><td>' + esc(o.storageClass) + '</td><td>' + esc({A:'Class A',B:'Class B',FREE:'무료 작업',UNKNOWN:'분류 확인 필요'}[o.billingClass] || '확인 필요') + '</td><td>' + n(o.requests) + '회</td></tr>').join('') +
      '</tbody></table></div></section><section class="cf-panel" id="cf-monitor-suggestions"><h2>추가로 감시하면 좋은 항목</h2><p class="cf-muted">아래는 추가 연동 권장 목록입니다. 현재 자동 경보가 켜졌다는 뜻은 아닙니다.</p><div class="cf-monitor-list">' +
      [
        ['R2 저장 급증 · 캐시 종류별 비중','최근 1시간·24시간 PUT 증가율과 원본 / 언어별 본문 / 배포 캐시 / 지도별 저장 비중. 최초 생성과 반복 덮어쓰기는 별도 계측이 필요합니다.'],
        ['포함량 소진 예상일 · 비용 경보','80%·100% 도달뿐 아니라 청구 종료 전 초과 예상, 일일 비용 급증, 설정한 월 예산 접근을 알림으로 연결합니다.'],
        ['캐시 적중률 · 봇 트래픽','R2 GET 200·404, 원본 API 조회율, CDN 적중률과 검색봇별 요청을 함께 봅니다. R2 적중과 CDN 적중은 분리합니다.'],
        ['Workers 오류 · CPU · 응답 지연','스크립트별 오류율, CPU 제한 초과, CPU·응답시간 p95를 확인해 원인 서비스와 경로를 찾습니다.'],
        ['D1 비효율 쿼리 · 저장 증가','읽은 행 대비 반환 행, 느린 쿼리, DB별 저장량 증가를 확인합니다. 조회 횟수와 과금 행 수는 다릅니다.'],
        ['갱신·변경 알림·Tunnel 상태','28일 순환 갱신 성공/실패/누락, 변경 알림 대기열, DO 실행 오류, 원본 5xx·Tunnel 연결 상태를 확인합니다.']
      ].map(([h,p]) => '<article class="cf-monitor-item"><h3>' + esc(h) + '</h3><p>' + esc(p) + '</p></article>').join('') +
      '</div><p class="cf-muted">예상액은 청구서가 아닙니다. 조회는 서버에서 5분간 재사용하고, 반영 지연을 고려해 15분 전까지 요청합니다. 기간은 설정된 청구 갱신일 기준 UTC이며 화면 시각은 KST입니다. 공개 단가 확인: 2026-09-30.</p></section>'
    let service = selectedService
    document.getElementById('cf-include-zero').checked=includeZero
    root.querySelectorAll('[data-service]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.service===service)))
    function update() {
      const showZero = document.getElementById('cf-include-zero').checked
      const visible = metrics.filter(m => (service === '전체' || m.service === service) && (showZero || m.used == null || m.used > 0 || m.status === 'STALE'))
      document.getElementById('cf-meters').innerHTML = visible.map(card).join('') || '<p class="cf-empty">현재 표시할 사용량이 없습니다. 사용량 0인 항목 보기를 켜세요.</p>'
    }
    root.querySelectorAll('[data-service]').forEach(button => button.addEventListener('click', () => {
      service = button.dataset.service
      root.querySelectorAll('[data-service]').forEach(b => b.setAttribute('aria-pressed', String(b === button)))
      update()
    }))
    document.getElementById('cf-include-zero').addEventListener('change', update)
    update()
  }
  globalThis.CloudflareCostView = {render, money, format, card}
})()
