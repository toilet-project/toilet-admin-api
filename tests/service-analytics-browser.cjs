// Synthetic browser acceptance. It never calls production APIs or writes business data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../src/main/resources/static');
const summary = { activeUsers: 1284, newUsers: 741, sessions: 1762, views: 4298, engagedSessions: 1289, keyEvents: 186, engagementRate: .7316, averageEngagementSeconds: 154 };
const dimension = (key, activeUsers, views = 0, sessions = 0, eventCount = 0, keyEvents = 0, detail = '') => ({ key, label: key, detail, activeUsers, views, sessions, eventCount, keyEvents, averageEngagementSeconds: 138 });
const report = {
  available: true, status: 'UP', range: '7d', fetchedAt: '2026-09-15T13:10:00Z', lastSuccessfulAt: '2026-09-15T13:10:00Z', stale: false,
  message: '급똥 서버에서 직접 집계한 이용 현황입니다.',
  data: {
    current: summary, previous: { ...summary, activeUsers: 1181 }, activeUsersChangePercent: 8.7,
    realtime: { activeUsers: 42, views: 116, events: 388, keyEvents: 9 },
    trend: [
      ['2026-09-09', 144, 482], ['2026-09-10', 157, 511], ['2026-09-11', 166, 548], ['2026-09-12', 172, 591],
      ['2026-09-13', 188, 624], ['2026-09-14', 207, 698], ['2026-09-15', 250, 844],
    ].map(([date, activeUsers, views]) => ({ date, activeUsers, newUsers: Math.round(activeUsers * .58), sessions: Math.round(activeUsers * 1.35), views, keyEvents: Math.round(activeUsers * .14) })),
    pages: [dimension('/', 702, 2184, 0, 0, 61, '/'), dimension('/policies/privacy', 184, 522, 0, 0, 2, '/policies/privacy'), dimension('/toilet/:id', 172, 491, 0, 0, 18, '/toilet/:id')],
    channels: [dimension('Organic Search', 583, 0, 801, 0, 69), dimension('Direct', 394, 0, 542, 0, 61), dimension('Referral', 192, 0, 274, 0, 34), dimension('Organic Social', 115, 0, 145, 0, 22)],
    sources: [dimension('google / organic', 428, 0, 612), dimension('naver / organic', 311, 0, 443), dimension('(direct) / (none)', 304, 0, 417)],
    devices: [dimension('mobile', 872, 0, 1194), dimension('desktop', 358, 0, 491), dimension('tablet', 54, 0, 77)],
    operatingSystems: [dimension('Android', 566), dimension('iOS', 337), dimension('Windows', 291), dimension('Macintosh', 90)],
    browsers: [dimension('Chrome', 711), dimension('Safari', 344), dimension('Samsung Internet', 151), dimension('Edge', 78)],
    countries: [dimension('South Korea', 1197), dimension('United States', 42), dimension('Japan', 26)],
    cities: [dimension('Seoul', 562), dimension('Daejeon', 188), dimension('Busan', 164), dimension('Suwon', 117)],
    events: [dimension('page_view', 901, 0, 0, 4298, 0), dimension('toilet_marker_select', 512, 0, 0, 936, 0), dimension('toilet_search', 346, 0, 0, 603, 0), dimension('report_submit', 82, 0, 0, 91, 91)],
  },
};
const realtime = { available: true, status: 'UP', fetchedAt: report.fetchedAt, lastSuccessfulAt: report.lastSuccessfulAt, stale: false, message: '최근 30분 실시간 집계입니다.', data: report.data.realtime };
const health = { configured: true, status: 'UP', checkedAt: report.fetchedAt, lastAttemptAt: report.fetchedAt, lastSuccessfulAt: report.lastSuccessfulAt, nextScheduledAt: '2026-09-16T17:30:00Z', message: '개별 이벤트는 35일 보관하고 최근 14일을 매일 02:30에 다시 집계합니다.', rawEventRetentionDays: 35, correctionWindowDays: 14 };

function staticServer() {
  return http.createServer((request, response) => {
    const file = path.resolve(root, `.${new URL(request.url, 'http://local').pathname}`);
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return response.writeHead(404).end();
      response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(data);
    });
  });
}

(async () => {
  const server = staticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const target of ['detail', 'home']) {
      const context = await browser.newContext({ viewport: { width: 1720, height: 980 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/v1/auth/me') return route.fulfill({ json: { roles: ['ADMIN'], nickname: '운영자 A' } });
        if (url.pathname.endsWith('/service-analytics/overview') || url.pathname.endsWith('/service-analytics/trend')) return route.fulfill({ json: report });
        if (url.pathname.endsWith('/service-analytics/realtime')) return route.fulfill({ json: realtime });
        if (url.pathname.endsWith('/service-analytics/collection-status')) return route.fulfill({ json: health });
        if (url.pathname.endsWith('/operations/status')) return route.fulfill({ json: { admin: { status: 'UP' }, publicApi: { status: 'UP' }, database: { status: 'UP' }, disk: { status: 'UP', usedPercent: 41 }, batch: { status: 'UP', completedAt: report.fetchedAt } } });
        if (url.pathname.endsWith('/cloudflare/usage')) return route.fulfill({ json: { available: true, planLabel: 'Workers Paid', checkedAt: report.fetchedAt, usagePeriodStart: '2026-08-29', usagePeriodEnd: '2026-09-28', message: '모든 항목이 예시 한도의 80% 미만입니다.', workersRequests: { used: 18420, limit: 10000000, usedPercent: .18 }, d1RowsRead: { used: 620000, limit: 25000000000, usedPercent: 0 }, r2StorageBytes: { used: 800000000, limit: 10000000000, usedPercent: 8 } } });
        if (url.pathname.endsWith('/reports/summary')) return route.fulfill({ json: { pendingCount: 12, overdueCount: 3, recentReports: [] } });
        if (url.pathname.includes('/duplicate-coordinates')) return route.fulfill({ json: { items: [], page: 0, totalElements: 18, totalPages: 3 } });
        if (url.pathname.endsWith('/regions')) return route.fulfill({ json: { items: [], page: 0, totalElements: 7, totalPages: 1 } });
        if (url.pathname.endsWith('/dashboard')) return route.fulfill({ json: { from: '2026-09-09', to: '2026-09-15', batch: { successfulRuns: 7, failedRuns: 0, insertedRecords: 706, updatedRecords: 2058, totalToiletCount: 54281, lastSuccessAt: report.fetchedAt, lastSuccessDurationSeconds: 734 }, dailySummaries: [], recentExecutions: [] } });
        return url.origin === origin ? route.continue() : route.abort();
      });
      await page.goto(`${origin}/${target === 'detail' ? 'service-analytics.html' : 'index.html'}`);
      await page.locator(target === 'detail' ? '#analytics-kpi-active' : '#analytics-active-users').filter({ hasText: '1,284' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      if (process.env.SERVICE_ANALYTICS_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SERVICE_ANALYTICS_SCREENSHOT_DIR, `service-analytics-${target}.png`), fullPage: true });
      console.log(`PASS analytics ${target} (synthetic aggregate API only)`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
