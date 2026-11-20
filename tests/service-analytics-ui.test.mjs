import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../src/main/resources/static/', import.meta.url)

test('admin navigation and home link to the analytics workspace', async () => {
  const [shell, home] = await Promise.all([
    readFile(new URL('admin-shell.js', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
  ])
  assert.match(shell, /서비스 이용 분석/)
  assert.match(shell, /\/service-analytics\.html/)
  assert.match(home, /id="analytics-realtime-users"/)
  assert.match(home, /id="analytics-mini-chart"/)
})

test('analytics detail keeps a static shell and replaces only async data regions', async () => {
  const [page, script] = await Promise.all([
    readFile(new URL('service-analytics.html', root), 'utf8'),
    readFile(new URL('service-analytics.js', root), 'utf8'),
  ])
  for (const id of ['analytics-view', 'analytics-kpis', 'analytics-filter-chips', 'analytics-error', 'analytics-export']) {
    assert.match(page, new RegExp(`id="${id}"`))
  }
  assert.match(script, /\/api\/admin\/v1\/service-analytics\/explore/)
  assert.match(script, /AbortController/)
  assert.doesNotMatch(script, /innerHTML\s*=\s*await\s+response\.text/)
})

// Run the shipped script with deferred HTTP responses to exercise tab/query races without a browser dependency.
async function workspace(search = '') {
  class Element {
    constructor(dataset = {}) {
      this.dataset = dataset; this.handlers = {}; this.attributes = {}; this.options = [];
      this.innerHTML = ''; this.textContent = ''; this.hidden = false; this.value = ''; this.disabled = false;
      this.isConnected = true;
      this.classList = { add() {}, remove() {} }; this.clientWidth = 1000;
    }
    addEventListener(name, handler) { this.handlers[name] = handler }
    setAttribute(name, value) { this.attributes[name] = value }
    hasAttribute(name) { return name in this.attributes }
    closest() { return this }
    querySelectorAll() { return [] }
    querySelector() { return new Element() }
    click() {}
  }
  const elements = new Map(), get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const tabs = ['overview','content','acquisition','behavior','audience','quality','bots','popular','reviews'].map(tab => new Element({tab}));
  const requests = [], realtimeRequests = [], reviewRequests = [], csvs = [], rootElement = get('analytics-shell');
  const documentHandlers = new Map(), windowHandlers = new Map();
  const on = handlers => (type, handler) => { if (!handlers.has(type)) handlers.set(type,new Set()); handlers.get(type).add(handler); };
  const off = handlers => (type, handler) => handlers.get(type)?.delete(handler);
  const regions = new Map();
  rootElement.querySelector = selector => { if (!regions.has(selector)) regions.set(selector, new Element()); return regions.get(selector); };
  const flush = async () => { for (let i=0;i<4;i++) await new Promise(resolve => setImmediate(resolve)) };
  const script = await readFile(new URL('service-analytics.js', root), 'utf8');
  vm.runInNewContext(script, {
    AdminAuth:{start:async()=>({roles:['ADMIN']})},
    document: {getElementById: get, createElement:()=>new Element(), addEventListener:on(documentHandlers), removeEventListener:off(documentHandlers), querySelectorAll: selector => selector.includes('data-tab') ? tabs : []},
    window: {innerWidth:1200, location:{search}, addEventListener:on(windowHandlers), removeEventListener:off(windowHandlers), OriginBotAnalytics:{cancel(){},show(node){node.innerHTML='independent bots'}}, PopularToiletsAnalytics:{cancel(){},show(node){node.innerHTML='independent popular'}}, WrittenReviewsAnalytics:{cancel(){},show(node){reviewRequests.push(true);node.innerHTML='independent reviews'}}},
    fetch: (url, options) => {
      if (url.includes('/auth/me')) return Promise.resolve({ok:true,json:async()=>({roles:['ADMIN']})});
      if (url.includes('/realtime')) { realtimeRequests.push(url);return Promise.resolve({ok:true,json:async()=>({available:false})}); }
      return new Promise(resolve => requests.push({url,signal:options.signal,resolve}));
    },
    AbortController, URLSearchParams, Blob, URL:{createObjectURL(blob){csvs.push(blob);return 'blob:test'},revokeObjectURL(){}}, Intl, Date, setTimeout, clearTimeout, console,
  });
  await flush();
  return {
    requests, realtimeRequests, reviewRequests, csvs, regions, get, flush,
    async leave() { for (const handler of [...documentHandlers.get('admin:before-route-change') || []]) handler(); rootElement.isConnected=false; await flush(); },
    listenerCount() { return [...documentHandlers.values(),...windowHandlers.values()].reduce((sum,set)=>sum+set.size,0); },
    async click(dataset, id='') { const button=new Element(dataset);button.id=id;rootElement.handlers.click({target:button});await flush() },
    async selectReview(value) { const select=new Element();select.id='';select.value=value;select.attributes['data-clue-review']='';rootElement.handlers.change({target:select});await flush() },
    async respond(index, data, status=200) { requests[index].resolve({ok:status===200,status,json:async()=>data});await flush() },
    selected() { return tabs.find(t=>t.attributes['aria-current']==='page')?.dataset.tab },
  };
}
function report(generatedAt='2026-10-04T12:00:00Z') {
  const metrics={visitors:12,sessions:15,views:20,events:30,keyEvents:2,engagementSeconds:40,emptyResults:0};
  return {generatedAt,from:'2026-09-28',to:'2026-10-04',previousFrom:'2026-09-21',previousTo:'2026-09-27',cutoff:'2026-10-04T21:00',
    comparisonAvailable:true,comparisonNote:'비교 가능',visitorDefinition:'일별 추정 방문자 합계',detailed:true,hourly:false,
    current:metrics,previous:metrics,trend:[],previousTrend:[],dimensions:{page:[],source:[],country:[],client:[]},previousDimensions:{},flows:[],
    quality:{unknownPageViews:0,unattributedSessions:0,internalSessions:0,duplicateStarts:0,rowsTruncated:false},notices:[],filters:{},
    botFilter:{excludeBots:true,toggleAvailable:true,note:'봇 제외'},entryClues:{available:true,evidenceAvailable:true,rows:[]}};
}
test('tabs request scoped work once and reuse successfully loaded views', async () => {
  const ui=await workspace();assert.equal(new URL(ui.requests[0].url,'https://test').searchParams.get('view'),'overview');
  await ui.respond(0,report());await ui.click({tab:'content'});
  assert.equal(ui.selected(),'content');assert.match(ui.get('analytics-view').innerHTML,/불러오고/);
  assert.equal(ui.get('analytics-export').disabled,true);
  assert.equal(new URL(ui.requests[1].url,'https://test').searchParams.get('view'),'content');
  const content=report();content.dimensions.screen=[];await ui.respond(1,content);
  assert.equal(ui.get('analytics-export').disabled,false);
  await ui.click({tab:'overview'});await ui.click({tab:'content'});
  assert.equal(ui.requests.length,2);assert.equal(ui.selected(),'content');
  assert.equal(ui.realtimeRequests.length,1); // Other tabs do not add unrelated real-time scans.
  await ui.click({tab:'acquisition'});await ui.respond(2,report('2026-10-04T12:02:00Z'));
  await ui.click({tab:'content'});assert.equal(ui.requests.length,4); // Server cache expired; old scoped data must be fetched again.
});
test('failed new tab or filter restores last successful view and query', async () => {
  const ui=await workspace();await ui.respond(0,report());
  await ui.click({tab:'content'});const content=report();content.dimensions.screen=[];await ui.respond(1,content);
  await ui.click({tab:'overview'});await ui.click({tab:'behavior'});await ui.respond(2,null,503);
  assert.equal(ui.selected(),'overview');assert.equal(ui.get('analytics-error').hidden,false);
  assert.match(ui.get('analytics-view').innerHTML,/일별 방문 변화/);
  await ui.click({filter:'source',value:'naver'});await ui.respond(3,null,400);
  assert.equal(ui.get('filter-source').value,'');assert.match(ui.get('analytics-error').textContent,/마지막 성공 조건/);
});
test('late responses cannot replace a newer tab or independent bot report', async () => {
  const ui=await workspace();await ui.respond(0,report());
  await ui.click({tab:'acquisition'});await ui.click({tab:'behavior'});
  assert.equal(ui.requests[1].signal.aborted,true);
  const behavior=report();behavior.dimensions.event=[];await ui.respond(2,behavior);await ui.respond(1,null,401);
  assert.equal(ui.selected(),'behavior');assert.match(ui.get('analytics-view').innerHTML,/이용 흐름/);
  assert.equal(ui.get('analytics-shell').hidden,false);
  await ui.click({tab:'audience'});await ui.click({tab:'bots'});await ui.respond(3,report());
  assert.equal(ui.selected(),'bots');assert.equal(ui.get('analytics-view').innerHTML,'independent bots');
});

test('written reviews are independent of traffic filters and discard late traffic responses', async () => {
  const ui=await workspace();
  await ui.click({tab:'reviews'});
  assert.equal(ui.requests[0].signal.aborted,true);
  assert.equal(ui.selected(),'reviews');
  assert.equal(ui.get('analytics-view').innerHTML,'independent reviews');
  assert.equal(ui.regions.get('.analytics-controls').hidden,true);
  assert.equal(ui.get('analytics-kpis').hidden,true);
  assert.equal(ui.regions.get('.analytics-definitions').hidden,true);
  await ui.respond(0,report());
  assert.equal(ui.get('analytics-view').innerHTML,'independent reviews');
  assert.equal(ui.reviewRequests.length,1);
  await ui.click({tab:'overview'});
  assert.equal(ui.regions.get('.analytics-controls').hidden,false);
  assert.equal(ui.requests.length,2);
});

test('written-review direct link avoids initial traffic scans', async () => {
  const ui=await workspace('?tab=reviews');
  assert.equal(ui.selected(),'reviews');
  assert.equal(ui.requests.length,0);
  assert.equal(ui.realtimeRequests.length,0);
  assert.equal(ui.reviewRequests.length,1);
});

test('session review shows full coverage while table filtering and CSV retain bounded evidence', async () => {
  const ui=await workspace();await ui.respond(0,report());await ui.click({tab:'acquisition'});
  const data=report();
  const cohort={device:'desktop',os:'Windows',landing:'/regions/:sido/:district/toilet/:id',client:'BROWSER',entry:'NO_REFERRER',navigation:'NAVIGATE',source:'none',channel:'Direct',traffic:'UNFLAGGED',sessions:60,views:60,withDetail:0,withSearch:0,engagementSeconds:480};
  data.entryClues={available:true,evidenceAvailable:true,truncated:false,
    rows:[{...cohort,browser:'LegacyOnly'}],
    review:{totalSessions:150,displayedSessions:120,eventsWithoutStart:3,truncated:true,
      rows:[{...cohort,browser:'PassiveChrome',review:'TIMED_SINGLE_VIEW'},{...cohort,browser:'ActiveSafari',review:'OBSERVED_ACTIVITY',withSearch:60}],
      categories:[{key:'TIMED_SINGLE_VIEW',sessions:80},{key:'OBSERVED_ACTIVITY',sessions:70}]}};
  await ui.respond(1,data);
  assert.match(ui.get('analytics-view').innerHTML,/시작 세션 150개 전체/);
  assert.match(ui.get('analytics-view').innerHTML,/120개 세션\(80\.0%\)/);
  assert.match(ui.get('analytics-view').innerHTML,/시작 기록 없이 남은 이벤트 3건/);
  assert.match(ui.get('analytics-view').innerHTML,/자동화 의심 후보/);
  assert.match(ui.get('analytics-view').innerHTML,/ActiveSafari/);
  assert.doesNotMatch(ui.get('analytics-view').innerHTML,/LegacyOnly/);
  await ui.selectReview('TIMED_SINGLE_VIEW');
  assert.equal(ui.requests.length,2); // This selector filters the returned cohort table, not global metrics.
  assert.match(ui.get('analytics-view').innerHTML,/PassiveChrome/);
  assert.doesNotMatch(ui.get('analytics-view').innerHTML,/ActiveSafari/);
  await ui.click({},'analytics-export');
  const csv=await ui.csvs[0].text();
  assert.match(csv,/전체 시작 세션","150/);assert.match(csv,/상위 100개 유형 · 전체 아님/);
  assert.match(csv,/시작 기록 없는 이벤트","3/);assert.match(csv,/활성 시간만 기록/);
  assert.match(csv,/UNFLAGGED · 미탐지/);assert.match(csv,/PassiveChrome/);assert.doesNotMatch(csv,/ActiveSafari/);
});

test('new UI falls back to old unknown-only rows and keeps unknown-source drilldown', async () => {
  const ui=await workspace();await ui.respond(0,report());await ui.click({tab:'acquisition'});
  const data=report();
  data.entryClues.rows=[{device:'mobile',os:'iOS',browser:'OldSafari',landing:'/',client:'BROWSER',entry:'NO_REFERRER',navigation:'NAVIGATE',sessions:2,views:2,withDetail:0,withSearch:0,engagementSeconds:0}];
  await ui.respond(1,data);
  assert.match(ui.get('analytics-view').innerHTML,/기존 출처 미확인 표만 제공/);
  assert.match(ui.get('analytics-view').innerHTML,/OldSafari/);
  await ui.click({clue:'0'});
  const query=new URL(ui.requests[2].url,'https://test').searchParams;
  assert.equal(query.get('unattributed'),'true');assert.equal(query.get('browser'),'OldSafari');
});

test('leaving analytics disposes pending traffic scans and global listeners', async () => {
  for (const status of [200,401]) {
    const ui=await workspace();
    assert.ok(ui.listenerCount()>0);
    await ui.leave();
    assert.equal(ui.requests[0].signal.aborted,true);
    assert.equal(ui.listenerCount(),0);
    ui.get('analytics-view').innerHTML='new reviews workspace';
    await ui.respond(0,status===200?report():null,status);
    assert.equal(ui.get('analytics-view').innerHTML,'new reviews workspace');
  }
});
