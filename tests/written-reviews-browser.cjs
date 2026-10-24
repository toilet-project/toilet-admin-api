// Disposable local acceptance: synthetic review data only; no business-data writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../src/main/resources/static');
const first = { id:'review-a', toiletId:42, toiletName:'서울역 <화장실>', toiletVisibility:'VISIBLE', satisfaction:5, cleanliness:4, paper:true, waitMinutes:10, authorDisplayName:'<운영자 아님>', authorRemoved:false, createdAt:'2026-10-24T19:00:00+09:00', updatedAt:'2026-10-24T19:01:00+09:00', hasComment:true };
const second = { ...first, id:'review-b', toiletId:43, toiletName:'숨김 화장실', toiletVisibility:'HIDDEN_DUPLICATE', satisfaction:3, cleanliness:2, paper:false, waitMinutes:0, authorDisplayName:'탈퇴한 사용자', authorRemoved:true, createdAt:'2026-10-23T14:00:00+09:00', updatedAt:'2026-10-23T14:00:00+09:00', hasComment:false };
const next = { ...first, id:'review-c', toiletName:'이전 페이지 화장실', createdAt:'2026-10-22T10:00:00+09:00', updatedAt:'2026-10-22T10:00:00+09:00' };
const pageItems = [first,second,...Array.from({length:8},(_,index)=>({...second,id:`review-extra-${index}`,toiletName:`검사 화장실 ${index+1}`}))];
const moderation = {reviewKey:'11111111-2222-4333-8444-555555555555',version:3,moderationPolicyVersion:'review-moderation-v1'};
const comment = '첫 줄 <img src=x onerror="window.reviewXss=1">\n두 번째 줄 & 전체 후기';
const metrics={visitors:12,sessions:15,views:20,events:30,keyEvents:2,engagementSeconds:40,emptyResults:0};
const trafficReport={generatedAt:'2026-10-24T12:00:00Z',from:'2026-10-18',to:'2026-10-24',previousFrom:'2026-10-11',previousTo:'2026-10-17',comparisonAvailable:true,comparisonNote:'비교 가능',visitorDefinition:'일별 추정 방문자 합계',detailed:true,hourly:false,current:metrics,previous:metrics,trend:[],previousTrend:[],dimensions:{page:[],source:[],country:[],client:[]},quality:{unattributedSessions:0},notices:[],botFilter:{excludeBots:true,toggleAvailable:true,note:'봇 제외'}};
const json = (route, value, status=200) => route.fulfill({ status, json:value, headers:{'Cache-Control':'private, no-store'} });
async function held(get) { const deadline=Date.now()+5000; while (!get()) { if (Date.now()>deadline) throw new Error('Deferred review request did not start'); await new Promise(resolve=>setTimeout(resolve,10)); } }

(async () => {
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return response.writeHead(404).end();
      response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
  let browser;
  try {
    browser = await chromium.launch({ headless:true, ...(channel ? {channel} : {}) });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport:{width,height:1100} });
      // Simulate an already-dispatched transport that does not honor abort; page disposal must still ignore it.
      await context.addInitScript(()=>{
        const original=window.fetch.bind(window);window.trafficCompletions=0;
        window.fetch=(input,options)=>{
          const url=new URL(typeof input==='string'?input:input.url,location.href);
          if (!url.pathname.endsWith('/service-analytics/explore')) return original(input,options);
          return original(input,{...options,signal:undefined}).then(response=>{window.trafficCompletions++;return response;});
        };
      });
      const page = await context.newPage(), errors = [], requests = [];
      let mode = 'ready', detailMode = 'ready', trafficMode = 'failure', holdDetail, holdList, holdTraffic;
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/api/v1/auth/me') return json(route, { roles:['ADMIN'],nickname:'테스트 운영자' });
        if (url.pathname.startsWith('/api/admin/v1/reviews')) {
          requests.push({path:url.pathname,query:url.search,method:request.method(),headers:request.headers()});
          if (url.pathname === '/api/admin/v1/reviews') {
            if (mode === 'hold') { holdList = route; return; }
            if (mode === 'failure') { mode='ready';return json(route,{},503); }
            if (mode === 'empty') return json(route,{items:[],hasMore:false,nextCursor:null});
            if (mode === 'auth') return json(route,{},401);
            if (url.searchParams.has('cursor')) { assert.equal(url.searchParams.get('cursor'),'cursor:page2');return json(route,{items:[next],hasMore:false,nextCursor:null}); }
            assert.deepEqual([...url.searchParams.keys()],['size']);
            assert.equal(url.searchParams.get('size'),'10');
            return json(route,{items:pageItems,hasMore:true,nextCursor:'cursor:page2'});
          }
          if (detailMode === 'hold') { holdDetail=route; return; }
          if (detailMode === 'failure') { detailMode='ready';return json(route,{},503); }
          if (detailMode === 'missing') return json(route,{},404);
          if (detailMode === 'forbidden') return json(route,{},403);
          const item = url.pathname.endsWith('/review-b') ? second : first;
          return json(route,{...item,...moderation,comment:item.hasComment?comment:''});
        }
        if (url.pathname.endsWith('/service-analytics/explore') && trafficMode === 'hold') { holdTraffic=route;return; }
        if (url.pathname.includes('/service-analytics/')) return json(route,{},503);
        return url.origin === origin ? route.continue() : route.abort();
      });
      await page.goto(`${origin}/service-analytics.html?tab=reviews`);
      await page.locator('.written-review-row').first().waitFor();
      assert.equal(await page.locator('.analytics-controls').isVisible(),false);
      assert.equal(await page.locator('#analytics-kpis').isVisible(),false);
      assert.equal(await page.locator('.analytics-definitions').isVisible(),false);
      assert.equal(await page.locator('[data-tab="reviews"]').getAttribute('aria-current'),'page');
      assert.equal(await page.locator('[data-tab="reviews"]').evaluate(node=>{const b=node.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth;}),true);
      assert.match(await page.locator('.written-review-row').first().innerText(),/서울역 <화장실>[\s\S]*4\.5/);
      assert.equal(await page.locator('.written-review-row').count(),10);
      assert.equal(await page.locator('.written-review-row small').count(),0);
      assert.ok((await page.locator('.written-review-row').first().boundingBox()).height<=48);
      assert.equal(requests.filter(r=>r.path !== '/api/admin/v1/reviews').length,0);
      await page.locator('.written-review-row').first().focus(); await page.keyboard.press('Enter');
      await page.locator('.written-review-comment').waitFor();
      assert.equal(await page.locator('.written-review-comment').innerText(),comment);
      assert.equal(await page.locator('.written-review-comment img').count(),0);
      assert.equal(await page.evaluate(()=>window.reviewXss),undefined);
      assert.equal(await page.locator('.written-review-row').first().getAttribute('aria-expanded'),'true');
      assert.match(await page.locator('.written-review-facts').innerText(),/대기 시간[\s\S]*10분/);
      assert.equal(await page.locator('.written-review-detail a').getAttribute('href'),'https://geupddong.com/toilet/42');
      if (process.env.WRITTEN_REVIEWS_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.WRITTEN_REVIEWS_SCREENSHOT_DIR,`written-reviews-${width}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
      await page.locator('.written-review-row').nth(1).click();
      await page.locator('.written-review-comment').filter({hasText:'작성된 본문이 없습니다.'}).waitFor();
      assert.equal(await page.locator('.written-review-detail a:visible').count(),0);
      await page.locator('[data-reviews-page="next"]').click();
      await page.getByText('이전 페이지 화장실',{exact:true}).waitFor();
      assert.equal(await page.locator('[data-reviews-page="next"]').isDisabled(),true);
      await page.locator('[data-reviews-page="previous"]').click();
      await page.getByText('서울역 <화장실>',{exact:true}).waitFor();

      detailMode='failure'; await page.locator('.written-review-row').first().click();
      await page.locator('[data-review-detail-retry]').click(); await page.locator('.written-review-comment').waitFor();
      await page.locator('.written-review-row').first().click();
      detailMode='missing'; await page.locator('.written-review-row').first().click();
      await page.getByText('삭제되었거나 더 이상 확인할 수 없는 리뷰입니다.').waitFor();
      detailMode='ready'; await page.locator('[data-reviews-first]').click(); await page.locator('.written-review-row').first().waitFor();

      detailMode='hold'; await page.locator('.written-review-row').first().click();
      await held(()=>holdDetail);
      detailMode='ready'; await page.locator('.written-review-row').nth(1).click();
      await page.getByText('작성된 본문이 없습니다.').waitFor();
      if (holdDetail) await json(holdDetail,{...first,comment:'오래된 상세 응답'}).catch(()=>{});
      assert.equal(await page.getByText('오래된 상세 응답').count(),0);

      mode='failure'; await page.locator('.admin-topbar #refresh').click();
      await page.getByText('리뷰를 불러오지 못했습니다.',{exact:true}).waitFor();
      assert.equal(await page.getByText('아직 작성된 리뷰가 없습니다.').count(),0);
      await page.locator('[data-reviews-retry]').click(); await page.locator('.written-review-row').first().waitFor();
      mode='hold'; await page.locator('.admin-topbar #refresh').click();
      await page.getByText('작성된 리뷰를 불러오고 있습니다.').waitFor();
      await held(()=>holdList);
      await page.locator('[data-tab="bots"]').click();
      if (holdList) await json(holdList,{items:[first],hasMore:false,nextCursor:null}).catch(()=>{});
      assert.equal(await page.locator('.written-review-row').count(),0);
      mode='empty'; await page.locator('[data-tab="reviews"]').click();
      await page.getByText('아직 작성된 리뷰가 없습니다.').waitFor();
      mode='ready'; await page.locator('.admin-topbar #refresh').click(); await page.locator('.written-review-row').first().waitFor();
      mode='hold'; holdList=null; await page.locator('.admin-topbar #refresh').click(); await held(()=>holdList);
      await page.evaluate(()=>window.AdminNavigation.go('/features.html'));
      assert.equal(await page.locator('main[data-admin-page="features"]').isVisible(),true);
      await json(holdList,{},401).catch(()=>{});
      assert.equal(await page.evaluate(()=>AdminAuth.getState().status),'authenticated');
      mode='ready'; const beforeReturn=requests.length;
      await page.evaluate(()=>window.AdminNavigation.go('/service-analytics.html?tab=reviews'));
      await page.locator('.written-review-row').first().waitFor();
      assert.equal(requests.length,beforeReturn+1);
      for (const status of [200,401]) {
        await page.evaluate(()=>window.AdminNavigation.go('/features.html'));
        holdTraffic=null;trafficMode='hold';
        await page.evaluate(()=>window.AdminNavigation.go('/service-analytics.html'));
        await held(()=>holdTraffic);
        await page.evaluate(()=>window.AdminNavigation.go('/features.html'));
        await page.evaluate(()=>window.AdminNavigation.go('/service-analytics.html?tab=reviews'));
        await page.locator('.written-review-row').first().waitFor();
        const completions=await page.evaluate(()=>window.trafficCompletions);
        await json(holdTraffic,status===200?trafficReport:{},status);
        await page.waitForFunction(count=>window.trafficCompletions>count,completions);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await page.locator('.written-review-row').count(),10);
        assert.equal(await page.locator('[data-tab="reviews"]').getAttribute('aria-current'),'page');
        assert.equal(await page.locator('#analytics-error').isVisible(),false);
        assert.equal(await page.evaluate(()=>AdminAuth.getState().status),'authenticated');
      }
      detailMode='forbidden'; await page.locator('.written-review-row').first().click();
      await page.locator('#auth-title').filter({hasText:'관리자 권한이 필요합니다'}).waitFor();
      assert.equal(await page.locator('#analytics-shell').isVisible(),false);
      assert.equal(await page.locator('.written-review-row').count(),0);
      detailMode='ready'; mode='auth'; await page.reload();
      await page.locator('#auth-title').filter({hasText:'관리자 로그인'}).waitFor();
      assert.equal(await page.locator('#analytics-shell').isVisible(),false);
      assert.equal(await page.locator('.written-review-row').count(),0);
      assert.equal(requests.some(r=>r.method!=='GET'),false);
      assert.deepEqual(errors,[]);
      console.log(`PASS written reviews ${width}px: pagination, full text, escaping, stale responses, retry, empty, auth`);
      await context.close();
    }
    // Every destructive request below is intercepted locally and uses disposable fixtures only.
    for (const scenario of ['ready','preview','legacy','policy','changed','busy','already','unknown','auth','forbidden','late','late-auth','late-tab']) {
      const context=await browser.newContext({viewport:{width:scenario==='ready'?390:1440,height:1100}});
      if(scenario==='preview')await context.addInitScript(()=>{window.AdminWrittenReviewsPreview=Object.freeze({readOnly:true,moderationAllowed:false});});
      const page=await context.newPage(),writes=[],errors=[];let deleted=false,version=3,holdDelete,holdTraffic;
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.pathname==='/api/v1/auth/me')return json(route,{roles:['ADMIN']});
        if(url.pathname==='/api/admin/v1/reviews')return json(route,{items:deleted?[second]:[first,second],hasMore:false,nextCursor:null});
        if(url.pathname==='/api/admin/v1/reviews/review-a' && request.method()==='GET')return json(route,{...first,...(['preview','legacy'].includes(scenario)?{}:{...moderation,version,...(scenario==='policy'?{moderationPolicyVersion:'outdated'}:{})}),comment});
        if(url.pathname==='/api/admin/v1/reviews/review-a' && request.method()==='DELETE') {
          writes.push(request.postDataJSON());
          if(['ready','late','late-auth','late-tab'].includes(scenario)){holdDelete=route;return;}
          if(scenario==='changed'){version=4;return json(route,{error:{code:'REVIEW_CHANGED'}},409);}
          if(scenario==='busy')return json(route,{error:{code:'REVIEW_BUSY'}},409);
          if(scenario==='already'){deleted=true;return json(route,{error:{code:'REVIEW_NOT_FOUND'}},404);}
          if(scenario==='unknown'){deleted=true;return json(route,{},503);}
          if(scenario==='auth')return json(route,{},401);
          if(scenario==='forbidden')return json(route,{},403);
          throw new Error('Read-only fixture attempted deletion');
        }
        if(scenario==='late-tab' && url.pathname.endsWith('/service-analytics/explore')){holdTraffic=route;return;}
        if(url.pathname.includes('/service-analytics/'))return json(route,{},503);
        return url.origin===origin?route.continue():route.abort();
      });
      await page.goto(`${origin}/service-analytics.html?tab=reviews`);
      await page.locator('.written-review-row').first().click();await page.locator('.written-review-comment').waitFor();
      if(scenario==='preview'){
        assert.equal(await page.locator('[data-review-delete-open]').isDisabled(),false);
        assert.match(await page.locator('[data-review-delete-open]').innerText(),/삭제 절차 미리보기/);
        await page.locator('[data-review-delete-open]').click();
        await page.locator('select[name="reason"]').selectOption('ABUSE');await page.locator('input[name="confirmed"]').check();
        assert.equal(await page.locator('[data-review-delete-submit]').isDisabled(),true);
        assert.match(await page.locator('.written-review-delete-form .written-review-moderation-note').last().innerText(),/실데이터 프리뷰에서는 리뷰를 삭제할 수 없습니다/);
        await page.locator('[data-review-delete-submit]').evaluate(button=>{button.disabled=false;button.click();});
        assert.equal(writes.length,0);
        await page.locator('[data-review-delete-cancel]').click();assert.equal(await page.locator('.written-review-delete-form').count(),0);
      } else if(['legacy','policy'].includes(scenario)){
        assert.equal(await page.locator('[data-review-delete-open]').isDisabled(),true);
        assert.match(await page.locator('.written-review-moderation-note').innerText(),/최신 삭제 기준을 확인할 수 없습니다/);
        await page.locator('[data-review-delete-open]').evaluate(button=>{button.disabled=false;button.click();});
        assert.equal(await page.locator('.written-review-delete-form').count(),0);assert.equal(writes.length,0);
      } else {
        await page.locator('[data-review-delete-open]').click();
        assert.equal(await page.locator('[data-review-delete-submit]').isDisabled(),true);
        assert.equal(await page.locator('.written-review-delete-form select option').count(),6);
        assert.match(await page.locator('.written-review-delete-form').innerText(),/서비스 화면에서 복구할 수 없습니다/);
        assert.match(await page.locator('.written-review-delete-target').innerText(),/서울역 <화장실>/);
        await page.locator('[data-review-delete-cancel]').click();assert.equal(writes.length,0);
        await page.locator('[data-review-delete-open]').click();
        await page.locator('select[name="reason"]').selectOption('SPAM');
        assert.equal(await page.locator('[data-review-delete-submit]').isDisabled(),true);
        await page.locator('input[name="confirmed"]').check();
        assert.equal(await page.locator('[data-review-delete-submit]').isDisabled(),false);
        if(scenario==='ready' && process.env.WRITTEN_REVIEWS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.WRITTEN_REVIEWS_SCREENSHOT_DIR,'written-reviews-delete-confirm-mobile.png'),fullPage:true});
        await page.locator('[data-review-delete-submit]').evaluate(button=>{button.click();button.click();});
        await held(()=>writes.length);
        assert.equal(writes.length,1);assert.deepEqual(writes[0],{reviewKey:moderation.reviewKey,version:3,reason:'SPAM',confirmed:true});
        if(scenario==='ready'){
          await held(()=>holdDelete);assert.equal(await page.locator('.written-review-delete-form').getAttribute('aria-busy'),'true');
          assert.equal(await page.locator('[data-review-delete-submit]').isDisabled(),true);
          deleted=true;await json(holdDelete,{id:first.id,deleted:true});
          await page.locator('.written-reviews-notice').filter({hasText:'리뷰를 삭제했습니다. 최신 목록으로 이동합니다.'}).waitFor();
          await page.locator('.written-review-row').filter({hasText:'숨김 화장실'}).waitFor();
          assert.equal(await page.locator('.written-review-row').count(),1);
        }else if(['changed','busy'].includes(scenario)){
          await page.locator('.written-review-delete-error').filter({hasText:scenario==='changed'?'리뷰가 수정되었습니다.':'다른 작업이 진행 중입니다.'}).waitFor();
          assert.equal(await page.locator('[data-review-delete-submit]').isDisabled(),true);
          await page.locator('.written-review-delete-error [data-review-detail-retry]').click();await page.locator('[data-review-delete-open]').waitFor();
          assert.equal(writes.length,1);assert.equal(await page.locator('[data-review-delete-open]').isDisabled(),false);
        }else if(scenario==='already'){
          await page.locator('.written-reviews-notice').filter({hasText:'이미 삭제되었거나 더 이상 확인할 수 없는 리뷰입니다.'}).waitFor();
          assert.equal(await page.getByText('리뷰를 삭제했습니다. 최신 목록으로 이동합니다.',{exact:true}).count(),0);
        }else if(scenario==='unknown'){
          await page.locator('.written-review-delete-error').filter({hasText:'삭제 결과를 확인하지 못했습니다.'}).waitFor();
          assert.equal(await page.locator('[data-review-delete-submit]').isDisabled(),true);
          await page.locator('.written-review-delete-error [data-reviews-first]').click();await page.locator('.written-review-row').filter({hasText:'숨김 화장실'}).waitFor();assert.equal(writes.length,1);
        }else if(['auth','forbidden'].includes(scenario)){
          await page.locator('#auth-title').filter({hasText:scenario==='auth'?'관리자 로그인':'관리자 권한이 필요합니다'}).waitFor();
          assert.equal(await page.locator('.written-review-row').count(),0);
        }else if(scenario==='late' || scenario==='late-auth'){
          await held(()=>holdDelete);await page.evaluate(()=>window.AdminNavigation.go('/features.html'));
          await page.evaluate(()=>window.AdminNavigation.go('/service-analytics.html?tab=reviews'));await page.locator('.written-review-row').first().waitFor();
          await json(holdDelete,scenario==='late'?{id:first.id,deleted:true}:{},scenario==='late'?200:401);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          assert.equal(await page.locator('.written-review-row').count(),2);assert.equal(await page.locator('.written-reviews-notice').isVisible(),false);
          assert.equal(await page.evaluate(()=>AdminAuth.getState().status),'authenticated');
        }else if(scenario==='late-tab'){
          await held(()=>holdDelete);await page.locator('[data-tab="overview"]').click();await held(()=>holdTraffic);
          assert.equal(await page.locator('#analytics-refresh').isDisabled(),true);
          await json(holdDelete,{id:first.id,deleted:true});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          assert.equal(await page.locator('#analytics-refresh').isDisabled(),true);
          await page.locator('[data-tab="reviews"]').click();await page.locator('.written-review-row').first().waitFor();
          await json(holdTraffic,{},503).catch(()=>{});assert.equal(await page.locator('.written-review-row').count(),2);
        }
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);console.log(`PASS written review moderation ${scenario} (local fixtures only)`);await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
