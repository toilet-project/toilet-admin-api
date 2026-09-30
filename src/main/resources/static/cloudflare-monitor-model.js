(() => {
  const finite = v => typeof v === 'number' && Number.isFinite(v)
  const ratio = (part, total) => finite(part) && finite(total) && total > 0 ? part / total * 100 : null
  const section = (report, key) => report?.sections?.[key]?.status === 'OK' ? report.sections[key].data : null
  function exhaustion(metric, usage) {
    if (metric.periodKind !== 'CYCLE' || metric.status === 'STALE' || !finite(metric.used) || metric.used <= 0 || metric.included <= 0) return null
    const start = Date.parse(usage.usagePeriodStart), observed = Date.parse(metric.measuredAt), end = Date.parse(usage.usagePeriodEnd) + 864e5
    if (![start,observed,end].every(Number.isFinite) || observed-start < 864e5 || observed > end) return null
    const at = start + metric.included / metric.used * (observed-start)
    return at < end ? new Date(at).toISOString() : null
  }
  function assess(usage, report, budget, {usagePending=false,monitoringPending=false,states={}}={}) {
    const alerts = []
    const add = (id, title, detail, tab='overview', level='warn') => alerts.push({id,title,detail,tab,level})
    for (const m of usage?.metrics || []) {
      if (m.periodKind !== 'CYCLE' || m.used == null || m.status === 'STALE') continue
      const pct = ratio(m.used,m.included), at = exhaustion(m,usage)
      if (m.used > m.included) add(m.id,`${m.label} 포함량 초과`,'현재까지의 예상 초과액과 요청 종류를 확인하세요.','cost','critical')
      else if (pct >= 80 || at) add(m.id,`${m.label} ${pct >= 80 ? '포함량 80% 이상' : '주기 내 포함량 초과 예상'}`,at ? `현재 평균 속도 기준 ${at}. 초기 캐시 채우기처럼 일시적인 증가면 달라집니다.` : '남은 포함량과 청구 종료일을 확인하세요.','cost')
    }
    const cost=usage?.costSummary
    if(!usagePending && (!usage || cost?.observedSubtotalUsd==null)) add('cost-unavailable','요금 집계 확인 필요','현재 초과액을 산출하지 못했습니다. 다른 상태 지표가 정상이더라도 비용을 0원으로 판단하지 마세요.','cost','info')
    if(finite(budget) && budget>0 && finite(cost?.observedSubtotalUsd)) {
      if(cost.observedSubtotalUsd >= budget) add('budget','설정한 추가요금 예산 도달','집계 가능한 현재 초과액 소계가 예산 이상입니다.','cost','critical')
      else if(cost.observedSubtotalUsd >= budget*.8 || (finite(cost.projectedSubtotalUsd) && cost.projectedSubtotalUsd>=budget)) add('budget','추가요금 예산 주의','현재 사용량 또는 종료 예상 소계가 설정 예산에 접근했습니다. 미산출 비용은 별도입니다.','cost')
    }
    const r2=section(report,'r2')
    if(r2) {
      if(r2.lastHourPuts>=1000 && (r2.previousHourPuts===0 || r2.lastHourPuts>=r2.previousHourPuts*2)) add('put-spike','최근 완료 1시간 PUT 증가','직전 1시간 대비 2배 이상이며 1,000회 이상입니다. 캐시 종류별 비중을 확인하세요.','cache')
      if(ratio(r2.getMissing,r2.getOk+r2.getMissing)>=20 && r2.getOk+r2.getMissing>=100) add('r2-miss','R2 조회의 404 비율 상승','GET 2xx·404 중 404가 20% 이상입니다. 새 캐시 생성이나 없는 키의 반복 조회를 확인하세요.','cache')
      if(r2.serverErrors>0) add('r2-errors','R2 서버 오류 관측','최근 완료 24시간의 5xx 응답이 있습니다.','cache')
    }
    for(const w of section(report,'workers')||[]) {
      if(w.requests>=100 && ratio(w.errors,w.requests)>=1) add('worker-'+w.name,`${w.name} 오류율 1% 이상`,'Workers 실행 오류 기준입니다. HTTP 5xx와는 별도 지표입니다.','health')
      if(w.requests>=100 && w.responseP95Ms>=1000) add('latency-'+w.name,`${w.name} 응답 지연`,'요청 지속시간 p95가 1초 이상입니다. 대기·스트리밍 응답도 포함될 수 있습니다.','health')
    }
    for(const d of section(report,'d1')||[]) {
      if(d.queries>=100 && d.rowsRead/d.queries>=1000) add('d1-'+d.id,'D1 쿼리당 읽은 행 수 점검','쿼리 100회 이상에서 평균 1,000행 이상을 읽었습니다. 쿼리 특성과 인덱스를 확인하세요.','health')
    }
    const traffic=section(report,'traffic'),objects=section(report,'objects')
    if(traffic?.edgeErrors>0 || traffic?.originErrors>0) add('http-errors','웹 트래픽 5xx 관측','엣지 응답과 원본 응답의 5xx를 구분해 확인하세요.','cache')
    if(objects && objects.errors+objects.cpuErrors+objects.memoryErrors+objects.internalErrors>0) add('do-errors','Durable Objects 오류 관측','실행 오류와 CPU·메모리 제한 오류를 확인하세요.','health')
    const refresh=section(report,'refresh'),latest=refresh?.runs?.[0]
    if(latest && latest.status==='completed' && latest.conclusion!=='success') add('refresh-failure','정기 캐시 갱신 결과 점검','가장 최근 실행이 성공으로 끝나지 않았습니다. 실행 기록을 확인하세요.','health')
    if(refresh && (!refresh.lastSuccessAt || Date.parse(report.checkedAt)-Date.parse(refresh.lastSuccessAt)>30*36e5)) add('refresh-late','정기 캐시 갱신 성공 기록 지연','최근 조회 시각 기준 30시간 내 성공 기록을 확인하지 못했습니다. GitHub 예약 실행 지연도 확인하세요.','health')
    const unknown=Object.entries(report?.sections||{}).filter(([key,s])=>!['loading','idle'].includes(states[key]?.status)&&(s.status!=='OK'||states[key]?.status==='error')).length
    if((!report && !monitoringPending) || unknown) add('coverage','일부 모니터링 확인 필요',`${report?unknown:'전체'}개 수집 항목의 현재 값을 확인하지 못했습니다. 무료·정상으로 해석하지 마세요.`,'health','info')
    return alerts
  }
  const model={ratio,section,exhaustion,assess}
  globalThis.CloudflareMonitorModel=model
  if(typeof module!=='undefined') module.exports=model
})()
