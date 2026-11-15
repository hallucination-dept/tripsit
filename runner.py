"""Trusted coordinator for bounded black-box checks; candidate code runs only in Modal.

The oracle is outside the candidate worker. A passing case establishes only that
its isolated process returned the expected JSON for the supplied input.
"""
import asyncio
import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import time
import uuid

MAX_REQUEST = 1_048_576
PROBE_CONTROLS = ('clean_environment', 'blocked_egress', 'unprivileged_worker', 'oracle_isolation',
            'bounded_output', 'timeout_termination', 'artifact_containment', 'runtime_contract')
CONTROLS = (*PROBE_CONTROLS, 'cancellation_termination')
CONFIG = {'version': 1, 'block_network': True, 'secrets': [], 'include_oidc_identity_token': False,
          'cpu': [0.25, 1], 'memory': [256, 512], 'sandbox_timeout': 1200,
          'files': 24, 'source_bytes': 262144, 'checks': 16, 'cases': 16,
          'per_check_ms': 60000, 'optional_checks': 3, 'optional_total_ms': 180000,
          'worker_uid': 65534, 'output_bytes': 65536, 'artifact_files': 0}


class RunnerError(Exception):
    def __init__(self, message='Execution unavailable.', status=503):
        super().__init__(message)
        self.status = status


_pending_cleanup = set()

def _consume(task):
    if not task.cancelled(): task.exception()


async def while_active(operation, cancel, timeout, late_cleanup=None):
    task=asyncio.create_task(operation)
    stopped=asyncio.create_task(cancel.wait())
    try:
        done,_=await asyncio.wait((task,stopped),timeout=timeout,return_when=asyncio.FIRST_COMPLETED)
        if task not in done or stopped in done or cancel.is_set(): raise RunnerError()
        return task.result()
    except BaseException:
        if late_cleanup is not None:
            async def cleanup():
                try:
                    handle=await task
                    await asyncio.wait_for(late_cleanup(handle),15)
                except (Exception,asyncio.CancelledError): pass
            cleanup_task=asyncio.create_task(cleanup())
            _pending_cleanup.add(cleanup_task)
            cleanup_task.add_done_callback(_pending_cleanup.discard)
        else:
            task.cancel()
            task.add_done_callback(_consume)
        raise
    finally:
        stopped.cancel()
        await asyncio.gather(stopped,return_exceptions=True)


def canonical(value):
    # Match JSON.stringify for finite JSON integers, including 1.0 decoded by Python.
    if isinstance(value, float) and value.is_integer(): return int(value)
    if isinstance(value, list): return [canonical(row) for row in value]
    if isinstance(value, dict): return {key: canonical(value[key]) for key in sorted(value, key=lambda text: text.encode('utf-16-be'))}
    return value


def digest(value):
    return hashlib.sha256(json.dumps(canonical(value), ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def code_digest():
    return digest({name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                   for name in ('runner.py', 'runner_supervisor.py', 'modal_runner.py')})


def _text(value, maximum=128):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and not any(ord(c) < 32 for c in value)


def _json(value, depth=0):
    if depth > 12: raise ValueError()
    if value is None or isinstance(value, bool): return
    if isinstance(value, int) and abs(value) <= 9007199254740991: return
    if isinstance(value, str) and len(value.encode('utf8')) <= 8192: return
    if isinstance(value, list) and len(value) <= 256:
        for row in value: _json(row, depth+1)
        return
    if isinstance(value, dict) and len(value) <= 128:
        for key, row in value.items():
            if not _text(key, 128): raise ValueError()
            _json(row, depth+1)
        return
    # Integer JSON only avoids ambiguous float/NaN canonicalization across runtimes.
    raise ValueError()


def verified_revision(revision, identity, files):
    if not re.fullmatch(r'[a-f0-9]{40}', identity['baseSha']): raise ValueError()
    if not isinstance(revision, dict) or set(revision) != {'commitSha', 'treeSha', 'commitObject'}: raise ValueError()
    if any(not isinstance(revision[k], str) or not re.fullmatch(r'[a-f0-9]{40}', revision[k]) for k in ('commitSha', 'treeSha')): raise ValueError()
    if not isinstance(revision['commitObject'], str) or len(revision['commitObject']) > 21848: raise ValueError()
    raw = base64.b64decode(revision['commitObject'], validate=True)
    if not raw or len(raw) > 16384 or base64.b64encode(raw).decode() != revision['commitObject']: raise ValueError()
    if hashlib.sha1(f'commit {len(raw)}\0'.encode() + raw).hexdigest() != revision['commitSha']: raise ValueError()
    pattern = (rb'tree ' + revision['treeSha'].encode() + rb'\nparent ' + identity['baseSha'].encode()
        + rb'\nauthor TripSit <tripsit@localhost> (-?[0-9]+) \+0000\ncommitter TripSit <tripsit@localhost> \1 \+0000\n\nStage candidate\n')
    if not re.fullmatch(pattern, raw): raise ValueError()
    root = {}
    for file in files:
        if file['mode'] not in ('100644', '100755') or '\0' in file['content']: raise ValueError()
        directory = root
        parts = file['path'].split('/')
        for part in parts[:-1]: directory = directory.setdefault(part, {})
        if not isinstance(directory, dict) or parts[-1] in directory: raise ValueError()
        directory[parts[-1]] = (file['mode'], file['blobSha'])
    def tree(directory):
        rows = []
        for name, item in directory.items():
            nested = isinstance(item, dict)
            mode, sha = ('40000', tree(item)) if nested else item
            rows.append((name.encode() + (b'/' if nested else b''), mode.encode() + b' ' + name.encode() + b'\0' + bytes.fromhex(sha)))
        data = b''.join(value for _name, value in sorted(rows))
        return hashlib.sha1(f'tree {len(data)}\0'.encode() + data).hexdigest()
    if tree(root) != revision['treeSha']: raise ValueError()


def validate_request(value):
    try:
        if not isinstance(value, dict) or set(value) not in ({'identity', 'files', 'checks', 'prId'}, {'identity', 'files', 'checks', 'prId', 'revision'}): raise ValueError()
        exact = 'revision' in value
        if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > MAX_REQUEST: raise ValueError()
        identity = value['identity']
        expected = {'ownerId','itemId','candidateId','baseSha','candidateDigest','snapshotDigest','policyVersion'}
        if not isinstance(identity, dict) or set(identity) != expected or not _text(identity['ownerId']) or not _text(identity['policyVersion']): raise ValueError()
        for key in ('itemId', 'candidateId'):
            if not isinstance(identity[key], str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', identity[key]): raise ValueError()
        for key in ('candidateDigest', 'snapshotDigest'):
            if not isinstance(identity[key], str) or not re.fullmatch(r'[a-f0-9]{64}', identity[key]): raise ValueError()
        if not isinstance(identity['baseSha'], str) or not re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})', identity['baseSha']): raise ValueError()
        if value['prId'] is not None and not _text(value['prId']): raise ValueError()
        files = value['files']
        if not isinstance(files, list) or not 1 <= len(files) <= CONFIG['files']: raise ValueError()
        paths, portable, total = set(), set(), 0
        for row in files:
            if not isinstance(row, dict) or set(row) != ({'path', 'content', 'blobSha', 'mode'} if exact else {'path', 'content', 'blobSha'}): raise ValueError()
            path = row['path']
            if not _text(path, 1024) or len(path.encode()) > 1024 or path != str(PurePosixPath(path)) or path.startswith('/') or re.search(r'[\\:\x00-\x1f\x7f]', path): raise ValueError()
            if any(part in ('.', '..') or part.lower() == '.git' for part in path.split('/')): raise ValueError()
            if path in paths or path.casefold() in portable: raise ValueError()
            for other in paths:
                if path.casefold().startswith(other.casefold()+'/') or other.casefold().startswith(path.casefold()+'/'): raise ValueError()
            paths.add(path); portable.add(path.casefold())
            if not isinstance(row['content'], str): raise ValueError()
            data = row['content'].encode('utf-8', 'strict'); total += len(data)
            if total > CONFIG['source_bytes'] or hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest() != row['blobSha']: raise ValueError()
        if exact: verified_revision(value['revision'], identity, files)
        checks, ids, optional_time, optional_count = value['checks'], set(), 0, 0
        if not isinstance(checks, list) or not 1 <= len(checks) <= CONFIG['checks']: raise ValueError()
        for check in checks:
            if not isinstance(check, dict) or set(check) != {'id','language','path','export','cases','requirementIds','nodeIds','mandatory','impact','timeoutMs'}: raise ValueError()
            if not _text(check['id']) or check['id'] in ids or check['path'] not in paths: raise ValueError()
            ids.add(check['id'])
            if check['language'] not in ('python', 'javascript', 'typescript') or not _text(check['export']) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',check['export']): raise ValueError()
            suffixes={'python':('.py',),'javascript':('.mjs','.js'),'typescript':('.ts','.mts')}
            if not check['path'].endswith(suffixes[check['language']]): raise ValueError()
            if type(check['mandatory']) is not bool or check['impact'] not in ('unknown','critical','high','medium','low'): raise ValueError()
            if type(check['timeoutMs']) is not int or not 1 <= check['timeoutMs'] <= CONFIG['per_check_ms']: raise ValueError()
            if not check['mandatory']:
                optional_time += check['timeoutMs']; optional_count += 1
            for key, maximum in (('requirementIds',100),('nodeIds',2000)):
                rows = check[key]
                if not isinstance(rows,list) or len(rows)>maximum or len(set(rows))!=len(rows) or any(not _text(row) for row in rows): raise ValueError()
            if not check['requirementIds']: raise ValueError()
            cases=check['cases']
            if not isinstance(cases,list) or not 1<=len(cases)<=CONFIG['cases']: raise ValueError()
            for case in cases:
                if not isinstance(case,dict) or set(case)!={'args','expected'} or not isinstance(case['args'],list) or len(case['args'])>16: raise ValueError()
                _json(case['args']); _json(case['expected'])
                if len(json.dumps(case['args'],ensure_ascii=False,separators=(',',':')).encode())>16384: raise ValueError()
        if optional_count>CONFIG['optional_checks'] or optional_time>CONFIG['optional_total_ms']: raise ValueError()
        return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except (ValueError, TypeError, KeyError, UnicodeError, OverflowError, RecursionError):
        raise RunnerError('Invalid execution request.', 400) from None


class Runner:
    def __init__(self, factory, image_identity, clock=time.monotonic):
        self.factory, self.image_identity, self.clock = factory, image_identity, clock
        self._admission, self._verified_at = None, 0
        self._lock = asyncio.Lock()

    def _binding(self):
        config = digest(CONFIG)
        code = code_digest()
        return {'configurationDigest': config, 'codeDigest': code,
                'environmentDigest': digest({'configurationDigest':config,'codeDigest':code,'image':self.image_identity})}

    def admission(self):
        binding = self._binding()
        fresh = self._admission and self.clock()-self._verified_at < 600 and self._admission['environmentDigest'] == binding['environmentDigest']
        return {**binding, 'status':'passed' if fresh else 'unavailable'}

    async def verify(self):
        async with self._lock:
            self._admission = None
            sandbox, cancel_task, cancellation, binding = None, None, None, None
            try:
                sandbox = await asyncio.wait_for(self.factory(), 60)
                result = await asyncio.wait_for(sandbox.run('probe', {}, 30, None), 35)
                if not isinstance(result,dict) or set(result)!= {'controls'} or not isinstance(result['controls'],dict) or set(result['controls'])!=set(PROBE_CONTROLS) or any(result['controls'][key] is not True for key in PROBE_CONTROLS): raise RunnerError()
                cancellation=asyncio.Event()
                cancel_task=asyncio.create_task(sandbox.run('cancel_probe',{},30,cancellation))
                await asyncio.wait_for(sandbox.ready.wait(),5)
                if cancel_task.done():
                    _consume(cancel_task)
                    raise RunnerError()
                cancellation.set()
                try:
                    await asyncio.wait_for(cancel_task,3)
                except RunnerError: pass
                else: raise RunnerError()
                binding = self._binding()
            except (Exception, asyncio.CancelledError):
                binding = None
            finally:
                if cancellation is not None: cancellation.set()
                if cancel_task is not None:
                    if not cancel_task.done(): cancel_task.cancel()
                    cancel_task.add_done_callback(_consume)
                if sandbox is not None:
                    try: await asyncio.wait_for(asyncio.shield(sandbox.terminate()), 15)
                    except (Exception, asyncio.CancelledError): binding = None
            self._admission = binding
            self._verified_at = self.clock() if binding else 0
            return self.admission()

    async def execute(self, request, cancel=None):
        value = validate_request(request)
        cancel=cancel or asyncio.Event()
        if cancel.is_set(): raise RunnerError()
        admission = self.admission()
        if admission['status']!='passed': raise RunnerError()
        if self._lock.locked(): raise RunnerError('Execution unavailable.', 429)
        async with self._lock:
            sandbox = None
            try:
                try:
                    sandbox = await while_active(self.factory(),cancel,60,late_cleanup=lambda handle:handle.terminate())
                except BaseException:
                    self._admission=None
                    raise
                timeout = sum(row['timeoutMs'] for row in value['checks'])/1000+30
                result = await while_active(sandbox.run('execute',value,timeout,cancel),cancel,timeout+5)
                if cancel is not None and cancel.is_set(): raise RunnerError()
                if self.admission()['environmentDigest'] != admission['environmentDigest']: raise RunnerError()
                rows=result['results']
                if not isinstance(result,dict) or set(result)!= {'results'} or not isinstance(rows,list) or len(rows)!=len(value['checks']): raise RunnerError()
                definitions, executions = [], []
                dependency = digest(sorted([{'path':row['path'],'blobSha':row['blobSha']} for row in value['files']],key=lambda row:row['path'].encode('utf-16-be')))
                for check, row in zip(value['checks'], rows):
                    if not isinstance(row,dict) or set(row)!= {'checkId','status','result','exitCode','executedTests'} or row['checkId']!=check['id']: raise RunnerError()
                    if row['status'] not in ('completed','timed_out','cancelled','infrastructure_error') or row['result'] not in ('passed','failed','inconclusive') or type(row['executedTests']) is not int or not 0<=row['executedTests']<=len(check['cases']): raise RunnerError()
                    if row['exitCode'] is not None and (type(row['exitCode']) is not int or not -255<=row['exitCode']<=255): raise RunnerError()
                    if row['result']=='passed' and (row['status']!='completed' or row['exitCode']!=0 or row['executedTests']!=len(check['cases'])): raise RunnerError()
                    if row['result']=='failed' and (row['status']!='completed' or row['exitCode']!=1 or row['executedTests']==0): raise RunnerError()
                    definition = {'id':check['id'], 'definitionDigest':digest({key:val for key,val in check.items() if key!='cases'}),
                                  'oracleDigest':digest(check['cases']), 'dependencyDigest':dependency, 'environmentDigest':admission['environmentDigest']}
                    definitions.append(definition)
                    executions.append({**row, **{key:val for key,val in definition.items() if key!='id'}, 'id':str(uuid.uuid4()),
                                       'collector':'trusted_runner','runnerId':'modal-blackbox-v1','prId':value['prId']})
                result = {'identity':value['identity'],'admission':admission,'checks':definitions,'executions':executions}
                if 'revision' in value: result['revision'] = value['revision']
                return result
            except (Exception, asyncio.CancelledError):
                raise RunnerError() from None
            finally:
                if sandbox is not None:
                    try: await asyncio.wait_for(asyncio.shield(sandbox.terminate()), 15)
                    except (Exception, asyncio.CancelledError):
                        self._admission = None
                        raise RunnerError() from None
