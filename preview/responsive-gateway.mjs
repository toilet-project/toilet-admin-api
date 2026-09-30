// Compatibility for links already shared during responsive review. No auth relay.
const pages = new Set(['index','toilets','reports','public-data-changes','opening-hours','data-quality','duplicate-names','regions','operations','service-analytics','members','permissions','batch-syncs','features','cloudflare','api-usage','notifications'])
export default {
  async fetch(request) {
    const url = new URL(request.url)
    const prefix = '/admin-responsive'
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', {status:405})
    if (url.hostname !== 'preview.geupddong.com' || (url.pathname !== prefix && !url.pathname.startsWith(prefix+'/'))) return new Response('Not found', {status:404})
    const name = url.pathname.slice(prefix.length).replace(/^\//,'').replace(/\.html$/,'')
    if (name && name !== 'responsive-screen' && !pages.has(name)) return new Response('Not found', {status:404})
    const target = new URL('https://admin.geupddong.com/preview/responsive-screen.html')
    target.searchParams.set('size', ['13','15','desktop'].includes(url.searchParams.get('size')) ? url.searchParams.get('size') : '13')
    let page = name && name !== 'responsive-screen' ? name : (url.searchParams.get('page') || 'toilets.html').split(/[?#]/)[0].replace(/^\/(?:admin-responsive|preview)\//,'').replace(/\.html$/,'')
    if (!pages.has(page)) page = 'toilets'
    target.searchParams.set('page', page+'.html')
    return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'no-store'}})
  },
}
