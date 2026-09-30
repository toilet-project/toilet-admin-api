/* Preview-only routing. All production writes are rejected locally and at the gateway. */
(() => {
  const base = '/admin-responsive', nativeFetch = window.fetch.bind(window)
  // Unlike the browser tool's temporary viewport, the preview frame survives
  // menu navigation, reloads and the end of an automation turn.
  if (window === window.top) {
    try {
      const size=localStorage.getItem('admin.preview.screen')
      if (['13','15','desktop'].includes(size)) {
        location.replace(base+'/responsive-screen.html?'+new URLSearchParams({size,page:location.pathname.slice(base.length+1)+location.search+location.hash}))
        return
      }
    } catch {}
  }
  const announce = () => {
    if (window !== window.parent) window.parent.postMessage({type:'admin-preview-location',path:location.pathname+location.search+location.hash},location.origin)
  }
  document.addEventListener('admin:route-change',announce)
  window.addEventListener('popstate',announce)
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href)
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (!['GET', 'HEAD'].includes(method)) return Promise.resolve(new Response(JSON.stringify({message:'반응형 확인용 프리뷰입니다. 운영 데이터는 저장하지 않습니다.'}), {status:405,headers:{'Content-Type':'application/json'}}))
    if (url.origin === 'https://api.geupddong.com') url.href = location.origin + base + '/backend' + url.pathname + url.search
    else if (url.origin === location.origin && url.pathname.startsWith('/api/')) url.pathname = base + '/server' + url.pathname
    else if (url.origin === location.origin && !url.pathname.startsWith(base + '/')) url.pathname = base + url.pathname
    return nativeFetch(url.href, {...options, method, credentials:'same-origin'})
  }
  const links = () => document.querySelectorAll('a[href^="/"]').forEach(a => { const value=a.getAttribute('href'); if (!value.startsWith(base + '/') && !value.startsWith('//')) a.setAttribute('href',base+value) })
  document.addEventListener('DOMContentLoaded', () => {
    announce()
    links()
    new MutationObserver(links).observe(document.body,{childList:true,subtree:true})
    const badge=document.createElement('span');badge.textContent='프리뷰 · 저장 차단';badge.style.cssText='font-size:11px;color:#926321;white-space:nowrap;margin-left:auto'
    document.querySelector('.admin-breadcrumb')?.after(badge)
  }, {once:true})
})()
