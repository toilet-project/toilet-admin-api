export function mountHostMonitor(main) {
  const root = main.querySelector('#host-monitor')
  if (!root || root.dataset.mounted) return
  root.dataset.mounted = 'true'
  const $ = (id) => root.querySelector(`[data-hm="${id}"]`)
  const fmt = (value, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—'
  const pct = (value) => value == null ? '—' : `${fmt(value)}%`
  const bytes = (value) => value == null ? '—' : value >= 1024 ** 3 ? `${fmt(value / 1024 ** 3, 2)} GiB` : `${fmt(value / 1024 ** 2, 2)} MiB`
  const at = (value) => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date(value))
  const todayKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date())
  let pending = false, generation = 0
  const text = (key, value) => { $(key).textContent = value }
  async function json(url) {
    const response = await fetch(url, {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(8000)})
    if (!response.ok) throw new Error('unavailable')
    return response.json()
  }
  function banner(level, messages) {
    $('status').dataset.level = level
    $('status').replaceChildren(...messages.map(message => {
      const p = document.createElement('p'); p.textContent = message; return p
    }))
  }
  function graph(target, rows, getter, label) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    const width = Math.max(300,target.clientWidth || 820), right = width - 14
    svg.setAttribute('viewBox', `0 0 ${width} 190`); svg.setAttribute('class', 'hm-graph')
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label)
    for (const value of [0, 50, 80, 100]) {
      const y = 162 - value * 1.35
      const line = document.createElementNS(ns, 'line')
      Object.entries({x1:35, x2:right, y1:y, y2:y, stroke:value===80?'#d8b36d':'#e7ede9', 'stroke-dasharray':value===80?'5 4':'0'}).forEach(([k,v]) => line.setAttribute(k,v))
      svg.append(line)
      const text = document.createElementNS(ns,'text'); text.setAttribute('x',0); text.setAttribute('y',y+4); text.textContent=`${value}%`; svg.append(text)
    }
    for (const [metric,color] of [['cpuPercent','#176940'],['memoryPercent','#6978b8']]) {
      let segment = []
      const flush = () => {
        if (!segment.length) return
        const line = document.createElementNS(ns,'polyline')
        Object.entries({points:segment.join(' '),fill:'none',stroke:color,'stroke-width':2.4}).forEach(([k,v])=>line.setAttribute(k,v))
        svg.append(line)
        // A single observed day remains visible.
        if (segment.length===1) { const [cx,cy]=segment[0].split(','); const dot=document.createElementNS(ns,'circle'); for(const [k,v] of Object.entries({cx,cy,r:3,fill:color}))dot.setAttribute(k,v);svg.append(dot) }
        segment=[]
      }
      rows.forEach((row,i) => {
        const value = getter(row,metric)
        if (value == null) { flush(); return }
        if(i && row.ts && row.ts-rows[i-1].ts>90) flush()
        const fraction = row.ts ? (row.ts-rows[0].ts)/Math.max(1,rows.at(-1).ts-rows[0].ts) : i/Math.max(1,rows.length-1)
        segment.push(`${35+fraction*(right-35)},${162-Math.min(100,Math.max(0,value))*1.35}`)
      }); flush()
    }
    target.replaceChildren(svg)
  }
  async function history(date) {
    const sequence = ++generation
    $('detail').hidden = false; text('detail-title',`${date} · 분 단위 추이`); text('detail-note','기록을 불러오는 중입니다.'); $('detail-chart').replaceChildren()
    try {
      const data = await json(`/api/admin/v1/operations/host/history?date=${encodeURIComponent(date)}`)
      if (sequence !== generation || !root.isConnected) return
      text('detail-note',data.message)
      if(data.status==='OK') {
        graph($('detail-chart'),data.samples,(r,k)=>r[k],`${date} CPU 및 메모리 사용률`)
        const samples=data.samples
        if(samples.length) text('detail-note',`${at(samples[0].ts*1000)} ~ ${at(samples.at(-1).ts*1000)} · ${samples.length}회 측정 · 빈 구간은 미수집 시간입니다.`)
      }
    } catch { if(sequence===generation) text('detail-note','분 단위 기록을 불러오지 못했습니다.') }
  }
  function renderDays(days) {
    const mapped=new Map(days.map(day=>[day.date,day]))
    const count=Number($('range').value)
    const today=todayKey()
    const timeline=[]
    for(let offset=count-1;offset>=0;offset--) {
      const date=new Date(`${today}T00:00:00+09:00`);date.setUTCDate(date.getUTCDate()-offset)
      const key=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(date)
      timeline.push(mapped.get(key)||{date:key})
    }
    graph($('chart'),timeline,(r,k)=>r.metrics?.[k]?.avg,'선택 기간의 일평균 CPU 및 메모리 사용률. 상세 수치는 아래 표에 제공됩니다.')
    text('period',`${timeline[0].date} ~ ${today} · 일평균`)
    $('days').replaceChildren(...timeline.slice().reverse().map(day=>{
      const row=document.createElement('tr')
      const cell=document.createElement('td')
      if(day.sampleCount && day.date>=new Date(Date.parse(`${today}T12:00:00Z`)-29*864e5).toISOString().slice(0,10)) {
        const button=document.createElement('button');button.className='hm-date';button.textContent=day.date;button.addEventListener('click',()=>history(day.date));cell.append(button)
      } else cell.textContent=day.date
      row.append(cell)
      const metric=key=>day.metrics?.[key]||{}
      const cpu=metric('cpuPercent'),mem=metric('memoryPercent')
      for(const value of [pct(cpu.avg),pct(cpu.max),pct(cpu.p95),pct(mem.avg),pct(mem.max),pct(metric('diskPercent').max),`${fmt(cpu.above80Minutes)} / ${fmt(mem.above80Minutes)}`,bytes(day.rxBytes),bytes(day.txBytes),day.internetChecks?`${day.internetFailures}/${day.internetChecks}`:'—',pct(day.coveragePercent)]) {
        const td=document.createElement('td');td.textContent=value;row.append(td)
      }
      return row
    }))
  }
  function render(data) {
    if (!root.isConnected) return
    if (!data.latest) { banner('UNKNOWN',[data.message]);$('content').hidden=true;return }
    $('content').hidden=false
    const v=data.latest, stale=data.status!=='OK'
    const today=data.days.find(day=>day.date===todayKey())
    for(const [key,field] of [['cpu','cpuPercent'],['memory','memoryPercent'],['disk','diskPercent'],['network','txMbps']]) {
      const metric=today?.metrics?.[field]
      const format=value=>key==='network' ? (value==null?'—':`${fmt(value,3)} Mbps`) : pct(value)
      text(`${key}-avg`,format(metric?.avg))
      text(`${key}-max`,format(metric?.max))
    }
    text('today-note',`${todayKey()} · 한국 시간 기준 오늘의 수집 기록으로 계산합니다. ${today?.observedMinutes>0?`수집률 ${pct(today.coveragePercent)} · 미수집 시간은 계산에서 제외합니다.`:'오늘 누적 기록이 없으면 평균·최대는 —로 표시합니다.'} 최대는 수집된 값 중 가장 높은 값입니다.`)
    banner(stale?'UNKNOWN':data.assessment.level,stale?[data.message]:data.assessment.messages)
    text('updated',`${stale?'마지막 기록':'최근 수집'} ${at(data.generatedAt)} · 1분 주기`)
    for(const [key,field] of [['cpu','cpuPercent'],['memory','memoryPercent'],['disk','diskPercent']]) {
      text(key,pct(v[field]));$(key+'-bar').style.width=`${Math.max(0,Math.min(100,v[field]||0))}%`
    }
    text('cpu-note',`${fmt(v.cpuCores,0)}코어 · 디스크 대기 ${pct(v.ioWaitPercent)}`)
    text('memory-note',`사용 가능 ${bytes(v.memoryAvailableBytes)} / 전체 ${bytes(v.memoryTotalBytes)}`)
    text('disk-note',`남은 공간 ${bytes(v.diskAvailableBytes)} · 파일 개수 사용률 ${pct(v.inodePercent)}`)
    text('network',`${fmt(v.txMbps,3)} Mbps`);text('network-note',`수신 ${fmt(v.rxMbps,3)} Mbps · 호스트 전체 송신량`)
    text('link',v.linkUp===true?'연결됨':v.linkUp===false?'연결 끊김':'확인 불가')
    text('link-speed',v.linkSpeedMbps?`${fmt(v.linkSpeedMbps)} Mbps`:'확인 불가')
    text('internet',v.internetOk===true?`${fmt(v.internetLatencyMs)} ms`:v.internetOk===false?'연결 점검 실패':'미측정')
    text('api',v.apiOk===true?`${fmt(v.apiLatencyMs)} ms`:v.apiOk===false?'상태 점검 실패':'미측정')
    text('capacity',`회선 기준: 다운로드 ${v.downloadMbps?fmt(v.downloadMbps)+' Mbps':'미설정'} / 업로드 ${v.uploadMbps?fmt(v.uploadMbps)+' Mbps':'미설정'} · 구간 패킷 오류 ${fmt(v.networkErrors,0)} / 버림 ${fmt(v.networkDrops,0)}`)
    text('swap',`스왑 ${bytes(v.swapUsedBytes)} / ${bytes(v.swapTotalBytes)} · 메모리 대기 ${pct(v.memoryPressurePercent)} · 디스크 대기 ${pct(v.ioPressurePercent)}`)
    renderDays(data.days)
  }
  async function refresh() {
    if(pending||!root.isConnected) return
    pending=true;$('refresh').disabled=true
    const range=$('range').value
    try { render(await json(`/api/admin/v1/operations/host?days=${range}`)) }
    catch { banner('UNKNOWN',['상태 기록을 불러오지 못했습니다. 기존 표시는 마지막 조회 결과입니다.']) }
    finally { pending=false;$('refresh').disabled=false;if(range!==$('range').value)refresh() }
  }
  $('refresh').addEventListener('click',refresh)
  $('range').addEventListener('change',refresh)
  refresh()
  function poll() { setTimeout(()=>{if(!root.isConnected)return;if(!document.hidden)refresh();poll()},60000) }
  poll()
}
