// Shares the same audited visibility API as duplicate-name management.
window.CoordinateVisibility = {
  async mount({container, group, base, refresh}) {
    const host = document.createElement('section')
    host.className = 'coordinate-hide-box'
    host.setAttribute('aria-label', '대표 시설 선택 및 사용자 숨김')
    container.prepend(host)
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
    const endpoint = base + '/api/admin/v1/duplicate-names'
    try {
      const response = await fetch(`${endpoint}/coordinate-facilities?${new URLSearchParams({latitude:group.latitude,longitude:group.longitude})}`, {credentials:'include'})
      if (response.status === 404) { host.remove(); return } // Feature flag remains off until release.
      if (!response.ok) throw Error('숨김 설정을 불러오지 못했습니다. 새로고침해 주세요.')
      const rows = await response.json()
      if (!host.isConnected) return
      const active = rows.filter(item => item.visibilityStatus === 'VISIBLE')
      let representative = null, selected = new Set(), saving = false
      host.innerHTML = `<div class="coordinate-hide-summary"><strong>대표 미선택 · 숨김 0개</strong><button type="button" data-clear-hide>선택 해제</button></div><div class="coordinate-hide-form"><textarea rows="1" maxlength="500" aria-label="숨김 처리 근거" placeholder="주소·출입구 등 동일 시설로 판단한 근거"></textarea><button type="button" data-hide-save disabled>숨기기</button></div><p role="status" hidden></p>`
      const reason = host.querySelector('textarea'), save = host.querySelector('[data-hide-save]'), summary = host.querySelector('strong'), status = host.querySelector('[role="status"]')
      const controls = []
      for (const item of active) {
        const row = container.querySelector(`[data-toilet-row="${item.id}"]`)
        if (!row) continue
        const control = document.createElement('div')
        control.className = 'coordinate-hide-choice'
        control.innerHTML = `<label><input type="radio" name="coordinate-representative" value="${item.id}" aria-label="${esc(item.name)} 대표 시설" /> 대표</label><label><input type="checkbox" value="${item.id}" aria-label="${esc(item.name)} 사용자에게 숨김 선택" /> 숨김 선택</label>`
        row.append(control)
        const radio = control.querySelector('[type="radio"]'), check = control.querySelector('[type="checkbox"]')
        controls.push({item,radio,check})
        radio.addEventListener('change', () => { representative=item.id;selected.delete(item.id);sync() })
        check.addEventListener('change', () => { check.checked?selected.add(item.id):selected.delete(item.id);sync() })
      }
      function sync() {
        for (const {item,radio,check} of controls) {
          radio.checked=representative===item.id;radio.disabled=saving
          check.checked=selected.has(item.id);check.disabled=saving||representative===item.id
        }
        summary.textContent=`${representative?'대표 선택':'대표 미선택'} · 숨김 ${selected.size}개`
        save.disabled=saving||!representative||!selected.size||!reason.value.trim()
        save.textContent=saving?'처리 중':'숨기기'
        reason.disabled=saving;host.querySelector('[data-clear-hide]').disabled=saving
      }
      host.querySelector('[data-clear-hide]').addEventListener('click',()=>{representative=null;selected.clear();sync()})
      reason.addEventListener('input',sync)
      save.addEventListener('click',async()=>{
        if(save.disabled)return
        const rep=active.find(item=>item.id===representative)
        if(!window.confirm(`‘${rep.name}’ 시설을 대표로 남기고 선택한 ${selected.size}개 시설을 사용자에게 숨길까요?\n처리 근거와 이력은 보관됩니다.`))return
        saving=true;sync();status.hidden=true
        try {
          const ids=[representative,...selected]
          const result=await fetch(endpoint+'/coordinate-hide',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({representativeId:representative,toiletIds:[...selected],expectedVersions:Object.fromEntries(active.filter(item=>ids.includes(item.id)).map(item=>[item.id,item.version])),reason:reason.value.trim()})})
          if(!result.ok){const error=await result.json().catch(()=>null);throw Error(error?.message||'숨김 처리에 실패했습니다. 최신 상태를 확인하고 다시 시도해 주세요.')}
          if(host.isConnected)await refresh()
        }catch(error){if(host.isConnected){status.textContent=error.message;status.hidden=false}}
        finally{saving=false;if(host.isConnected)sync()}
      })
      sync()
    } catch(error) { if(host.isConnected)host.textContent=error.message }
  }
}
