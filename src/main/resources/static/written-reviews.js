(() => {
  window.WrittenReviewsAnalytics?.dispose?.();
  const endpoint = 'https://api.geupddong.com/api/admin/v1/reviews';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  let host, listController, detailController, listEpoch = 0, detailEpoch = 0;
  let report, page = 0, cursors = [null], expanded = null, pendingPage = 0, pendingCursor = null;
  let unsubscribe;

  function cancelDetail() { ++detailEpoch; detailController?.abort(); detailController = null; expanded = null; }
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
    host.innerHTML = `<section class="analytics-panel written-reviews" aria-labelledby="written-reviews-title"><header><div><h2 id="written-reviews-title">작성 리뷰</h2><p>전체 기간의 사용자 리뷰를 작성일 최신순으로 확인합니다. 행을 누르면 작성 내용이 펼쳐집니다.</p></div><span class="written-reviews-order">최신순 · 한국시간</span></header><div class="written-reviews-results" aria-live="polite"></div></section>`;
    host.querySelector('.written-reviews-results').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.reviewIndex !== undefined) void toggleDetail(Number(button.dataset.reviewIndex));
      else if (button.hasAttribute('data-review-detail-retry')) void toggleDetail(Number(button.dataset.reviewDetailRetry), true);
      else if (button.hasAttribute('data-reviews-retry')) void load(pendingPage, pendingCursor);
      else if (button.hasAttribute('data-reviews-first')) { cursors = [null]; void load(0, null); }
      else if (button.dataset.reviewsPage === 'next' && report?.hasMore) void load(page + 1, report.nextCursor);
      else if (button.dataset.reviewsPage === 'previous' && page > 0) void load(page - 1, cursors[page - 1]);
    });
  }
  function render() {
    const results = host.querySelector('.written-reviews-results');
    if (!report.items.length) {
      results.innerHTML = `<div class="written-reviews-empty"><h3>${page === 0 ? '아직 작성된 리뷰가 없습니다.' : '이 페이지의 리뷰가 더 이상 없습니다.'}</h3><p>${page === 0 ? '사용자가 리뷰를 작성하면 이곳에 최신순으로 표시됩니다.' : '리뷰가 삭제되었을 수 있습니다. 최신 목록을 다시 확인해 주세요.'}</p>${page > 0 ? '<button type="button" data-reviews-first>최신 리뷰 보기</button>' : ''}</div>`;
      return;
    }
    results.innerHTML = `<p class="written-reviews-rating-note">평점은 만족도와 청결도의 평균입니다. 본문이 없는 별점 리뷰도 포함합니다.</p><div class="written-reviews-columns" aria-hidden="true"><span>화장실</span><span>평점</span><span>작성자</span><span>작성일</span><span></span></div><ul class="written-reviews-list">${report.items.map((item, index) => {
      const avg = ((item.satisfaction + item.cleanliness) / 2).toFixed(1);
      return `<li><button type="button" class="written-review-row" data-review-index="${index}" id="written-review-toggle-${index}" aria-expanded="false" aria-controls="written-review-detail-${index}"><span class="written-review-toilet"><strong>${esc(item.toiletName || '이름 없는 화장실')}</strong>${item.toiletVisibility !== 'VISIBLE' ? '<small class="written-review-hidden">비공개 화장실</small>' : ''}</span><span class="written-review-rating"><span class="written-review-star" aria-hidden="true">★</span> <strong>${avg}</strong><small>만족 ${item.satisfaction} · 청결 ${item.cleanliness}</small></span><span class="written-review-author">${esc(item.authorDisplayName)}${item.hasComment ? '<small>작성 내용 있음</small>' : '<small>별점 리뷰</small>'}</span><span class="written-review-time"><time datetime="${esc(item.createdAt)}">${esc(date(item.createdAt))}</time>${item.updatedAt !== item.createdAt ? '<small>수정됨</small>' : ''}</span><span class="written-review-chevron" aria-hidden="true">⌄</span></button><section class="written-review-detail" id="written-review-detail-${index}" role="region" aria-labelledby="written-review-toggle-${index}" hidden></section></li>`;
    }).join('')}</ul><footer class="analytics-table-footer written-reviews-footer"><span>이 페이지 ${report.items.length}개 · ${page + 1}페이지</span><div><button type="button" data-reviews-page="previous" ${page === 0 ? 'disabled' : ''}>이전</button><button type="button" data-reviews-page="next" ${report.hasMore ? '' : 'disabled'}>다음</button></div></footer>`;
  }
  async function load(nextPage = 0, cursor = null) {
    const token = ++listEpoch, target = host;
    if (!target?.isConnected) return;
    listController?.abort(); listController = new AbortController(); cancelDetail();
    const controller = listController;
    const results = target.querySelector('.written-reviews-results');
    pendingPage = nextPage; pendingCursor = cursor;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<p class="analytics-empty" role="status">작성된 리뷰를 불러오고 있습니다.</p>';
    const params = new URLSearchParams({ size: '20' });
    if (cursor) params.set('cursor', cursor);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${endpoint}?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (token !== listEpoch || target !== host || !target.isConnected) return;
      if ([401, 403].includes(response.status)) { reject(response.status, target); return; }
      if (!response.ok) throw new Error(response.status === 400 ? 'cursor' : 'load');
      const value = await response.json();
      if (token !== listEpoch || target !== host || !target.isConnected) return;
      if (!Array.isArray(value.items) || value.items.length > 20 || !value.items.every(validReview)
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
    return `<div class="written-review-detail-heading"><h3>${esc(item.toiletName || '이름 없는 화장실')} <small>리뷰 상세</small></h3>${item.toiletVisibility === 'VISIBLE' ? `<a class="analytics-link" href="https://geupddong.com/toilet/${item.toiletId}" target="_blank" rel="noopener noreferrer">화장실 보기 ↗</a>` : '<span class="written-review-hidden">비공개 화장실</span>'}</div><dl class="written-review-facts"><div><dt>만족도</dt><dd>${item.satisfaction} / 5</dd></div><div><dt>청결도</dt><dd>${item.cleanliness} / 5</dd></div><div><dt>휴지</dt><dd>${item.paper ? '있음' : '없음'}</dd></div><div><dt>대기 시간</dt><dd>${item.waitMinutes === 0 ? '대기 없음' : `${item.waitMinutes}분`}</dd></div></dl><h4>작성 내용</h4><p class="written-review-comment${item.comment.trim() ? '' : ' is-empty'}">${item.comment.trim() ? esc(item.comment) : '작성된 본문이 없습니다.'}</p><p class="written-review-detail-meta">${esc(item.authorDisplayName)} · 작성 ${esc(date(item.createdAt))}${changed ? ` · 수정 ${esc(date(item.updatedAt))}` : ''}</p>`;
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
      region.innerHTML = detailHtml(value);
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
