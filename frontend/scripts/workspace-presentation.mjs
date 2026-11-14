import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildImpact} from '../src/lib/server/impact-extractor.ts';
import {snapshotPolicy} from '../src/lib/server/snapshot-policy.ts';
import {assessmentView} from '../src/lib/server/assessment-view.ts';
import {chromeSession} from './intake-browser.mjs';
// Synthetic presentation fixtures only; protected requests never reach the real API.
const applicationOrigin=process.env.TRIPSIT_PRESENTATION_ORIGIN || 'http://localhost:5173';
const originURL=new URL(applicationOrigin);
if(originURL.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(originURL.hostname) || originURL.username || originURL.password || originURL.pathname!=='/' || originURL.search || originURL.hash)throw new Error('Use an explicit local HTTP presentation origin.');
const now=new Date();
const item={id:'11111111-1111-4111-8111-111111111111',createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+7*86400000).toISOString(),snapshot:{repositoryId:11,repository:'northstar/payments',private:false,issueNumber:142,issueId:142,baseSha:'a9f31c8'.repeat(6).slice(0,40),supplied:{title:'Retry settled payments without duplicate charges',body:'A failed request can be retried after payment settlement.\n\nExpected behavior\n• Keep one receipt for the original request.\n• Return the existing result for repeated requests.\n\nReproduction\n1. Submit the same request twice.\n2. Verify one charge and one receipt.',provenance:'supplied'},inferred:[],ownerConfirmed:[]}};
const candidateId='22222222-2222-4222-8222-222222222222';
const original='export const receipt = 1;\n';
const replacement='export const receipt = "<script>escaped fixture</script>";\n';
const caller='import { receipt } from "../src/payments.js";\nexport const actual = receipt;\n';
const hash=text=>createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const policy=snapshotPolicy(item);
const candidate={id:candidateId,candidate:{baseSha:item.snapshot.baseSha,expiresAt:item.expiresAt,outputDigest:'d'.repeat(64),model:'synthetic-presentation-model',settings:{temperature:0},mapping:{status:'unavailable',reason:'Exact mapping unavailable.'},observations:{status:'unavailable',count:0},files:[{path:'src/payments.ts',originalBlob:hash(original),blobSha:hash(replacement),content:replacement}]}};
const identity={ownerId:'presentation-user',itemId:item.id,candidateId,baseSha:item.snapshot.baseSha,candidateDigest:candidate.candidate.outputDigest,snapshotDigest:policy.snapshotDigest,policyVersion:policy.policy.version};
const impact=buildImpact({baseSha:item.snapshot.baseSha,candidateDigest:identity.candidateDigest,repositoryPaths:['src/payments.ts','tests/payments.test.ts'],complete:true,files:[{path:'src/payments.ts',base:{content:original,blobSha:hash(original)},candidate:{content:replacement,blobSha:hash(replacement)}},{path:'tests/payments.test.ts',base:{content:caller,blobSha:hash(caller)},candidate:{content:caller,blobSha:hash(caller)}}]});
const syntheticReviews=[];
const syntheticVerifications=[];
let verificationPosts=0;
let reviewPosts=0;
const fixtureAssessment=()=>assessmentView('presentation-user',{identity,repositoryId:11,policy:policy.policy,impact,reviews:syntheticReviews,verifications:syntheticVerifications,files:[],generation:{model:candidate.candidate.model,settingsDigest:'e'.repeat(64),mapping:candidate.candidate.mapping,observedTokens:0}},reviewerIsConfigured,true);
let signedIn=true;
let reviewerIsConfigured=true;
const legacyRequests=[];
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path.startsWith('/api/projects'))legacyRequests.push(path);
 const json=value=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(path==='/api/auth/get-session')return json(signedIn?{user:{id:'presentation-user',name:'Nora Chen',email:'nora@example.test',emailVerified:true,createdAt:now.toISOString(),updatedAt:now.toISOString()},session:{id:'presentation-session',token:'synthetic-presentation-only',userId:'presentation-user',expiresAt:'2099-01-01T00:00:00Z',createdAt:now.toISOString(),updatedAt:now.toISOString()}}:null);
 if(path==='/api/github/repositories')return json({repositories:[{id:11,fullName:'northstar/payments',private:false},{id:12,fullName:'northstar/platform',private:false}],complete:true});
 if(path==='/api/github/issues')return json({issues:[{id:142,number:142,title:item.snapshot.supplied.title,updatedAt:now.toISOString()},{id:137,number:137,title:'Preserve decimal precision in refund totals',updatedAt:now.toISOString()}],complete:true});
 if(path.endsWith('/policy'))return json(policy);
 if(path.endsWith('/files'))return json({itemId:item.id,baseSha:item.snapshot.baseSha,files:[{path:'src/payments.ts',blobSha:hash(original)},{path:'tests/payments.test.ts',blobSha:hash(caller)}]});
 if(path.endsWith('/candidates'))return json(candidate);
 if(path.endsWith('/assessment'))return json(fixtureAssessment());
 if(path.endsWith('/assessment/verification')){verificationPosts++;const check={id:'unchanged-caller-regression',mandatory:true,impact:'high',timeoutMs:1000,provenance:'trusted_repository',definitionDigest:'1'.repeat(64),environmentDigest:'2'.repeat(64),dependencyDigest:'3'.repeat(64),oracleDigest:'4'.repeat(64),requirementIds:['issue-intent'],nodeIds:impact.graph.nodes.filter(node=>node.source?.path==='tests/payments.test.ts').map(node=>node.id)};const artifact={id:'44444444-4444-4444-8444-444444444444',identity,createdAt:now.toISOString(),digest:'5'.repeat(64),result:{checks:[check],executions:[{...check,id:'synthetic-execution',checkId:check.id,collector:'trusted_runner',runnerId:'synthetic-runner',prId:null,status:'completed',result:'failed',exitCode:1,executedTests:1}],admission:{status:'passed',configurationDigest:'6'.repeat(64),codeDigest:'7'.repeat(64),environmentDigest:check.environmentDigest}}};syntheticVerifications.splice(0,syntheticVerifications.length,artifact);return json({verification:artifact});}
 if(path.endsWith('/reviews')){reviewPosts++;const artifact={id:'33333333-3333-4333-8333-333333333333',identity,createdAt:now.toISOString(),digest:'f'.repeat(64),result:{status:'completed',baseSha:identity.baseSha,candidateDigest:identity.candidateDigest,model:'synthetic-reviewer',destination:'https://reviewer.example',retentionDisclosure:'Synthetic presentation only.',promptDigest:'a'.repeat(64),responseDigest:'b'.repeat(64),claims:[{id:'C1',requirementIds:['issue-intent'],nodeIds:[impact.graph.nodes[0].id],statement:'<script>Review fixture requires duplicate-request coverage</script>',stance:'uncertain',counterexample:'Retried requests need an explicit check.'}],checks:[{id:'T1',requirementIds:['issue-intent'],nodeIds:[],description:'Exercise a duplicate request; not executed.'}]}};syntheticReviews.splice(0,syntheticReviews.length,artifact);return json({review:artifact});}
 if(path==='/api/work-items')return json(req.method==='POST'?{item}:{items:[item]});
 if(path.startsWith('/api/work-items/'))return json({item});
 if(path==='/api/review')return json({review:'Review fixture: verify retry behavior at the payment boundary and exercise duplicate request IDs.',tokens:[]});
 if(path.startsWith('/api/')){res.writeHead(404);return res.end();}
 try{const upstream=await fetch(originURL.origin+req.url,{signal:AbortSignal.timeout(10000)});res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/octet-stream'});res.end(Buffer.from(await upstream.arrayBuffer()));}
 catch{res.writeHead(503);res.end('Presentation fixture unavailable');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=await chromeSession();
const reports=[];
try{
 for(const target of [{name:'desktop',width:1440,height:1000,auth:true},{name:'mobile',width:390,height:844,auth:true},{name:'signin',width:1440,height:1000,auth:false},{name:'unavailable',width:390,height:844,auth:true,review:false}]){
  signedIn=target.auth;
  reviewerIsConfigured=target.review!==false;
  syntheticReviews.length=0;
  syntheticVerifications.length=0;
  const beforeVerificationPosts=verificationPosts;
  const beforeReviewPosts=reviewPosts;
  const context=await chrome.command('Target.createBrowserContext');
  const tab=await chrome.command('Target.createTarget',{url:'about:blank',browserContextId:context.browserContextId});
  const attached=await chrome.command('Target.attachToTarget',{targetId:tab.targetId,flatten:true});
  const command=(method,params={})=>chrome.command(method,params,attached.sessionId);
  await command('Emulation.setDeviceMetricsOverride',{width:target.width,height:target.height,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error('Fixture evaluation failed');return result.result.value;};
  const waitFor=async expression=>{const until=Date.now()+15000;while(Date.now()<until){try{if(await evaluate(expression))return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Fixture UI readiness timed out');};
  await waitFor(target.auth?"Boolean(document.querySelector('#repository option[value=\"northstar/payments\"]') && !document.querySelector('#repository').disabled)":"Boolean([...document.querySelectorAll('button')].find(button=>button.textContent.includes('Continue with GitHub')))");
  if(target.auth){await evaluate("document.querySelector('[aria-labelledby=\"issue-heading\"] button[type=\"submit\"]').click()");await waitFor("Boolean(document.querySelector('.issue-body'))");await waitFor("Boolean(document.querySelector('#candidate-files option'))");await evaluate("const selected=document.querySelector('#candidate-files');selected.options[0].selected=true;selected.dispatchEvent(new Event('change',{bubbles:true}));");await waitFor("!document.querySelector('#candidate-files').closest('form').querySelector('button[type=submit]').disabled");await evaluate("document.querySelector('#candidate-files').closest('form').querySelector('button[type=submit]').click()");await waitFor("Boolean(document.querySelector('.candidate-preview'))");await waitFor("document.querySelector('.inspection')?.textContent.includes('Assessment loaded for the selected candidate.')");if(reviewPosts!==beforeReviewPosts || verificationPosts!==beforeVerificationPosts)throw new Error('Inspection started a costly operation automatically');if(target.review===false){if(!await evaluate("document.querySelector('.inspection button').disabled && document.querySelector('.inspection').textContent.includes('Independent reviewer unavailable')"))throw new Error('Missing reviewer did not remain unavailable');}else{if(await evaluate("document.querySelector('.inspection button').disabled"))throw new Error('Expected fixture review button enabled');await evaluate("document.querySelector('.inspection button').click()");await waitFor("document.querySelector('.inspection')?.textContent.includes('synthetic-reviewer')");if(!await evaluate("document.querySelector('.inspection').textContent.includes('<script>Review fixture') && !document.querySelector('.inspection script')"))throw new Error('Untrusted review text was not escaped');}}
  if(target.auth && target.review!==false){await evaluate("[...document.querySelectorAll('.inspection button')].find(button=>button.textContent==='Run trusted checks').click()");await waitFor("document.querySelector('.inspection')?.textContent.includes('Recorded check executions')");if(!await evaluate("document.querySelector('.inspection').textContent.includes('unchanged-caller-regression') && document.querySelector('.inspection').textContent.includes('failed · current') && document.querySelector('.inspection').textContent.includes('tests/payments.test.ts')"))throw new Error('Missing downstream failure trace');}
  if(target.auth){await evaluate("const input=document.querySelector('#code');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'function total(items) { return items.length; }');input.dispatchEvent(new Event('input',{bubbles:true}));");await waitFor("!document.querySelector('#code').closest('form').querySelector('button[type=submit]').disabled");await evaluate("document.querySelector('#code').closest('form').querySelector('button[type=submit]').click()");await waitFor("Boolean(document.querySelector('.review')?.textContent.includes('Review fixture'))");}
  await new Promise(resolve=>setTimeout(resolve,300));
  const layout=await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,headings:[...document.querySelectorAll('h1,h2')].map(n=>n.textContent)})");
  const metrics=await command('Page.getLayoutMetrics');
  const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:target.width,height:Math.min(metrics.cssContentSize.height,2200),scale:1}});
  const path=`/tmp/tripsit-ui-${target.name}.png`;await writeFile(path,Buffer.from(screenshot.data,'base64'));
  if(target.auth){const bounds=await evaluate("(()=>{const r=document.querySelector('.inspection').getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height};})()");const panel=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{...bounds,height:Math.min(bounds.height,1600),scale:1}});await writeFile(`/tmp/tripsit-inspection-${target.name}.png`,Buffer.from(panel.data,'base64'));}
  reports.push({fixture:target.name,path,...layout,overflow:layout.scrollWidth>layout.width});
  await chrome.command('Target.disposeBrowserContext',{browserContextId:context.browserContextId});
 }
}finally{await chrome.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({scope:'synthetic presentation fixtures; no authentication or real API acceptance claimed',legacyRequests,reviewPosts,verificationPosts,reports}));
if(legacyRequests.length || reports.some(report=>report.overflow))process.exitCode=1;
