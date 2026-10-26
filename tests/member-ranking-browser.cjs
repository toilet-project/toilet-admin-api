// All account/XP fixtures are synthetic. No operational API requests or business writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../src/main/resources/static');
const ranks=[['white','흰색 휴지',0,79],['green','초록 휴지',80,239],['yellow','노랑 휴지',240,989],['blue','파랑 휴지',990,2239],['red','빨강 휴지',2240,6239],['pink','핑크 휴지',6240,15989],['black','검정 휴지',15990,null]];
const xps=[16000,6240,2240,990,240,80,80,0,0,0,0,0,0,0,0];
const users=xps.map((totalXp,index)=>{const rank=ranks.find(item=>totalXp>=item[2]&&(item[3]===null||totalXp<=item[3]));return{id:String(index+1),displayName:index===0?'<별회원> & 테스트':index===1?null:`회원 ${index+1}`,email:index===1?null:`m***${index+1}@example.invalid`,status:index===2?'SUSPENDED':'ACTIVE',totalXp,level:Math.floor(Math.sqrt(totalXp/10+1)),rank:rank[0],rankName:rank[1],position:xps.indexOf(totalXp)+1};});
const distribution={totalMembers:users.length,scope:'ACTIVE_AND_SUSPENDED',excludedStatuses:['PENDING_CONSENT','WITHDRAWN'],buckets:ranks.map(([rank,rankName,minXp,maxXp])=>({rank,rankName,minXp,maxXp,count:users.filter(user=>user.rank===rank).length}))};
const memberPage={items:[{id:1,displayName:'기존 회원',email:'e***@example.invalid',status:'ACTIVE',roles:['USER'],lastLoginAt:'2026-10-26T12:00:00'}],page:0,size:20,totalPages:1,totalElements:1};
const reply=(route,value,status=200)=>route.fulfill({status,json:value,headers:{'Cache-Control':'private, no-store'}});
async function held(get){const deadline=Date.now()+5000;while(!get()){if(Date.now()>deadline)throw new Error('Deferred test request did not start');await new Promise(resolve=>setTimeout(resolve,10));}}
function search(body){let selected=users.filter(user=>!body.keyword||body.keyword.includes('@')?(!body.keyword||body.keyword==='member1@example.invalid'?user.id==='1'||!body.keyword:false):(user.displayName||'').includes(body.keyword));selected.sort((a,b)=>(body.sort==='xp_asc'?a.totalXp-b.totalXp:b.totalXp-a.totalXp)||Number(a.id)-Number(b.id));return{items:selected.slice(body.page*body.size,(body.page+1)*body.size),page:body.page,size:body.size,totalElements:selected.length,totalPages:Math.ceil(selected.length/body.size)};}
(async()=>{
  const server=http.createServer((request,response)=>{const file=path.resolve(root,'.'+new URL(request.url,'http://local').pathname);if(!file.startsWith(root+path.sep))return response.writeHead(403).end();fs.readFile(file,(error,bytes)=>{if(error)return response.writeHead(404).end();response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');response.end(bytes);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';let browser;
  try{
    browser=await chromium.launch({headless:true,...(channel?{channel}:{})});
    for(const mode of ['anonymous','forbidden','desktop','mobile','preview']){
      const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1440,height:1100}});
      await context.addInitScript(preview=>{if(preview)window.AdminExperienceRankingPreview={readOnly:true};const original=fetch.bind(window);window.rankingResponseCount=0;window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(!url.pathname.includes('/growth/ranking')&&!url.pathname.endsWith('/security/users'))return original(input,options);return original(input,{...options,signal:undefined}).then(response=>{window.rankingResponseCount++;return response;});};},mode==='preview');
      const page=await context.newPage(),requests=[],errors=[];let distributionStatus=200,listStatus=200,holdList,holdMember,holdMembers=false;
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
        if(url.pathname==='/api/v1/auth/me')return reply(route,{roles:[mode==='forbidden'?'USER':'ADMIN']},mode==='anonymous'?401:200);
        if(url.pathname.endsWith('/growth/ranking/distribution')){requests.push({url:request.url(),method:request.method()});return reply(route,distribution,distributionStatus);}
        if(url.pathname.endsWith('/growth/ranking/search')){const body=request.postDataJSON();requests.push({url:request.url(),method:request.method(),body});assert.equal(request.method(),'POST');assert.equal(url.search,'');assert.deepEqual(Object.keys(body).sort(),['keyword','page','size','sort']);assert.equal(body.size,10);if(body.keyword==='hold'){holdList=route;return;}return reply(route,search(body),listStatus);}
        if(url.pathname.endsWith('/security/users')){requests.push({url:request.url(),method:request.method()});if(holdMembers){holdMember=route;return;}return reply(route,memberPage);}
        return url.origin===origin?route.continue():route.abort();
      });
      await page.goto(origin+'/members.html?tab=ranking');
      if(['anonymous','forbidden'].includes(mode)){await page.locator('#auth-shell').waitFor();assert.equal(await page.locator('#members-shell').isVisible(),false);assert.equal(requests.length,0);await context.close();continue;}
      await page.locator('.member-rank-table tbody tr').first().waitFor();await page.locator('.member-rank-bucket').first().waitFor();
      assert.equal(await page.locator('.member-rank-table tbody tr').count(),10);assert.equal(await page.locator('.member-rank-bucket').count(),7);assert.match(await page.locator('.member-ranking-total').innerText(),/15명/);
      assert.equal(await page.locator('.member-rank-table tbody tr').nth(1).locator('.member-rank-name').innerText(),'이름 없음');
      assert.equal(await page.locator('input[name="keyword"]').getAttribute('maxlength'),'320');
      assert.equal(await page.locator('[data-members-tab="ranking"]').getAttribute('aria-selected'),'true');
      assert.equal(await page.locator('[data-members-tab="ranking"]').getAttribute('tabindex'),'0');
      if(mode==='mobile')assert.equal(await page.locator('.member-rank-table').evaluate(node=>node.scrollWidth>node.clientWidth),false);
      assert.match(await page.locator('.member-rank-table tbody tr').first().innerText(),/<별회원> & 테스트/);assert.equal(await page.locator('.member-rank-table script').count(),0);
      assert.equal(await page.locator('.member-rank-bucket img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),true);
      const distributionCalls=()=>requests.filter(request=>request.url.endsWith('/distribution')).length;
      assert.equal(distributionCalls(),1);assert.equal(requests.some(request=>request.url.includes('/security/users')),false);
      await page.locator('.member-rank-sort select').selectOption('xp_asc');await page.locator('.member-rank-table tbody tr td').first().filter({hasText:'8'}).waitFor();
      assert.equal(distributionCalls(),1);await page.locator('[data-ranking-page="1"]').click();await page.locator('.member-rank-pagination').filter({hasText:'2 / 2페이지'}).waitFor();
      assert.equal(await page.locator('.member-rank-table tbody tr').count(),5);await page.locator('[data-ranking-page="0"]').click();await page.locator('.member-rank-pagination').filter({hasText:'1 / 2페이지'}).waitFor();
      await page.locator('input[name="keyword"]').fill('member1@example.invalid');await page.locator('.member-rank-search button[type="submit"]').click();await page.locator('.member-rank-table tbody tr').filter({hasText:'<별회원>'}).waitFor();
      assert.equal(await page.locator('.member-rank-table tbody tr').count(),1);assert.equal(await page.locator('.member-rank-table tbody tr td').first().innerText(),'1');assert.equal(distributionCalls(),1);assert.equal(new URL(page.url()).search,'?tab=ranking');assert.equal(requests.some(request=>request.url.includes('member1')),false);
      await page.locator('[data-ranking-clear]').click();await page.locator('.member-rank-table tbody tr td').first().filter({hasText:'8'}).waitFor();
      if(process.env.MEMBER_RANKING_SCREENSHOT_DIR){fs.mkdirSync(process.env.MEMBER_RANKING_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.MEMBER_RANKING_SCREENSHOT_DIR,`member-ranking-${mode}.png`),fullPage:true});}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.locator('[data-members-tab="ranking"]').focus();await page.keyboard.press('Home');assert.equal(await page.locator('[data-members-tab="members"]').evaluate(node=>node===document.activeElement),true);
      if(mode==='preview'){await page.getByText('이 프리뷰는 경험치 랭킹을 확인하는 화면입니다.',{exact:false}).waitFor();assert.equal(requests.some(request=>request.url.includes('/security/users')),false);}else await page.getByText('기존 회원',{exact:true}).waitFor();
      await page.keyboard.press('End');await page.locator('.member-rank-table tbody tr').first().waitFor();assert.equal(await page.locator('[data-members-tab="ranking"]').evaluate(node=>node===document.activeElement),true);
      await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-members-tab="members"]').getAttribute('aria-selected'),'true');assert.equal(await page.locator('[data-members-tab="members"]').evaluate(node=>node===document.activeElement),true);
      await page.keyboard.press('ArrowLeft');await page.locator('.member-rank-table tbody tr').first().waitFor();assert.equal(await page.locator('[data-members-tab="ranking"]').getAttribute('aria-selected'),'true');assert.equal(await page.locator('[data-members-tab="ranking"]').evaluate(node=>node===document.activeElement),true);
      const beforeRefresh=distributionCalls();await page.locator('.admin-topbar #refresh').click();await held(()=>distributionCalls()>beforeRefresh);await page.locator('.member-rank-table tbody tr').first().waitFor();
      distributionStatus=503;await page.locator('#members-refresh').click();await page.locator('[data-ranking-distribution-retry]').waitFor();await page.locator('.member-rank-table tbody tr').first().waitFor();assert.equal(await page.locator('.member-rank-bucket').count(),0);
      distributionStatus=200;await page.locator('[data-ranking-distribution-retry]').click();await page.locator('.member-rank-bucket').first().waitFor();
      listStatus=503;await page.locator('.member-rank-sort select').selectOption('xp_asc');await page.locator('[data-ranking-retry]').waitFor();assert.equal(await page.getByText('조건에 맞는 회원이 없습니다.',{exact:true}).count(),0);assert.equal(await page.locator('.member-rank-bucket').count(),7);
      listStatus=200;await page.locator('[data-ranking-retry]').click();await page.locator('.member-rank-table tbody tr').first().waitFor();
      await page.locator('input[name="keyword"]').fill('없는 회원');await page.locator('.member-rank-search button[type="submit"]').click();await page.getByText('조건에 맞는 회원이 없습니다.',{exact:true}).waitFor();
      await page.locator('input[name="keyword"]').fill('hold');await page.locator('.member-rank-search button[type="submit"]').click();await held(()=>holdList);
      await page.locator('[data-ranking-clear]').click();await page.locator('.member-rank-table tbody tr').first().waitFor();const completed=await page.evaluate(()=>window.rankingResponseCount);await reply(holdList,{},401);await page.waitForFunction(count=>window.rankingResponseCount>count,completed);
      assert.equal(await page.evaluate(()=>AdminAuth.getState().status),'authenticated');assert.equal(await page.locator('.member-rank-table tbody tr').count(),10);
      for(const status of [200,401]){
        holdList=null;await page.locator('input[name="keyword"]').fill('hold');await page.locator('.member-rank-search button[type="submit"]').click();await held(()=>holdList);await page.evaluate(()=>AdminNavigation.go('/features.html'));await page.evaluate(()=>AdminNavigation.go('/members.html?tab=ranking'));await page.locator('.member-rank-table tbody tr').first().waitFor();
        const completed=await page.evaluate(()=>window.rankingResponseCount);await reply(holdList,status===200?search({keyword:'',sort:'xp_desc',page:0,size:10}):{},status);await page.waitForFunction(count=>window.rankingResponseCount>count,completed);assert.equal(await page.locator('.member-rank-table tbody tr').count(),10);assert.equal(await page.evaluate(()=>AdminAuth.getState().status),'authenticated');
      }
      if(mode!=='preview')for(const status of [200,401]){
        holdMember=null;holdMembers=true;await page.locator('[data-members-tab="members"]').click();await held(()=>holdMember);await page.evaluate(()=>AdminNavigation.go('/features.html'));await page.evaluate(()=>AdminNavigation.go('/members.html?tab=ranking'));await page.locator('.member-rank-table tbody tr').first().waitFor();
        const completed=await page.evaluate(()=>window.rankingResponseCount);await reply(holdMember,status===200?memberPage:{},status);await page.waitForFunction(count=>window.rankingResponseCount>count,completed);assert.equal(await page.locator('.member-rank-table tbody tr').count(),10);assert.equal(await page.evaluate(()=>AdminAuth.getState().status),'authenticated');holdMembers=false;
      }
      listStatus=mode==='mobile'?403:401;await page.locator('#members-refresh').click();await page.locator('#auth-shell').waitFor();assert.equal(await page.locator('#members-shell').isVisible(),false);assert.equal(await page.locator('.member-rank-table tbody tr').count(),0);assert.equal(await page.locator('input[name="keyword"]').count(),0);
      assert.equal(requests.some(request=>request.method!=='GET'&&!(request.method==='POST'&&request.url.endsWith('/ranking/search'))),false);assert.deepEqual(errors,[]);
      console.log(`PASS member XP ranking ${mode}: distributions, search privacy, ordering, pages, keyboard, failures, late responses, auth`);await context.close();
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
