/* Build either the existing admin preview or the isolated authentication review. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root,'src/main/resources/static')
const authReview = process.argv.includes('--auth-review')
const output = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || join(root, authReview ? 'build/admin-auth-preview' : 'build/admin-preview-assets'))
const prefix = authReview ? '/admin-auth-review' : '/preview'
const names = []
async function build(dir,relative='') {
  for (const file of await readdir(dir,{withFileTypes:true})) {
    const name = relative + file.name
    if (file.isDirectory()) { await build(join(dir,file.name),name+'/'); continue }
    if (!/\.(html|js|css|svg|png|ico|woff2?|ttf)$/.test(name)) continue
    let content = await readFile(join(dir,file.name))
    const extension = extname(name)
    if (extension === '.html') content = content.toString()
      .replaceAll('href="/','href="'+prefix+'/').replaceAll('src="/','src="'+prefix+'/')
      .replaceAll('returnTo=admin','returnTo=adminPreview')
      .replace('<head>','<head><script src="'+prefix+'/admin-preview-runtime.js"></script>')
    if (extension === '.js') content = content.toString()
      .replace(/(["'`])\/([a-z0-9-]+\.html)/gi,'$1'+prefix+'/$2')
      .replaceAll("'/'","'"+prefix+"/'").replaceAll('"/"','"'+prefix+'/"').replaceAll('`/`','`'+prefix+'/`')
      .replace(/(['"])\/(?!\/|preview\/)([^'"\n]+\.js(?:\?[^'"\n]*)?)\1/g,(_,quote,value)=>quote+prefix+'/'+value+quote)
    if (authReview && name === 'admin-shell.js') content = content.replace('/^\\/preview(?=', '/^\\/admin-auth-review(?=')
    if (extension === '.css') content = content.toString().replaceAll("url('/brand/","url('"+prefix+"/brand/")
    const target = join(output,prefix,name)
    await mkdir(dirname(target),{recursive:true}); await writeFile(target,content); names.push(name)
  }
}
await build(source)
for (const name of ['admin-preview-runtime.js','responsive-screen.html','responsive-screen.js']) {
  let content = await readFile(join(root,'preview',name),'utf8')
  if (authReview && name === 'admin-preview-runtime.js') content = content
    .replace("const PREVIEW_ORIGIN = 'https://admin.geupddong.com'", "const PREVIEW_ORIGIN = 'https://preview.geupddong.com'")
    .replace("const PREFIX = '/preview'", `const PREFIX = '${prefix}'`)
    .replace('if (window === window.top) {', 'if (false) {')
    .replace('const target = requestUrl(input)', `const target = requestUrl(input)
    if (target.origin === PREVIEW_ORIGIN && target.pathname.startsWith('/api/admin/')) target.hostname = 'admin.geupddong.com'`)
  await writeFile(join(output,prefix,name),content)
}
await writeFile(join(output,'_headers'),`${prefix}/*
  Cache-Control: no-store
  Content-Security-Policy: default-src 'self'; base-uri 'self'; connect-src 'self' https://api.geupddong.com https://admin.geupddong.com https://*.kakao.com https://*.kakaocdn.net https://*.daum.net https://*.daumcdn.net; font-src 'self' data:; frame-ancestors 'self'; img-src 'self' data: blob: https:; object-src 'none'; script-src 'self' https://dapi.kakao.com https://*.kakao.com https://*.kakaocdn.net https://*.daum.net https://*.daumcdn.net; style-src 'self' 'unsafe-inline'; form-action 'none'
  Referrer-Policy: same-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  X-Robots-Tag: noindex, nofollow
`)
console.log(`Prepared ${names.length+3} assets for ${prefix}.`)
