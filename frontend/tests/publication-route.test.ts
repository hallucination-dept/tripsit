import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
const item='11111111-1111-4111-8111-111111111111', candidate='22222222-2222-4222-8222-222222222222', packet='33333333-3333-4333-8333-333333333333';
test('publication route enforces session, same-origin and empty input before calling coordinator', async () => {
 let calls=0;
 (globalThis as any).publishFixture=async (...args:unknown[])=>{calls++;assert.equal(args[0],'owner');return {number:7};};
 const hooks=registerHooks({resolve(specifier,context,next){
  const mocks:Record<string,string>={
   '#lib/auth.js':'export const database={};',
   '#lib/server/assessment-runtime.ts':'export const assessmentRuntime=async()=>({});',
   '#lib/server/assessment.ts':'export const verificationContext=value=>value;',
   '#lib/server/verification.ts':'export const configuredChecks=()=>[];',
   '$app/env/private':'export const TRUSTED_CHECKS_JSON=undefined;',
   '#lib/server/publication.ts':'export const createPublication=()=>({publish:(...args)=>globalThis.publishFixture(...args)});'
  };
  return mocks[specifier]?{url:`data:text/javascript,${encodeURIComponent(mocks[specifier])}`,shortCircuit:true}:next(specifier,context);
 }});
 try {
  const {POST}=await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/packet/[packetId]/publish/+server.ts');
  const event=(owner:string|null,origin='http://localhost',body='{}')=>({request:new Request('http://localhost/api/publish',{method:'POST',headers:{origin,'content-type':'application/json'},body}),locals:{user:owner?{id:owner}:null},params:{id:item,candidateId:candidate,packetId:packet}});
  assert.equal((await POST(event(null))).status,401);
  assert.equal((await POST(event('owner','https://evil.example'))).status,403);
  assert.equal((await POST(event('owner','http://localhost','{"override":true}'))).status,400);
  assert.equal(calls,0);
  const result=await POST(event('owner'));assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(calls,1);
 } finally {hooks.deregister();delete (globalThis as any).publishFixture;}
});
