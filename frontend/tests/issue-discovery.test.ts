import assert from 'node:assert/strict';
import test from 'node:test';
import { createIssueDiscovery } from '../src/lib/issue-discovery.ts';
const repositories = [{ id: 1, fullName: 'team/one', private: false }, { id: 2, fullName: 'team/two', private: true }];
const issue = (number: number) => ({ id: number, number, title: `Issue ${number}`, updatedAt: '2026-01-01T00:00:00Z' });
const response = (value: unknown) => new Response(JSON.stringify(value));
test('discovery loads automatically, polls, preserves valid choices and removes closed issues', async () => {
 const calls: string[]=[]; const timers: (()=>void)[]=[]; let currentIssues=[issue(1),issue(2)];
 const discovery=createIssueDiscovery({fetcher:async input=>{calls.push(String(input));return response(String(input).includes('repositories')?{repositories,complete:true}:{issues:currentIssues,complete:true});},schedule:(run,delay)=>{assert.equal(delay,60_000);timers.push(run);return()=>{const i=timers.indexOf(run);if(i!==-1)timers.splice(i,1);};}});
 await discovery.start('owner');assert.equal(discovery.state.repository,'team/one');assert.equal(discovery.state.issueNumber,1);
 discovery.selectIssue(2);await timers.shift()!();assert.equal(discovery.state.issueNumber,2);
 currentIssues=[issue(3)];await timers.shift()!();assert.equal(discovery.state.issueNumber,3);assert.equal(discovery.state.issuesComplete,true);assert.equal(calls.length,6);
 discovery.stop();assert.equal(timers.length,0);
});
test('repository changes and sign-out discard responses even when transport ignores abort',async()=>{
 let finish:(value:Response)=>void=()=>{};let slow=false;const signals:AbortSignal[]=[];
 const discovery=createIssueDiscovery({fetcher:async(input,init)=>{signals.push(init!.signal as AbortSignal);if(String(input).includes('repositories'))return response({repositories,complete:true});if(slow)return new Promise<Response>(resolve=>{finish=resolve;});return response({issues:[issue(1)],complete:true});},schedule:()=>()=>{}});
 await discovery.start('owner-a');slow=true;const previous=discovery.selectRepository('team/two');await Promise.resolve();slow=false;await discovery.start('owner-b');finish(response({issues:[issue(99)],complete:true}));await previous;
 assert.equal(discovery.state.owner,'owner-b');assert.equal(discovery.state.repository,'team/one');assert.equal(discovery.state.issueNumber,1);assert(signals.some(s=>s.aborted));discovery.stop();assert.equal(discovery.state.owner,'');assert.deepEqual(discovery.state.repositories,[]);
});
test('unavailable discovery clears stale choices and ignores overlapping refreshes',async()=>{
 let deny=false;let finish:(value:Response)=>void=()=>{};let pending=false;let requests=0;
 const discovery=createIssueDiscovery({fetcher:async input=>{requests++;if(pending)return new Promise<Response>(resolve=>{finish=resolve;});if(deny)return new Response(JSON.stringify({message:'GitHub access denied.'}),{status:403});return response(String(input).includes('repositories')?{repositories,complete:true}:{issues:[],complete:true});},schedule:()=>()=>{}});
 await discovery.start('owner');assert.equal(discovery.state.issueNumber,0);pending=true;const refreshing=discovery.refresh();await discovery.refresh();assert.equal(requests,3);pending=false;finish(response({repositories,complete:true}));await refreshing;deny=true;await discovery.refresh();assert.equal(discovery.state.repository,'');assert.deepEqual(discovery.state.issues,[]);assert.match(discovery.state.error,/denied/);assert.equal(discovery.state.loading,false);discovery.stop();
});
test('same-owner repository change cancels the old issue request and revoked repos lose selection',async()=>{
 let finish:(value:Response)=>void=()=>{};let slow=false;let available=repositories;
 const discovery=createIssueDiscovery({fetcher:async input=>{if(String(input).includes('repositories'))return response({repositories:available,complete:true});if(slow&&String(input).includes('two'))return new Promise<Response>(resolve=>{finish=resolve;});return response({issues:[issue(1)],complete:true});},schedule:()=>()=>{}});
 await discovery.start('owner');slow=true;const old=discovery.selectRepository('team/two');await Promise.resolve();await discovery.selectRepository('team/one');finish(response({issues:[issue(99)],complete:true}));await old;
 assert.equal(discovery.state.repository,'team/one');assert.equal(discovery.state.issueNumber,1);available=[];await discovery.refresh();assert.equal(discovery.state.repository,'');assert.equal(discovery.state.issueNumber,0);assert.deepEqual(discovery.state.issues,[]);discovery.stop();
});


test('transient repository and issue refresh failures preserve last valid options and selected issue', async () => {
 for (const stage of ['repositories', 'issues']) for (const failure of ['http', 'network', 'timeout']) {
  let failing=false;
  const discovery=createIssueDiscovery({fetcher:async input=>{
   const repositoriesRequest=String(input).includes('repositories');
   if(failing && repositoriesRequest===(stage==='repositories')) {
    if(failure==='http')return new Response(JSON.stringify({message:'Temporarily unavailable.'}),{status:502});
    throw new DOMException('Refresh could not finish.',failure==='timeout'?'TimeoutError':'NetworkError');
   }
   return response(repositoriesRequest?{repositories,complete:true}:{issues:[issue(1),issue(2)],complete:true});
  },schedule:()=>()=>{}});
  await discovery.start('owner');discovery.selectIssue(2);failing=true;await discovery.refresh();
  assert.equal(discovery.state.repository,'team/one');assert.equal(discovery.state.issueNumber,2);
  assert.deepEqual(discovery.state.repositories,repositories);assert.deepEqual(discovery.state.issues,[issue(1),issue(2)]);
  assert(discovery.state.error);assert.equal(discovery.state.loading,false);discovery.stop();
 }
});

test('partial refresh does not mistake omitted cached choices for closed issues or removed repository access', async () => {
 let partial=false;
 const discovery=createIssueDiscovery({fetcher:async input=>response(String(input).includes('repositories')?
  {repositories:partial?[repositories[1]]:repositories,complete:!partial}:{issues:partial?[issue(3)]:[issue(1),issue(2)],complete:!partial}),schedule:()=>()=>{}});
 await discovery.start('owner');discovery.selectIssue(2);partial=true;await discovery.refresh();
 assert.equal(discovery.state.repository,'team/one');assert.equal(discovery.state.issueNumber,2);
 assert.equal(discovery.state.repositories.length,2);assert.deepEqual(discovery.state.issues.map(row=>row.number),[1,2,3]);
 assert.equal(discovery.state.repositoriesComplete,false);assert.equal(discovery.state.issuesComplete,false);discovery.stop();
});

test('authoritative issue access denial removes only that repository while a session denial removes all cached access', async () => {
 let denied=false, sessionDenied=false;
 const discovery=createIssueDiscovery({fetcher:async input=>{
  if(sessionDenied)return new Response('not JSON',{status:401});
  if(denied && !String(input).includes('repositories'))return new Response(JSON.stringify({message:'Repository access denied.'}),{status:403});
  return response(String(input).includes('repositories')?{repositories,complete:true}:{issues:[issue(1)],complete:true});
 },schedule:()=>()=>{}});
 await discovery.start('owner');denied=true;await discovery.refresh();
 assert.deepEqual(discovery.state.repositories,[repositories[1]]);assert.equal(discovery.state.repository,'');assert.deepEqual(discovery.state.issues,[]);
 sessionDenied=true;await discovery.refresh();assert.deepEqual(discovery.state.repositories,[]);assert.equal(discovery.state.repository,'');discovery.stop();
});

test('repository and issue requests each receive a full deadline', async () => {
 const original = AbortSignal.timeout;
 AbortSignal.timeout = delay => original([70_000, 110_000].includes(delay) ? 150 : delay);
 const delay = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, 100);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Timed out', 'TimeoutError')); }, { once: true });
 });
 try {
  const discovery = createIssueDiscovery({ fetcher: async (url, options) => {
   await delay(options!.signal as AbortSignal);
   return response(String(url).includes('repositories') ? { repositories, complete: true } : { issues: [issue(1)], complete: true });
  }, schedule: () => () => {} });
  await discovery.start('owner');
  assert.equal(discovery.state.error, ''); assert.equal(discovery.state.issueNumber, 1);
  discovery.stop();
 } finally { AbortSignal.timeout = original; }
});

test('a late response from a transport that ignores a request deadline is discarded', async () => {
 const original = AbortSignal.timeout;
 AbortSignal.timeout = delay => original([70_000, 110_000].includes(delay) ? 30 : delay);
 let requests = 0;
 try {
  const discovery = createIssueDiscovery({ fetcher: async () => { requests++; await new Promise(resolve => setTimeout(resolve, 60)); return response({ repositories, complete: true }); }, schedule: () => () => {} });
  await discovery.start('owner');
  assert.equal(requests, 1); assert.deepEqual(discovery.state.repositories, []); assert(discovery.state.error);
  discovery.stop();
 } finally { AbortSignal.timeout = original; }
});
