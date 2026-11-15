"""Bound an upstream operation to the caller's connection and await cancellation cleanup."""
import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, TypeVar

T = TypeVar('T')


class ClientDisconnected(Exception):
    """The downstream connection no longer needs the model result."""


class UpstreamFailed(Exception):
    """The model server refused a streamed request before any output was relayed."""

    def __init__(self, status: int):
        super().__init__(f'The model request failed with status {status}.')
        self.status = status


async def stream_upstream(client: Any, url: str, body: dict) -> AsyncIterator[bytes]:
    """Open a streamed POST with an httpx-style client and return an iterator over its raw bytes.

    A refused request raises UpstreamFailed before anything is relayed. The iterator closes the
    upstream response and the client when it finishes or is closed early, for example when the
    downstream client disconnects, so the model server can abort generation.
    """
    try:
        response = await client.send(client.build_request('POST', url, json=body), stream=True)
    except BaseException:
        await client.aclose()
        raise
    if not response.is_success:
        await response.aclose()
        await client.aclose()
        raise UpstreamFailed(response.status_code)

    async def relay() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return relay()


async def while_connected(
    operation: Callable[[], Awaitable[T]],
    disconnected: Callable[[], Awaitable[bool]],
    *,
    timeout: float = 900,
    poll_interval: float = .1,
) -> T:
    async def watch_disconnect():
        while not await disconnected():
            await asyncio.sleep(poll_interval)

    work = asyncio.ensure_future(operation())
    watcher = asyncio.create_task(watch_disconnect())
    try:
        done, _ = await asyncio.wait((work, watcher), timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            await watcher
            raise ClientDisconnected('The client disconnected.')
        if work in done:
            return await work
        raise TimeoutError('The model request exceeded its deadline.')
    finally:
        for task in (work, watcher):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, watcher, return_exceptions=True)
