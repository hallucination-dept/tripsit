import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {baselinePolicy} from '../src/lib/server/policy.ts';
import {chromeSession} from './intake-browser.mjs';

// Synthetic protected APIs only: no live authentication, repository, model or storage requests.
const application=new URL(process.env.TRIPSIT_PRESENTATION_ORIGIN || 'http://localhost:5173');
assert(application.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(application.hostname)
 && !application.username && !application.password && application.pathname==='/' && !application.search && !application.hash);
const now=new Date().toISOString(), expiry=new Date(Date.now()+7*86400000).toISOString();
const item={id:'11111111-1111-4111-8111-111111111111',createdAt:now,expiresAt:expiry,snapshot:{repositoryId:1,repository:'team/one',private:false,issueNumber:1,issueId:1,baseSha:'a'.repeat(40),supplied:{title:'Keep the current implementation',body:'Selected snapshot must survive background refresh.',provenance:'supplied'},inferred:[],ownerConfirmed:[]}};
const repositories=[{id:1,fullName:'team/one',private:false},{id:2,fullName:'team/two',private:true}];
const issue=number=>({id:number,number,title:`Issue ${number}`,updatedAt:now});
let phase='normal', requests=0;
const held=[];
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture'), path=url.pathname;
 const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(path==='/api/auth/get-session')return json({user:{id:'fixture-owner',name:'Fixture owner',email:'fixture@example.test',emailVerified:true,createdAt:now,updatedAt:now},session:{id:'fixture-session',token:'synthetic',userId:'fixture-owner',expiresAt:expiry,createdAt:now,updatedAt:now}});
 if(path==='/api/github/repositories'){requests++;return phase==='repository-failure'?json({message:'Temporary repository refresh failure.'},502):json({repositories:phase==='removed'?[repositories[1]]:repositories,complete:true});}
 if(path==='/api/github/issues'){
  if(phase==='issue-failure')return json({message:'Temporary issue refresh failure.'},502);
  if(phase==='hold' && url.searchParams.get('repository')==='team/two'){held.push(()=>{if(!res.destroyed)json({issues:[issue(99)],complete:true});});return;}
  return json({issues:[issue(1),issue(2)],complete:true});
 }
 if(path==='/api/work-items')return json(req.method==='POST'?{item}:{items:[item]});
 if(path.endsWith('/policy'))return json({itemId:item.id,baseSha:item.snapshot.baseSha,snapshotDigest:'c'.repeat(64),policy:baselinePolicy('unknown')});
 if(path.endsWith('/files'))return json({itemId:item.id,baseSha:item.snapshot.baseSha,files:[{path:'fixture.ts',blobSha:'b'.repeat(40)}]});
 if(path.endsWith('/candidates'))return json({id:'22222222-2222-4222-8222-222222222222',candidate:{baseSha:item.snapshot.baseSha,expiresAt:expiry,outputDigest:'d'.repeat(64),model:'fixture-model',settings:{},mapping:{status:'unavailable',reason:'Synthetic fixture.'},observations:{status:'unavailable',count:0},files:[{path:'fixture.ts',originalBlob:'b'.repeat(40),blobSha:'e'.repeat(40),content:'retained candidate fixture'}]}});
 if(path.startsWith('/api/'))return json({message:'No live APIs are forwarded.'},404);
 try{const response=await fetch(application.origin+req.url,{signal:AbortSignal.timeout(10000)});res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/octet-stream'});res.end(Buffer.from(await response.arrayBuffer()));}
 catch{json({message:'Local application unavailable.'},503);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=await chromeSession();
try{
 const context=await chrome.command('Target.createBrowserContext');
 const tab=await chrome.command('Target.createTarget',{url:'about:blank',browserContextId:context.browserContextId});
 const attached=await chrome.command('Target.attachToTarget',{targetId:tab.targetId,flatten:true});
 const command=(method,params={})=>chrome.command(method,params,attached.sessionId);
 const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error('Browser fixture evaluation failed');return result.result.value;};
 const waitFor=async expression=>{const until=Date.now()+15000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(`Browser fixture timed out: ${expression}`);};
 await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
 await waitFor("document.querySelector('#issue-number')?.value==='1' && !document.querySelector('#issue-number').disabled");
 await evaluate("document.querySelector('[aria-labelledby=\"issue-heading\"] button[type=submit]').click()");
 await waitFor("Boolean(document.querySelector('.issue-body') && (document.querySelector('#implement-issue') || document.querySelector('#candidate-files option')))");
 if(await evaluate("Boolean(document.querySelector('#implement-issue'))")){
  await waitFor("!document.querySelector('#implement-issue').disabled");
  await evaluate("document.querySelector('#implement-issue').click()");
 }else{
  await evaluate("const files=document.querySelector('#candidate-files');files.options[0].selected=true;files.dispatchEvent(new Event('change',{bubbles:true}));");
  await waitFor("!document.querySelector('#candidate-files').closest('form').querySelector('button[type=submit]').disabled");
  await evaluate("document.querySelector('#candidate-files').closest('form').querySelector('button[type=submit]').click()");
 }
 await waitFor("document.querySelector('.candidate-preview')?.textContent.includes('retained candidate fixture')");
 const retained="Boolean(document.querySelector('.issue-body') && document.querySelector('.candidate-preview')?.textContent.includes('retained candidate fixture') && document.querySelector('#issue-number').value==='1')";
 for(const failure of ['repository-failure','issue-failure']){
  phase=failure;
  await evaluate("document.querySelector('.panel-footer button').click()");
  await waitFor(`document.querySelector('[aria-labelledby="issue-heading"] [role=alert]')?.textContent.includes('${failure==='repository-failure'?'repository':'issue'} refresh failure')`);
  assert(await evaluate(retained),'Transient background refresh reset the selected snapshot or candidate');
  assert(await evaluate("!document.querySelector('#repository').disabled && !document.querySelector('#issue-number').disabled"),'Cached choices were blocked by background refresh');
 }
 phase='hold';
 await evaluate("(()=>{const repo=document.querySelector('#repository');repo.value='team/two';repo.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await waitFor("document.querySelector('#repository').value==='team/two' && document.querySelector('.sync-state').textContent.includes('Refreshing')");
 assert(await evaluate("!document.querySelector('#repository').disabled"),'Pending issue loading blocked repository switching');
 await evaluate("(()=>{const repo=document.querySelector('#repository');repo.value='team/one';repo.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await waitFor("document.querySelector('#repository').value==='team/one' && document.querySelector('#issue-number').value==='1'");
 held.splice(0).forEach(release=>release());
 assert(await evaluate(retained),'Repository selection reset existing implementation');
 phase='removed';
 await evaluate("document.querySelector('.panel-footer button').click()");
 await waitFor("document.querySelector('#repository').value==='team/two' && !document.querySelector('.issue-body') && !document.querySelector('.candidate-preview')");
 assert(requests>=3);
 console.log(JSON.stringify({scope:'synthetic browser APIs only',passed:['poll failure preserves snapshot and candidate','cached choices stay enabled','pending issue load permits repository switch','authoritative removal clears inaccessible snapshot'],liveApisForwarded:false}));
 await chrome.command('Target.disposeBrowserContext',{browserContextId:context.browserContextId});
}finally{held.splice(0).forEach(release=>release());await chrome.close();await new Promise(resolve=>server.close(resolve));}
