import asyncio
import unittest

from model_request import ClientDisconnected, UpstreamFailed, stream_upstream, while_connected


class ModelRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_returns_result_and_cleans_disconnect_watcher(self):
        cleaned = asyncio.Event()
        async def operation():
            await asyncio.sleep(0)
            return {'choices': []}
        async def disconnected():
            try:
                await asyncio.sleep(10)
            finally:
                cleaned.set()
        self.assertEqual(await while_connected(operation, disconnected), {'choices': []})
        self.assertTrue(cleaned.is_set())

    async def test_disconnect_cancels_upstream_and_awaits_cleanup(self):
        cleaned = asyncio.Event()
        async def operation():
            try:
                await asyncio.sleep(10)
            finally:
                await asyncio.sleep(0)
                cleaned.set()
        async def disconnected():
            return True
        with self.assertRaises(ClientDisconnected):
            await asyncio.wait_for(while_connected(operation, disconnected), .5)
        self.assertTrue(cleaned.is_set())

    async def test_deadline_cancels_work_and_disconnect_watcher(self):
        work_cleaned = asyncio.Event()
        watch_cleaned = asyncio.Event()
        async def operation():
            try:
                await asyncio.sleep(10)
            finally:
                work_cleaned.set()
        async def disconnected():
            try:
                await asyncio.sleep(10)
            finally:
                watch_cleaned.set()
        with self.assertRaises(TimeoutError):
            await asyncio.wait_for(while_connected(operation, disconnected, timeout=.02), .5)
        self.assertTrue(work_cleaned.is_set())
        self.assertTrue(watch_cleaned.is_set())

    async def test_external_cancellation_cleans_both_child_tasks(self):
        work_started = asyncio.Event()
        watch_started = asyncio.Event()
        work_cleaned = asyncio.Event()
        watch_cleaned = asyncio.Event()
        async def operation():
            work_started.set()
            try:
                await asyncio.sleep(10)
            finally:
                work_cleaned.set()
        async def disconnected():
            watch_started.set()
            try:
                await asyncio.sleep(10)
            finally:
                watch_cleaned.set()
        pending = asyncio.create_task(while_connected(operation, disconnected))
        await work_started.wait()
        await watch_started.wait()
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(pending, .5)
        self.assertTrue(work_cleaned.is_set())
        self.assertTrue(watch_cleaned.is_set())

    async def test_upstream_failure_preserves_exception_and_cleans_watcher(self):
        cleaned = asyncio.Event()
        async def operation():
            await asyncio.sleep(0)
            raise OSError('fixture upstream failure')
        async def disconnected():
            try:
                await asyncio.sleep(10)
            finally:
                cleaned.set()
        with self.assertRaises(OSError):
            await while_connected(operation, disconnected)
        self.assertTrue(cleaned.is_set())

    async def test_polling_observes_later_disconnect(self):
        calls = 0
        cleaned = asyncio.Event()
        async def operation():
            try:
                await asyncio.sleep(10)
            finally:
                cleaned.set()
        async def disconnected():
            nonlocal calls
            calls += 1
            return calls == 2
        with self.assertRaises(ClientDisconnected):
            await asyncio.wait_for(while_connected(operation, disconnected, poll_interval=.01), .5)
        self.assertEqual(calls, 2)
        self.assertTrue(cleaned.is_set())


class FakeStreamResponse:
    def __init__(self, status, chunks):
        self.status_code, self.is_success, self.chunks, self.closed = status, 200 <= status < 300, chunks, False

    async def aiter_raw(self):
        for chunk in self.chunks:
            yield chunk

    async def aclose(self):
        self.closed = True


class FakeStreamClient:
    def __init__(self, response=None, error=None):
        self.response, self.error, self.closed, self.requests = response, error, False, []

    def build_request(self, method, url, json):
        return (method, url, json)

    async def send(self, request, stream):
        self.requests.append((request, stream))
        if self.error:
            raise self.error
        return self.response

    async def aclose(self):
        self.closed = True


class StreamUpstreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_relays_raw_chunks_and_closes_upstream(self):
        response = FakeStreamResponse(200, [b'data: {"a":1}\n\n', b'data: [DONE]\n\n'])
        client = FakeStreamClient(response)
        chunks = await stream_upstream(client, 'http://model/v1/chat/completions', {'stream': True})
        self.assertEqual([chunk async for chunk in chunks], [b'data: {"a":1}\n\n', b'data: [DONE]\n\n'])
        self.assertEqual(client.requests, [(('POST', 'http://model/v1/chat/completions', {'stream': True}), True)])
        self.assertTrue(response.closed and client.closed)

    async def test_refused_request_raises_status_before_relaying(self):
        response = FakeStreamResponse(400, [b'{"error": "secret upstream detail"}'])
        client = FakeStreamClient(response)
        with self.assertRaises(UpstreamFailed) as raised:
            await stream_upstream(client, 'http://model', {})
        self.assertEqual(raised.exception.status, 400)
        self.assertNotIn('secret', str(raised.exception))
        self.assertTrue(response.closed and client.closed)

    async def test_transport_error_closes_client(self):
        client = FakeStreamClient(error=OSError('connection refused'))
        with self.assertRaises(OSError):
            await stream_upstream(client, 'http://model', {})
        self.assertTrue(client.closed)

    async def test_early_close_releases_upstream(self):
        response = FakeStreamResponse(200, [b'one', b'two', b'three'])
        client = FakeStreamClient(response)
        chunks = await stream_upstream(client, 'http://model', {})
        self.assertEqual(await chunks.__anext__(), b'one')
        await chunks.aclose()
        self.assertTrue(response.closed and client.closed)


if __name__ == '__main__':
    unittest.main()
