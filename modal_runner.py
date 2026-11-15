"""Disposable Modal black-box check service. Deploy only after infrastructure approval.

API reference checked against https://modal.com/docs/sdk/py/latest/Sandbox and
https://modal.com/docs/guide/sandbox-networking on 2026-11-15.
"""
import asyncio
import json
from pathlib import Path

from runner import CONFIG, MAX_REQUEST, Runner, RunnerError, while_active


class SandboxTransport:
    def __init__(self, handle):
        self.handle=handle
        self.ready=asyncio.Event()
    async def run(self, mode, payload, timeout, cancel):
        cancel=cancel or asyncio.Event()
        async def operation():
            def active():
                if cancel.is_set(): raise RunnerError()
            active()
            await self.handle.filesystem.write_text.aio(Path(__file__).with_name('runner_supervisor.py').read_text(),'/run/tripsit-supervisor.py')
            active()
            process=await self.handle.exec.aio('python3','-I','/run/tripsit-supervisor.py',mode,timeout=max(1,int(timeout)+1),text=False)
            active()
            if mode=='execute':
                process.stdin.write(json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode())
            active()
            process.stdin.write_eof()
            await process.stdin.drain.aio()
            active()
            data=bytearray()
            async for chunk in process.stdout:
                active()
                data.extend(chunk)
                if len(data)>65536: raise RunnerError()
                if mode=='cancel_probe' and data==b'ready\n': self.ready.set()
            active()
            if await process.wait.aio()!=0: raise RunnerError()
            active()
            return json.loads(data)
        return await while_active(operation(),cancel,timeout)
    async def terminate(self): await self.handle.terminate.aio(wait=True)

# Import remains available to offline tests without installing or contacting Modal.
try:
    import modal
except ImportError:
    modal=None
    app=None

if modal is not None:
    app=modal.App('tripsit-check-runner')
    sandbox_image=modal.Image.from_registry('node:22-bookworm-slim').apt_install('python3')
    api_image=modal.Image.debian_slim(python_version='3.12').pip_install('fastapi').add_local_python_source('runner','runner_supervisor','modal_runner')

    @app.function(image=api_image, timeout=1200, max_containers=1)
    @modal.asgi_app(requires_proxy_auth=True)
    def web():
        from fastapi import FastAPI, HTTPException, Request
        from fastapi.responses import JSONResponse
        api=FastAPI(title='TripSit controlled checks')

        @api.middleware('http')
        async def no_store(request, call_next):
            response=await call_next(request)
            response.headers['Cache-Control']='no-store'
            return response


        async def factory():
            handle=await modal.Sandbox.create.aio('sleep','1200',app=app,image=sandbox_image,
                      block_network=True,secrets=[],env={},include_oidc_identity_token=False,
                      cpu=tuple(CONFIG['cpu']),memory=tuple(CONFIG['memory']),timeout=CONFIG['sandbox_timeout'],
                      volumes={},network_file_systems={},encrypted_ports=[],unencrypted_ports=[])
            return SandboxTransport(handle)

        # Image object identity is immutable once built, unlike the registry's mutable tag.
        sandbox_image.build(app=app)
        service=Runner(factory,sandbox_image.object_id)

        @api.get('/admission')
        async def admission(): return service.admission()

        @api.post('/admission')
        async def verify(request: Request):
            body=bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body)>1024: raise HTTPException(413,'Admission request is too large.')
            if body not in (b'',b'{}'): raise HTTPException(400,'Invalid admission request.')
            report=await service.verify()
            return JSONResponse(report,status_code=200 if report['status']=='passed' else 503,headers={'Cache-Control':'no-store'})

        @api.post('/execute')
        async def execute(request: Request):
            raw=bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw)>MAX_REQUEST: raise HTTPException(413,'Execution request is too large.')
            try:
                payload=json.loads(raw)
            except (ValueError,UnicodeError): raise HTTPException(400,'Invalid execution request.') from None
            cancelled=asyncio.Event()
            async def watch():
                while not cancelled.is_set():
                    if await request.is_disconnected(): cancelled.set(); return
                    await asyncio.sleep(.1)
            watcher=asyncio.create_task(watch())
            try:
                result=await service.execute(payload,cancelled)
                return JSONResponse(result,headers={'Cache-Control':'no-store'})
            except RunnerError as failure:
                raise HTTPException(failure.status,str(failure)) from None
            finally:
                watcher.cancel()
                await asyncio.gather(watcher,return_exceptions=True)
        return api
