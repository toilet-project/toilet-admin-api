// Local UI review only. No credentials, provider calls, or production authentication changes.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
const assets = path.resolve('src/main/resources/static')
const snapshot = process.argv[2]
if (!snapshot) throw new Error('A previously collected, credential-free snapshot path is required')
const monitorSnapshot = path.join(path.dirname(snapshot),'admin-monitor-preview.json')
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}
http.createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url,'http://127.0.0.1').pathname
    if (pathname === '/usage.json' || pathname === '/api/admin/v1/cloudflare/usage' || pathname === '/api/admin/v1/cloudflare/monitoring') {
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
      res.end(await fs.readFile(pathname.endsWith('/monitoring')?monitorSnapshot:snapshot,'utf8'));return
    }
    if (pathname.startsWith('/api/admin/')) {
      res.setHeader('Content-Type','application/json')
      res.end(JSON.stringify({status:'DISABLED',message:'로컬 검토에서는 운영 서버 수집기를 연결하지 않았습니다. 실제 값은 운영 관리자에서 조회합니다.'}));return
    }
    const name = pathname === '/' ? '/cloudflare.html' : pathname
    const file = path.resolve(assets, '.' + decodeURIComponent(name))
    if (!file.startsWith(assets + path.sep) || !mime[path.extname(file)]) {res.writeHead(404).end();return}
    let body = await fs.readFile(file)
    if (name.endsWith('.html')) {
      body = body.toString().replace(/<script src="\/admin-session[^>]*><\/script>/g,'')
        .replace(/<script src="\/workspace-pages[^>]*><\/script>/g,
          '<script>CloudflareMonitorView.start();document.querySelector(".cf-intro").textContent="로컬 검토 · 실제 Cloudflare 읽기 전용 스냅샷. 운영 서버·배치·원본 봇 연결은 운영 화면에서 확인합니다."</script>')
    }
    res.setHeader('Content-Type',mime[path.extname(file)])
    res.setHeader('Cache-Control','no-store')
    res.end(body)
  } catch {res.writeHead(404).end()}
}).listen(8197,'127.0.0.1',()=>console.log('Cloudflare review http://127.0.0.1:8197'))
