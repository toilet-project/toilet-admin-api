// Local UI review only. No credentials, provider calls, or production authentication changes.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
const assets = path.resolve('src/main/resources/static')
const snapshot = process.argv[2]
if (!snapshot) throw new Error('A previously collected, credential-free snapshot path is required')
const payload = JSON.parse(await fs.readFile(snapshot, 'utf8'))
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}
http.createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url,'http://127.0.0.1').pathname
    if (pathname === '/usage.json') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(payload)); return }
    const name = pathname === '/' ? '/cloudflare.html' : pathname
    const file = path.resolve(assets, '.' + decodeURIComponent(name))
    if (!file.startsWith(assets + path.sep) || !mime[path.extname(file)]) {res.writeHead(404).end();return}
    let body = await fs.readFile(file)
    if (name.endsWith('.html')) {
      body = body.toString().replace(/<script src="\/admin-session[^>]*><\/script>/g,'')
        .replace(/<script src="\/workspace-pages[^>]*><\/script>/g,
          '<script>fetch("/usage.json").then(r=>r.json()).then(d=>{CloudflareCostView.render(d);document.getElementById("workspace-status").textContent="로컬 검토 화면 · 실제 계정 읽기 전용 스냅샷 · 조회 "+new Date(d.checkedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"});})</script>')
    }
    res.setHeader('Content-Type',mime[path.extname(file)])
    res.setHeader('Cache-Control','no-store')
    res.end(body)
  } catch {res.writeHead(404).end()}
}).listen(8197,'127.0.0.1',()=>console.log('Cloudflare review http://127.0.0.1:8197'))
