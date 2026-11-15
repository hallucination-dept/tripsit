import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('decision route enforces sign-in, origin, packet identity, no query overrides and limits',async()=>{
 let calls=0; const global=globalThis as typeof globalThis & { decisionFixture?:()=>unknown };
 global.decisionFixture=()=>{calls++;return {decision:'revise'};};
 const hooks=registerHooks({resolve(specifier,context,next){
  const mocks:Record<string,string>={'#lib/auth.js':'export const database={};','#lib/server/assessment-runtime.ts':'export const assessmentRuntime=async()=>({intake:{}});','#lib/server/human-decision.ts':'export const createHumanDecision=()=>({record:()=>globalThis.decisionFixture(),list:()=>[]});'};
  return mocks[specifier]?{url:`data:text/javascript,${encodeURIComponent(mocks[specifier])}`,shortCircuit:true}:next(specifier,context);
 }});
 try {
  const {POST,GET}=await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/packet/[packetId]/decisions/+server.ts');
  const id='11111111-1111-4111-8111-111111111111';
  const event=(origin='http://localhost',owner=true,packet=id,query='')=>({request:new Request('http://localhost/decisions'+query,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:'{}'}),locals:{user:owner?{id:'owner'}:null},params:{id,candidateId:id,packetId:packet}});
  const getEvent=(owner=true)=>({request:new Request('http://localhost/decisions'),locals:{user:owner?{id:'owner'}:null},params:{id,candidateId:id,packetId:id}});
  assert.equal((await GET(getEvent(false))).status,401);
  assert.equal((await GET(getEvent())).status,200);
  assert.equal((await POST(event('http://localhost',false))).status,401);
  assert.equal((await POST(event('https://evil.example'))).status,403);
  assert.equal((await POST(event('http://localhost',true,'bad'))).status,404);
  assert.equal((await POST(event('http://localhost',true,id,'?override=1'))).status,400);
  assert.equal(calls,0);
  for(let i=0;i<3;i++){const result=await POST(event());assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');}
  assert.equal((await POST(event())).status,429);assert.equal(calls,3);
 } finally {hooks.deregister();delete global.decisionFixture;}
});
