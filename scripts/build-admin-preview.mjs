import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src', 'main', 'resources', 'static')
const outputRoot = join(root, 'build', 'admin-preview-assets')
const output = join(outputRoot, 'preview')

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  }))
  return nested.flat()
}

export function previewHtml(content) {
  let result = content
    .replaceAll('href="/', 'href="/preview/')
    .replaceAll('src="/', 'src="/preview/')
    .replaceAll('returnTo=admin', 'returnTo=adminPreview')
    .replace(/url=\/permissions\.html/gi, 'url=/preview/permissions.html')

  const runtime = '<script src="/preview/admin-preview-runtime.js?v=5"></script>'
  result = result.replace(/<body([^>]*)>/i, (body) => `${body}\n  ${runtime}`)
  return result
}

export function previewJavaScript(content) {
  return content
    .replace(/(["'`])\/([a-z0-9-]+\.html)/gi, '$1/preview/$2')
    .replaceAll("'/'", "'/preview/'")
    .replaceAll('"/"', '"/preview/"')
    .replaceAll('`/`', '`/preview/`')
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(join(root, 'preview', 'admin-preview-runtime.js'), join(output, 'admin-preview-runtime.js'))

for (const path of await files(source)) {
  const target = join(output, relative(source, path))
  await mkdir(dirname(target), { recursive: true })
  const extension = extname(path).toLowerCase()
  if (extension === '.html') {
    await writeFile(target, previewHtml(await readFile(path, 'utf8')), 'utf8')
  } else if (extension === '.js') {
    await writeFile(target, previewJavaScript(await readFile(path, 'utf8')), 'utf8')
  } else {
    await cp(path, target)
  }
}

await writeFile(join(outputRoot, '_headers'), `/preview/*
  Cache-Control: no-store
  Content-Security-Policy: default-src 'self'; base-uri 'self'; connect-src 'self' https://api.geupddong.com https://admin.geupddong.com https://*.kakao.com https://*.daum.net https://*.daumcdn.net; font-src 'self' data:; frame-ancestors 'none'; img-src 'self' data: blob: https:; object-src 'none'; script-src 'self' https://dapi.kakao.com https://*.kakao.com https://*.daum.net https://*.daumcdn.net; style-src 'self' 'unsafe-inline'; form-action 'none'
  Referrer-Policy: same-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-Robots-Tag: noindex, nofollow
`, 'utf8')

console.log(`Admin preview assets written to ${outputRoot}`)
