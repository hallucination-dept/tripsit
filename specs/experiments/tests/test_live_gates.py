import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('live_gates', Path(__file__).resolve().parents[1] / 'live_gates.py')
gates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gates)


class ConfigurationTests(unittest.TestCase):
    def test_explicit_local_fixture_and_distinct_sessions_are_required(self):
        env = {
            'TRIPSIT_LIVE_ORIGIN': 'http://127.0.0.1:5173',
            'TRIPSIT_LIVE_OWNER_COOKIE': 'session=owner',
            'TRIPSIT_LIVE_OTHER_COOKIE': 'session=other',
            'TRIPSIT_LIVE_REPOSITORY': 'team/repo',
            'TRIPSIT_LIVE_ISSUE_NUMBER': '2',
            'TRIPSIT_LIVE_REPOSITORY_ID': '5',
            'TRIPSIT_LIVE_BASE_SHA': 'a' * 40,
            'TRIPSIT_LIVE_REVOKED_ITEM_ID': '11111111-1111-4111-8111-111111111111',
        }
        self.assertEqual(gates.configuration_errors(env), [])
        self.assertTrue(gates.configuration_errors({**env, 'TRIPSIT_LIVE_OWNER_COOKIE': 'x\r\nInjected: secret'}))
        self.assertTrue(gates.configuration_errors({**env, 'TRIPSIT_LIVE_OTHER_COOKIE': 'session=owner'}))
        for origin in ['https://example.com', 'http://user:secret@localhost', 'http://127.0.0.1:5173/path', 'http://localhost:0']:
            self.assertTrue(gates.configuration_errors({**env, 'TRIPSIT_LIVE_ORIGIN': origin}))


if __name__ == '__main__':
    unittest.main()
