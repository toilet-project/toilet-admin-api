import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assets } from '../preview/report-gateway.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'build/report-hours-preview')
const prefix = '/admin-hours-review'
// The browser SDK key is already public in the current web preview assets.
const publicAssets = process.argv[2]
if (!publicAssets) throw new Error('Current public web assets directory required')
const keys = new Set()
async function collectKeys(dir) {
  for (const file of await readdir(dir, {withFileTypes:true})) {
    if (file.isDirectory()) await collectKeys(resolve(dir,file.name))
    else if (file.name.endsWith('.js')) for (const match of (await readFile(resolve(dir,file.name),'utf8')).matchAll(/appkey=([a-f0-9]{32})/g)) keys.add(match[1])
  }
}
await collectKeys(publicAssets)
if (keys.size !== 1) throw new Error('Exactly one existing public map SDK key required')
const names = new Set([...assets,'opening-hours.html','opening-hours.js','opening-hours.css','admin-session.js'])
for (const name of names) {
  let content = await readFile(resolve(root,'src/main/resources/static',name))
  const extension = extname(name)
  if (extension === '.html') content = content.toString()
    .replaceAll('href="/','href="'+prefix+'/').replaceAll('src="/','src="'+prefix+'/')
    .replace('<head>','<head><script src="'+prefix+'/admin-preview-runtime.js"></script>')
  if (extension === '.js') content = content.toString()
    .replace(/(["'`])\/(reports|opening-hours)\.html/g,'$1'+prefix+'/$2.html')
    .replace(/(["'`])\/(?!admin-hours-review\/)([a-z-]+\.html)/g,'$1https://admin.geupddong.com/$2')
    .replaceAll("'/'", "'https://admin.geupddong.com/'")
    .replace("fetch('/api/admin/v1/map-config')",`fetch('${prefix}/api/admin/v1/map-config')`)
  if (extension === '.css') content = content.toString().replaceAll("url('/brand/",`url('${prefix}/brand/`)
  const path = resolve(output, '.'+prefix, name)
  await mkdir(dirname(path),{recursive:true}); await writeFile(path,content)
}
const runtime = (await readFile(resolve(root,'preview/admin-preview-runtime.js'),'utf8'))
  .replace("const PREVIEW_ORIGIN = 'https://admin.geupddong.com'", "const PREVIEW_ORIGIN = 'https://preview.geupddong.com'")
  .replace("const PREFIX = '/preview'", `const PREFIX = '${prefix}'`)
  .replace("if (window === window.top) {", "if (false) {")
  .replace('.admin-preview-notice[hidden]{display:none}', '.admin-preview-notice[hidden]{display:none}@media(max-width:620px){.admin-topbar .admin-refresh{display:none}.admin-preview-badge{font-size:10px;padding:4px}}')
await writeFile(resolve(output,'.'+prefix,'admin-preview-runtime.js'),runtime)
const mapConfig = resolve(output,'.'+prefix,'api/admin/v1/map-config')
await mkdir(dirname(mapConfig),{recursive:true})
await writeFile(mapConfig,JSON.stringify({enabled:true,javascriptKey:[...keys][0]}))
await writeFile(resolve(output,'_headers'),`${prefix}/*
  Cache-Control: no-store
  Content-Security-Policy: default-src 'self'; base-uri 'self'; connect-src 'self' https://api.geupddong.com https://*.kakao.com https://*.kakaocdn.net https://*.daum.net https://*.daumcdn.net; font-src 'self' data:; frame-ancestors 'self'; img-src 'self' data: blob: https:; object-src 'none'; script-src 'self' https://dapi.kakao.com https://*.kakao.com https://*.kakaocdn.net https://*.daum.net https://*.daumcdn.net; style-src 'self' 'unsafe-inline'; form-action 'none'
  Referrer-Policy: same-origin
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow
${prefix}/api/admin/v1/map-config
  Content-Type: application/json
`)
console.log('Built report and opening-hours preview with live reads and existing write protection.')
