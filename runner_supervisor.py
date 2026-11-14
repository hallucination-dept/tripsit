"""Root-owned in-sandbox oracle supervisor. Never run this against repository code on the host."""
import ctypes
import json
import math
import os
from pathlib import Path
import resource
import selectors
import signal
import subprocess
import sys
import time

MAX_OUTPUT = 65536
CLEAN_ENV = {'PATH':'/usr/local/bin:/usr/bin:/bin', 'LANG':'C.UTF-8', 'HOME':'/nonexistent', 'PYTHONDONTWRITEBYTECODE':'1'}
PYTHON_WORKER = '''import importlib.util,json,sys
sys.path.insert(0,"/workspace")
path,name=sys.argv[1:]
args=json.load(sys.stdin)
spec=importlib.util.spec_from_file_location("candidate",path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
result=getattr(module,name)(*args)
print(json.dumps(result,ensure_ascii=False,allow_nan=False,separators=(",",":")))
'''
JAVASCRIPT_WORKER = '''import {pathToFileURL} from 'node:url';
const input=[]; for await (const chunk of process.stdin) input.push(chunk);
const args=JSON.parse(Buffer.concat(input).toString('utf8'));
const module=await import(pathToFileURL(process.argv[1]).href);
const value=await module[process.argv[2]](...args);
process.stdout.write(JSON.stringify(value));
'''


def demote(timeout):
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
    PR_SET_NO_NEW_PRIVS = 38
    if ctypes.CDLL(None, use_errno=True).prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0) != 0:
        raise RuntimeError('Worker restriction failed')
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    resource.setrlimit(resource.RLIMIT_CPU,(max(1,math.ceil(timeout)),max(1,math.ceil(timeout))+1))
    resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
    resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
    resource.setrlimit(resource.RLIMIT_NPROC,(32,32))
    # Node reserves a large virtual address space; the sandbox enforces the 512 MiB physical memory cap.


def terminate(process):
    try: os.killpg(process.pid,signal.SIGKILL)
    except ProcessLookupError: pass
    try: process.wait(timeout=2)
    except subprocess.TimeoutExpired: raise RuntimeError('Worker termination failed')
    # A worker can create another session; remove all nobody descendants before the next case.
    for _ in range(8):
        remaining=[]
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit(): continue
            try:
                status=(entry/'status').read_text()
                if any(line.startswith('Uid:') and line.split()[1]=='65534' for line in status.splitlines()):
                    if any(line.startswith('State:') and 'Z' in line.split()[1] for line in status.splitlines()): continue
                    remaining.append(int(entry.name))
                    try: os.kill(int(entry.name),signal.SIGSTOP)
                    except ProcessLookupError: pass
            except (FileNotFoundError,ProcessLookupError): pass
        if not remaining: return
        for pid in remaining:
            try: os.kill(pid,signal.SIGKILL)
            except ProcessLookupError: pass
        time.sleep(.01)
    raise RuntimeError('Worker descendant termination failed')


def run_case(check, case, timeout):
    command = ['python3','-I','-c',PYTHON_WORKER] if check['language']=='python' else ['node','--max-old-space-size=128','--experimental-strip-types','--input-type=module','-e',JAVASCRIPT_WORKER]
    command.extend(['/workspace/'+check['path'],check['export']])
    raw=json.dumps(case['args'],ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
    if len(raw)>16384: return 'invalid',None
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                             cwd='/workspace',env=CLEAN_ENV,preexec_fn=lambda:demote(timeout),start_new_session=True)
    deadline=time.monotonic()+timeout
    output=bytearray()
    try:
        os.set_blocking(process.stdin.fileno(),False)
        os.set_blocking(process.stdout.fileno(),False)
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdin,selectors.EVENT_WRITE)
            ready.register(process.stdout,selectors.EVENT_READ)
            offset=0
            stopped=False
            while ready.get_map():
                if process.poll() is not None and not stopped:
                    terminate(process)
                    stopped=True
                remaining=deadline-time.monotonic()
                if remaining<=0: return 'timed_out',None
                for key,_ in ready.select(min(.1,remaining)):
                    if key.fileobj is process.stdin:
                        try: offset+=os.write(process.stdin.fileno(),raw[offset:])
                        except BrokenPipeError: offset=len(raw)
                        if offset==len(raw): ready.unregister(process.stdin); process.stdin.close()
                    else:
                        chunk=os.read(process.stdout.fileno(),8192)
                        if not chunk: ready.unregister(process.stdout)
                        else:
                            output.extend(chunk)
                            if len(output)>MAX_OUTPUT: return 'oversized',None
            remaining=deadline-time.monotonic()
            if remaining<=0: return 'timed_out',None
            try: code=process.wait(timeout=remaining)
            except subprocess.TimeoutExpired: return 'timed_out',None
            if code!=0: return 'error',None
            try:
                value=json.loads(output,parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                # Compare JSON representation, so true cannot pass an expected numeric 1.
                actual=json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True,allow_nan=False)
                expected=json.dumps(case['expected'],ensure_ascii=False,separators=(',',':'),sort_keys=True,allow_nan=False)
                return ('passed' if actual==expected else 'failed'),value
            except (ValueError,UnicodeError,RecursionError): return 'invalid',None
    finally:
        terminate(process)
        if not process.stdin.closed: process.stdin.close()
        process.stdout.close()


def stage(files):
    workspace=Path('/workspace')
    workspace.mkdir(mode=0o755,exist_ok=True)
    for row in files:
        path=workspace/row['path']
        path.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
        descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
        with os.fdopen(descriptor,'wb') as target: target.write(row['content'].encode('utf8'))
    for parent,dirs,_files in os.walk(workspace,topdown=False):
        os.chmod(parent,0o555)


def execute(payload):
    stage(payload['files'])
    results=[]
    for check in payload['checks']:
        executed,failed,inconclusive=0,False,False
        status='completed'
        deadline=time.monotonic()+check['timeoutMs']/1000
        for case in check['cases']:
            remaining=deadline-time.monotonic()
            if remaining<=0:
                status='timed_out'; inconclusive=True; break
            observed,_=run_case(check,case,remaining)
            if observed in ('passed','failed'):
                executed+=1
                failed=failed or observed=='failed'
            else:
                inconclusive=True
                status='timed_out' if observed=='timed_out' else 'infrastructure_error'
                break
        result='inconclusive' if inconclusive or not executed else 'failed' if failed else 'passed'
        results.append({'checkId':check['id'],'status':status,'result':result,
                        'exitCode':None if result=='inconclusive' else 1 if failed else 0,'executedTests':executed})
    return {'results':results}


def probe():
    # Only fixed trusted fixtures run before admission, never caller-supplied source.
    controls={name:False for name in ('clean_environment','blocked_egress','unprivileged_worker','oracle_isolation',
                                    'bounded_output','timeout_termination','artifact_containment','runtime_contract')}
    if os.geteuid()!=0: return {'controls':controls}
    secret_names=any(any(term in key.upper() for term in ('SECRET','PASSWORD','CREDENTIAL','DATABASE_URL','GITHUB_TOKEN','MODAL_TOKEN','IDENTITY_TOKEN')) for key in os.environ)
    oracle=Path('/run/tripsit-oracle')
    oracle.write_text('not sent to worker'); oracle.chmod(0o600)
    text='''import os,socket,time
from pathlib import Path
def environment(): return sorted(os.environ)
def uid(): return [os.getuid(),os.getgid()]
def oracle():
    try: Path('/run/tripsit-oracle').read_text(); return False
    except PermissionError: pass
    try: Path('/proc/1/environ').read_bytes(); return False
    except (PermissionError,FileNotFoundError): return True
def symlink():
    try:
        os.symlink('/run/tripsit-oracle','/tmp/escape')
        Path('/tmp/escape').read_text(); return False
    except PermissionError: return True
def network():
    failures=0
    try:
        with socket.create_connection(('1.1.1.1',443),timeout=2): pass
    except OSError: failures+=1
    try: socket.getaddrinfo('example.com',443)
    except OSError: failures+=1
    return failures==2
def flood(): print('x'*70000)
def timeout():
    while True: time.sleep(.1)
'''
    stage([{'path':'probe.py','content':text},
           {'path':'probe.mjs','content':'export function value(input) { return input; }'},
           {'path':'probe.ts','content':'export function value(input: number): number { return input; }'}])
    def check(name,expected,timeout=5):
        return run_case({'language':'python','path':'probe.py','export':name},{'args':[],'expected':expected},timeout)[0]=='passed'
    controls['clean_environment']=not secret_names and check('environment',sorted(CLEAN_ENV))
    controls['unprivileged_worker']=check('uid',[65534,65534])
    controls['oracle_isolation']=check('oracle',True)
    controls['artifact_containment']=check('symlink',True)
    controls['blocked_egress']=check('network',True)
    controls['bounded_output']=run_case({'language':'python','path':'probe.py','export':'flood'},{'args':[],'expected':None},3)[0]=='oversized'
    started=time.monotonic()
    controls['timeout_termination']=run_case({'language':'python','path':'probe.py','export':'timeout'},{'args':[],'expected':None},.2)[0]=='timed_out' and time.monotonic()-started<3
    controls['runtime_contract']=all(run_case({'language':language,'path':path,'export':'value'},
        {'args':[7],'expected':7},5)[0]=='passed' for language,path in [('javascript','probe.mjs'),('typescript','probe.ts')])
    return {'controls':controls}


if __name__=='__main__':
    try:
        mode=sys.argv[1]
        if mode=='probe': result=probe()
        elif mode=='execute':
            raw=sys.stdin.buffer.read(1048577)
            if len(raw)>1048576: raise ValueError()
            result=execute(json.loads(raw))
        else: raise ValueError()
        sys.stdout.write(json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    except Exception:
        # Never print raw candidate output or exceptions, including infrastructure traceback.
        sys.stdout.write('{"error":"Execution unavailable."}')
        sys.exit(1)
