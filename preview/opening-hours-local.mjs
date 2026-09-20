import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src/main/resources/static/', import.meta.url))
const samplePath = fileURLToPath(new URL('./opening-hours-sample.json', import.meta.url))
const assets = new Set(['opening-hours.html','opening-hours.css','opening-hours.js','dashboard.css','admin-shell.css','admin-shell.js','admin-session.css'])
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' }
const headers = { 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }

const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ')
const daySet = text => {
  if (/평일|월\s*[~-]\s*금/.test(text)) return [1,2,3,4,5]
  if (/주말|토\s*[~-]\s*일/.test(text)) return [6,7]
  const names = ['월','화','수','목','금','토','일'], selected = []
  names.forEach((name,index) => { if (text.includes(`${name}요일`)) selected.push(index + 1) })
  return selected.length ? selected : [1,2,3,4,5,6,7]
}
const time = (hour, minute = '0') => `${String(Number(hour)).padStart(2,'0')}:${String(Number(minute || 0)).padStart(2,'0')}`

export function normalize(item) {
  const status = clean(item.openTime), detail = clean(item.openTimeDetail), combined = `${status} ${detail}`.trim()
  const holidayPolicy = combined.includes('연중무휴') ? 'OPEN' : /공휴일\s*(제외|휴무)/.test(combined) ? 'CLOSED' : 'UNKNOWN'
  const saysClosed = /미개방|폐쇄|운영\s*안함|이용\s*불가/.test(combined)
  const says24h = /24\s*시간|00(?::00)?\s*[~-]\s*(?:24(?::00)?|23:59)|00\s*[~-]\s*24/.test(combined)
  const exception = /공휴일\s*(?:제외|휴무)|휴관|동절기|하절기|계절|임시|주말\s*제외/.test(combined)
  const matches = [...(detail || status).matchAll(/(?<!\d)([01]?\d|2[0-3])(?:[:시]([0-5]\d)?)?\s*(?:~|〜|～|–|—|-)\s*([01]?\d|2[0-4])(?:[:시]([0-5]\d)?)?(?!\d)/g)]
  if ((saysClosed && (says24h || matches.length)) || (says24h && exception)) return decision('UNKNOWN', null, 'REVIEW_REQUIRED', null, holidayPolicy, [])
  if (saysClosed) return decision('CLOSED', false, 'PARSED', .95, holidayPolicy, [])
  if (says24h) return decision('ALWAYS', true, 'PARSED', 1, holidayPolicy, [])
  if (status === '불규칙') return decision('IRREGULAR', null, 'REVIEW_REQUIRED', null, holidayPolicy, [])
  if (matches.length === 1 && !exception) {
    const match = matches[0], start = time(match[1], match[2]), end = Number(match[3]) === 24 ? '00:00' : time(match[3], match[4])
    if (start === end) return decision('UNKNOWN', null, 'REVIEW_REQUIRED', null, holidayPolicy, [])
    const schedules = daySet(combined).map(dayOfWeek => ({ dayOfWeek, slotIndex:0, startTime:start, endTime:end, crossesMidnight:end <= start, closed:false }))
    return decision('SCHEDULED', false, 'PARSED', schedules.length === 7 ? .9 : .85, holidayPolicy, schedules)
  }
  return decision(status === '상시' ? 'ALWAYS' : 'UNKNOWN', null, 'REVIEW_REQUIRED', null, holidayPolicy, [])
}

const decision = (openingPolicy,open24h,status,confidence,holidayPolicy,schedules) => ({ openingPolicy,open24h,status,confidence,parserVersion:'v1-preview',holidayPolicy,manualOverride:false,sourceChanged:false,schedules })
const json = (response,status,value) => { response.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'}); response.end(JSON.stringify(value)) }
const body = request => new Promise((resolve,reject) => { let size=0,value=''; request.setEncoding('utf8'); request.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>32768){reject(new Error('too large'));request.destroy()}else value+=chunk});request.on('end',()=>{try{resolve(JSON.parse(value||'{}'))}catch(error){reject(error)}});request.on('error',reject) })

export async function createPreview() {
  const source = JSON.parse(await readFile(samplePath,'utf8'))
  const rows = source.map(item => ({ ...item, ...normalize(item) }))
  const overrides = new Map()
  const item = id => rows.find(value => value.toiletId === id)
  const view = value => overrides.get(value.toiletId) || { openingPolicy:value.openingPolicy,open24h:value.open24h,status:value.status,confidence:value.confidence,parserVersion:value.parserVersion,holidayPolicy:value.holidayPolicy,manualOverride:value.manualOverride,sourceChanged:value.sourceChanged,schedules:value.schedules }
  return createServer(async (request,response) => {
    const url = new URL(request.url,'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/') { response.writeHead(302,{...headers,Location:'/opening-hours.html'}); return response.end() }
    if (request.method === 'GET' && url.pathname === '/api/v1/auth/me') return json(response,200,{id:1,displayName:'프리뷰 관리자',roles:['ADMIN']})
    if (request.method === 'GET' && url.pathname === '/api/admin/v1/opening-hours/reviews') {
      const filter = url.searchParams.get('status') || 'REVIEW', keyword = clean(url.searchParams.get('keyword')).toLocaleLowerCase('ko-KR')
      const page = Math.max(0,Number(url.searchParams.get('page')||0)), size = Math.min(50,Math.max(1,Number(url.searchParams.get('size')||15)))
      const filtered = rows.map(value => ({...value,...view(value)})).filter(value => {
        const status = value.sourceChanged ? 'SOURCE_CHANGED' : value.status
        const matched = !keyword || [value.name,value.managementNumber,value.roadAddress,value.jibunAddress].some(field=>clean(field).toLocaleLowerCase('ko-KR').includes(keyword))
        const state = filter === 'ALL' || (filter === 'REVIEW' ? ['REVIEW_REQUIRED','NOT_NORMALIZED','SOURCE_CHANGED'].includes(status) : status === filter)
        return matched && state
      })
      const totalElements = filtered.length, totalPages = totalElements ? Math.ceil(totalElements/size) : 0
      return json(response,200,{items:filtered.slice(page*size,page*size+size).map(({schedules,...value})=>value),page,size,totalElements,totalPages})
    }
    const detailMatch = url.pathname.match(/^\/api\/admin\/v1\/opening-hours\/reviews\/(\d+)$/)
    if (request.method === 'GET' && detailMatch) {
      const value = item(Number(detailMatch[1])); if (!value) return json(response,404,{message:'화장실을 찾지 못했습니다.'})
      const normalized = view(value); return json(response,200,{item:{...value,...normalized,schedules:undefined},normalized})
    }
    const saveMatch = url.pathname.match(/^\/api\/admin\/v1\/opening-hours\/(\d+)$/)
    if (request.method === 'PUT' && saveMatch) {
      const value = item(Number(saveMatch[1])); if (!value) return json(response,404,{message:'화장실을 찾지 못했습니다.'})
      try {
        const input = await body(request)
        const normalized = { openingPolicy:input.openingPolicy,open24h:Boolean(input.open24h),status:'CONFIRMED',confidence:1,parserVersion:'v1-preview',holidayPolicy:input.holidayPolicy || 'UNKNOWN',manualOverride:true,sourceChanged:false,schedules:Array.isArray(input.schedules)?input.schedules:[] }
        overrides.set(value.toiletId,normalized); return json(response,200,normalized)
      } catch { return json(response,400,{message:'확정값 형식을 확인해 주세요.'}) }
    }
    if (request.method === 'GET') {
      const name = url.pathname.slice(1) || 'opening-hours.html'
      if (!assets.has(name)) return json(response,404,{message:'프리뷰에서 제공하지 않는 화면입니다.'})
      if (name === 'admin-session.js') { response.writeHead(200,{...headers,'Content-Type':'text/javascript; charset=utf-8'}); return response.end('') }
      try { const content = await readFile(join(root,name)); response.writeHead(200,{...headers,'Content-Type':types[extname(name)]||'application/octet-stream'}); return response.end(content) }
      catch { return json(response,404,{message:'파일을 찾지 못했습니다.'}) }
    }
    return json(response,405,{message:'지원하지 않는 요청입니다.'})
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.OPENING_HOURS_PREVIEW_PORT || 8798)
  const server = await createPreview()
  server.listen(port,'127.0.0.1',()=>process.stdout.write(`opening-hours-preview=http://127.0.0.1:${port}/opening-hours.html\n`))
}
