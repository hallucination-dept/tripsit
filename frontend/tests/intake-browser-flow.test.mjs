import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { chromeSession, page, ownerFlow } from '../scripts/intake-browser.mjs';

// This unauthenticated local fixture tests the harness, never TripSit acceptance.
const item = { id: 'fixture-id', expiresAt: '2099-01-01T00:00:00Z', snapshot: { repository: 'team/repo', issueNumber: 2, baseSha: 'a'.repeat(40), supplied: { title: '<script>fixture</script>', body: '<img src=fixture>' } } };
function fixture(mode) {
  return `<section aria-labelledby="issue-heading"><select id="repository"><option value="team/repo">team/repo</option></select><select id="issue-number"><option value="2">#2</option></select><button type="submit">Snapshot issue</button><button id="reload">Reload my snapshots</button><ul></ul><div id="content"></div></section><button id="signout">Sign out</button><script>
  const item=${JSON.stringify(item).replaceAll('<', '\\u003c')}; const mode=${JSON.stringify(mode)};
  function render(value){const root=document.querySelector('#content'); root.replaceChildren();const title=document.createElement('h3');title.textContent=value.snapshot.supplied.title;root.append(title);const code=document.createElement('code');code.textContent=value.snapshot.baseSha;root.append(code);const body=document.createElement('p');body.className='issue-body';body.textContent=value.snapshot.supplied.body;root.append(body);const text=document.createElement('p');text.textContent='Supplied issue text (unconfirmed) Inferred expectations: 0 Owner-confirmed criteria: 0 Snapshot expires';root.append(text);}
  document.querySelector('[type=submit]').onclick=()=>render(item);
  document.querySelector('#reload').onclick=()=>{const ul=document.querySelector('ul');ul.replaceChildren();const li=document.createElement('li');const button=document.createElement('button');button.textContent='team/repo #2';button.onclick=async()=>{if(mode==='noop')return;button.disabled=true;const response=await fetch('/api/work-items/'+item.id);if(response.ok)render((await response.json()).item);button.disabled=false;};li.append(button);ul.append(li);};
  document.querySelector('#signout').onclick=()=>document.body.replaceChildren();
  </script>`;
}

test('real Chrome harness rejects no-op and denied detail actions instead of accepting retained create content', async () => {
  let mode = 'noop';
  const server = createServer((request,response) => {
    if (request.url === '/') {response.setHeader('Content-Type','text/html');response.end(fixture(mode));}
    else {response.setHeader('Content-Type','application/json');if(request.url==='/api/work-items')response.end(JSON.stringify({items:[item]}));else if(mode==='denied'){response.statusCode=403;response.end('{}');}else response.end(JSON.stringify({item}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const chrome=await chromeSession();
  try {
    for(const current of ['noop','denied']) {
      mode=current; const evaluate=await page(chrome,origin);
      await assert.rejects(()=>evaluate(`(${ownerFlow.toString()})('team/repo',2,600)`));
    }
    mode='valid';const evaluate=await page(chrome,origin);
    const result=await evaluate(`(${ownerFlow.toString()})('team/repo',2,3000)`);
    assert.equal(result.detail,true);assert.equal(result.itemId,item.id);assert.equal(result.hostileFixture,true);
  } finally {await chrome.close();await new Promise(resolve=>server.close(resolve));}
});

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('repeated real Chrome smoke reports success only after successful process cleanup', async () => {
  for (let run=0;run<5;run++) {
    const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/intake-browser.mjs',import.meta.url)),'--browser-smoke'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    assert.equal(code,0);assert.match(stdout,/^PASS: .*profile cleanup/);assert.equal(stderr,'');
  }
});
