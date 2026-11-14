"""Modal-hosted OpenAI-compatible API for Gemma 4 31B with token probabilities."""

import math
import os
import subprocess
import time
from contextlib import asynccontextmanager

import httpx
import modal


MODEL_ID = os.environ.get("MODEL_ID", "google/gemma-4-31B-it")
BACKEND_URL = "http://127.0.0.1:8001"
MAX_MODEL_LEN = os.environ.get("MAX_MODEL_LEN", "8192")

app = modal.App("tripsitter-gemma-review")

# Google's Gemma 4 vLLM image includes a vLLM build with Gemma 4 support.
image = (
    modal.Image.from_registry("vllm/vllm-openai:gemma4")
    .pip_install("fastapi", "httpx")
)


@app.cls(
    image=image,
    # 31B BF16 is tight on one 80 GB GPU once KV cache and runtime overhead
    # are included; tensor parallelism across two H100s leaves useful headroom.
    gpu="H100:2",
    timeout=900,
    scaledown_window=300,
    secrets=[modal.Secret.from_name("huggingface")],
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
            "2",
            "--max-model-len",
            MAX_MODEL_LEN,
            "--gpu-memory-utilization",
            "0.95",
            "--logprobs-mode",
            "raw_logprobs",
        ]
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
        from fastapi.responses import JSONResponse, Response

        @asynccontextmanager
        async def lifespan(_app):
            async with httpx.AsyncClient(timeout=900) as client:
                _app.state.backend = client
                yield

        api = FastAPI(title="Gemma 4 OpenAI-compatible API", lifespan=lifespan)

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
                raise HTTPException(
                    status_code=400,
                    detail="Streaming is not supported by this endpoint because token probabilities are returned after generation.",
                )

            # Ask vLLM for the selected token's raw log probability at every
            # generated position. Convert it to probability in the response.
            body["logprobs"] = True
            body["top_logprobs"] = 0

            try:
                upstream = await request.app.state.backend.post(
                    f"{BACKEND_URL}/v1/chat/completions", json=body
                )
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc

            if not upstream.is_success:
                return Response(
                    content=upstream.content,
                    status_code=upstream.status_code,
                    media_type="application/json",
                )

            result = upstream.json()
            for choice in result.get("choices", []):
                logprobs = choice.get("logprobs") or {}
                token_items = logprobs.get("content") or []
                choice["token_probabilities"] = [
                    {
                        "token": item.get("token"),
                        "bytes": item.get("bytes"),
                        "logprob": item["logprob"],
                        "probability": math.exp(item["logprob"]),
                    }
                    for item in token_items
                    if item.get("logprob") is not None
                ]

            return JSONResponse(result)

        # Forward standard OpenAI-compatible completion fields (including
        # token logprobs), adding token_probabilities to each choice.
        return api
