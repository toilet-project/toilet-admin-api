import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

async function workspace() {
  class Element {
    innerHTML='';
    children=new Map();
    querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new Element());return this.children.get(selector)}
    querySelectorAll(){return []}
  }
  const host=new Element(),requests=[],window={};
  const code=await readFile(new URL('../src/main/resources/static/origin-bots.js',import.meta.url),'utf8');
  vm.runInNewContext(code,{window,AbortController,URLSearchParams,Intl,Date,fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
  const flush=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve))};
  return {host,requests,api:window.OriginBotAnalytics,flush,
    async respond(fragment,data,status=200){const request=requests.find(r=>!r.done&&r.url.includes(fragment));assert.ok(request);request.done=true;request.resolve({ok:status===200,status,json:async()=>data});await flush()},
    automation:()=>host.querySelector('[data-automation-statistics]').innerHTML,
    origin:()=>host.querySelector('[data-origin-log]').innerHTML};
}
const automation=(status='READY')=>({status,message:'통계만 분리합니다.',from:'2026-11-14',to:'2026-11-20',generatedAt:'2026-11-20T07:30:00Z',partial:false,
  job:{intervalSeconds:300,lastCompletedAt:'2026-11-20T07:29:00Z'},coverage:{from:'2026-11-14',to:'2026-11-20',matchedEvents:100,totalEvents:100,unmatchedEvents:0,ambiguousEvents:0},
  officialSources:[{key:'naver',provider:'Naver',title:'Yeti',url:'https://searchadvisor.naver.com/doc/naverbot.json',status:'OK',prefixCount:36,fetchedAt:'2026-11-20T07:00:00Z'}],
  rows:[{classification:'PATTERN_INFERRED',reason:'DISTRIBUTED_PASSIVE_PROFILE',sessions:8,views:8,events:20},{classification:'UA_SIGNAL',reason:'UA_SIGNAL',sessions:5,views:5,events:12}]});
const origin=()=>({status:'OK',message:'서버 요청',from:'2026-11-14',to:'2026-11-20',generatedAt:'2026-11-20T07:30:00Z',partial:false,
  rows:[{bot:'Googlebot',verification:'verified',path:'toilets_api',status:2,count:23,day:'2026-11-20',hour:'2026-11-20T07:00:00Z',first:'2026-11-20T07:01:00Z',last:'2026-11-20T07:29:00Z'}]});

test('analytics automation is separate from verified origin requests even if origin collector is disabled',async()=>{
  const ui=await workspace(),pending=ui.api.show(ui.host,{range:'7d'});
  await ui.respond('automation-statistics',automation());await ui.respond('origin-bots',{status:'DISABLED',message:'연결 대기'});await pending;
  assert.match(ui.automation(),/패턴 판별 · 운영 주체 미확인/);assert.match(ui.automation(),/요청 자동화 표시 · 세션/);
  assert.match(ui.automation(),/접속 제한 없이 통계만 분리/);assert.doesNotMatch(ui.automation(),/Googlebot/);
  assert.match(ui.automation(),/공개 IP 대조 범위 · 전체 봇 목록 아님/);assert.match(ui.automation(),/https:\/\/searchadvisor\.naver\.com\/doc\/naverbot\.json/);
  assert.match(ui.automation(),/목록에 없다는 이유만으로 악의적 접속/);
  assert.match(ui.origin(),/연결 대기/);
});
test('missing automation reader never hides existing bot requests or implies zero automated traffic',async()=>{
  const ui=await workspace(),pending=ui.api.show(ui.host,{range:'7d'});
  await ui.respond('automation-statistics',{},404);await ui.respond('origin-bots',origin());await pending;
  assert.match(ui.automation(),/0건이나 분류 완료를 뜻하지 않습니다/);
  assert.match(ui.origin(),/Googlebot/);assert.match(ui.origin(),/공식 IP 확인/);
});
test('plan and partial statuses are visible and provider identity is never inferred from pattern rows',async()=>{
  const ui=await workspace(),pending=ui.api.show(ui.host,{range:'7d'}),plan=automation('PLAN');plan.partial=true;
  await ui.respond('automation-statistics',plan);await ui.respond('origin-bots',{status:'DISABLED',message:'대기'});await pending;
  assert.match(ui.automation(),/계획 검토 · 미반영/);assert.match(ui.automation(),/패턴 분리 예정/);assert.match(ui.automation(),/부분 범위/);
  assert.match(ui.automation(),/운영 주체의 신원을 확인했다는 뜻이 아닙니다/);
});
test('cancellation prevents stale automation responses from overwriting the next period',async()=>{
  const ui=await workspace(),old=ui.api.show(ui.host,{range:'7d'}),fresh=ui.api.show(ui.host,{range:'today'});
  assert.ok(ui.requests.slice(0,2).every(r=>r.options.signal.aborted));
  await ui.respond('automation-statistics',automation());await ui.respond('origin-bots',origin());await old;
  assert.doesNotMatch(ui.automation(),/패턴으로 분리한/);
  const newer=automation();newer.from=newer.to='2026-11-20';
  await ui.respond('automation-statistics',newer);await ui.respond('origin-bots',origin());await fresh;
  assert.match(ui.automation(),/조회 2026-11-20 ~ 2026-11-20/);
});
test('a stale plan remains clearly unapplied instead of looking like classified production totals',async()=>{
  const ui=await workspace(),pending=ui.api.show(ui.host,{range:'7d'}),plan=automation('STALE');plan.job.applyMode='plan';
  await ui.respond('automation-statistics',plan);await ui.respond('origin-bots',{status:'DISABLED',message:'대기'});await pending;
  assert.match(ui.automation(),/분류 작업 지연 · 계획 검토 · 미반영/);
  assert.match(ui.automation(),/패턴 분리 예정/);assert.doesNotMatch(ui.automation(),/패턴으로 분리한/);
});
