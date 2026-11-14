"""Bound an upstream operation to the caller's connection and await cancellation cleanup."""
import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar('T')


class ClientDisconnected(Exception):
    """The downstream connection no longer needs the model result."""


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
