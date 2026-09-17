(() => {
  if(location.origin!=='https://preview.geupddong.com'||!location.pathname.startsWith('/admin-duplicates/'))return
  const prefix='/admin-duplicates',supported=new Set(['/duplicate-names.html','/public-data-changes.html','/data-quality.html'])
  const mapAttribution=link=>/^https?:\/\/map\.kakao\.com(?:\/|$)/.test(link.getAttribute('href')||'')
  const targetFor=link=>{const url=new URL(link.getAttribute('href')||'',location.href);if(url.origin!==location.origin)return null;const path=url.pathname.startsWith(prefix+'/')?url.pathname.slice(prefix.length):url.pathname;return supported.has(path)?prefix+path+url.search+url.hash:null}
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');if(!link||link.getAttribute('href')?.startsWith('#')||mapAttribution(link))return
    event.preventDefault();event.stopImmediatePropagation()
    const target=targetFor(link);if(target)location.assign(target)
  },true)
  function sync(){document.querySelectorAll('a[href]').forEach(link=>{if(link.getAttribute('href')?.startsWith('#')||mapAttribution(link))return;const target=targetFor(link);if(target){if(link.getAttribute('href')!==target)link.setAttribute('href',target)}else{link.setAttribute('aria-disabled','true');link.title='이번 프리뷰는 중복 이름 관리와 공공데이터 변경 검토만 포함합니다.';link.style.opacity='.45'}})}
  sync()
  new MutationObserver(sync).observe(document.body,{childList:true,subtree:true})
})()
