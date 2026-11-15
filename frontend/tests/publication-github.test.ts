import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { stageCandidate } from '../src/lib/server/candidate-staging.ts';
import { writeStagedGitObjects, publicationGitHubTransport } from '../src/lib/server/publication-git.ts';

const base = 'a'.repeat(40), emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const content = new TextEncoder().encode('hello\n');
const candidate = {baseSha:base,files:[{path:'src/new.ts',originalBlob:null,content,blobSha:createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')}]};
const stage = () => stageCandidate(base,emptyTree,[],candidate as never,'2026-01-01T00:00:00.000Z');

test('reproduces blobs, nested trees and commit with per-write authorization and verified SHAs', async () => {
 const staged = stage(); let index=0, authorized=0;
 const sha = await writeStagedGitObjects(staged.objects,async (path,body) => {
  assert.equal(authorized,index+1);
  const object=staged.objects[index++]; assert.equal(path,`/git/${object.type === 'blob' ? 'blobs' : object.type === 'tree' ? 'trees' : 'commits'}`);
  if (object.type === 'commit') { assert.equal((body as any).tree,staged.rootSha); assert.deepEqual((body as any).parents,[base]); }
  return {sha:object.sha};
 },async () => { authorized++; },new AbortController().signal);
 assert.equal(sha,staged.commitSha); assert.equal(index,staged.objects.length);
});

test('rejects corrupted inputs before writes and stops on revoked authorization or mismatch', async () => {
 const staged = stage(); let calls=0;
 await assert.rejects(writeStagedGitObjects(staged.objects.map((row,index)=> index ? row : {...row,content:'YQ=='}),async()=>{calls++;return {};},async()=>{},new AbortController().signal));
 assert.equal(calls,0);
 await assert.rejects(writeStagedGitObjects(staged.objects,async()=>{calls++;return {sha:'f'.repeat(40)};},async()=>{},new AbortController().signal)); assert.equal(calls,1);
 calls=0; await assert.rejects(writeStagedGitObjects(staged.objects,async()=>{calls++;return {};},async()=>{throw Error('revoked');},new AbortController().signal)); assert.equal(calls,0);
});

test('transport only posts bounded fixed endpoints without exposing upstream errors', async () => {
 let called=0;
 const send=publicationGitHubTransport('team/repo','fixture',async (url,init)=>{called++;assert.equal(String(url),'https://api.github.com/repos/team/repo/git/blobs');assert.equal(init?.redirect,'error');return new Response('private upstream', {status:403});});
 await assert.rejects(send('/git/blobs',{},new AbortController().signal),error=>error.status===502&&!error.message.includes('private')); assert.equal(called,1);
 await assert.rejects(send('/pulls',{},new AbortController().signal)); assert.equal(called,1);
});
