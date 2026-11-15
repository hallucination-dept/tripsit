"""Offline runner boundaries; these never certify Modal admission or execute candidate code."""
import asyncio
import base64
import copy
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner


def fixture():
    content = 'export function value(x) { return x + 1; }\n'
    return {'identity': {'ownerId':'owner', 'itemId':'11111111-1111-4111-8111-111111111111',
                        'candidateId':'22222222-2222-4222-8222-222222222222', 'baseSha':'b'*40,
                        'candidateDigest':'c'*64, 'snapshotDigest':'d'*64, 'policyVersion':'baseline-1'},
            'files':[{'path':'value.mjs','content':content,'blobSha':hashlib.sha1(f'blob {len(content.encode())}\0'.encode()+content.encode()).hexdigest()}],
            'checks':[{'id':'value-check','language':'javascript','path':'value.mjs','export':'value',
                       'cases':[{'args':[1],'expected':2}], 'requirementIds':['R1'],'nodeIds':['n1'],
                       'mandatory':True,'impact':'high','timeoutMs':1000}], 'prId':None}


def exact_fixture():
    value=fixture()
    value['files'][0]['mode']='100755'
    file=value['files'][0]
    tree=b'100755 value.mjs\0'+bytes.fromhex(file['blobSha'])
    tree_sha=hashlib.sha1(f'tree {len(tree)}\0'.encode()+tree).hexdigest()
    commit=f'tree {tree_sha}\nparent {value["identity"]["baseSha"]}\nauthor TripSit <tripsit@localhost> 0 +0000\ncommitter TripSit <tripsit@localhost> 0 +0000\n\nStage candidate\n'.encode()
    value['revision']={'treeSha':tree_sha,'commitSha':hashlib.sha1(f'commit {len(commit)}\0'.encode()+commit).hexdigest(),
                       'commitObject':base64.b64encode(commit).decode()}
    return value


class FakeSandbox:
    def __init__(self, response=None):
        self.response=response
        self.terminated=0
        self.requests=[]
        self.ready=asyncio.Event()
    async def run(self, mode, payload, timeout, cancel):
        if mode=='cancel_probe':
            self.ready.set()
            await cancel.wait()
            raise runner.RunnerError()
        self.requests.append((mode,payload,timeout))
        if isinstance(self.response,Exception): raise self.response
        return self.response
    async def terminate(self): self.terminated+=1


class RunnerTests(unittest.IsolatedAsyncioTestCase):
    def test_complete_revision_validates_commit_parent_tree_modes_and_files(self):
        value=exact_fixture()
        self.assertEqual(subprocess.run(['git','hash-object','-t','commit','--stdin'],input=base64.b64decode(value['revision']['commitObject']),capture_output=True,check=True).stdout.decode().strip(),value['revision']['commitSha'])
        self.assertEqual(runner.validate_request(value),value)
        for change in [lambda v:v['revision'].update(commitSha='a'*40),
                       lambda v:v['revision'].update(treeSha='a'*40),
                       lambda v:v['identity'].update(baseSha='a'*40),
                       lambda v:v['files'][0].update(mode='120000'),
                       lambda v:v['files'][0].update(mode='100644'),
                       lambda v:v['files'][0].update(content='\0'),
                       lambda v:v['files'].append({**v['files'][0], 'path':'additional.mjs'}),
                       lambda v:v['revision'].update(commitObject='!')]:
            altered=copy.deepcopy(value); change(altered)
            with self.assertRaises(runner.RunnerError): runner.validate_request(altered)

    def test_nested_complete_tree_cannot_omit_unchanged_file(self):
        value=exact_fixture()
        first=value['files'][0]; first['path']='src/value.mjs'
        other={**first,'path':'src/other.mjs','mode':'100644'}
        value['files'].append(other)
        subtree=b'100644 other.mjs\0'+bytes.fromhex(other['blobSha'])+b'100755 value.mjs\0'+bytes.fromhex(first['blobSha'])
        subhash=hashlib.sha1(f'tree {len(subtree)}\0'.encode()+subtree).digest()
        root=b'40000 src\0'+subhash
        tree_sha=hashlib.sha1(f'tree {len(root)}\0'.encode()+root).hexdigest()
        commit=f'tree {tree_sha}\nparent {value["identity"]["baseSha"]}\nauthor TripSit <tripsit@localhost> 0 +0000\ncommitter TripSit <tripsit@localhost> 0 +0000\n\nStage candidate\n'.encode()
        value['revision']={'treeSha':tree_sha,'commitSha':hashlib.sha1(f'commit {len(commit)}\0'.encode()+commit).hexdigest(),
                           'commitObject':base64.b64encode(commit).decode()}
        value['checks'][0]['path']=first['path']
        self.assertEqual(runner.validate_request(value),value)
        value['files'].pop()
        with self.assertRaises(runner.RunnerError): runner.validate_request(value)

    def test_exact_revision_rejects_sha256_parent_even_with_matching_commit(self):
        value=exact_fixture()
        value['identity']['baseSha']='f'*64
        tree_sha=value['revision']['treeSha']
        commit=f'tree {tree_sha}\nparent {value["identity"]["baseSha"]}\nauthor TripSit <tripsit@localhost> 0 +0000\ncommitter TripSit <tripsit@localhost> 0 +0000\n\nStage candidate\n'.encode()
        value['revision']['commitSha']=hashlib.sha1(f'commit {len(commit)}\0'.encode()+commit).hexdigest()
        value['revision']['commitObject']=base64.b64encode(commit).decode()
        with self.assertRaises(runner.RunnerError): runner.validate_request(value)

    def test_exact_revision_rejects_malformed_commit_even_when_hash_matches(self):
        original=exact_fixture()
        raw=base64.b64decode(original['revision']['commitObject'])
        author=b'author TripSit <tripsit@localhost> 0 +0000\n'
        committer=b'committer TripSit <tripsit@localhost> 0 +0000\n'
        for commit in (raw.replace(author,b''),raw.replace(committer,b''),raw.replace(author,author+author),
                       raw.replace(committer,b'committer invalid\n')):
            value=copy.deepcopy(original)
            value['revision']['commitSha']=hashlib.sha1(f'commit {len(commit)}\0'.encode()+commit).hexdigest()
            value['revision']['commitObject']=base64.b64encode(commit).decode()
            with self.assertRaises(runner.RunnerError): runner.validate_request(value)

    async def test_verified_revision_echoed_without_changing_legacy_response(self):
        sandbox=FakeSandbox({'controls':{key:True for key in runner.PROBE_CONTROLS}})
        async def factory(): return sandbox
        service=runner.Runner(factory,'image-fixture')
        await service.verify()
        sandbox.response={'results':[{'checkId':'value-check','status':'completed','result':'passed','exitCode':0,'executedTests':1}]}
        value=exact_fixture()
        self.assertEqual((await service.execute(value))['revision'],value['revision'])
        self.assertNotIn('revision',await service.execute(fixture()))

    def test_exact_source_checks_and_caps(self):
        value=fixture()
        self.assertEqual(runner.validate_request(value), value)
        for mutation in [lambda v:v['files'][0].update(path='../escape.mjs'),
                         lambda v:v['files'][0].update(blobSha='a'*40),
                         lambda v:v['files'].append(copy.deepcopy(v['files'][0])),
                         lambda v:v['checks'][0].update(cases=[]),
                         lambda v:v['checks'][0].update(timeoutMs=60001),
                         lambda v:v['checks'][0].update(command='echo passed'),
                         lambda v:v['identity'].update(ownerId=''),
                         lambda v:v.update(private=True),
                         lambda v:v['files'][0].update(content='\ud800')]:
            changed=copy.deepcopy(value); mutation(changed)
            with self.assertRaises(runner.RunnerError): runner.validate_request(changed)

    async def test_unverified_or_stale_admission_creates_no_candidate_sandbox(self):
        created=[]
        async def factory(): created.append(True); return FakeSandbox()
        service=runner.Runner(factory, 'image-fixture')
        with self.assertRaises(runner.RunnerError): await service.execute(fixture())
        self.assertEqual(created,[])
        self.assertEqual(service.admission()['status'],'unavailable')

    async def test_actual_control_report_is_required_and_termination_always_happens(self):
        sandbox=FakeSandbox({'controls':{key:True for key in runner.PROBE_CONTROLS}})
        async def factory(): return sandbox
        service=runner.Runner(factory,'image-fixture')
        result=await service.verify()
        self.assertEqual(result['status'],'passed')
        self.assertEqual(sandbox.terminated,1)
        for key in runner.PROBE_CONTROLS:
            sandbox.response={'controls':{name:name!=key for name in runner.PROBE_CONTROLS}}
            self.assertEqual((await service.verify())['status'],'unavailable')
        self.assertEqual(service.admission()['status'],'unavailable')

    async def test_coordinator_binds_results_and_rejects_forged_or_zero_test_success(self):
        sandbox=FakeSandbox({'controls':{key:True for key in runner.PROBE_CONTROLS}})
        async def factory(): return sandbox
        service=runner.Runner(factory,'image-fixture')
        await service.verify()
        sandbox.response={'results':[{'checkId':'value-check','status':'completed','result':'passed','exitCode':0,'executedTests':1}]}
        report=await service.execute(fixture())
        self.assertEqual(report['identity'], fixture()['identity'])
        self.assertEqual(report['executions'][0]['collector'],'trusted_runner')
        self.assertEqual(report['executions'][0]['executedTests'],1)
        self.assertEqual(report['checks'][0]['oracleDigest'], runner.digest(fixture()['checks'][0]['cases']))
        self.assertEqual(len(report['checks'][0]['dependencyDigest']),64)
        sandbox.response['results'][0]['executedTests']=0
        with self.assertRaises(runner.RunnerError): await service.execute(fixture())
        sandbox.response['results'][0]['executedTests']=1
        sandbox.response['results'][0]['checkId']='unknown'
        with self.assertRaises(runner.RunnerError): await service.execute(fixture())
        self.assertEqual(sandbox.terminated,4)

    async def test_deadline_and_cancellation_terminate_and_never_leak_upstream_errors(self):
        sandbox=FakeSandbox({'controls':{key:True for key in runner.PROBE_CONTROLS}})
        async def factory(): return sandbox
        service=runner.Runner(factory,'image-fixture')
        await service.verify()
        sandbox.response=RuntimeError('secret code or credentials')
        with self.assertRaisesRegex(runner.RunnerError,'Execution unavailable'):
            await service.execute(fixture())
        self.assertEqual(sandbox.terminated,2)
        cancelled=asyncio.Event(); cancelled.set()
        with self.assertRaises(runner.RunnerError): await service.execute(fixture(), cancelled)
        self.assertEqual(sandbox.terminated,2)

    async def test_cancellation_before_factory_result_cleans_late_handle_without_dispatch(self):
        release=asyncio.Event(); entered=asyncio.Event()
        sandbox=FakeSandbox()
        async def factory():
            entered.set(); await release.wait(); return sandbox
        service=runner.Runner(factory,'image-fixture')
        service._admission=service._binding(); service._verified_at=service.clock()
        cancel=asyncio.Event()
        task=asyncio.create_task(service.execute(fixture(),cancel))
        await entered.wait(); cancel.set()
        await asyncio.sleep(.03)
        try: self.assertTrue(task.done(),'Cancellation must not wait for a stalled creation')
        finally:
            release.set()
            await asyncio.gather(task,return_exceptions=True)
            await asyncio.sleep(.03)
        self.assertEqual(sandbox.terminated,1)
        self.assertEqual(sandbox.requests,[])
        self.assertEqual(service.admission()['status'],'unavailable')

    async def test_transport_cancellation_during_filesystem_setup_never_dispatches_source(self):
        from modal_runner import SandboxTransport
        release=asyncio.Event(); entered=asyncio.Event(); sent=[]
        class Method:
            def __init__(self,method): self.aio=method
        async def write(*args):
            entered.set()
            try: await release.wait()
            except asyncio.CancelledError: await release.wait()
        async def execute(*args,**kwargs): sent.append(args); raise AssertionError('No source dispatch after cancellation')
        class Filesystem: pass
        class Handle: pass
        handle=Handle(); handle.filesystem=Filesystem()
        handle.filesystem.write_text=Method(write); handle.exec=Method(execute)
        transport=SandboxTransport(handle)
        cancel=asyncio.Event()
        task=asyncio.create_task(transport.run('execute',fixture(),10,cancel))
        await entered.wait(); cancel.set(); await asyncio.sleep(.03)
        try: self.assertTrue(task.done(),'Cancellation must race the complete setup phase')
        finally:
            release.set(); await asyncio.gather(task,return_exceptions=True); await asyncio.sleep(.03)
        self.assertEqual(sent,[])

    async def test_dependency_digest_sorts_paths_by_utf16_for_cross_runtime_binding(self):
        value=fixture()
        template=value['files'][0]
        value['files']=[{**template,'path':'\ue000.mjs'},{**template,'path':'😀.mjs'}]
        value['checks'][0]['path']='😀.mjs'
        sandbox=FakeSandbox({'controls':{key:True for key in runner.PROBE_CONTROLS}})
        async def factory(): return sandbox
        service=runner.Runner(factory,'image-fixture'); await service.verify()
        sandbox.response={'results':[{'checkId':'value-check','status':'completed','result':'passed','exitCode':0,'executedTests':1}]}
        report=await service.execute(value)
        expected=runner.digest([{'path':path,'blobSha':template['blobSha']} for path in ['😀.mjs','\ue000.mjs']])
        self.assertEqual(report['checks'][0]['dependencyDigest'],expected)

    def test_supervisor_never_imports_candidate_into_trusted_oracle_process(self):
        source=(Path(__file__).resolve().parents[1]/'runner_supervisor.py').read_text()
        self.assertIn('os.setuid(65534)',source)
        self.assertIn('os.setgid(65534)',source)
        self.assertIn('PR_SET_NO_NEW_PRIVS',source)
        self.assertIn('start_new_session=True',source)
        self.assertIn('os.killpg',source)
        self.assertNotIn('shell=True',source)
        self.assertIn('O_NOFOLLOW',source)

if __name__=='__main__': unittest.main()
