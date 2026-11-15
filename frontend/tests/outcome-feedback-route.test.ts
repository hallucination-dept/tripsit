import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';
test('outcome route requires an authenticated same-origin owner',async()=>{
 let calls=0;const bridge=globalThis as typeof globalThis & {outcomeFixture?:()=>unknown};bridge.outcomeFixture=()=>{calls++;return {id:'record'};};
 const hooks=registerHooks({resolve(specifier,context,next){const mocks:Record<string,string>={'#lib/auth.js':'export const database={};','#lib/server/generation-runtime.ts':'export const candidateServices=async()=>({});','#lib/server/outcome-feedback.ts':'export const createOutcomeFeedback=()=>({record:()=>globalThis.outcomeFixture(),list:()=>({findings:[],decisions:[]})});'};return mocks[specifier]?{url:`data:text/javascript,${encodeURIComponent(mocks[specifier])}`,shortCircuit:true}:next(specifier,context);}});
 try{const {POST}=await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/outcomes/+server.ts');
  const event=(owner:boolean,origin:string)=>({request:new Request('http://localhost/outcomes',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}),locals:{user:owner?{id:'owner'}:null},params:{id:'item',candidateId:'candidate'}});
  assert.equal((await POST(event(false,'http://localhost'))).status,401);assert.equal((await POST(event(true,'https://evil.example'))).status,403);assert.equal(calls,0);
  assert.equal((await POST(event(true,'http://localhost'))).status,200);assert.equal(calls,1);
 }finally{hooks.deregister();delete bridge.outcomeFixture;}
});
