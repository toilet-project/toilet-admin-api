(() => {
  const base='/admin-responsive', preferenceKey='admin.preview.screen'
  const sizes={13:[1280,800],15:[1440,900],desktop:[1920,1080]}
  const pages=new Set(['','index.html','toilets.html','reports.html','public-data-changes.html','opening-hours.html','data-quality.html','duplicate-names.html','regions.html','operations.html','service-analytics.html','members.html','permissions.html','batch-syncs.html','features.html','cloudflare.html','api-usage.html','notifications.html'])
  const frame=document.querySelector('#admin-preview'), query=new URLSearchParams(location.search)
  let saved
  try { saved=localStorage.getItem(preferenceKey) } catch {}
  let size=Object.hasOwn(sizes,query.get('size'))?query.get('size'):Object.hasOwn(sizes,saved)?saved:'13'
  const cleanPath=value=>{
    try {
      const url=new URL(value,location.origin+base+'/')
      if(url.origin!==location.origin || !url.pathname.startsWith(base+'/') || !pages.has(url.pathname.slice(base.length+1)) || url.search.length>1500) return null
      return url.pathname+url.search+url.hash
    } catch { return null }
  }
  let savedPage
  try { savedPage=sessionStorage.getItem('admin.preview.page') } catch {}
  let page=cleanPath(query.get('page')||savedPage||'toilets.html')||base+'/toilets.html'
  function remember() {
    const url=new URL(location.href)
    url.search=new URLSearchParams({size,page:page.slice(base.length+1)}).toString()
    history.replaceState(null,'',url)
    try { sessionStorage.setItem('admin.preview.page',page) } catch {}
    document.querySelector('#live-size').href=page
  }
  function resize(value) {
    size=value
    const [width,height]=sizes[size]
    frame.style.width=width+'px';frame.style.height=height+'px'
    frame.title=(size==='desktop'?'데스크탑':size+'인치')+' 관리자 프리뷰'
    document.querySelector('#screen-size').textContent=`${width} × ${height} · 페이지 이동 후에도 유지`
    document.querySelectorAll('[data-size]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.size===size)))
    try { localStorage.setItem(preferenceKey,size) } catch {}
    remember()
  }
  document.querySelectorAll('[data-size]').forEach(button=>button.addEventListener('click',()=>resize(button.dataset.size)))
  document.querySelector('#live-size').addEventListener('click',()=>{try { localStorage.removeItem(preferenceKey) } catch {}})
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin || event.source!==frame.contentWindow || event.data?.type!=='admin-preview-location')return
    const next=cleanPath(event.data.path)
    if(next){page=next;remember()}
  })
  resize(size)
  frame.src=page
})()
