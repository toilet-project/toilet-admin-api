// Runs the actual dashboard against AnalyticsPreviewServer's real SQL and disposable events.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.ANALYTICS_PREVIEW_ORIGIN || 'http://127.0.0.1:8187';
const screenshotDir = process.env.SERVICE_ANALYTICS_SCREENSHOT_DIR;
const endpoint = '/api/admin/v1/service-analytics/explore';
const ready = page => page.waitForFunction(() => document.querySelector('#analytics-view').getAttribute('aria-busy') === 'false' && document.querySelectorAll('#analytics-kpis article').length === 5);

(async () => {
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL === 'bundled' ? {} : { channel: 'chrome' }), headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1720, height: 1120 }, acceptDownloads: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/service-analytics.html'); await ready(page);
    assert.equal(await page.locator('.analytics-single-chart').count(), 2);
    const api = await (await context.request.get(origin + endpoint + '?range=7d')).json();
    assert(api.current.views > api.current.visitors);
    assert.equal(api.trend.length, 7);
    assert.equal(api.comparisonAvailable, true);
    const toggle=page.getByRole('switch',{name:'봇 제외'});
    assert.equal(await toggle.getAttribute('aria-checked'),'true');
    assert(api.botFilter.botEvents>0);
    const includeResponse=page.waitForResponse(r=>r.url().includes(endpoint)&&new URL(r.url()).searchParams.get('excludeBots')==='false');
    await toggle.click();
    const included=await (await includeResponse).json();await ready(page);
    assert(included.current.views>api.current.views,'retained bot events are included only when off');
    assert.equal(await toggle.getAttribute('aria-checked'),'false');
    await toggle.focus();await page.keyboard.press('Space');await ready(page);
    assert.equal(await toggle.getAttribute('aria-checked'),'true');
    const view = async tab => { await page.locator(`.analytics-tabs [data-tab="${tab}"]`).click(); };
    const screenshot = async name => { if (screenshotDir) { fs.mkdirSync(screenshotDir, { recursive: true }); await page.screenshot({ path: path.join(screenshotDir, name + '.png'), fullPage: true }); } };
    const tooltip = page.locator('#analytics-chart-tooltip');
    const hoverPoint = page.locator('.analytics-single-chart').first().locator('[data-point="1"]');
    await hoverPoint.hover();
    assert.equal(await tooltip.isVisible(), true);
    assert.match(await tooltip.innerText(), new RegExp(api.trend[1].key));
    assert.match(await tooltip.innerText(), /추정 방문자/);
    assert.match(await tooltip.innerText(), /페이지뷰/);
    assert.match(await tooltip.innerText(), /이전/);
    assert.equal(await page.locator('rect.is-active-point').count(), 2);
    assert.equal(await hoverPoint.locator('title').count(), 0);
    const regions = await page.locator('.analytics-single-chart').first().locator('[data-point]').evaluateAll(nodes => nodes.map(node => ({ x: Number(node.getAttribute('x')), width: Number(node.getAttribute('width')) })));
    assert(Math.abs(regions[0].x + regions[0].width - regions[1].x) < 0.001, 'no hover gaps');
    if (screenshotDir) { fs.mkdirSync(screenshotDir, { recursive: true }); await page.screenshot({ path: path.join(screenshotDir, 'analytics-tooltip-desktop.png') }); }
    await page.mouse.move(0, 0); assert.equal(await tooltip.isVisible(), false);
    await hoverPoint.focus(); assert.equal(await tooltip.isVisible(), true);
    await page.keyboard.press('Escape'); assert.equal(await tooltip.isVisible(), false);
    await page.locator('#analytics-lower-metric').selectOption('sessions');
    await page.locator('.analytics-single-chart').last().locator('[data-point="1"]').hover();
    assert.match(await tooltip.innerText(), /첫 유입 세션/);
    await page.locator('#analytics-lower-metric').selectOption('views');
    await screenshot('analytics-overview-desktop');
    await view('acquisition');
    const sourceTable = page.locator('[data-table="source"]');
    assert.match(await sourceTable.locator('tbody tr').last().innerText(), /직접 접속·확인 불가/);
    const sourceResponse = page.waitForResponse(r => r.url().includes(endpoint) && new URL(r.url()).searchParams.get('source') === 'naver');
    await sourceTable.getByRole('button', { name: 'Naver', exact: true }).click();
    const filtered = await (await sourceResponse).json(); await ready(page);
    assert.equal(filtered.filters.source, 'naver'); assert(filtered.current.views < api.current.views);
    assert.equal(await page.locator('#filter-source').inputValue(), 'naver');
    await page.locator('#filter-device').selectOption('mobile'); await ready(page);
    await view('content');
    const detail = page.locator('[data-table="page"] [data-value="/toilet/:id"]');
    await detail.click(); await ready(page);
    assert.equal(await page.locator('#analytics-filter-chips button').count(), 3);
    await screenshot('analytics-content-filtered');
    await page.locator('#analytics-reset').click(); await ready(page);
    await view('behavior');
    assert.equal(await page.locator('.analytics-flow').count(), 3);
    await screenshot('analytics-behavior');
    await view('audience');
    const cities = page.locator('[data-table="city"]');
    assert.equal(await cities.locator('tbody tr').count(), 15);
    await cities.getByRole('button', { name: '다음', exact: true }).click();
    assert.match(await cities.locator('.analytics-table-footer').innerText(), /2 \/ 2/);
    await cities.locator('[data-search]').fill('검증 도시 21');
    assert.equal(await cities.locator('tbody tr').count(), 1);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#analytics-export').click();
    const download = await downloadPromise;
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert(csv.includes('검증 도시 21')); assert(csv.includes('일별 방문자 합계'));
    assert(csv.includes('봇 제외'));assert(csv.includes('봇 분류 기준'));
    await view('quality'); await screenshot('analytics-quality');
    await view('bots');
    await page.getByText('미니 PC 봇 접근 수집기가 아직 연결되지 않았습니다. 0건을 뜻하지 않습니다.').waitFor();
    assert.equal(await page.locator('#analytics-kpis').isVisible(), false);
    assert.equal(await page.locator('.analytics-filter-line').isVisible(), false);
    assert.equal(await page.locator('#analytics-export').isDisabled(), true);
    assert.equal(await toggle.isVisible(),false);
    const botDay = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
    const botAt = `${botDay}T02:00:00Z`;
    await context.route('**/api/admin/v1/service-analytics/origin-bots?*', route => route.fulfill({json:{
      status:'OK',message:'합성 봇 데이터 · 실제 서버 접근 내역이 아닙니다.',from:botDay,to:botDay,
      generatedAt:new Date().toISOString(),partial:true,rows:[
        {day:botDay,hour:botAt,bot:'Googlebot',verification:'verified',path:'toilets_api',status:2,count:21,first:botAt,last:botAt},
        {day:botDay,hour:botAt,bot:'Naver Yeti',verification:'declared',path:'sitemap',status:4,count:23,first:botAt,last:botAt},
        {day:botDay,hour:botAt,bot:'Bingbot',verification:'unmatched',path:'other',status:2,count:2,first:botAt,last:botAt}
      ]}}));
    await page.locator('#analytics-refresh').click();
    await page.locator('#origin-bot-name').waitFor();
    assert.match(await page.locator('#analytics-view').innerText(), /공식 IP 확인/);
    assert.match(await page.locator('#analytics-view').innerText(), /부분 기록/);
    await screenshot('analytics-origin-bots-synthetic');
    await page.locator('#origin-bot-name').selectOption('Naver Yeti');
    assert.equal(await page.locator('[data-origin-bot]').count(),1);
    assert.match(await page.locator('#analytics-view table').first().innerText(),/이름만 확인/);
    await page.locator('#origin-bot-check').selectOption('verified');
    assert.equal(await page.locator('[data-origin-bot]').count(),0);
    await context.unroute('**/api/admin/v1/service-analytics/origin-bots?*');
    await view('overview');
    await ready(page);
    const firstDay = page.locator('.analytics-single-chart [data-day]').first();
    const selectedDay = await firstDay.getAttribute('data-day'); await firstDay.click(); await ready(page);
    assert((await page.locator('#analytics-range-note').innerText()).includes(selectedDay));
    assert.equal(await page.locator('.analytics-single-chart').first().getByRole('button').count(), 24);
    await page.locator('#analytics-back').click(); await ready(page);
    assert.equal(await page.locator('[data-range="7d"]').getAttribute('aria-pressed'), 'true');
    // A failed filter must keep both the previous data and its matching controls.
    await page.route('**/service-analytics/explore?**', route => route.fulfill({ status: 503, json: {} }));
    await page.locator('#filter-device').selectOption('tablet');
    await page.locator('#analytics-error:not([hidden])').waitFor(); await ready(page);
    assert.equal(await page.locator('#filter-device').inputValue(), '');
    await toggle.click();await ready(page);
    assert.equal(await toggle.getAttribute('aria-checked'),'true','failed query rolls bot mode back with matching result');
    await page.unroute('**/service-analytics/explore?**');
    await page.locator('#analytics-refresh').click(); await ready(page);
    // Empty filtered results are not errors, and controls remain usable.
    await page.locator('#filter-device').selectOption('tablet'); await ready(page);
    await view('acquisition'); assert.match(await page.locator('#analytics-view').innerText(), /조건에 해당하는 기록이 없습니다/);
    await page.locator('#analytics-reset').click(); await ready(page);
    // Future hours remain blank, not fake zero activity.
    await view('overview'); await page.locator('[data-range="today"]').click(); await ready(page);
    const today = await (await context.request.get(origin + endpoint + '?range=today')).json();
    assert.equal(today.hourly, true); assert.equal(today.trend.length, 24);
    await screenshot('analytics-today');
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 960 });
      for (const tab of ['overview', 'acquisition', 'content', 'behavior', 'audience', 'quality']) {
        await view(tab);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow ${width} ${tab}`);
      }
      await view('overview'); await screenshot('analytics-overview-' + width);
    }
    assert.deepEqual(errors, []);
    // Touch first reveals values without navigating; a second tap retains date drilldown.
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 960 }, isMobile: true, hasTouch: true });
    await touchContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const touchPage = await touchContext.newPage();
    await touchPage.goto(origin + '/service-analytics.html'); await ready(touchPage);
    const touchTarget = touchPage.locator('.analytics-single-chart').first().locator('[data-point="6"]');
    await touchTarget.tap();
    const touchTip = touchPage.locator('#analytics-chart-tooltip');
    assert.equal(await touchTip.isVisible(), true);
    assert.equal(await touchPage.locator('[data-range="7d"]').getAttribute('aria-pressed'), 'true');
    assert.match(await touchTip.innerText(), /한 번 더 누르면/);
    const tipBox = await touchTip.boundingBox();
    assert(tipBox.x >= 0 && tipBox.x + tipBox.width <= 390 && tipBox.y >= 0 && tipBox.y + tipBox.height <= 960, 'tooltip stays inside mobile viewport');
    if (screenshotDir) await touchPage.screenshot({ path: path.join(screenshotDir, 'analytics-tooltip-mobile.png') });
    await touchPage.getByRole('heading', { name: '서비스 이용 분석', exact: true }).tap(); assert.equal(await touchTip.isVisible(), false);
    await touchTarget.tap(); await touchTarget.tap(); await ready(touchPage);
    assert.equal(await touchPage.locator('.analytics-single-chart').first().getByRole('button').count(), today.trend.filter(point => point.metrics).length);
    await touchContext.close();
    assert.equal((await context.request.post(origin + endpoint)).status(), 405);
    assert.equal((await context.request.get(origin + endpoint + '?range=custom&from=2099-01-01&to=2099-01-02')).status(), 400);
    console.log('PASS actual SQL dashboard: independent charts, source/device/page filters, pagination, search, CSV, ordered flows, day drilldown, empty/error state, 4 viewport widths, read-only preview.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
