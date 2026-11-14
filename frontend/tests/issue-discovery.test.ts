import assert from 'node:assert/strict';
import test from 'node:test';
import { createIssueDiscovery } from '../src/lib/issue-discovery.ts';
const repositories = [{ id: 1, fullName: 'team/one', private: false }, { id: 2, fullName: 'team/two', private: true }];
const issue = (number: number) => ({ id: number, number, title: `Issue ${number}`, updatedAt: '2026-01-01T00:00:00Z' });
const response = (value: unknown) => new Response(JSON.stringify(value));
test('discovery loads automatically, polls, preserves valid choices and removes closed issues', async () => {
 const calls: string[]=[]; const timers: (()=>void)[]=[]; let currentIssues=[issue(1),issue(2)];
 const discovery=createIssueDiscovery({fetcher:async input=>{calls.push(String(input));return response(String(input).includes('repositories')?{repositories,complete:true}:{issues:currentIssues,complete:false});},schedule:(run,delay)=>{assert.equal(delay,60_000);timers.push(run);return()=>{const i=timers.indexOf(run);if(i!==-1)timers.splice(i,1);};}});
 await discovery.start('owner');assert.equal(discovery.state.repository,'team/one');assert.equal(discovery.state.issueNumber,1);
 discovery.selectIssue(2);await timers.shift()!();assert.equal(discovery.state.issueNumber,2);
 currentIssues=[issue(3)];await timers.shift()!();assert.equal(discovery.state.issueNumber,3);assert.equal(discovery.state.issuesComplete,false);assert.equal(calls.length,6);
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
