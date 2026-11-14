import asyncio
import unittest

from model_request import ClientDisconnected, while_connected


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


if __name__ == '__main__':
    unittest.main()
