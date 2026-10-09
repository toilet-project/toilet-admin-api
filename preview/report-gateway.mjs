// Temporary review UI. Only the isolated report store is reachable through this Worker.
export const PREFIX = '/admin-reports'
const SITE = 'https://preview.geupddong.com'
const COOKIE = '__Secure-ReportReview'
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://dapi.kakao.com https://t1.kakaocdn.net https://*.daumcdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.kakao.com https://*.daum.net https://*.daumcdn.net https://t1.kakaocdn.net; font-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" }
export const assets = new Set(['opening-hours-editor.js','opening-hours-editor.css','reports.html','reports.js','report-facility-info.js','report-resolution.js','reports.css','dashboard.css','admin-shell.css','admin-shell.js','admin-session.css','admin-responsive.js','admin-responsive.css','brand.css','brand/hangul-point-v1/lockup-ko.svg','brand/hangul-point-v1/favicon.svg','brand/hangul-point-v1/favicon-32.png','brand/hangul-point-v1/apple-touch-icon.png'])
export function permitted(method, path) {
  if (method === 'GET') return assets.has(path.slice(1)) || ['/api/v1/auth/me','/api/admin/v1/map-config','/api/admin/v1/reports/search','/api/admin/v1/reports/summary'].includes(path) || /^\/api\/admin\/v1\/reports\/[1-9]\d*(?:\/actions)?$/.test(path)
  return method === 'POST' && /^\/api\/admin\/v1\/reports\/[1-9]\d*\/(approve|reject|actions)$/.test(path)
}
const reply = (status, message) => new Response(JSON.stringify({message}), {status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}})
const equal = (a,b) => { if (typeof a !== 'string' || a.length !== b.length) return false; let result=0; for(let i=0;i<a.length;i++) result |= a.charCodeAt(i)^b.charCodeAt(i); return result===0 }
async function bounded(request, limit) {
  const reader=request.body?.getReader(); if(!reader) return new Uint8Array()
  let size=0; const chunks=[]
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('large')}chunks.push(value)}
  const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}return body
}
export function createHandler(fetcher=fetch,now=()=>Date.now()) { return async (request,env) => {
  const url=new URL(request.url)
  if(url.origin!==SITE || !(url.pathname===PREFIX || url.pathname.startsWith(PREFIX+'/')))return reply(404,'지원하지 않는 프리뷰 경로입니다.')
  let config;try{config=JSON.parse(env.ADMIN_REPORT_CONNECTION)}catch{return reply(503,'관리자 시험 연결을 준비 중입니다.')}
  const expiry=Date.parse(config.expiresAt)
  if(!Number.isFinite(expiry)||expiry<=now()||expiry-now()>7200000)return reply(410,'관리자 시험 연결이 만료됐습니다.')
  if(!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com$/.test(config.origin||'') || !/^[a-f0-9]{64}$/.test(config.gatewayToken||'') || !/^[a-f0-9]{64}$/.test(config.accessToken||'') || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(config.localOrigin||''))return reply(503,'관리자 시험 설정을 확인해 주세요.')
  if(url.search.length>1500)return reply(400,'조회 조건이 너무 깁니다.')
  const path=url.pathname.slice(PREFIX.length)||'/'
  if(path==='/__session' && request.method==='POST') {
    if(request.headers.get('Origin')!==config.localOrigin || !request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return reply(403,'시험 연결 출처가 다릅니다.')
    let body;try{body=new URLSearchParams(new TextDecoder().decode(await bounded(request,512)))}catch{return reply(413,'요청이 너무 큽니다.')}
    if(!equal(body.get('access'),config.accessToken))return reply(403,'시험 접속 인증이 올바르지 않습니다.')
    return new Response(null,{status:303,headers:{...headers,Location:SITE+PREFIX+'/','Set-Cookie':`${COOKIE}=${config.accessToken}; Path=${PREFIX}; Max-Age=${Math.max(0,Math.floor((expiry-now())/1000))}; HttpOnly; Secure; SameSite=Lax`}})
  }
  const target=path==='/'?'/reports.html':path
  if(!permitted(request.method,target))return reply(403,'제보 검토 이외의 작업은 차단됩니다.')
  const access=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)
  if(!equal(access,config.accessToken)) {
    if(request.method==='GET' && target==='/reports.html')return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>시험 관리자 연결</title><body style="font:16px system-ui;padding:32px"><h1>시험 관리자 연결</h1><p>이 PC에서 시험 접속을 연결한 뒤 다시 열어 주세요. 운영 관리자 계정은 사용하지 않습니다.</p><a href="${config.localOrigin}/handoff">시험 접속 연결</a></body></html>`,{status:401,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}})
    return reply(401,'시험 관리자 연결이 필요합니다.')
  }
  let body
  if(request.method==='POST') {
    if(request.headers.get('Origin')!==SITE || !request.headers.get('Content-Type')?.startsWith('application/json'))return reply(403,'같은 프리뷰의 JSON 요청만 허용됩니다.')
    try{body=await bounded(request,8192)}catch{return reply(413,'요청이 너무 큽니다.')}
  }
  try {
    const upstream=await fetcher(config.origin+target+url.search,{method:request.method,headers:{'X-Report-Review-Key':config.gatewayToken,...(body?{'Content-Type':'application/json'}:{})},body,redirect:'manual',signal:AbortSignal.timeout(15000)})
    if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();return reply(502,'예상하지 않은 응답입니다.')}
    return new Response(upstream.body,{status:upstream.status,headers:{...headers,'Content-Type':upstream.headers.get('Content-Type')||'application/json'}})
  } catch{return reply(503,'시험 서버 연결을 확인해 주세요.')}
}}
export default {fetch:createHandler()}
