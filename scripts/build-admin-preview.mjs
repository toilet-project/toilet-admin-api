/* Reuse the existing admin.geupddong.com/preview deployment and OAuth target. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root,'src/main/resources/static')
const output = resolve(process.argv[2] || join(root,'build/admin-preview-assets'))
const prefix = '/preview'
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
      .replace('<head>','<head><script src="/preview/admin-preview-runtime.js"></script>')
    if (extension === '.js') content = content.toString()
      .replace(/(["'`])\/([a-z0-9-]+\.html)/gi,'$1/preview/$2')
      .replaceAll("'/'","'/preview/'").replaceAll('"/"','"/preview/"').replaceAll('`/`','`/preview/`')
      .replace(/(['"])\/(?!\/|preview\/)([^'"\n]+\.js(?:\?[^'"\n]*)?)\1/g,(_,quote,value)=>quote+prefix+'/'+value+quote)
    if (extension === '.css') content = content.toString().replaceAll("url('/brand/","url('/preview/brand/")
    const target = join(output,prefix,name)
    await mkdir(dirname(target),{recursive:true}); await writeFile(target,content); names.push(name)
  }
}
await build(source)
for (const name of ['admin-preview-runtime.js','responsive-screen.html','responsive-screen.js']) {
  let content = await readFile(join(root,'preview',name),'utf8')
  await writeFile(join(output,prefix,name),content)
}
await writeFile(join(output,'_headers'),`/preview/*
  Cache-Control: no-store
  Content-Security-Policy: default-src 'self'; base-uri 'self'; connect-src 'self' https://api.geupddong.com https://*.kakao.com https://*.daum.net https://*.daumcdn.net; font-src 'self' data:; frame-ancestors 'self'; img-src 'self' data: blob: https:; object-src 'none'; script-src 'self' https://dapi.kakao.com https://*.kakao.com https://*.daum.net https://*.daumcdn.net; style-src 'self' 'unsafe-inline'; form-action 'none'
  Referrer-Policy: same-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  X-Robots-Tag: noindex, nofollow
`)
console.log(`Prepared ${names.length+3} assets for the existing admin preview.`)
