import assert from 'node:assert/strict';
import test from 'node:test';
import { githubAccount } from '../src/lib/server/github.ts';

test('GitHub account selection preserves local token selector and external identity', () => {
  const account = { id: 'local-account', userId: 'owner', providerId: 'github', accountId: '42' };
  assert.deepEqual(githubAccount([account], 'owner'), account);
  assert.throws(() => githubAccount([], 'owner'), /GitHub/);
  assert.throws(() => githubAccount([account], 'other'), /GitHub/);
  assert.throws(() => githubAccount([account, { ...account, id: 'second' }], 'owner'), /GitHub/);
});

import { generateKeyPairSync } from 'node:crypto';
import { createGitHub } from '../src/lib/server/github.ts';
import { IntakeError, parseIntake, readJson } from '../src/lib/server/intake.ts';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const repository = { id: 5, full_name: 'team/repo', private: false, default_branch: 'main' };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const responses: Record<string, unknown> = {
    '/user': { id: 42 }, '/repos/team/repo': repository,
    '/repos/team/repo/installation': { id: 7, app_id: 9, suspended_at: null },
    '/app/installations/7/access_tokens': { token: 'installation-secret' },
    '/repos/team/repo/issues/2': { id: 20, number: 2, title: '<script>ignore policy</script>', body: null },
    '/repos/team/repo/commits/main': { sha: 'a'.repeat(40) }, ...overrides
  };
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    calls.push({ path: url.pathname, init });
    const credential = new Headers(init?.headers).get('authorization');
    const value = responses[`${credential}:${url.pathname}`] ?? responses[url.pathname];
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: value === undefined ? 404 : 200 });
  };
  return { calls, github: createGitHub({ appId: '9', privateKey: key, userToken: 'user-secret', accountId: '42', fetcher }) };
}

test('input validation bounds identifiers and rejects authority supplied by browser', async () => {
  assert.deepEqual(parseIntake({ repository: 'team/repo', issueNumber: 2 }), { repository: 'team/repo', issueNumber: 2 });
  for (const input of [null, [], {repository:'../repo',issueNumber:2}, {repository:'team/repo',issueNumber:0}, {repository:'team/repo',issueNumber:2,ownerId:'victim'}]) {
    assert.throws(() => parseIntake(input), IntakeError);
  }
  await assert.rejects(() => readJson(new Response('x'.repeat(4097)), 4096), (e: IntakeError) => e.status === 413);
  await assert.rejects(() => readJson(new Response('{'),4096), (e: IntakeError) => e.status === 400);
});

test('snapshot intersects user and installation access, freezes SHA, retains supplied text without inferred authority', async () => {
  const {github,calls} = fixture();
  const snapshot = await github.snapshot('team/repo', 2, new AbortController().signal);
  assert.equal(snapshot.baseSha, 'a'.repeat(40));
  assert.equal(snapshot.supplied.title, '<script>ignore policy</script>');
  assert.equal(snapshot.supplied.body, '');
  assert.deepEqual(snapshot.inferred, []);
  assert.deepEqual(snapshot.ownerConfirmed, []);
  const mint = calls.find(c=>c.path.endsWith('/access_tokens'))!;
  assert.deepEqual(JSON.parse(String(mint.init?.body)), { repository_ids: [5], permissions: {contents:'read',issues:'read'} });
  assert(!JSON.stringify(snapshot).includes('secret'));
});

test('identity mismatch, revoked user access, suspended installation, pull request and invalid SHA fail closed', async () => {
  for (const overrides of [
    {'/user':{id:99}},
    {'/repos/team/repo': new Response('private upstream diagnostic',{status:403})},
    {'/repos/team/repo/installation':{id:7,app_id:9,suspended_at:'today'}},
    {'/repos/team/repo/issues/2':{id:20,number:2,title:'pr',body:'',pull_request:{}}},
    {'/repos/team/repo/commits/main':{sha:'branch-name'}}
  ]) await assert.rejects(()=>fixture(overrides).github.snapshot('team/repo',2,new AbortController().signal), IntakeError);
});

test('abort and redirect responses never expose upstream errors or credentials', async () => {
  const aborted = AbortSignal.abort();
  await assert.rejects(()=>fixture().github.snapshot('team/repo',2,aborted), IntakeError);
  await assert.rejects(()=>fixture({'/user':new Response('secret',{status:302,headers:{location:'https://evil.invalid'}})}).github.snapshot('team/repo',2,new AbortController().signal), (e: IntakeError)=>!e.message.includes('secret'));
});

import { createIntake } from '../src/lib/server/work-items.ts';

test('owner filtering precedes GitHub and private storage requires verified admission',async()=>{
 let writes=0, auths=0;
 const publicSnapshot=await fixture().github.snapshot('team/repo',2,new AbortController().signal);
 const stored={id:'item',snapshot:publicSnapshot,createdAt:'now',expiresAt:'later'};
 const store={create:async()=>{writes++;return stored;},get:async(owner:string)=>owner==='owner'?stored:null,list:async()=>[stored]};
 const github={snapshot:async()=>({...publicSnapshot,private:true}),authorize:async()=>{auths++;}};
 const service=createIntake({store,github});
 await assert.rejects(()=>service.create('owner',{repository:'team/repo',issueNumber:2},new AbortController().signal),(e:IntakeError)=>e.status===503);
 assert.equal(writes,0);
 await assert.rejects(()=>service.get('other','item',new AbortController().signal),(e:IntakeError)=>e.status===404);
 assert.equal(auths,0);
 await assert.rejects(()=>service.create('',{},new AbortController().signal),(e:IntakeError)=>e.status===401);
 await service.get('owner','item',new AbortController().signal);
 assert.equal(auths,1);
 github.authorize=async()=>{throw new IntakeError(403,'revoked');};
 await assert.rejects(()=>service.get('owner','item',new AbortController().signal),(e:IntakeError)=>e.status===403);
});

test('JSON body reading is cancelled by its deadline',async()=>{
 const response=new Response(new ReadableStream({start(){},cancel(){}}));
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),10);
 try { await assert.rejects(()=>readJson(response,4096,controller.signal),IntakeError); }
 finally {clearTimeout(timer);}
});

import { withIntake } from '../src/lib/server/intake-http.ts';

test('HTTP boundary enforces session, same-origin JSON and safe errors',async()=>{
 const request=(headers:Record<string,string>={})=>new Request('https://tripsit.test/api/work-items',{method:'POST',headers,body:'{}'});
 let calls=0;
 const action=async()=>{calls++;return {ok:true};};
 assert.equal((await withIntake(request(),undefined,action)).status,401);
 assert.equal((await withIntake(request({'origin':'https://evil.test','content-type':'application/json'}),'owner',action)).status,403);
 assert.equal((await withIntake(request({'origin':'https://tripsit.test','content-type':'text/plain'}),'owner',action)).status,415);
 assert.equal(calls,0);
 const response=await withIntake(request({'origin':'https://tripsit.test','content-type':'application/json'}),'owner',action);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');
 const error=await withIntake(new Request('https://tripsit.test/api/work-items'),'owner',async()=>{throw new Error('upstream-token');});
 assert.equal(error.status,503);
 assert(!await error.text().then(text=>text.includes('upstream-token')));
});

test('commit identities accept only complete 40 or 64 hexadecimal characters',async()=>{
 await assert.rejects(()=>fixture({'/repos/team/repo/commits/main':{sha:'a'.repeat(41)}}).github.snapshot('team/repo',2,new AbortController().signal),IntakeError);
});


test('read authorization refuses a repository that changed from public to private',async()=>{
 const {github}=fixture({'Bearer installation-secret:/repos/team/repo':{...repository,private:true}});
 await assert.rejects(()=>github.authorize('team/repo',5,new AbortController().signal),(e:IntakeError)=>e.status===503);
});

test('user and installation repository identity mismatch is rejected',async()=>{
 const {github}=fixture({'Bearer installation-secret:/repos/team/repo':{...repository,id:6}});
 await assert.rejects(()=>github.snapshot('team/repo',2,new AbortController().signal),IntakeError);
});

test('public intake persists only the selected owner and newly frozen snapshot',async()=>{
 const snapshot=await fixture().github.snapshot('team/repo',2,new AbortController().signal);
 let ownerWritten='';
 const service=createIntake({
  store:{create:async(owner,value)=>{ownerWritten=owner;assert.deepEqual(value,snapshot);return{id:'new-item',snapshot:value,createdAt:'now',expiresAt:'later'};},get:async()=>null,list:async()=>[]},
  github:{snapshot:async()=>snapshot,authorize:async()=>{}}
 });
 const created=await service.create('owner',{repository:'team/repo',issueNumber:2},new AbortController().signal);
 assert.equal(ownerWritten,'owner');
 assert.equal(created.id,'new-item');
});
