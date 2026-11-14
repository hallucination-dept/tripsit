"""Fixed trusted fixtures only; run inside the documented disposable Docker command."""
import importlib.util
import json
import os
from pathlib import Path
import sys

if os.geteuid()!=0 or not Path('/.dockerenv').exists():
    raise SystemExit('This fixture verifier requires a disposable root Docker container.')
spec=importlib.util.spec_from_file_location('supervisor','/supervisor.py')
supervisor=importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)
Path('/run/tripsit-oracle').write_text('private expected value')
Path('/run/tripsit-oracle').chmod(0o600)
source='''import os,time
from pathlib import Path
def plus_one(x): return x+1
def incorrect(x): return x-1
def fail_then_loop(x):
    if x==2:
        while True: time.sleep(.1)
    return x-1
def forged():
    print('{"results":[{"result":"passed","executedTests":999}]}')
    return True
def modify_oracle():
    try: Path('/run/tripsit-oracle').write_text('forged'); return False
    except PermissionError: return True
def detach():
    if os.fork()==0:
        os.setsid(); time.sleep(.5); Path('/tmp/detached-wrote').write_text('escaped'); os._exit(0)
    return True
def detached_absent():
    time.sleep(.8)
    return not Path('/tmp/detached-wrote').exists()
def loop():
    while True: time.sleep(.1)
'''
def check(name,args,expected,timeout=2000):
    return {'id':name,'language':'python','path':'value.py','export':name,
            'cases':[{'args':args,'expected':expected}],'timeoutMs':timeout}
result=supervisor.execute({'files':[{'path':'value.py','content':source}], 'checks':[
    check('plus_one',[1],2),check('incorrect',[1],2),check('forged',[],True),
    {**check('fail_then_loop',[1],2,200),'cases':[{'args':[1],'expected':2},{'args':[2],'expected':3}]},
    check('modify_oracle',[],True),check('detach',[],True),check('detached_absent',[],True),check('loop',[],True,200)]})
rows={row['checkId']:row for row in result['results']}
assert rows['plus_one']['result']=='passed'
assert rows['incorrect']['result']=='failed'
assert rows['forged']['result']=='inconclusive'
assert rows['fail_then_loop']['result']=='failed'
assert rows['fail_then_loop']['executedTests']==1
assert rows['modify_oracle']['result']=='passed'
assert Path('/run/tripsit-oracle').read_text()=='private expected value'
assert rows['detach']['result']=='passed'
assert rows['detached_absent']['result']=='passed'
assert rows['loop']['status']=='timed_out'
assert rows['loop']['result']=='inconclusive'
print(json.dumps({'status':'passed_local_trusted_fixtures_only','cases':8,
                  'limitations':'Not Modal admission; no repository candidate code executed.'}))
