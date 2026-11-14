"""Modal-hosted OpenAI-compatible API for Gemma 4 31B with token probabilities."""

import os
import subprocess
import time

import httpx
import modal
from model_output import add_token_probabilities


MODEL_ID = os.environ.get("MODEL_ID", "google/gemma-4-31B-it")
BACKEND_URL = "http://127.0.0.1:8001"
MAX_MODEL_LEN = os.environ.get("MAX_MODEL_LEN", "8192")

app = modal.App("tripsitter-gemma-review")

# Google's Gemma 4 vLLM image includes a vLLM build with Gemma 4 support.
image = (
    modal.Image.from_registry("vllm/vllm-openai:gemma4", add_python="3.12")
    # The upstream vLLM image uses `vllm` as its Docker ENTRYPOINT. Modal needs
    # to launch its own Python function process, then we start vLLM ourselves.
    .entrypoint([])
    .pip_install("fastapi", "httpx")
    .add_local_python_source("model_output")
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
                raise HTTPException(
                    status_code=400,
                    detail="Streaming is not supported by this endpoint because token probabilities are returned after generation.",
                )

            # Ask vLLM for the selected token's raw log probability at every
            # generated position. Convert it to probability in the response.
            body["logprobs"] = True
            body["top_logprobs"] = 0

            try:
                async with httpx.AsyncClient(timeout=900) as client:
                    upstream = await client.post(
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

            return JSONResponse(add_token_probabilities(upstream.json()))

        # Forward standard OpenAI-compatible completion fields (including
        # token logprobs), adding token_probabilities to each choice.
        return api
