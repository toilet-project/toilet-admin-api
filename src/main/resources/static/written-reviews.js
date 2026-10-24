(() => {
  window.WrittenReviewsAnalytics?.dispose?.();
  const endpoint = 'https://api.geupddong.com/api/admin/v1/reviews';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  const shortDate = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  const moderationPolicyVersion = 'review-moderation-v1';
  const reasons = [
    ['SPAM', '광고·스팸', '상품·서비스 홍보나 구매·가입 유도, 광고 링크가 주목적인 내용'],
    ['ABUSE', '욕설·혐오·괴롭힘', '사람이나 집단을 겨냥한 명확한 욕설·혐오·위협·성적 괴롭힘'],
    ['PERSONAL_INFORMATION', '개인정보 노출', '공개할 필요가 없는 연락처·상세 거주지·계정·신분 식별정보'],
    ['IRRELEVANT', '화장실 이용과 무관한 내용', '이용 경험과 관계없는 게시글이나 무의미한 문자의 반복'],
    ['MANIPULATION', '반복·조작 리뷰', '구체적인 근거로 확인된 복제·도배 또는 평점 조작'],
  ];
  const readOnlyPreview = () => window.AdminWrittenReviewsPreview?.readOnly === true || window.AdminWrittenReviewsPreview?.moderationAllowed === false;
  const canModerate = item => item && typeof item.reviewKey === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.reviewKey)
    && Number.isSafeInteger(item.version) && item.version >= 0 && item.moderationPolicyVersion === moderationPolicyVersion;
  let host, listController, detailController, listEpoch = 0, detailEpoch = 0;
  let report, page = 0, cursors = [null], expanded = null, pendingPage = 0, pendingCursor = null;
  let unsubscribe, loadedDetail = null, removal = null;

  function cancelDetail() { ++detailEpoch; detailController?.abort(); detailController = null; expanded = null; loadedDetail = null; }
  function cancel() { ++listEpoch; listController?.abort(); listController = null; cancelDetail(); host = null; }
  function dispose() { cancel(); document.removeEventListener('admin:before-route-change', dispose); unsubscribe?.(); unsubscribe = null; }
  function reject(status, target) {
    target.innerHTML = '';
    cancel();
    AdminAuth.reject(status, document.getElementById('analytics-shell'));
  }
  function validReview(item) {
    return item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200
      && Number.isSafeInteger(item.toiletId) && item.toiletId > 0
      && ['satisfaction', 'cleanliness'].every(key => Number.isInteger(item[key]) && item[key] >= 1 && item[key] <= 5)
      && typeof item.toiletName === 'string' && typeof item.toiletVisibility === 'string'
      && typeof item.authorDisplayName === 'string' && typeof item.authorRemoved === 'boolean'
      && typeof item.paper === 'boolean' && Number.isInteger(item.waitMinutes) && item.waitMinutes >= 0 && item.waitMinutes <= 60
      && typeof item.hasComment === 'boolean' && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.updatedAt));
  }
  function shell() {
    host.innerHTML = `<section class="analytics-panel written-reviews" aria-labelledby="written-reviews-title"><header><div><h2 id="written-reviews-title">작성 리뷰</h2><p>전체 기간의 사용자 리뷰를 작성일 최신순으로 확인합니다. 행을 누르면 작성 내용이 펼쳐집니다.</p></div><span class="written-reviews-order">최신순 · 한국시간</span></header><p class="written-reviews-notice" role="status" tabindex="-1" hidden></p><div class="written-reviews-results" aria-live="polite"></div></section>`;
    host.querySelector('.written-reviews-results').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.reviewIndex !== undefined) void toggleDetail(Number(button.dataset.reviewIndex));
      else if (button.hasAttribute('data-review-detail-retry')) void toggleDetail(Number(button.dataset.reviewDetailRetry), true);
      else if (button.hasAttribute('data-reviews-retry')) void load(pendingPage, pendingCursor);
      else if (button.hasAttribute('data-reviews-first')) { cursors = [null]; void load(0, null); }
      else if (button.dataset.reviewsPage === 'next' && report?.hasMore) void load(page + 1, report.nextCursor);
      else if (button.dataset.reviewsPage === 'previous' && page > 0) void load(page - 1, cursors[page - 1]);
      else if (button.hasAttribute('data-review-delete-open')) openRemoval(Number(button.dataset.reviewDeleteOpen));
      else if (button.hasAttribute('data-review-delete-cancel')) closeRemoval();
    });
    host.querySelector('.written-reviews-results').addEventListener('change', syncRemovalForm);
    host.querySelector('.written-reviews-results').addEventListener('submit', event => {
      if (!event.target.matches('.written-review-delete-form')) return;
      event.preventDefault(); void removeReview(event.target);
    });
  }
  function render() {
    const results = host.querySelector('.written-reviews-results');
    if (!report.items.length) {
      results.innerHTML = `<div class="written-reviews-empty"><h3>${page === 0 ? '아직 작성된 리뷰가 없습니다.' : '이 페이지의 리뷰가 더 이상 없습니다.'}</h3><p>${page === 0 ? '사용자가 리뷰를 작성하면 이곳에 최신순으로 표시됩니다.' : '리뷰가 삭제되었을 수 있습니다. 최신 목록을 다시 확인해 주세요.'}</p>${page > 0 ? '<button type="button" data-reviews-first>최신 리뷰 보기</button>' : ''}</div>`;
      return;
    }
    results.innerHTML = `<div class="written-reviews-columns" aria-hidden="true"><span>화장실</span><span title="만족도와 청결도의 평균">평점</span><span>작성자</span><span>작성일</span><span></span></div><ul class="written-reviews-list">${report.items.map((item, index) => {
      const avg = ((item.satisfaction + item.cleanliness) / 2).toFixed(1);
      return `<li><button type="button" class="written-review-row" data-review-index="${index}" id="written-review-toggle-${index}" aria-expanded="false" aria-controls="written-review-detail-${index}" aria-label="${esc(item.toiletName || '이름 없는 화장실')}, 평균 평점 ${avg}, 작성자 ${esc(item.authorDisplayName)}, 작성일 ${esc(date(item.createdAt))}"><span class="written-review-toilet"><strong title="${esc(item.toiletName)}">${esc(item.toiletName || '이름 없는 화장실')}</strong></span><span class="written-review-rating"><span class="written-review-star" aria-hidden="true">★</span> <strong>${avg}</strong></span><span class="written-review-author" title="${esc(item.authorDisplayName)}">${esc(item.authorDisplayName)}</span><span class="written-review-time"><time datetime="${esc(item.createdAt)}"><span class="written-review-date-long">${esc(date(item.createdAt))}</span><span class="written-review-date-short">${esc(shortDate(item.createdAt))}</span></time></span><span class="written-review-chevron" aria-hidden="true">⌄</span></button><section class="written-review-detail" id="written-review-detail-${index}" role="region" aria-labelledby="written-review-toggle-${index}" hidden></section></li>`;
    }).join('')}</ul><footer class="analytics-table-footer written-reviews-footer"><span>이 페이지 ${report.items.length}개 · ${page + 1}페이지</span><div><button type="button" data-reviews-page="previous" ${page === 0 ? 'disabled' : ''}>이전</button><button type="button" data-reviews-page="next" ${report.hasMore ? '' : 'disabled'}>다음</button></div></footer>`;
  }
  async function load(nextPage = 0, cursor = null, message = '') {
    const token = ++listEpoch, target = host;
    if (!target?.isConnected) return;
    listController?.abort(); listController = new AbortController(); cancelDetail();
    const controller = listController;
    const results = target.querySelector('.written-reviews-results');
    const notice = target.querySelector('.written-reviews-notice');
    notice.textContent = message; notice.hidden = !message;
    if (message) notice.focus();
    pendingPage = nextPage; pendingCursor = cursor;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<p class="analytics-empty" role="status">작성된 리뷰를 불러오고 있습니다.</p>';
    const params = new URLSearchParams({ size: '10' });
    if (cursor) params.set('cursor', cursor);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${endpoint}?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (token !== listEpoch || target !== host || !target.isConnected) return;
      if ([401, 403].includes(response.status)) { reject(response.status, target); return; }
      if (!response.ok) throw new Error(response.status === 400 ? 'cursor' : 'load');
      const value = await response.json();
      if (token !== listEpoch || target !== host || !target.isConnected) return;
      if (!Array.isArray(value.items) || value.items.length > 10 || !value.items.every(validReview)
        || typeof value.hasMore !== 'boolean' || (value.hasMore && (typeof value.nextCursor !== 'string' || !value.nextCursor))) throw new Error('load');
      page = nextPage; cursors[page] = cursor; cursors.length = page + 1; report = value;
      render();
    } catch (error) {
      if (token !== listEpoch || target !== host || !target.isConnected) return;
      results.innerHTML = `<div class="written-reviews-empty" role="alert"><h3>리뷰를 불러오지 못했습니다.</h3><p>${error.message === 'cursor' ? '목록 기준이 달라졌습니다. 최신 리뷰부터 다시 확인해 주세요.' : '연결 상태를 확인한 뒤 다시 시도해 주세요.'}</p><button type="button" ${error.message === 'cursor' ? 'data-reviews-first' : 'data-reviews-retry'}>${error.message === 'cursor' ? '최신 리뷰 보기' : '다시 시도'}</button></div>`;
    } finally {
      clearTimeout(timeout);
      if (token === listEpoch && target === host && target.isConnected) results.setAttribute('aria-busy', 'false');
    }
  }
  function detailHtml(item) {
    const changed = item.updatedAt !== item.createdAt;
    return `<div class="written-review-detail-heading"><h3>${esc(item.toiletName || '이름 없는 화장실')} <small>리뷰 상세</small></h3>${item.toiletVisibility === 'VISIBLE' ? `<a class="analytics-link" href="https://geupddong.com/toilet/${item.toiletId}" target="_blank" rel="noopener noreferrer">화장실 보기 ↗</a>` : '<span class="written-review-hidden">비공개 화장실</span>'}</div><dl class="written-review-facts"><div><dt>만족도</dt><dd>${item.satisfaction} / 5</dd></div><div><dt>청결도</dt><dd>${item.cleanliness} / 5</dd></div><div><dt>휴지</dt><dd>${item.paper ? '있음' : '없음'}</dd></div><div><dt>대기 시간</dt><dd>${item.waitMinutes === 0 ? '대기 없음' : `${item.waitMinutes}분`}</dd></div></dl><p class="written-review-rating-caption">목록 평점은 만족도와 청결도의 평균입니다.</p><h4>작성 내용</h4><p class="written-review-comment${item.comment.trim() ? '' : ' is-empty'}">${item.comment.trim() ? esc(item.comment) : '작성된 본문이 없습니다.'}</p><p class="written-review-detail-meta">${esc(item.authorDisplayName)} · 작성 ${esc(date(item.createdAt))}${changed ? ` · 수정 ${esc(date(item.updatedAt))}` : ''}</p>`;
  }
  function moderationHtml(item, index) {
    const disabled = !readOnlyPreview() && !canModerate(item);
    const note = readOnlyPreview() ? '실데이터 프리뷰에서는 리뷰를 삭제할 수 없습니다.' : !canModerate(item) ? '최신 삭제 기준을 확인할 수 없습니다. 상세를 다시 불러오거나 관리자 화면을 새로고침해 주세요.' : '';
    return `<section class="written-review-moderation" aria-label="리뷰 운영 관리"><div class="written-review-moderation-intro"><div><h4>리뷰 운영 관리</h4><p>확인된 가이드 위반에 한해 삭제할 수 있습니다. 낮은 평점이나 불만·비판만을 이유로 삭제하지 않습니다.</p></div><button type="button" class="written-review-delete-button" data-review-delete-open="${index}" ${disabled ? 'disabled' : ''}>${readOnlyPreview()?'삭제 절차 미리보기':'리뷰 삭제'}</button></div>${note ? `<p class="written-review-moderation-note">${note}</p>` : ''}<div class="written-review-delete-slot"></div></section>`;
  }
  function syncRemovalForm() {
    const form = host?.querySelector('.written-review-delete-form');
    if (!form) return;
    const reason = form.elements.namedItem('reason').value;
    const confirmed = form.elements.namedItem('confirmed').checked;
    form.querySelector('[data-review-delete-submit]').disabled = !!removal || readOnlyPreview() || !canModerate(loadedDetail) || !reasons.some(item => item[0] === reason) || !confirmed;
    form.querySelector('.written-review-delete-selected').textContent = reasons.find(item => item[0] === reason)?.[1] || '사유를 선택해 주세요.';
  }
  function openRemoval(index) {
    if ((readOnlyPreview()?!loadedDetail:!canModerate(loadedDetail)) || index !== expanded || removal) return;
    const section = host.querySelector('.written-review-moderation');
    section.querySelector('[data-review-delete-open]').hidden = true;
    section.querySelector('.written-review-delete-slot').innerHTML = `<form class="written-review-delete-form"><h4>이 리뷰를 삭제할까요?</h4><p class="written-review-delete-target">대상 화장실: <strong>${esc(loadedDetail.toiletName || '이름 없는 화장실')}</strong></p><p>이 리뷰의 작성 내용과 평가가 함께 삭제되며, 공개 리뷰·내 리뷰·관련 집계에서 제외됩니다. 서비스 화면에서 복구할 수 없습니다. 삭제 사유와 처리 이력은 남습니다.</p><p>삭제 후에도 작성자의 24시간 재작성 제한은 유지됩니다.</p><label>삭제 사유<select name="reason" required><option value="">가이드 위반 사유 선택</option>${reasons.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><p class="written-review-moderation-note">확인된 가이드 위반 사유를 선택해 주세요. 낮은 별점이나 불만만으로는 삭제할 수 없습니다.</p><details class="written-review-delete-guide"><summary>사유별 판단 기준</summary><ul>${reasons.map(([,label,description])=>`<li><strong>${label}</strong>: ${description}</li>`).join('')}</ul><p>짧은 글·별점만 있는 리뷰, 비슷한 평점이나 반복 방문만으로 위반을 판단하지 않습니다. 사유가 불분명하면 처리하지 않고 추가로 확인해 주세요.</p></details><p>선택한 사유: <strong class="written-review-delete-selected">사유를 선택해 주세요.</strong></p><label class="written-review-delete-confirm"><input type="checkbox" name="confirmed" required>위 안내와 삭제 사유를 확인했으며, 작성 내용과 평가가 함께 삭제됨을 확인했습니다.</label><p class="written-review-delete-error" role="alert" hidden></p>${readOnlyPreview()?'<p class="written-review-moderation-note">실데이터 프리뷰에서는 리뷰를 삭제할 수 없습니다.</p>':''}<div class="written-review-delete-actions"><button type="button" data-review-delete-cancel>취소</button><button type="submit" class="written-review-delete-button" data-review-delete-submit disabled>리뷰 삭제</button></div></form>`;
    section.querySelector('select').focus();
  }
  function closeRemoval() {
    if (removal) return;
    const section = host?.querySelector('.written-review-moderation');
    if (!section) return;
    section.querySelector('.written-review-delete-slot').innerHTML = '';
    const button = section.querySelector('[data-review-delete-open]');
    button.hidden = false; button.focus();
  }
  async function removeReview(form) {
    const target = host, item = loadedDetail, listToken = listEpoch, detailToken = detailEpoch;
    const reason = form.elements.namedItem('reason').value;
    if (removal || readOnlyPreview() || !target?.isConnected || !canModerate(item) || !form.elements.namedItem('confirmed').checked || !reasons.some(value => value[0] === reason)) return;
    const operation = {}; removal = operation;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),15000);
    const controls = [...target.querySelectorAll('.written-reviews-results button,.written-reviews-results input,.written-reviews-results select'), document.getElementById('analytics-refresh')].filter(Boolean).map(control=>[control,control.disabled]);
    controls.forEach(([control])=>{control.disabled=true;});
    form.setAttribute('aria-busy','true');
    const error = form.querySelector('.written-review-delete-error'); error.hidden = true;
    const current = () => target === host && target.isConnected && listToken === listEpoch && detailToken === detailEpoch;
    const unlock = () => {if(current())controls.forEach(([control,disabled])=>{if(control.isConnected)control.disabled=disabled;});};
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(item.id)}`,{method:'DELETE',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({reviewKey:item.reviewKey,version:item.version,reason,confirmed:true})});
      if (!current()) return;
      if ([401,403].includes(response.status)) {reject(response.status,target);return;}
      if (response.status === 404) {unlock();await load(0,null,'이미 삭제되었거나 더 이상 확인할 수 없는 리뷰입니다. 최신 목록을 다시 확인해 주세요.');return;}
      if (response.status === 409 || response.status === 400) {
        const result=await response.json();if(!current())return;
        const message=result.error?.code==='REVIEW_BUSY'?'다른 작업이 진행 중입니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.':result.error?.code==='REVIEW_CHANGED'?'리뷰가 수정되었습니다. 최신 내용을 다시 확인한 뒤 삭제해 주세요.':'삭제 조건을 확인하지 못했습니다. 최신 내용을 다시 확인해 주세요.';
        loadedDetail=null; error.innerHTML=`${message} <button type="button" data-review-detail-retry="${expanded}">최신 상세 다시 보기</button>`; error.hidden=false;return;
      }
      if (!response.ok) throw new Error('unconfirmed');
      const value = await response.json();
      if (!current()) return;
      if (value.id !== item.id || value.deleted !== true) throw new Error('unconfirmed');
      unlock();await load(0,null,'리뷰를 삭제했습니다. 최신 목록으로 이동합니다.');
    } catch {
      if (!current()) return;
      loadedDetail=null; error.innerHTML='삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 상태를 확인해 주세요. <button type="button" data-reviews-first>최신 목록 확인</button>'; error.hidden=false;
    } finally {
      clearTimeout(timeout);
      if (removal === operation) removal=null;
      unlock();
      if (form.isConnected) form.setAttribute('aria-busy','false');
      syncRemovalForm();
    }
  }
  async function toggleDetail(index, retry = false) {
    const target = host, item = report?.items[index];
    if (!target?.isConnected || !item) return;
    const wasOpen = expanded === index;
    cancelDetail();
    target.querySelectorAll('.written-review-row').forEach(button => button.setAttribute('aria-expanded', 'false'));
    target.querySelectorAll('.written-review-detail').forEach(region => { region.hidden = true; region.innerHTML = ''; });
    if (wasOpen && !retry) return;
    expanded = index;
    const token = ++detailEpoch, listToken = listEpoch;
    const region = target.querySelector(`#written-review-detail-${index}`);
    target.querySelector(`#written-review-toggle-${index}`).setAttribute('aria-expanded', 'true');
    region.hidden = false; region.setAttribute('aria-busy', 'true');
    region.innerHTML = '<p class="analytics-empty" role="status">리뷰 상세를 불러오고 있습니다.</p>';
    detailController = new AbortController();
    const controller = detailController;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(item.id)}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (token !== detailEpoch || listToken !== listEpoch || target !== host || !target.isConnected) return;
      if ([401, 403].includes(response.status)) { reject(response.status, target); return; }
      if (!response.ok) throw new Error(response.status === 404 ? 'missing' : 'load');
      const value = await response.json();
      if (token !== detailEpoch || listToken !== listEpoch || target !== host || !target.isConnected) return;
      if (!validReview(value) || value.id !== item.id || typeof value.comment !== 'string') throw new Error('load');
      loadedDetail = value; region.innerHTML = detailHtml(value) + moderationHtml(value,index);
    } catch (error) {
      if (token !== detailEpoch || listToken !== listEpoch || target !== host || !target.isConnected) return;
      region.innerHTML = `<div class="written-reviews-empty" role="alert"><p>${error.message === 'missing' ? '삭제되었거나 더 이상 확인할 수 없는 리뷰입니다.' : '리뷰 상세를 불러오지 못했습니다.'}</p><button type="button" ${error.message === 'missing' ? 'data-reviews-first' : `data-review-detail-retry="${index}"`}>${error.message === 'missing' ? '최신 리뷰 보기' : '다시 시도'}</button></div>`;
    } finally {
      clearTimeout(timeout);
      if (token === detailEpoch && target === host && target.isConnected) region.setAttribute('aria-busy', 'false');
    }
  }
  window.WrittenReviewsAnalytics = { cancel, dispose, show(target) { cancel(); host = target; report = null; page = 0; cursors = [null]; shell(); void load(); } };
  document.addEventListener('admin:before-route-change', dispose);
  if (typeof AdminAuth !== 'undefined') unsubscribe = AdminAuth.subscribe?.(state => {
    if (state.status !== 'authenticated' && host) { const target = host; cancel(); target.innerHTML = ''; }
  });
})();
