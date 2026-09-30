(() => {
  const sectionKeys = ['r2','writes','workers','d1','storage','traffic','objects','refresh']
  const endpoints = {
    usage:'/api/admin/v1/cloudflare/usage',
    ...Object.fromEntries(sectionKeys.map(key=>[key,`/api/admin/v1/cloudflare/monitoring/${key}`])),
    operations:'/api/admin/v1/operations/status',
    bots:'/api/admin/v1/service-analytics/origin-bots?range=today',
    host:'/api/admin/v1/operations/host?days=7'
  }
  function create({fetchJson,onChange}) {
    const bundle={monitoring:{sections:{}}}, states=Object.fromEntries(Object.keys(endpoints).map(key=>[key,{status:'idle'}]))
    function publish() { onChange(bundle,states) }
    async function load(keys=Object.keys(endpoints)) {
      const selected=keys.filter(key=>endpoints[key]&&states[key].status!=='loading')
      for(const key of selected) states[key]={...states[key],status:'loading',message:null}
      publish()
      await Promise.allSettled(selected.map(async key=>{
        try {
          const response=await fetchJson(endpoints[key])
          const section=sectionKeys.includes(key)?response.sections?.[key]:null
          if ((sectionKeys.includes(key) && section?.status!=='OK') || ['UNAVAILABLE','ERROR','DISABLED'].includes(response.status)) {
            throw new Error(section?.message||response.message||'현재 값을 확인할 수 없습니다.')
          }
          if(section) {
            bundle.monitoring={...bundle.monitoring,checkedAt:response.checkedAt,start:response.start,end:response.end,
              sections:{...bundle.monitoring.sections,[key]:section}}
          } else bundle[key]=response
          states[key]={status:'loaded',checkedAt:response.checkedAt||response.generatedAt||new Date().toISOString(),start:response.start,end:response.end}
        } catch(error) {
          // Keep the last successful value in memory, explicitly marked as stale by the view.
          states[key]={...states[key],status:'error',message:error.message||'조회에 실패했습니다.'}
          if(sectionKeys.includes(key) && !bundle.monitoring.sections[key]) bundle.monitoring.sections[key]={status:'UNAVAILABLE',data:null}
        }
        publish()
      }))
    }
    return {load,bundle,states}
  }
  const api={create,endpoints,sectionKeys}
  globalThis.CloudflareMonitorLoader=api
  if(typeof module!=='undefined') module.exports=api
})()
