/* Build a private, authenticated static preview without copying credentials or data. */
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..'), output = path.resolve(process.argv[2] || path.join(root, 'build/responsive-preview'))
const prefix = '/admin-responsive', staticDir = path.join(root, 'src/main/resources/static')
const assetsDir = path.join(output, 'assets', prefix), names = []
fs.mkdirSync(assetsDir, {recursive:true})
function walk(dir, relative='') {
  for (const file of fs.readdirSync(dir,{withFileTypes:true})) {
    const name=path.posix.join(relative,file.name)
    if (file.isDirectory()) { walk(path.join(dir,file.name),name); continue }
    if (!/\.(html|js|css|svg|png|ico|woff2?)$/.test(name)) continue
    names.push(name)
    let body=fs.readFileSync(path.join(dir,file.name))
    if (/\.(html|js|css)$/.test(name)) {
      body=body.toString()
      // Only rewrite markup here. JS creates links and queries those same links
      // before the bridge prefixes them; changing just its selectors breaks navigation.
      if (name.endsWith('.html')) body=body.replaceAll('href="/',`href="${prefix}/`).replaceAll('src="/',`src="${prefix}/`).replace('<head>','<head><script src="'+prefix+'/responsive-bridge.js"></script>')
      if (name.endsWith('.js')) body=body.replace(/(['"])\/(?!\/|admin-responsive\/)([^'"\n]+\.js(?:\?[^'"\n]*)?)\1/g,(_,quote,value)=>quote+prefix+'/'+value+quote)
      if (name === 'admin-shell.js') body=body.replace('pathname.replace(/^\\/preview(?=\\/|$)/', 'pathname.replace(/^\\/(?:preview|admin-responsive)(?=\\/|$)/')
    }
    const dest=path.join(assetsDir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body)
  }
}
walk(staticDir)
fs.copyFileSync(path.join(root,'preview/responsive-bridge.js'),path.join(assetsDir,'responsive-bridge.js'));names.push('responsive-bridge.js')
for (const name of ['responsive-screen.html','responsive-screen.js']) {
  fs.copyFileSync(path.join(root,'preview',name),path.join(assetsDir,name));names.push(name)
}
fs.writeFileSync(path.join(output,'manifest.mjs'),`export default ${JSON.stringify(names)};\n`)
fs.copyFileSync(path.join(root,'preview/responsive-gateway.mjs'),path.join(output,'worker.mjs'))
console.log(`Prepared ${names.length} static assets; no user data or credentials included.`)
