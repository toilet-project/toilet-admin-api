// Test-only bridge. Production credentials and browser cookies are never forwarded.
import http from 'node:http'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,dirname,basename,extname} from 'node:path'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {assets,permitted,PREFIX} from './report-gateway.mjs'
const [metadataPath,outputPath,staticPath,publicAssetsPath]=process.argv.slice(2)
const metadata=JSON.parse(await readFile(metadataPath,'utf8')),expires=Date.parse(metadata.expiresAt)
if(dirname(resolve(metadataPath))!==dirname(resolve(outputPath)) || basename(dirname(resolve(metadataPath)))!==`account-retention-mysql-${metadata.marker}` || !/^[a-f0-9]{10}$/.test(metadata.marker) || !/^jdbc:mysql:\/\/127\.0\.0\.1:\d+\/account_retention_test_[a-f0-9]{32}\?/.test(metadata.jdbcUrl) || !(expires>Date.now()&&expires-Date.now()<=7200000) || !metadata.tokens?.['3'])throw new Error('Isolated fixture required')
const sourceRoot=resolve(staticPath)
if(basename(sourceRoot)!=='static')throw new Error('Explicit static source required')
// This is the already-public JS map key bundled in the deployed preview, not a REST/admin key.
const publicKeys=new Set()
for(const file of await readdir(publicAssetsPath)){if(!file.endsWith('.js'))continue;const content=await readFile(resolve(publicAssetsPath,file),'utf8');for(const match of content.matchAll(/appkey=([a-f0-9]{32})/g))publicKeys.add(match[1])}
if(publicKeys.size!==1)throw new Error('Exactly one public SDK key required')
const previousPath=process.env.REPORT_PREVIEW_REUSE_CONNECTION
const previous=previousPath ? JSON.parse(await readFile(previousPath,'utf8')) : null
if(previous && (dirname(resolve(previousPath))!==dirname(resolve(metadataPath)) || previous.expiresAt!==metadata.expiresAt || !(previous.port>1024&&previous.port<65536) || !/^[a-f0-9]{64}$/.test(previous.gatewayToken) || !/^[a-f0-9]{64}$/.test(previous.accessToken) || previous.localOrigin!==`http://127.0.0.1:${previous.port}`))throw new Error('Existing trial connection invalid')
const javascriptKey=[...publicKeys][0],gatewayToken=previous?.gatewayToken || randomBytes(32).toString('hex'),accessToken=previous?.accessToken || randomBytes(32).toString('hex')
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer')
  const fail=(status,message)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({message}))}
  if(Date.now()>=expires)return fail(410,'시험 연결 만료')
  const localOrigin=`http://127.0.0.1:${server.address().port}`
  if(req.method==='GET'&&req.url==='/handoff'&&req.headers.host===new URL(localOrigin).host){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action https://preview.geupddong.com; frame-ancestors 'none'; base-uri 'none'"})
    return res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>격리 시험 관리자 연결</title><body style="font:16px system-ui;padding:32px"><h1>격리 시험 관리자 연결</h1><p>시험 제보 검토·시설 조치만 가능합니다. 운영 데이터는 바뀌지 않습니다.</p><form method="post" action="https://preview.geupddong.com${PREFIX}/__session"><input type="hidden" name="access" value="${accessToken}"><button type="submit">시험 관리자 프리뷰 열기</button></form></body></html>`)
  }
  const local=req.headers.host===new URL(localOrigin).host && req.url.startsWith(PREFIX+'/')
  const received=Buffer.from(String(req.headers['x-report-review-key']||''))
  if(!local&&(received.length!==gatewayToken.length||!timingSafeEqual(received,Buffer.from(gatewayToken))))return fail(403,'허용되지 않은 연결')
  if(local&&req.method==='POST'&&(req.headers.origin!==localOrigin||!req.headers['content-type']?.startsWith('application/json')))return fail(403,'시험 화면 요청만 허용')
  const url=new URL(req.url,'http://fixture.invalid');let path=url.pathname
  if(local)path=path.slice(PREFIX.length)
  if(path==='/')path='/reports.html'
  if(!permitted(req.method,path)||url.search.length>1500)return fail(403,'제보 이외 경로 차단')
  try {
    if(path==='/api/v1/auth/me'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({roles:['ADMIN'],displayName:'격리 시험 관리자',accessTokenExpiresAt:metadata.expiresAt}))}
    if(path==='/api/admin/v1/map-config'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({enabled:true,javascriptKey}))}
    if(assets.has(path.slice(1))){
      const file=path.slice(1),extension=extname(file);let content=await readFile(resolve(sourceRoot,file))
      if(extension==='.html')content=content.toString().replace(/<script src="\/admin-session\.js[^\"]*"><\/script>/g,'').replaceAll('href="/',`href="${PREFIX}/`).replaceAll('src="/',`src="${PREFIX}/`).replace('<body class="admin-page">','<body class="admin-page"><div style="padding:10px;text-align:center;background:#fff3cc;color:#634a00">시험 관리자 · 실제 공개 시설 / 별도 시험 제보 · 시설 조치도 시험 DB에만 반영됩니다.</div>')
      if(extension==='.js')content=content.toString().replaceAll("'https://api.geupddong.com'",`'${PREFIX}'`).replaceAll("fetch('/api/admin/v1/map-config')",`fetch('${PREFIX}/api/admin/v1/map-config')`).replaceAll('href="/reports.html"',`href="${PREFIX}/reports.html"`)
      if(file==='admin-shell.js')content=content.toString().replaceAll('href="${href}"','href="/admin-reports/reports.html"')
      if(extension==='.css')content=content.toString().replaceAll("url('/brand/",`url('${PREFIX}/brand/`)
      const type={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}[extension]
      res.writeHead(200,{'Content-Type':type});return res.end(content)
    }
    let body
    if(req.method==='POST'){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)return fail(413,'본문 초과');chunks.push(chunk)}body=Buffer.concat(chunks)}
    const result=await fetch(`http://127.0.0.1:${metadata.port}${path}${url.search}`,{method:req.method,headers:{Authorization:`Bearer ${metadata.tokens['3']}`,...(body?{'Content-Type':'application/json'}:{})},body,redirect:'error',signal:AbortSignal.timeout(12000)})
    res.writeHead(result.status,{'Content-Type':'application/json'});res.end(Buffer.from(await result.arrayBuffer()))
  }catch{if(!res.headersSent)fail(503,'시험 서버 연결 오류');else res.end()}
})
server.listen(previous?.port || 0,'127.0.0.1',async()=>{await writeFile(outputPath,JSON.stringify({port:server.address().port,gatewayToken,accessToken,localOrigin:`http://127.0.0.1:${server.address().port}`,expiresAt:metadata.expiresAt}),{flag:'wx',mode:0o600});console.log('REPORT_REVIEW_READY isolated=true')})
setTimeout(()=>server.close(),expires-Date.now()).unref()
