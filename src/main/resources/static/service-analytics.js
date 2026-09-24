(() => {
  const root = document.getElementById('analytics-shell');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const num = (value) =>
    new Intl.NumberFormat('ko-KR').format(Number(value || 0));
  const pct = (part, total) =>
    total ? `${((part / total) * 100).toFixed(1)}%` : '—';
  const time = (seconds) => {
    const s = Math.max(0, Math.round(seconds || 0));
    return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
  };
  const dateTime = (value) =>
    value
      ? new Intl.DateTimeFormat('ko-KR', {
          timeZone: 'Asia/Seoul',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(value))
      : '—';
  const labels = {
    page: {
      '/': '지도 홈',
      '/toilet/:id': '화장실 상세',
      '/regions': '지역 탐색',
      '/regions/:sido/:district/toilet/:id': '지역별 화장실 상세',
      '/account': '내 페이지',
      '/policies/terms': '이용약관',
      '/policies/privacy': '개인정보 처리방침',
      '/policies/location': '위치정보 안내',
      '/policies/all': '전체 정책',
      '/other': '알 수 없는 경로',
    },
    source: {
      none: '직접 접속·확인 불가',
      unknown: '미확인',
      google: 'Google',
      naver: 'Naver',
      daum: 'Daum',
      bing: 'Bing',
      geupddong: '급똥 내부',
      kakao: 'Kakao',
      instagram: 'Instagram',
      facebook: 'Facebook',
    },
    channel: {
      Direct: '직접 접속·확인 불가',
      Internal: '내부 이동',
      'Organic Search': '자연 검색',
      Referral: '외부 링크',
      'Organic Social': '소셜',
      'Paid Search': '유료 검색',
      'Paid Social': '유료 소셜',
      Email: '이메일',
      Offline: 'QR·오프라인',
      Campaign: '캠페인',
      Unassigned: '미분류',
    },
    device: { mobile: '모바일', desktop: '데스크톱', tablet: '태블릿' },
    country: {
      KR: '대한민국',
      US: '미국',
      JP: '일본',
      CN: '중국',
      TW: '대만',
      HK: '홍콩',
      GB: '영국',
      DE: '독일',
      SG: '싱가포르',
      XX: '확인 불가',
    },
    screen: {
      notifications: '알림',
      account_home: '내 페이지',
      my_reports: '내 제보',
      my_reviews: '내 리뷰',
      account_settings: '계정 관리',
      review_list: '리뷰 목록',
      review_write: '리뷰 작성',
      not_found: '찾을 수 없는 화면',
    },
    event: {
      page_view: '페이지 조회',
      session_start: '세션 시작',
      engagement: '체류 시간 기록',
      screen_view: '화면 열기',
      scroll_depth: '스크롤 도달',
      toilet_search: '장소 검색',
      nearby_search: '주변 검색',
      search_result_select: '검색 결과 선택',
      toilet_marker_select: '지도 마커 선택',
      toilet_detail_open: '화장실 상세 열기',
      directions_click: '길찾기 선택',
      report_start: '제보 시작',
      report_submit: '제보 제출',
      login_result: '로그인 결과',
      review_submit: '리뷰 제출',
    },
  };
  const label = (type, key) => labels[type]?.[key] || key || '값 없음';
  const specs = {
    page: ['페이지', 'views', '조회'],
    screen: ['앱 안의 화면', 'events', '열기'],
    channel: ['유입 채널', 'sessions', '첫 유입 세션'],
    source: ['유입 소스', 'sessions', '첫 유입 세션'],
    event: ['이용 행동', 'events', '발생'],
    device: ['기기', 'visitors', '일별 방문자 합계'],
    os: ['운영체제', 'visitors', '일별 방문자 합계'],
    browser: ['브라우저', 'visitors', '일별 방문자 합계'],
    country: ['접속 국가', 'visitors', '일별 방문자 합계'],
    city: ['접속 도시', 'visitors', '일별 방문자 합계'],
  };
  const state = {
    range: '7d',
    from: '',
    to: '',
    tab: 'overview',
    filters: {},
    tables: {},
    report: null,
    request: 0,
    controller: null,
    back: null,
    lowerMetric: 'views',
    busy: false,
    realtime: null,
    successfulQuery: null,
    excludeBots: true,
  };
  let activePoint = null;
  let touchPoint = null;
  let touchInput = false;
  function delta(current, previous) {
    if (previous == null) return '비교 없음';
    if (!previous) return current ? '이전 기록 0' : '변화 없음';
    const d = ((current - previous) / previous) * 100;
    return `${d > 0 ? '+' : ''}${d.toFixed(1)}%`;
  }
  function fallback(type, key) {
    return (type === 'page' && key === '/other') ||
      (type === 'source' && ['none', 'unknown'].includes(key)) ||
      (type === 'channel' && ['Direct', 'Unassigned'].includes(key)) ||
      (type === 'country' && key === 'XX')
      ? 1
      : 0;
  }
  function tableRows(type) {
    const pref = state.tables[type] || { search: '', sort: 'metric', page: 0 },
      metric = specs[type][1],
      prior = new Map(
        (state.report.previousDimensions[type] || []).map((r) => [
          r.key,
          r.metrics,
        ]),
      );
    return (state.report.dimensions[type] || [])
      .filter((r) =>
        `${label(type, r.key)} ${r.key}`
          .toLowerCase()
          .includes(pref.search.toLowerCase()),
      )
      .map((r) => ({
        ...r,
        previous: state.report.comparisonAvailable
          ? prior.get(r.key)?.[metric] || 0
          : null,
      }))
      .sort((a, b) => {
        if (fallback(type, a.key) !== fallback(type, b.key))
          return fallback(type, a.key) - fallback(type, b.key);
        if (pref.sort === 'name')
          return label(type, a.key).localeCompare(label(type, b.key), 'ko');
        if (pref.sort === 'change')
          return (
            b.metrics[metric] -
            (b.previous || 0) -
            (a.metrics[metric] - (a.previous || 0))
          );
        if (pref.sort === 'visitors')
          return b.metrics.visitors - a.metrics.visitors;
        return (
          b.metrics[metric] - a.metrics[metric] || a.key.localeCompare(b.key)
        );
      });
  }
  function panel(title, content, note = '') {
    return `<article class="analytics-panel"><header><h2>${esc(title)}</h2>${note ? `<span>${esc(note)}</span>` : ''}</header>${content}</article>`;
  }
  function table(type) {
    const [title, metric, unit] = specs[type],
      pref = state.tables[type] || { search: '', sort: 'metric', page: 0 },
      rows = tableRows(type),
      page = Math.min(pref.page, Math.max(0, Math.ceil(rows.length / 15) - 1)),
      part = rows.slice(page * 15, page * 15 + 15);
    const total = (state.report.dimensions[type] || []).reduce(
        (s, r) => s + r.metrics[metric],
        0,
      ),
      filterable =
        ['page', 'source', 'channel', 'device', 'country'].includes(type) &&
        state.report.detailed,
      detail = type === 'event';
    return `<article class="analytics-panel analytics-detail-table" data-table="${type}"><header><div><h2>${esc(title)}</h2><p>${num(rows.length)}개 항목 · ${filterable ? '항목 선택으로 전체 분석에 필터 적용' : '선택 기간의 집계'}</p></div></header><div class="analytics-table-controls"><input aria-label="${esc(title)} 검색" data-search="${type}" type="search" placeholder="항목 찾기" value="${esc(pref.search)}"><select aria-label="${esc(title)} 정렬" data-sort="${type}">${[
      ['metric', `${unit} 많은 순`],
      ['visitors', '방문자 많은 순'],
      ['change', '증가 건수 순'],
      ['name', '이름순'],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${pref.sort === v ? 'selected' : ''}>${t}</option>`,
      )
      .join(
        '',
      )}</select></div><div class="analytics-table-wrap"><table><thead><tr><th>항목</th><th>${unit}</th><th>비중</th><th>이전 대비</th><th>일별 방문자 합계</th>${detail ? '<th>성공 / 실패</th>' : '<th>평균 체류</th>'}</tr></thead><tbody>${part.map((r) => `<tr><td>${filterable ? `<button type="button" class="analytics-link" data-filter="${type}" data-value="${esc(r.key)}">${esc(label(type, r.key))}</button>` : `<strong>${esc(label(type, r.key))}</strong>`}${type === 'page' ? `<small>${esc(r.key)}</small>` : ''}</td><td>${num(r.metrics[metric])}</td><td>${pct(r.metrics[metric], total)}</td><td>${delta(r.metrics[metric], r.previous)}</td><td>${num(r.metrics.visitors)}</td><td>${detail ? (state.report.detailed ? `${num(r.metrics.successes)} / ${num(r.metrics.failures)}${r.metrics.unspecified ? `<small>미기록 ${num(r.metrics.unspecified)}</small>` : ''}` : '—') : time(r.metrics.visitors ? r.metrics.engagementSeconds / r.metrics.visitors : 0)}</td></tr>`).join('') || '<tr><td colspan="6">조건에 해당하는 기록이 없습니다.</td></tr>'}</tbody></table></div><footer class="analytics-table-footer"><span>비중: 표시 가능한 목록의 ${unit} 합계 기준${detail ? ' · 결과 기록이 있는 이벤트만 성공·실패 표시' : ''}</span><div><button data-page="${type}" data-value="${page - 1}" ${page === 0 ? 'disabled' : ''}>이전</button><span>${page + 1} / ${Math.max(1, Math.ceil(rows.length / 15))}</span><button data-page="${type}" data-value="${page + 1}" ${(page + 1) * 15 >= rows.length ? 'disabled' : ''}>다음</button></div></footer></article>`;
  }
  function chart(metric, title, unit) {
    const rows = state.report.trend,
      previous = state.report.previousTrend || [],
      w = window.innerWidth <= 800 ? Math.max(260, root.clientWidth - 64) : 900,
      h = 165,
      left = 54,
      right = 20,
      top = 15,
      bottom = 28;
    const maximum = Math.max(
        2,
        ...rows.map((p) => p.metrics?.[metric] || 0),
        ...previous.map((p) => p.metrics?.[metric] || 0),
      ),
      step = Math.pow(10, Math.floor(Math.log10(maximum))),
      max = Math.ceil(maximum / (step * 2)) * step * 2;
    const x = (i) =>
        left +
        (w - left - right) * (rows.length === 1 ? 0.5 : i / (rows.length - 1)),
      y = (v) => top + (h - top - bottom) * (1 - v / max);
    const path = (data) => {
      let started = false;
      return data
        .map((p, i) => {
          if (!p.metrics) {
            started = false;
            return '';
          }
          const value = `${started ? 'L' : 'M'}${x(i)},${y(p.metrics[metric])}`;
          started = true;
          return value;
        })
        .join(' ');
    };
    const grid = [0, 0.5, 1]
        .map(
          (p) =>
            `<line x1="${left}" y1="${y(max * p)}" x2="${w - right}" y2="${y(max * p)}" class="analytics-grid"/><text x="${left - 9}" y="${y(max * p) + 4}" text-anchor="end">${num(Math.round(max * p))}</text>`,
        )
        .join(''),
      stepLabel = Math.max(1, Math.ceil(rows.length / Math.max(3, Math.floor((w - left - right) / 90))));
    const points = rows.map((p, i) => {
      // Adjacent hit regions meet at midpoints: no dead gaps between data points.
      const start = i ? (x(i - 1) + x(i)) / 2 : left - 8;
      const end = i < rows.length - 1 ? (x(i) + x(i + 1)) / 2 : w - right + 8;
      const tick = i % stepLabel === 0 || i === rows.length - 1
        ? `<text x="${x(i)}" y="${h - 5}" text-anchor="middle">${esc(state.report.hourly ? p.key : p.key.slice(5).replace('-', '.'))}</text>` : '';
      if (!p.metrics) return tick;
      return `${tick}<circle data-dot="${i}" cx="${x(i)}" cy="${y(p.metrics[metric])}" r="3"/><rect data-point="${i}" data-day="${esc(p.key)}" x="${start}" y="${top}" width="${end - start}" height="${h - top - bottom}" fill="transparent" tabindex="0" role="button" aria-label="${esc(p.key)} ${title} ${num(p.metrics[metric])}${unit}${state.report.hourly ? '' : ' · 날짜 상세 보기'}"/>`;
    }).join('');
    return `<div class="analytics-single-chart" data-metric="${metric}"><h3>${title} <small>${unit}</small></h3><svg viewBox="0 0 ${w} ${h}" aria-label="${title} 추이. 가리키거나 터치하면 수치를 확인할 수 있습니다.">${grid}${previous.length ? `<path class="analytics-previous" d="${path(previous)}"/>` : ''}<path class="analytics-line" d="${path(rows)}"/>${points}</svg></div>`;
  }
  function overview() {
    const r = state.report,
      c = r.current;
    const trend = panel(
      r.hourly ? '시간대별 방문 변화' : '일별 방문 변화',
      `<div class="analytics-chart-toolbar"><span>각 그래프는 독립된 눈금입니다. <i class="analytics-dashed"></i> 이전 기간</span><select id="analytics-lower-metric" aria-label="두 번째 그래프 지표">${[
        ['views', '페이지뷰'],
        ['sessions', '첫 유입 세션'],
        ['keyEvents', '주요 행동'],
      ]
        .map(
          ([v, t]) =>
            `<option value="${v}" ${state.lowerMetric === v ? 'selected' : ''}>${t}</option>`,
        )
        .join(
          '',
        )}</select></div>${chart('visitors', '추정 방문자', '명')}${chart(state.lowerMetric, { views: '페이지뷰', sessions: '첫 유입 세션', keyEvents: '주요 행동' }[state.lowerMetric], '건')}<div id="analytics-point-readout" class="analytics-point-readout" aria-live="polite">${r.hourly ? '시간을 가리키면 두 지표를 함께 확인합니다.' : '날짜를 선택하면 해당 날짜의 유입·페이지·행동을 자세히 봅니다.'}</div><details class="analytics-trend-data"><summary>날짜별 수치 보기</summary><div class="analytics-table-wrap"><table><thead><tr><th>${r.hourly ? '시간' : '날짜'}</th><th>추정 방문자</th><th>조회</th><th>첫 유입 세션</th><th>주요 행동</th></tr></thead><tbody>${r.trend.map((p) => `<tr><td>${!r.hourly && p.metrics ? `<button class="analytics-link" data-day="${esc(p.key)}">${esc(p.key)}</button>` : esc(p.key)}</td>${['visitors', 'views', 'sessions', 'keyEvents'].map((k) => `<td>${p.metrics ? num(p.metrics[k]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`,
    );
    const top = (type, metric) =>
        [...(r.dimensions[type] || [])]
          .filter((row) => !fallback(type, row.key))
          .sort((a, b) => b.metrics[metric] - a.metrics[metric])[0],
      page = top('page', 'views'),
      source = top('source', 'sessions');
    const insights = panel(
      '운영자가 먼저 볼 내용',
      `<div class="analytics-insights"><button data-tab="content"><span>가장 많이 본 페이지</span><strong>${page ? esc(label('page', page.key)) : '기록 없음'}</strong><small>${page ? `${num(page.metrics.views)}회 조회` : ''} <b>페이지 분석 →</b></small></button><button data-tab="acquisition"><span>확인된 주요 유입</span><strong>${source ? esc(label('source', source.key)) : '확인된 출처 없음'}</strong><small>${source ? `${num(source.metrics.sessions)}세션` : ''} <b>유입 분석 →</b></small></button><button data-tab="behavior"><span>검색 결과가 없었던 요청</span><strong>${r.detailed ? num(c.emptyResults) : '—'}<small>건</small></strong><small>장소·주변 검색 합계 <b>이용 행동 →</b></small></button><button data-tab="quality"><span>출처 확인 불가 비중</span><strong>${r.detailed ? pct(r.quality.unattributedSessions, c.sessions) : '—'}</strong><small>직접 방문 포함 <b>수집 상태 →</b></small></button></div>`,
    );
    const live = state.realtime?.data;
    const realtime = panel(
      '지금 들어오는 방문',
      live
        ? `<div class="analytics-live"><strong>${num(live.activeUsers)}<small>추정 방문자</small></strong><strong>${num(live.views)}<small>페이지뷰</small></strong><strong>${num(live.keyEvents)}<small>주요 행동</small></strong></div><p>최근 30분 · 전체 서비스 기준 · ${state.report.botFilter?.excludeBots === false ? '봇 포함' : '봇 제외'} · 날짜·유입 등 세부 필터와 별도 집계 · ${dateTime(state.realtime.fetchedAt)} 조회</p>`
        : '<p class="analytics-empty">최근 30분 집계를 불러오지 못했습니다. 다른 분석은 계속 확인할 수 있습니다.</p>',
    );
    return `<div class="analytics-main-grid">${trend}<div class="analytics-overview-side">${realtime}${insights}</div></div><div id="analytics-chart-tooltip" class="analytics-chart-tooltip" role="tooltip" hidden></div>`;
  }
  function behavior() {
    const r = state.report,
      flows = r.flows.length
        ? r.flows
            .map((f) =>
              panel(
                f.name,
                `<ol class="analytics-flow">${f.steps.map((s, i) => `<li><span>${i + 1}. ${esc(s.name)}</span><strong>${num(s.sessions)}<small>세션</small></strong><div><i style="width:${f.steps[0].sessions ? (100 * s.sessions) / f.steps[0].sessions : 0}%"></i></div><small>${i ? `직전 단계 대비 ${pct(s.sessions, f.steps[i - 1].sessions)}` : '시작 단계'}</small></li>`).join('')}</ol>`,
              ),
            )
            .join('')
        : panel(
            '이용 흐름',
            '<p class="analytics-empty">이용 흐름은 최근 35일의 상세 기록이 있는 기간에서 확인할 수 있습니다.</p>',
          );
    return `<p class="analytics-section-note">선택 범위의 같은 세션에서 아래 순서대로 수집된 행동만 연결합니다. 제보·리뷰 완료는 성공 결과가 기록된 경우만 포함합니다. 0건은 실패율 100%를 뜻하지 않습니다.</p><div class="analytics-flow-grid">${flows}</div>${table('event')}`;
  }
  function quality() {
    const r = state.report,
      q = r.quality,
      c = r.current;
    return `<div class="analytics-two-column">${panel('확인해야 할 집계', `<dl class="analytics-quality-list"><div><dt>알 수 없는 페이지 조회</dt><dd>${r.detailed ? `${num(q.unknownPageViews)}건 · ${pct(q.unknownPageViews, c.views)}` : '상세 기간에서 확인'}</dd></div><div><dt>직접 접속·출처 확인 불가</dt><dd>${r.detailed ? `${num(q.unattributedSessions)}세션 · ${pct(q.unattributedSessions, c.sessions)}` : '상세 기간에서 확인'}</dd></div><div><dt>내부 출처로 기록된 유입</dt><dd>${r.detailed ? `${num(q.internalSessions)}세션` : '—'}</dd></div><div><dt>같은 세션의 반복 시작 이벤트</dt><dd>${r.detailed ? `${num(q.duplicateStarts)}건` : '—'}</dd></div></dl><p>이 값만으로 봇이나 오류를 확정하지 않습니다. 과거 원본 기록은 새 집계 방식으로 자동 복원되지 않습니다.</p>`)}${panel('집계 범위와 갱신', `<dl class="analytics-quality-list"><div><dt>현재 조회 방식</dt><dd>${r.detailed ? '보관 중인 이벤트 상세 집계' : '일별 집계'}</dd></div><div><dt>조회 기준 시각</dt><dd>${esc(r.cutoff.replace('T', ' ').slice(0, 16))} KST</dd></div><div><dt>마지막 일별 집계</dt><dd>${dateTime(q.lastCalculatedAt)}</dd></div><div><dt>마지막 수집 이벤트</dt><dd>${dateTime(q.lastEventAt)}</dd></div><div><dt>원본 보관</dt><dd>35일 · 조회 결과 최대 1분 캐시</dd></div></dl><p>${esc(r.comparisonNote)}</p>`)}</div>${panel('지표 해석', `<ul class="analytics-note-list">${r.notices.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`)}`;
  }
  function renderView() {
    hidePoint();
    const bots = state.tab === 'bots';
    $('analytics-kpis').hidden = bots;
    root.querySelector('.analytics-filter-line').hidden = bots;
    $('analytics-filter-chips').hidden = bots;
    $('analytics-range-note').hidden = bots;
    root.querySelector('.analytics-definitions').hidden = bots;
    $('analytics-exclude-bots').hidden = bots;
    $('analytics-bot-note').hidden = bots;
    $('analytics-export').disabled = bots || !state.report;
    document.querySelectorAll('.analytics-tabs [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
    if (bots) {
      const query = {range: state.range};
      if (state.range === 'custom') { query.from=state.from; query.to=state.to; }
      window.OriginBotAnalytics?.show($('analytics-view'), query);
      return;
    }
    window.OriginBotAnalytics?.cancel();
    if (!state.report) return;
    $('analytics-view').innerHTML =
      state.tab === 'overview'
        ? overview()
        : state.tab === 'acquisition'
          ? `<p class="analytics-section-note">첫 유입이 기록된 세션을 기준으로 비교합니다. 내부 이동의 조회 횟수를 유입 건수에 더하지 않습니다.</p><div class="analytics-two-column">${table('channel')}${table('source')}</div>`
          : state.tab === 'content'
            ? `<p class="analytics-section-note">URL이 바뀌는 페이지와 지도 안에서 열리는 화면을 구분합니다. 화장실별 식별자는 수집하지 않아 상세 페이지는 유형별로 합산됩니다.</p>${table('page')}${table('screen')}`
            : state.tab === 'behavior'
              ? behavior()
              : state.tab === 'audience'
                ? `<p class="analytics-section-note">국가·도시는 네트워크에서 추정한 정보입니다. 선택 필터를 적용해 방문 환경별 페이지와 행동을 함께 확인할 수 있습니다.</p><div class="analytics-two-column">${['device', 'os', 'browser', 'country', 'city'].map(table).join('')}</div>`
                : quality();
    document
      .querySelectorAll('.analytics-tabs [data-tab]')
      .forEach((b) =>
        b.setAttribute(
          'aria-current',
          b.dataset.tab === state.tab ? 'page' : 'false',
        ),
      );
  }
  function render() {
    const r = state.report,
      c = r.current,
      p = r.previous,
      cards = [
        ['visitors', r.visitorDefinition, num(c.visitors)],
        ['views', '페이지뷰', num(c.views)],
        ['sessions', '첫 유입 세션', num(c.sessions)],
        ['keyEvents', '주요 행동', num(c.keyEvents)],
        [
          'engagementSeconds',
          '방문자당 측정 체류',
          time(c.visitors ? c.engagementSeconds / c.visitors : 0),
        ],
      ];
    $('analytics-kpis').innerHTML = cards
      .map(
        ([k, title, value]) =>
          `<article><span>${title}</span><strong>${value}</strong><em>${k === 'engagementSeconds' ? '측정 체류 시간 ÷ 일별 방문자 합계' : `이전 기간 ${delta(c[k], p?.[k])}`}</em></article>`,
      )
      .join('');
    $('analytics-range-note').innerHTML =
      `<div><strong>${esc(r.from)} ~ ${esc(r.to)}</strong><span>${esc(r.comparisonNote)}</span></div>${state.back ? '<button id="analytics-back" type="button">← 이전 기간으로</button>' : ''}`;
    $('analytics-updated-at').textContent =
      `${dateTime(r.generatedAt)} 조회 · KST`;
    $('analytics-bot-note').textContent = r.botFilter?.note || '봇 필터 연결을 준비하고 있습니다.';
    syncBotToggle();
    $('analytics-definitions-list').innerHTML = r.notices
      .map((n) => `<li>${esc(n)}</li>`)
      .join('');
    for (const type of ['source', 'page', 'country']) {
      const select = $(`filter-${type}`),
        existing = new Map(
          [...select.options]
            .filter((o) => o.value)
            .map((o) => [o.value, o.textContent]),
        );
      (r.dimensions[type] || []).forEach((row) =>
        existing.set(row.key, label(type, row.key)),
      );
      if (state.filters[type])
        existing.set(state.filters[type], label(type, state.filters[type]));
      select.innerHTML =
        `<option value="">${{ source: '전체 유입', page: '전체 페이지', country: '모든 국가' }[type]}</option>` +
        [...existing]
          .sort(
            (a, b) =>
              fallback(type, a[0]) - fallback(type, b[0]) ||
              a[1].localeCompare(b[1], 'ko'),
          )
          .map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`)
          .join('');
      select.value = state.filters[type] || '';
    }
    $('filter-device').value = state.filters.device || '';
    for (const type of ['device', 'source', 'page', 'country'])
      $(`filter-${type}`).disabled = !r.detailed;
    $('analytics-filter-chips').innerHTML = Object.entries(state.filters)
      .map(
        ([type, value]) =>
          `<button type="button" data-remove="${type}" aria-label="${esc(label(type, value))} 필터 해제">${esc(label(type, value))} ×</button>`,
      )
      .join('');
    document
      .querySelectorAll('[data-range]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.range === state.range)),
      );
    $('analytics-custom-range').hidden = state.range !== 'custom';
    $('analytics-from').value = r.from;
    $('analytics-to').value = r.to;
    renderView();
  }
  async function load() {
    hidePoint();
    if (state.tab === 'bots') {
      document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
      $('analytics-custom-range').hidden = state.range !== 'custom';
      renderView();
      return;
    }
    const request = ++state.request;
    state.controller?.abort();
    state.controller = new AbortController();
    state.busy = true;
    syncBotToggle();
    root.classList.add('is-loading');
    $('analytics-view').setAttribute('aria-busy', 'true');
    $('analytics-refresh').disabled = true;
    $('analytics-export').disabled = true;
    $('analytics-error').hidden = true;
    root
      .querySelectorAll('.analytics-filter-line select')
      .forEach((s) => (s.disabled = true));
    const params = new URLSearchParams({
      range: state.range,
      ...state.filters,
      excludeBots: String(state.excludeBots),
    });
    if (state.range === 'custom') {
      params.set('from', state.from);
      params.set('to', state.to);
    }
    try {
      const [response, realtime] = await Promise.all([
        fetch(`/api/admin/v1/service-analytics/explore?${params}`, {
          credentials: 'include',
          signal: state.controller.signal,
        }),
        fetch(`/api/admin/v1/service-analytics/realtime?excludeBots=${state.excludeBots}`, {
          credentials: 'include',
          signal: state.controller.signal,
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (response.status === 401 || response.status === 403) {
        showLogin(response.status === 403);
        return;
      }
      if (!response.ok)
        throw new Error(response.status === 400 ? 'invalid-query' : 'load');
      const data = await response.json();
      if (request !== state.request) return;
      state.report = data;
      state.realtime = realtime?.available ? realtime : null;
      state.successfulQuery = {
        range: state.range,
        from: state.from,
        to: state.to,
        filters: { ...state.filters },
        back: state.back,
        excludeBots: state.excludeBots,
      };
      Object.values(state.tables).forEach((t) => (t.page = 0));
      render();
    } catch (error) {
      if (error.name === 'AbortError' || request !== state.request) return;
      if (state.successfulQuery) {
        Object.assign(state, {
          ...state.successfulQuery,
          filters: { ...state.successfulQuery.filters },
        });
        render();
      }
      $('analytics-error').textContent =
        error.message === 'invalid-query'
          ? '조회 조건을 확인해 주세요. 상세 필터와 봇 포함 조회는 최근 35일에 사용할 수 있습니다. 마지막 성공 조건으로 되돌렸습니다.'
          : (state.report
              ? '새 데이터를 불러오지 못해 마지막 성공 결과와 조건을 유지합니다.'
              : '데이터를 불러오지 못했습니다.') +
            ' 새로고침으로 다시 시도해 주세요.';
      $('analytics-error').hidden = false;
    } finally {
      if (request === state.request) {
        state.busy = false;
        syncBotToggle();
        root.classList.remove('is-loading');
        $('analytics-view').setAttribute('aria-busy', 'false');
        $('analytics-refresh').disabled = false;
        $('analytics-export').disabled = state.tab === 'bots' || !state.report;
        root
          .querySelectorAll('.analytics-filter-line select')
          .forEach(
            (s) => (s.disabled = state.report ? !state.report.detailed : false),
          );
      }
    }
  }
  function syncBotToggle() {
    const button = $('analytics-exclude-bots');
    button.setAttribute('aria-checked', String(state.excludeBots));
    button.disabled = state.busy || !state.report?.botFilter?.toggleAvailable;
    button.title = state.excludeBots ? '끄면 보관 중인 봇 분석 이벤트도 포함합니다.' : '켜면 봇으로 분류된 분석 이벤트를 제외합니다.';
  }
  function showLogin(forbidden) {
    root.hidden = true;
    $('auth-shell').hidden = false;
    $('auth-description').textContent = forbidden
      ? '관리자 권한이 필요합니다.'
      : '승인된 관리자 계정으로 로그인해 주세요.';
  }
  function applyFilter(type, value) {
    if (state.busy) return;
    if (value) state.filters[type] = value;
    else delete state.filters[type];
    load();
  }
  function hidePoint() {
    const tooltip = $('analytics-chart-tooltip');
    if (tooltip) tooltip.hidden = true;
    root.querySelectorAll('.is-active-point').forEach((node) => node.classList.remove('is-active-point'));
    root.querySelectorAll('[aria-describedby="analytics-chart-tooltip"]').forEach((node) => node.removeAttribute('aria-describedby'));
    activePoint = null;
    touchPoint = null;
  }
  function point(index, anchor, event) {
    const p = state.report?.trend[index];
    const tooltip = $('analytics-chart-tooltip');
    if (!p?.metrics || !tooltip || !anchor || state.busy) return;
    const prior = state.report.comparisonAvailable ? state.report.previousTrend?.[index] : null;
    const changed = activePoint?.anchor !== anchor || activePoint?.index !== index;
    if (changed || tooltip.hidden) {
      hidePoint();
      const metrics = [['visitors', '추정 방문자', '명'], ['views', '페이지뷰', '회']];
      if (state.lowerMetric !== 'views') metrics.push([state.lowerMetric, state.lowerMetric === 'sessions' ? '첫 유입 세션' : '주요 행동', '건']);
      const date = state.report.hourly ? `${state.report.from} · ${p.key}` : p.key;
      tooltip.innerHTML = `<strong class="analytics-tooltip-date">${esc(date)} <small>KST</small></strong>${prior?.metrics ? `<div class="analytics-tooltip-comparison">이전 ${esc(state.report.hourly ? `${state.report.previousFrom} · ${prior.key}` : prior.key)} 비교</div>` : ''}<div class="analytics-tooltip-values ${prior?.metrics ? 'has-comparison' : ''}">${prior?.metrics ? '<span></span><small>현재</small><small>이전</small>' : ''}${metrics.map(([key, title, unit]) => `<span>${title}</span><b>${num(p.metrics[key])}<small>${unit}</small></b>${prior?.metrics ? `<span class="analytics-tooltip-prior">${num(prior.metrics[key])}<small>${unit}</small></span>` : ''}`).join('')}</div>${state.report.hourly ? '' : `<small class="analytics-tooltip-hint">${touchInput || event?.pointerType === 'touch' ? '한 번 더 누르면 날짜별 상세' : '선택하면 날짜별 상세'}</small>`}`;
      anchor.setAttribute('aria-describedby', 'analytics-chart-tooltip');
      root.querySelectorAll(`[data-point="${index}"], [data-dot="${index}"]`).forEach((node) => node.classList.add('is-active-point'));
      tooltip.hidden = false;
    }
    activePoint = { index, anchor };
    if (changed) $('analytics-point-readout').textContent =
      `${p.key} · 추정 방문자 ${num(p.metrics.visitors)}명 · 페이지뷰 ${num(p.metrics.views)}회 · 세션 ${num(p.metrics.sessions)}건${prior?.metrics ? ` / 이전 방문자 ${num(prior.metrics.visitors)}명 · 조회 ${num(prior.metrics.views)}회` : ''}`;
    const dot = anchor.closest('.analytics-single-chart').querySelector(`[data-dot="${index}"]`).getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const x = event?.pointerType === 'mouse' ? event.clientX : dot.left + dot.width / 2;
    const y = event?.pointerType === 'mouse' ? event.clientY : dot.top;
    const left = Math.max(8, Math.min(x + 14, window.innerWidth - box.width - 8));
    const top = Math.max(8, Math.min(y - box.height - 14 >= 8 ? y - box.height - 14 : y + 18, window.innerHeight - box.height - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function selectDay(day) {
    if (state.busy || state.report.hourly) return;
    state.back = { range: state.range, from: state.from, to: state.to };
    state.range = 'custom';
    state.from = day;
    state.to = day;
    load();
  }
  function exportCsv() {
    if (state.busy || !state.report) return;
    const rows = [
        ['조회 시작', '조회 종료', '지표 기준'],
        [state.report.from, state.report.to, state.report.visitorDefinition],
        ['필터', JSON.stringify(state.report.filters)],
        ['봇 제외', state.report.botFilter?.excludeBots ? '켬' : '끔'],
        ['봇 분류 기준', state.report.botFilter?.note || '분류 정보 없음'],
        [],
      ],
      types = {
        acquisition: ['channel', 'source'],
        content: ['page', 'screen'],
        behavior: ['event'],
        audience: ['device', 'os', 'browser', 'country', 'city'],
      };
    if (types[state.tab])
      for (const type of types[state.tab]) {
        rows.push([
          specs[type][0],
          '항목 키',
          '일별 방문자 합계',
          '조회',
          '세션',
          '발생',
          '성공',
          '실패',
        ]);
        for (const r of tableRows(type))
          rows.push([
            label(type, r.key),
            r.key,
            r.metrics.visitors,
            r.metrics.views,
            r.metrics.sessions,
            r.metrics.events,
            state.report.detailed ? r.metrics.successes : '',
            state.report.detailed ? r.metrics.failures : '',
          ]);
        rows.push([]);
      }
    else if (state.tab === 'quality') {
      rows.push(['항목', '값']);
      for (const [key, value] of Object.entries(state.report.quality))
        rows.push([
          key,
          state.report.detailed ||
          (!key.endsWith('Sessions') &&
            key !== 'unknownPageViews' &&
            key !== 'duplicateStarts')
            ? value
            : '상세 기록 없음',
        ]);
      state.report.notices.forEach((n) => rows.push(['해석 기준', n]));
    } else {
      rows.push([
        '날짜/시간',
        '추정 방문자',
        '조회',
        '첫 유입 세션',
        '주요 행동',
      ]);
      state.report.trend.forEach((p) =>
        rows.push([
          p.key,
          ...['visitors', 'views', 'sessions', 'keyEvents'].map(
            (k) => p.metrics?.[k] ?? '',
          ),
        ]),
      );
    }
    const cell = (v) => {
        let s = String(v ?? '');
        if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
        return `"${s.replaceAll('"', '""')}"`;
      },
      blob = new Blob(
        ['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')],
        { type: 'text/csv;charset=utf-8' },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `서비스-이용분석-${state.report.from}-${state.report.to}-${state.tab}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button,[data-day]');
    if (!b) return;
    if (b.hasAttribute('data-point') && touchInput && touchPoint !== b) {
      point(Number(b.dataset.point), b, { pointerType: 'touch' });
      touchPoint = b;
      return;
    }
    if (b.dataset.tab) {
      const leavingBots = state.tab === 'bots' && b.dataset.tab !== 'bots';
      if (leavingBots) window.OriginBotAnalytics?.cancel();
      state.tab = b.dataset.tab;
      if (leavingBots) load(); else renderView();
    } else if (b.dataset.range) {
      if (b.dataset.range === 'custom') {
        $('analytics-custom-range').hidden = !$('analytics-custom-range')
          .hidden;
        return;
      }
      state.range = b.dataset.range;
      state.back = null;
      load();
    } else if (b.dataset.filter) applyFilter(b.dataset.filter, b.dataset.value);
    else if (b.dataset.remove) applyFilter(b.dataset.remove, '');
    else if (b.dataset.day) selectDay(b.dataset.day);
    else if (b.dataset.page) {
      const type = b.dataset.page;
      state.tables[type] ??= { search: '', sort: 'metric', page: 0 };
      state.tables[type].page = Number(b.dataset.value);
      renderView();
    } else if (b.id === 'analytics-back') {
      Object.assign(state, state.back);
      state.back = null;
      load();
    } else if (b.id === 'analytics-reset') {
      state.filters = {};
      state.excludeBots = true;
      load();
    } else if (b.id === 'analytics-exclude-bots' && !state.busy) {
      state.excludeBots = !state.excludeBots;
      load();
    } else if (b.id === 'analytics-refresh') load();
    else if (b.id === 'analytics-export') exportCsv();
  });
  root.addEventListener('change', (e) => {
    if (e.target.id.startsWith('filter-'))
      applyFilter(e.target.id.slice(7), e.target.value);
    if (e.target.dataset.sort) {
      const type = e.target.dataset.sort;
      state.tables[type] ??= { search: '', sort: 'metric', page: 0 };
      state.tables[type].sort = e.target.value;
      state.tables[type].page = 0;
      renderView();
    }
    if (e.target.id === 'analytics-lower-metric') {
      state.lowerMetric = e.target.value;
      renderView();
    }
  });
  root.addEventListener('input', (e) => {
    if (!e.target.dataset.search) return;
    const type = e.target.dataset.search,
      pos = e.target.selectionStart;
    state.tables[type] ??= { search: '', sort: 'metric', page: 0 };
    state.tables[type].search = e.target.value;
    state.tables[type].page = 0;
    renderView();
    const input = root.querySelector(`[data-search="${type}"]`);
    input.focus();
    input.setSelectionRange(pos, pos);
  });
  root.addEventListener('pointerover', (e) => {
    const p = e.target.closest('[data-point]');
    if (p && e.pointerType !== 'touch') point(Number(p.dataset.point), p, e);
  });
  root.addEventListener('pointermove', (e) => {
    const p = e.target.closest('[data-point]');
    if (p && e.pointerType !== 'touch') point(Number(p.dataset.point), p, e);
  });
  root.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'touch' && e.target.closest('[data-point]') && !e.relatedTarget?.closest?.('[data-point]')) hidePoint();
  });
  root.addEventListener('focusin', (e) => {
    if (e.target.hasAttribute('data-point')) point(Number(e.target.dataset.point), e.target);
  });
  root.addEventListener('focusout', (e) => {
    if (e.target.hasAttribute('data-point')) hidePoint();
  });
  root.addEventListener('keydown', (e) => {
    touchInput = false;
    if (e.key === 'Escape') hidePoint();
    if (e.target.dataset.day && ['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      selectDay(e.target.dataset.day);
    }
  });
  document.addEventListener('pointerdown', (e) => {
    touchInput = e.pointerType === 'touch';
    if (!e.target.closest('[data-point]')) hidePoint();
  });
  window.addEventListener('scroll', hidePoint, { capture: true, passive: true });
  window.addEventListener('resize', hidePoint, { passive: true });
  $('analytics-custom-range').addEventListener('submit', (e) => {
    e.preventDefault();
    state.range = 'custom';
    state.from = $('analytics-from').value;
    state.to = $('analytics-to').value;
    state.back = null;
    load();
  });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
  }).format(new Date());
  $('analytics-from').max = today;
  $('analytics-to').max = today;
  fetch('https://api.geupddong.com/api/v1/auth/me', { credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return showLogin(r.status === 403);
      const p = await r.json();
      if (!p.roles?.includes('ADMIN')) return showLogin(true);
      load();
    })
    .catch(() => showLogin(false));
})();
