"""Modal-hosted OpenAI-compatible API for Gemma 4 31B with token probabilities.

Non-streamed chat completions return token probabilities. Streamed completions are relayed unchanged.
Agent runs call /runs/{run_id}/v1, which keeps the tokens behind each file edit for edit confidence
(see specs/EDIT_CONFIDENCE_PLAN.md). Tool calling uses vLLM's Gemma 4 parsers.
"""

import asyncio
import os
import subprocess
import time

import httpx
import modal
from model_output import add_token_probabilities
from model_request import ClientDisconnected, UpstreamFailed, stream_upstream, while_connected
from token_capture import RUN_ID, capture_body, edit_tokens, sse_events


MODEL_ID = os.environ.get("MODEL_ID", "google/gemma-4-31B-it")
BACKEND_URL = "http://127.0.0.1:8001"
# Agent sessions need far more than a single review prompt.
MAX_MODEL_LEN = os.environ.get("MAX_MODEL_LEN", "65536")
# vLLM's Gemma 4 recipe recommends this template for tool calling; it ships in the image's examples.
TOOL_CHAT_TEMPLATES = (
    "/vllm-workspace/examples/tool_chat_template_gemma4.jinja",
    "examples/tool_chat_template_gemma4.jinja",
)

app = modal.App("tripsitter-gemma-review")
# Edit token records per agent run, kept until the app collects and deletes them.
run_tokens = modal.Dict.from_name("tripsitter-run-tokens", create_if_missing=True)
MAX_CAPTURED_TOKENS = 40_000

# Google's Gemma 4 vLLM image includes a vLLM build with Gemma 4 support.
image = (
    modal.Image.from_registry("vllm/vllm-openai:gemma4", add_python="3.12")
    # The upstream vLLM image uses `vllm` as its Docker ENTRYPOINT. Modal needs
    # to launch its own Python function process, then we start vLLM ourselves.
    .entrypoint([])
    .pip_install("fastapi", "httpx")
    .add_local_python_source("model_output", "model_request", "token_capture")
)


@app.cls(
    image=image,
    # RTX PRO 6000 Blackwell provides 96 GB VRAM for Gemma 4 31B.
    gpu="RTX-PRO-6000",
    timeout=900,
    startup_timeout=900,
    min_containers=1,
    scaledown_window=300,
    secrets=[modal.Secret.from_name("huggingface-secret")],
)
class GemmaAPI:
    @modal.enter()
    def start_vllm(self):
        command = [
            "vllm",
            "serve",
            MODEL_ID,
            "--host",
            "127.0.0.1",
            "--port",
            "8001",
            "--tensor-parallel-size",
            "1",
            "--max-model-len",
            MAX_MODEL_LEN,
            "--gpu-memory-utilization",
            "0.95",
            "--logprobs-mode",
            "raw_logprobs",
            "--enable-auto-tool-choice",
            "--tool-call-parser",
            "gemma4",
            "--reasoning-parser",
            "gemma4",
        ]
        template = next((path for path in TOOL_CHAT_TEMPLATES if os.path.isfile(path)), None)
        if template:
            command += ["--chat-template", template]
        else:
            print("Gemma 4 tool chat template not found; using the model's default chat template.")
        self.vllm_process = subprocess.Popen(command)
        self._wait_until_ready()

    def _wait_until_ready(self):
        deadline = time.monotonic() + 840
        while time.monotonic() < deadline:
            if self.vllm_process.poll() is not None:
                raise RuntimeError(
                    f"vLLM exited during startup with status {self.vllm_process.returncode}"
                )
            try:
                response = httpx.get(f"{BACKEND_URL}/health", timeout=2)
                if response.is_success:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(2)
        raise TimeoutError("Timed out waiting for vLLM to load Gemma 4")

    @modal.exit()
    def stop_vllm(self):
        process = getattr(self, "vllm_process", None)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        from fastapi import FastAPI, HTTPException, Request
        from fastapi.responses import JSONResponse, StreamingResponse

        api = FastAPI(title="Gemma 4 OpenAI-compatible API")

        @api.get("/health")
        async def health():
            return {"status": "ok", "model": MODEL_ID}

        @api.get("/v1/models")
        async def models():
            return {
                "object": "list",
                "data": [
                    {
                        "id": MODEL_ID,
                        "object": "model",
                        "created": 0,
                        "owned_by": "google",
                    }
                ],
            }

        @api.post("/v1/chat/completions")
        async def chat_completions(request: Request):
            body = await request.json()
            if body.get("stream", False):
                # Relay server-sent events unchanged; token probabilities are added only to
                # non-streamed responses. Closing the relay on disconnect aborts generation.
                client = httpx.AsyncClient(timeout=httpx.Timeout(900, connect=10))
                try:
                    chunks = await stream_upstream(client, f"{BACKEND_URL}/v1/chat/completions", body)
                except UpstreamFailed as exc:
                    raise HTTPException(status_code=exc.status, detail="The model request failed.") from exc
                except httpx.HTTPError as exc:
                    raise HTTPException(status_code=502, detail="The model request failed.") from exc
                return StreamingResponse(chunks, media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

            # Ask vLLM for the selected token's raw log probability at every
            # generated position. Convert it to probability in the response.
            body["logprobs"] = True
            body["top_logprobs"] = 0

            try:
                async with httpx.AsyncClient(timeout=900) as client:
                    upstream = await while_connected(
                        lambda: client.post(f"{BACKEND_URL}/v1/chat/completions", json=body),
                        request.is_disconnected,
                    )
            except ClientDisconnected as exc:
                raise HTTPException(status_code=499, detail="The client disconnected.") from exc
            except TimeoutError as exc:
                raise HTTPException(status_code=504, detail="The model request exceeded its deadline.") from exc
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail="The model request failed.") from exc

            if not upstream.is_success:
                raise HTTPException(status_code=upstream.status_code, detail="The model request failed.")

            return JSONResponse(add_token_probabilities(upstream.json()))

        capture_lock = asyncio.Lock()

        def known_run(run_id: str) -> str:
            if not RUN_ID.match(run_id):
                raise HTTPException(status_code=404, detail="Unknown agent run.")
            return run_id

        async def keep_tokens(run_id: str, calls: list):
            async with capture_lock:
                stored = await run_tokens.get.aio(run_id, None) or {"requests": [], "tokens": 0}
                count = sum(len(value["tokens"]) for call in calls for value in call["values"])
                if stored["tokens"] + count > MAX_CAPTURED_TOKENS:
                    return
                stored["requests"].append({"at": int(time.time()), "calls": calls})
                stored["tokens"] += count
                await run_tokens.put.aio(run_id, stored)

        @api.post("/runs/{run_id}/v1/chat/completions")
        async def run_chat_completions(run_id: str, request: Request):
            # An agent run's requests: generated non-streamed so every token, including the raw tool-call text,
            # comes back with its top-k logprobs; a streaming client gets the result replayed as SSE.
            known_run(run_id)
            body = await request.json()
            include_usage = bool((body.get("stream_options") or {}).get("include_usage"))
            try:
                async with httpx.AsyncClient(timeout=900) as client:
                    upstream = await while_connected(
                        lambda: client.post(f"{BACKEND_URL}/v1/chat/completions", json=capture_body(body)),
                        request.is_disconnected,
                    )
            except ClientDisconnected as exc:
                raise HTTPException(status_code=499, detail="The client disconnected.") from exc
            except TimeoutError as exc:
                raise HTTPException(status_code=504, detail="The model request exceeded its deadline.") from exc
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail="The model request failed.") from exc
            if not upstream.is_success:
                raise HTTPException(status_code=upstream.status_code, detail="The model request failed.")

            result = upstream.json()
            try:
                calls = [call for choice in (result.get("choices") or [])[:1] for call in edit_tokens(choice)]
                if calls:
                    await keep_tokens(run_id, calls)
            except Exception as exc:  # Capture is best effort; the agent's request must still succeed.
                print(f"Edit token capture skipped: {type(exc).__name__}")
            for choice in result.get("choices") or []:
                choice.pop("logprobs", None)
            if not body.get("stream", False):
                return JSONResponse(result)
            events = sse_events(result, include_usage)

            async def replay():
                for event in events:
                    yield event

            return StreamingResponse(replay(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

        @api.get("/runs/{run_id}/tokens")
        async def run_token_records(run_id: str):
            return await run_tokens.get.aio(known_run(run_id), None) or {"requests": [], "tokens": 0}

        @api.delete("/runs/{run_id}/tokens")
        async def forget_run_tokens(run_id: str):
            try:
                await run_tokens.pop.aio(known_run(run_id))
            except KeyError:
                pass
            return {"deleted": True}

        # Forward standard OpenAI-compatible completion fields (including
        # token logprobs), adding token_probabilities to each choice.
        return api
