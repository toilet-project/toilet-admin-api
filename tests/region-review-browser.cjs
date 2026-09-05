// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright module, or install playwright locally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../src/main/resources/static');
const current = { latitude:null, longitude:null, roadAddress:null, jibunAddress:'대전광역시 유성구 궁동 1' };
const toilet = { toiletId:1, name:'<검토> 화장실', managementNumber:'test-001', location:current, status:'NO_COORDINATE', assessmentStatus:'NO_COORDINATE', reason:'MISSING_COORDINATE', checkedAt:'2026-09-05T02:00:00+09:00' };
const detail = { toilet, assessedSource:current, evidenceJson:'{"reason":"<script>throw 1</script>"}' };
(async () => {
  const server = http.createServer((req,res) => {
    const file = path.resolve(root, '.'+new URL(req.url,'http://local').pathname);
    if (!file.startsWith(root+path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file,(error,data) => { if(error){res.writeHead(404).end();return;} res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data); });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const mode of ['anonymous','user','desktop','mobile','conflict']) {
      const context = await browser.newContext({viewport:{width:mode==='mobile'?390:1440,height:1000}});
      const page = await context.newPage(); const errors=[],writes=[],queries=[];
      let saved = false;
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*', route => {
        const request=route.request(),url=new URL(request.url());
        if (url.pathname==='/api/v1/auth/me') return route.fulfill({status:mode==='anonymous'?401:200,json:{roles:[mode==='user'?'USER':'ADMIN']}});
        if (url.pathname==='/api/admin/v1/map-config') return route.fulfill({json:{enabled:true,javascriptKey:'test-only'}});
        if (url.pathname.startsWith('/api/admin/v1/regions')) {
          if (request.method()==='POST') {
            writes.push(request.postDataJSON());
            if(mode==='conflict')return route.fulfill({status:409,json:{}});
            saved=true;return route.fulfill({json:{}});
          }
          if(request.method()!=='GET')return route.abort();
          if(url.pathname.endsWith('/history'))return route.fulfill({json:{items:[{assessmentId:1,status:'NO_COORDINATE',reason:'MISSING_COORDINATE',algorithmVersion:'test',checkedAt:toilet.checkedAt,evidenceJson:'{}'}],page:Number(url.searchParams.get('page')),size:10,totalElements:11,totalPages:2}});
          if(url.pathname.endsWith('/1'))return route.fulfill({json:saved?{...detail,toilet:{...toilet,status:'STALE',location:{latitude:37.7,longitude:127.2,roadAddress:'최신 주소',jibunAddress:null}}}:detail});
          queries.push(Object.fromEntries(url.searchParams));
          return route.fulfill({json:{items:[toilet],page:Number(url.searchParams.get('page')),size:20,totalElements:21,totalPages:2}});
        }
        return url.origin===origin?route.continue():route.abort();
      });
      await page.addInitScript(() => {
        window.__lookups=[];window.__maps=[];window.__searches=[];
        class LatLng {constructor(lat,lng){this.lat=Number(lat);this.lng=Number(lng)}getLat(){return this.lat}getLng(){return this.lng}}
        class Map {constructor(){this.handlers={};window.__maps.push(this)}setCenter(){}setLevel(){}}
        class Marker {constructor(options){this.position=options.position;this.handlers={}}setMap(){}setPosition(p){this.position=p}getPosition(){return this.position}}
        window.kakao={maps:{LatLng,Map,Marker,MarkerImage:class{},Size:class{},Point:class{},event:{addListener(target,event,callback){target.handlers[event]=callback}},services:{Status:{OK:'OK'},Geocoder:class{coord2Address(lng,lat,callback){window.__lookups.push(callback)}addressSearch(text,callback){window.__searches.push(callback)}}}}};
      });
      await page.goto(origin+'/regions.html');
      if(mode==='anonymous'||mode==='user') {
        await page.locator('#auth-shell').waitFor();assert.equal(await page.locator('#region-shell').isVisible(),false);assert.equal(queries.length,0);
      } else {
        await page.locator('.region-item').click();
        await page.waitForFunction(()=>window.__maps.length===1);
        assert.equal(await page.locator('#region-save').isDisabled(),true);
        assert.equal(writes.length,0);
        await page.locator('#region-map-search').fill('대전 주소');await page.locator('#region-map-find').click();
        await page.evaluate(()=>window.__searches[0]([{address_name:'검색 후보',x:'127.1',y:'37.6'}],'OK'));
        assert.equal(await page.locator('#region-save').isDisabled(),true);
        await page.locator('#region-candidates button').click();
        await page.evaluate(()=>{window.__maps[0].handlers.click({latLng:new kakao.maps.LatLng(37.7,127.2)});window.__lookups[1]([{road_address:{address_name:'최신 주소'}}],'OK');window.__lookups[0]([{address:{address_name:'오래된 주소'}}],'OK')});
        assert.match(await page.locator('#region-draft').innerText(),/37.7000000.*최신 주소/);
        await page.locator('#region-save').click();assert.equal(writes.length,0);
        assert.match(await page.locator('#region-save-status').innerText(),/사유/);
        await page.locator('#region-note').fill('현장 확인');
        page.once('dialog',dialog=>dialog.accept());await page.locator('#region-save').click();
        await page.waitForFunction(()=>document.getElementById('region-save-status')?.textContent.includes('저장했습니다') || document.getElementById('region-save-status')?.textContent.includes('변경되었습니다'));
        assert.equal(writes.length,1);assert.equal(writes[0].latitude,37.7);assert.deepEqual(writes[0].expectedLocation,current);
        assert.equal('roadAddress' in writes[0],false);
        if(mode==='conflict')assert.match(await page.locator('#region-save-status').innerText(),/새로고침/);
        else {
          await page.locator('#region-filter').selectOption('NO_COORDINATE');
          await page.waitForTimeout(100);
          assert.equal(queries.at(-1).status,'NO_COORDINATE');
          await page.locator('#region-pages').getByRole('button',{name:'다음'}).click();await page.waitForTimeout(100);
          assert.equal(queries.at(-1).page,'1');
          await page.locator('#region-reset').click();assert.equal(await page.locator('#region-save').isDisabled(),true);
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        if(process.env.REGION_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.REGION_SCREENSHOT_DIR,`region-${mode}.png`),fullPage:true});
      }
      assert.deepEqual(errors,[]);console.log(`PASS ${mode} (mock API only, no production writes)`);await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
