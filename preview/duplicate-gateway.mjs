const PREFIX='/admin-duplicates'
const ORIGIN='https://preview.geupddong.com'
const assets=new Set(['duplicate-names.html','duplicate-names.css','duplicate-names.js','dashboard.css','admin-shell.css','admin-shell.js','admin-session.css','quality-review-shell.css','public-data-changes.html','public-data-changes.css','public-data-changes.js','preview-navigation.js'])
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self' https://dapi.kakao.com/v2/maps/sdk.js https://t1.daumcdn.net/mapjsapi/; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mts.daumcdn.net https://t1.daumcdn.net; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"}
const reply=(status,message)=>new Response(JSON.stringify({message}),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}})
export function permitted(method,path) {
  if(method==='GET'&&['/data-quality.html','/data-quality.js','/coordinate-visibility.js','/coordinate-visibility.css','/api/admin/v1/duplicate-names/coordinate-facilities'].includes(path))return true
  if(method==='GET'&&/^\/api\/admin\/v1\/data-quality\/duplicate-coordinates(?:\/[a-f0-9]{64})?$/.test(path))return true
  if(method==='POST'&&path==='/api/admin/v1/duplicate-names/coordinate-hide')return true
  if(method==='GET'&&(path==='/api/v1/toilets'||/^\/api\/v1\/toilets\/[1-9]\d*$/.test(path)||['/api/v1/toilets/sitemap/ids','/api/v1/toilets/sitemap/shards'].includes(path)))return true
  if(method==='GET')return assets.has(path.slice(1))||['/preview/status','/api/v1/auth/me','/api/admin/v1/map-config','/api/admin/v1/duplicate-names','/api/admin/v1/duplicate-names/facilities','/api/admin/v1/public-data-change-reviews'].includes(path)||/^\/api\/admin\/v1\/duplicate-names\/[1-9]\d*\/history$/.test(path)||/^\/api\/admin\/v1\/public-data-change-reviews\/[1-9]\d*$/.test(path)
  return method==='POST'&&(path==='/preview/simulate-change'||path==='/api/admin/v1/duplicate-names/work-visibility'||path==='/api/admin/v1/duplicate-names/hide'||/^\/api\/admin\/v1\/duplicate-names\/[1-9]\d*\/restore$/.test(path)||/^\/api\/admin\/v1\/public-data-change-reviews\/[1-9]\d*\/decisions$/.test(path))
}
export default {async fetch(request,env){
  const url=new URL(request.url)
  if(url.origin!==ORIGIN||!(url.pathname===PREFIX||url.pathname.startsWith(PREFIX+'/')))return reply(404,'프리뷰 경로가 아닙니다.')
  const expiry=Number(env.PREVIEW_EXPIRES_AT)
  if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry-Date.now()>86400000)return reply(410,'임시 프리뷰가 종료되었습니다. 다시 준비한 후 이용할 수 있습니다.')
  if(!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com$/.test(env.PREVIEW_ORIGIN||'')||!/^\w{64}$/.test(env.PREVIEW_GATEWAY_TOKEN||'')||!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(env.PREVIEW_ADMIN_TOKEN||''))return reply(503,'프리뷰 연결을 준비 중입니다.')
  if(url.pathname===PREFIX||url.pathname===PREFIX+'/')return new Response(null,{status:302,headers:{...headers,Location:PREFIX+'/duplicate-names.html'}})
  const path=url.pathname.slice(PREFIX.length)
  if(!permitted(request.method,path)||url.search.length>1500)return reply(403,'이 프리뷰에서 지원하지 않는 요청입니다.')
  let body
  if(request.method==='POST'){
    if(request.headers.get('Origin')!==ORIGIN)return reply(403,'같은 프리뷰 화면에서만 시험 저장할 수 있습니다.')
    if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply(415,'JSON 요청만 허용됩니다.')
    const reader=request.body?.getReader();if(!reader)return reply(400,'요청 본문이 없습니다.')
    let size=0;const chunks=[]
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();return reply(413,'요청이 너무 큽니다.')}chunks.push(value)}}catch{return reply(400,'요청을 읽지 못했습니다.')}
    body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}
  }
  // No site Cookie, user Authorization, Cloudflare identity, or arbitrary forwarding headers cross this boundary.
  const upstreamHeaders={Authorization:'Bearer '+env.PREVIEW_ADMIN_TOKEN,'X-Preview-Gateway':env.PREVIEW_GATEWAY_TOKEN,Accept:'application/json'}
  if(body){upstreamHeaders['Content-Type']='application/json';upstreamHeaders.Origin='http://127.0.0.1:8797'}
  try{
    const result=await fetch(env.PREVIEW_ORIGIN+path+url.search,{method:request.method,headers:upstreamHeaders,body,redirect:'manual',signal:AbortSignal.timeout(15000)})
    if(result.status>=300&&result.status<400){await result.body?.cancel();return reply(502,'예상하지 않은 프리뷰 응답입니다.')}
    const type=result.headers.get('Content-Type')||'application/json'
    let response=new Response(result.body,{status:result.status,headers:{...headers,'Content-Type':type}})
    if(type.includes('text/html')){
      response=new HTMLRewriter().on('script[src]',{element(e){const src=e.getAttribute('src');if(src?.startsWith('/admin-session.js'))e.remove();else if(src?.startsWith('/'))e.setAttribute('src',PREFIX+src)}})
        .on('link[href]',{element(e){const href=e.getAttribute('href');if(href?.startsWith('/'))e.setAttribute('href',PREFIX+href)}})
        .on('a[href]',{element(e){const href=e.getAttribute('href');if(['/duplicate-names.html','/public-data-changes.html','/data-quality.html'].includes(href))e.setAttribute('href',PREFIX+href);else if(href==='/'){e.setAttribute('href',PREFIX+'/duplicate-names.html');e.setInnerContent('중복 이름 관리로')}}})
        .on('body',{element(e){e.append('<script src="'+PREFIX+'/preview-navigation.js"></script>',{html:true})}}).transform(response)
    }
    return response
  }catch{return reply(503,'시험 서버 연결이 끊겼습니다. 잠시 후 새로고침해 주세요.')}
}}
