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
async function workspace() {
  class Element {
    constructor(dataset = {}) {
      this.dataset = dataset; this.handlers = {}; this.attributes = {}; this.options = [];
      this.innerHTML = ''; this.textContent = ''; this.hidden = false; this.value = ''; this.disabled = false;
      this.classList = { add() {}, remove() {} }; this.clientWidth = 1000;
    }
    addEventListener(name, handler) { this.handlers[name] = handler }
    setAttribute(name, value) { this.attributes[name] = value }
    hasAttribute(name) { return name in this.attributes }
    closest() { return this }
    querySelectorAll() { return [] }
    querySelector() { return new Element() }
  }
  const elements = new Map(), get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const tabs = ['overview','content','acquisition','behavior','audience','quality','bots','popular'].map(tab => new Element({tab}));
  const requests = [], realtimeRequests = [], rootElement = get('analytics-shell');
  const flush = async () => { for (let i=0;i<4;i++) await new Promise(resolve => setImmediate(resolve)) };
  const script = await readFile(new URL('service-analytics.js', root), 'utf8');
  vm.runInNewContext(script, {
    document: {getElementById: get, addEventListener() {}, querySelectorAll: selector => selector.includes('data-tab') ? tabs : []},
    window: {innerWidth:1200, addEventListener() {}, OriginBotAnalytics:{cancel(){},show(node){node.innerHTML='independent bots'}}, PopularToiletsAnalytics:{cancel(){},show(node){node.innerHTML='independent popular'}}},
    fetch: (url, options) => {
      if (url.includes('/auth/me')) return Promise.resolve({ok:true,json:async()=>({roles:['ADMIN']})});
      if (url.includes('/realtime')) { realtimeRequests.push(url);return Promise.resolve({ok:true,json:async()=>({available:false})}); }
      return new Promise(resolve => requests.push({url,signal:options.signal,resolve}));
    },
    AbortController, URLSearchParams, Intl, Date, setTimeout, clearTimeout, console,
  });
  await flush();
  return {
    requests, realtimeRequests, get, flush,
    async click(dataset, id='') { const button=new Element(dataset);button.id=id;rootElement.handlers.click({target:button});await flush() },
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
