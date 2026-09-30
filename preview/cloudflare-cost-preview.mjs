// Local UI review only. No credentials, provider calls, or production authentication changes.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
const assets = path.resolve('src/main/resources/static')
const snapshot = process.argv[2]
if (!snapshot) throw new Error('A previously collected, credential-free snapshot path is required')
const monitorSnapshot = path.join(path.dirname(snapshot),'admin-monitor-preview.json')
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}
const calls=new Map()
http.createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url,'http://127.0.0.1').pathname
    const params=new URL(req.headers.referer||req.url,'http://127.0.0.1').searchParams
    const scenario=params.get('review'),failedKey=params.get('fail')||'traffic'
    const key=pathname.split('/').at(-1),callKey=`${scenario}:${key}`
    if(pathname==='/preview/auth') {
      await new Promise(resolve=>setTimeout(resolve,2000))
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({roles:['ADMIN']}));return
    }
    if(pathname==='/api/admin/v1/api-usage') {
      await new Promise(resolve=>setTimeout(resolve,6000))
      const catalog=JSON.parse(await fs.readFile('src/main/resources/api-usage-catalog.json','utf8'))
      res.setHeader('Content-Type','application/json')
      res.end(JSON.stringify({demo:true,checkedAt:new Date().toISOString(),services:catalog.services.map(definition=>({definition,status:'unconfigured',message:'로컬 표시 검토 · 실제 사용량 아님',periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-10-01T00:00:00Z',metrics:definition.metrics.map(definition=>({definition,used:null,projected:null}))}))}));return
    }
    if (pathname.startsWith('/api/admin/v1/cloudflare/')) {
      const count=(calls.get(callKey)||0)+1;calls.set(callKey,count)
      if(scenario==='staged')await new Promise(resolve=>setTimeout(resolve,({r2:1200,workers:2500,usage:10000,traffic:16000}[key]||6500)))
      if(key===failedKey&&((scenario==='retry'&&count===1)||(scenario==='stale'&&count>1))) {res.writeHead(503).end();return}
    }
    if (pathname === '/usage.json' || pathname.startsWith('/api/admin/v1/cloudflare/')) {
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
      const report=JSON.parse(await fs.readFile(pathname.includes('/monitoring')?monitorSnapshot:snapshot,'utf8'))
      if(pathname.includes('/monitoring/'))report.sections={[key]:report.sections[key]}
      res.end(JSON.stringify(report));return
    }
    if (pathname.startsWith('/api/admin/')) {
      res.setHeader('Content-Type','application/json')
      res.end(JSON.stringify({status:'DISABLED',message:'로컬 검토에서는 운영 서버 수집기를 연결하지 않았습니다. 실제 값은 운영 관리자에서 조회합니다.'}));return
    }
    const name = pathname === '/' ? '/cloudflare.html' : pathname
    const file = path.resolve(assets, '.' + decodeURIComponent(name))
    if (!file.startsWith(assets + path.sep) || !mime[path.extname(file)]) {res.writeHead(404).end();return}
    let body = await fs.readFile(file)
    if(name==='/api-usage.js')body=body.toString().replace('https://api.geupddong.com/api/v1/auth/me','/preview/auth')
    if (name.endsWith('.html')) {
      body = body.toString().replace(/<script src="\/admin-session[^>]*><\/script>/g,'')
        .replace(/<script src="\/workspace-pages[^>]*><\/script>/g,
          '<script>CloudflareMonitorView.start();document.querySelector(".cf-intro").textContent="로컬 검토 · 실제 Cloudflare 읽기 전용 스냅샷. 운영 서버·배치·원본 봇 연결은 운영 화면에서 확인합니다."</script>')
    }
    res.setHeader('Content-Type',mime[path.extname(file)])
    res.setHeader('Cache-Control','no-store')
    res.end(body)
  } catch {res.writeHead(404).end()}
}).listen(Number(process.env.PORT||8197),'127.0.0.1',()=>console.log(`Cloudflare review http://127.0.0.1:${process.env.PORT||8197}`))
