import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('discovery routes allow slow bounded multi-call operations and preserve cancellation', async () => {
 const original=AbortSignal.timeout;
 AbortSignal.timeout=delay=>original(delay===30_000?50:[65_000,105_000].includes(delay)?150:delay);
 const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='#lib/server/intake-runtime.ts')return {url:`data:text/javascript,${encodeURIComponent(`export const githubRuntime=async()=>({repositories:async()=>{await new Promise(r=>setTimeout(r,80));return {repositories:[],complete:true}},issues:async()=>{await new Promise(r=>setTimeout(r,80));return {issues:[],complete:true}}});`)}`,shortCircuit:true};
  return next(specifier,context);
 }});
 try {
  const {GET:repositories}=await import('../src/routes/api/github/repositories/+server.ts');
  const {GET:issues}=await import('../src/routes/api/github/issues/+server.ts');
  const request=new Request('http://localhost/api/github/repositories'), locals={user:{id:'owner'}};
  assert.equal((await repositories({request,locals})).status,200);
  const issueUrl=new URL('http://localhost/api/github/issues?repository=team/repo');
  assert.equal((await issues({request:new Request(issueUrl),locals,url:issueUrl})).status,200);
  const controller=new AbortController();controller.abort();
  assert.equal((await repositories({request:new Request(request,{signal:controller.signal}),locals})).status,504);
 } finally {hooks.deregister();AbortSignal.timeout=original;}
});
