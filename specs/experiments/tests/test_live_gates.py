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

import contextlib
import http.server
import json
import threading
import time
from datetime import datetime, timedelta, timezone

ITEM_ID = '22222222-2222-4222-8222-222222222222'
REVOKED_ID = '11111111-1111-4111-8111-111111111111'
SNAPSHOT = {'repositoryId': 5, 'repository': 'team/repo', 'private': False, 'issueNumber': 2,
            'issueId': 20, 'baseSha': 'a' * 40, 'supplied': {'title': 'source-secret', 'body': 'raw-source', 'provenance': 'supplied'},
            'inferred': [], 'ownerConfirmed': []}
CREATED = datetime.now(timezone.utc)
ITEM = {'id': ITEM_ID, 'snapshot': SNAPSHOT, 'createdAt': CREATED.isoformat(), 'expiresAt': (CREATED + timedelta(days=7)).isoformat()}


@contextlib.contextmanager
def api(mode='ok'):
    calls = []
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            self.respond()
        def do_POST(self):
            self.respond()
        def respond(self):
            cookie = self.headers.get('Cookie')
            calls.append((self.command, self.path, cookie))
            if mode == 'slow-headers':
                try:
                    for byte in b'HTTP/1.1 200 OK\r\nX-Drip: ' + b'x' * 30 + b'\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}':
                        self.connection.sendall(bytes([byte]))
                        time.sleep(.01)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            if self.command == 'POST':
                selected = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                assert selected == {'repository': 'team/repo', 'issueNumber': 2}
                assert self.headers['Origin'] == 'http://' + self.headers['Host']
            status, data = 200, {}
            if mode == 'redirect':
                self.send_response(302)
                self.send_header('Location', 'http://example.invalid/secret')
                self.end_headers()
                return
            if mode == 'slow':
                time.sleep(.15)
            if self.path == '/api/auth/get-session':
                data = {'user': {'id': 'owner' if mode == 'same-user' or cookie == 'session=owner' else 'other'}}
            elif not cookie:
                status, data = 401, {'message': 'sign in'}
            elif self.path.endswith(REVOKED_ID):
                status = 404 if mode == 'missing-revoked' else 403
                data = {'message': 'upstream-secret'}
            elif cookie == 'session=other':
                status, data = (200, {'item': ITEM}) if mode == 'leak' else (404, {'message': 'denied'})
            elif self.path == '/api/work-items' and self.command == 'GET':
                data = {'items': [ITEM]}
            else:
                data = {'item': ITEM}
                if mode == 'wrong-sha':
                    data = {'item': {**ITEM, 'snapshot': {**SNAPSHOT, 'baseSha': 'b' * 40}}}
            raw = (b'x' * (1024 * 1024 + 1)) if mode == 'oversized' else json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {'TRIPSIT_LIVE_ORIGIN': f'http://127.0.0.1:{server.server_port}',
           'TRIPSIT_LIVE_OWNER_COOKIE': 'session=owner', 'TRIPSIT_LIVE_OTHER_COOKIE': 'session=other',
           'TRIPSIT_LIVE_REPOSITORY': 'team/repo', 'TRIPSIT_LIVE_ISSUE_NUMBER': '2',
           'TRIPSIT_LIVE_REPOSITORY_ID': '5', 'TRIPSIT_LIVE_BASE_SHA': 'a' * 40,
           'TRIPSIT_LIVE_REVOKED_ITEM_ID': REVOKED_ID}
    try:
        yield env, calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class HttpProbeTests(unittest.TestCase):
    def test_real_http_roundtrip_checks_sessions_denials_and_exact_provenance(self):
        with api() as (env, calls):
            report = gates.run_probes(env)
        self.assertEqual(report['public_api']['status'], 'passed')
        self.assertFalse(report['accepted'])
        self.assertEqual(report['private_admission']['status'], 'unverified')
        self.assertEqual(len(calls), 8)
        serialized = json.dumps(report)
        for private in ['session=owner', 'session=other', 'source-secret', 'raw-source', 'team/repo', ITEM_ID, REVOKED_ID]:
            self.assertNotIn(private, serialized)
        self.assertIn('sha256', serialized)

    def test_denials_are_not_counted_as_pass_for_missing_revoked_fixture(self):
        for mode in ['leak', 'same-user', 'missing-revoked', 'wrong-sha']:
            with self.subTest(mode=mode), api(mode) as (env, _):
                report = gates.run_probes(env)
                self.assertEqual(report['public_api']['status'], 'failed')
                self.assertFalse(report['accepted'])
                self.assertNotIn('upstream-secret', json.dumps(report))

    def test_redirect_oversized_and_timed_out_responses_fail_without_source(self):
        for mode in ['redirect', 'oversized', 'slow']:
            with self.subTest(mode=mode), api(mode) as (env, calls):
                report = gates.run_probes(env, timeout=.03)
                self.assertEqual(report['public_api']['status'], 'failed')
                self.assertEqual(len(calls), 1)
                self.assertNotIn('secret', json.dumps(report))

    def test_localhost_alias_keeps_browser_origin_while_connecting_to_loopback(self):
        with api() as (env, _):
            env['TRIPSIT_LIVE_ORIGIN'] = env['TRIPSIT_LIVE_ORIGIN'].replace('127.0.0.1', 'localhost')
            report = gates.run_probes(env)
        self.assertEqual(report['public_api']['status'], 'passed')

    def test_dripping_headers_cannot_extend_absolute_deadline(self):
        with api('slow-headers') as (env, calls):
            start = time.monotonic()
            report = gates.run_probes(env, timeout=.08)
            elapsed = time.monotonic() - start
        self.assertEqual(report['public_api']['status'], 'failed')
        self.assertEqual(len(calls), 1)
        self.assertLess(elapsed, .3, 'Dripped bytes must not reset the total request deadline')
        self.assertNotIn('secret', json.dumps(report))

    def test_missing_configuration_never_sends_requests(self):
        report = gates.run_probes({})
        self.assertEqual(report['public_api']['status'], 'unavailable')
        self.assertFalse(report['accepted'])


class AggregationTests(unittest.TestCase):
    def test_process_failures_invalid_output_and_deadlines_never_export_output(self):
        import os
        import sys
        from unittest.mock import patch
        for script, timeout in [("print('not-json-secret')", 2),
                                ("print('{}'); raise SystemExit(1)", 2),
                                ("import time; time.sleep(2)", .03),
                                ("print('x' * 65537)", 2)]:
            with self.subTest(script=script), patch.dict(gates.CONTROLS, {
                    'authenticated_browser': ([sys.executable, '-c', script], timeout)}):
                self.assertIsNone(gates.execute_control('authenticated_browser', os.environ))
        with patch.dict(gates.CONTROLS, {'authenticated_browser': (
                [sys.executable, '-c', "print('{\"status\":\"passed_configured_browser_checks\"}')"], 2)}):
            self.assertEqual(gates.execute_control('authenticated_browser', os.environ),
                             {'status': 'passed_configured_browser_checks'})

    def test_configuration_change_invalidates_executed_results(self):
        from unittest.mock import patch
        with api() as (env, _):
            def changed(*_):
                env['TRIPSIT_LIVE_BASE_SHA'] = 'b' * 40
                return True
            with patch.object(gates, 'execute_control', side_effect=changed):
                report = gates.run_gate(env, verify_controls=True)
        self.assertEqual(report['evidence_status'], 'stale')
        self.assertFalse(report['accepted'])

    def test_missing_configuration_does_not_start_controls(self):
        from unittest.mock import patch
        with patch.object(gates, 'execute_control') as execute:
            report = gates.run_gate({}, verify_controls=True)
        execute.assert_not_called()
        self.assertFalse(report['accepted'])

    def test_fresh_results_remain_local_and_cannot_enable_private_admission(self):
        from unittest.mock import patch
        results = [True, {'status': 'passed_local_only', 'productionScheduleVerified': False},
                   {'status': 'passed_configured_browser_checks', 'checks': {'hostileFixture': True}}]
        with api() as (env, _), patch.object(gates, 'execute_control', side_effect=results):
            report = gates.run_gate(env, verify_controls=True)
        self.assertEqual(report['database_isolation_and_purge']['status'], 'passed_local_only')
        self.assertEqual(report['authenticated_browser']['status'], 'passed')
        self.assertEqual(report['periodic_retention']['status'], 'unverified')
        self.assertFalse(report['accepted'])
        self.assertEqual(report['private_admission']['status'], 'unverified')

    def test_stale_failed_and_incomplete_controls_are_denied(self):
        from unittest.mock import patch
        for result in [None, {}, {'status': 'incomplete_hostile_fixture'}, {'status': 'passed'}]:
            with self.subTest(result=result), api() as (env, _), patch.object(gates, 'execute_control', return_value=result):
                report = gates.run_gate(env, verify_controls=True)
            self.assertFalse(report['accepted'])
            self.assertEqual(report['authenticated_browser']['status'], 'failed')
        with api() as (env, _), patch.object(gates, 'code_digest', side_effect=['before', 'after']):
            with patch.object(gates, 'execute_control', return_value=True):
                report = gates.run_gate(env, verify_controls=True)
        self.assertEqual(report['evidence_status'], 'stale')
        self.assertFalse(report['accepted'])


if __name__ == '__main__':
    unittest.main()


class ReviewerGateTests(unittest.TestCase):
    def test_reviewer_gate_missing_configuration_fails_without_starting_process(self):
        from unittest.mock import patch
        with patch.object(gates, 'execute_control') as execute:
            report = gates.run_reviewer_gate({})
        execute.assert_not_called()
        self.assertFalse(report['accepted'])
        self.assertEqual(report['reviewer']['status'], 'unavailable')
        self.assertEqual(report['authenticated_owner_uat'], 'unverified')
        self.assertEqual(report['private_admission']['status'], 'unverified')

    def test_only_expected_bounded_source_free_result_can_pass(self):
        from unittest.mock import patch
        environment = {'REVIEWER_API_URL': 'https://example.invalid', 'REVIEWER_API_KEY': 'credential-secret',
                       'REVIEWER_MODEL': 'configured-model', 'REVIEWER_RETENTION_DISCLOSURE': 'retention-secret'}
        valid = {'status': 'passed_configured_reviewer', 'scope': 'public_synthetic_provider_contract',
                 'authenticatedOwnerUat': 'unverified', 'privateAdmission': 'unverified', 'claimCount': 1, 'checkCount': 1,
                 'fixtureDigest': 'a' * 64, 'promptDigest': 'b' * 64, 'responseDigest': 'c' * 64,
                 'configurationDigest': 'd' * 64}
        for result, accepted in [(valid, True), (None, False), ({}, False),
                                 ({**valid, 'status': 'passed'}, False), ({**valid, 'claimCount': 0}, False),
                                 ({**valid, 'checkCount': 0}, False), ({**valid, 'raw': 'source-secret'}, False),
                                 ({**valid, 'promptDigest': 'x'}, False)]:
            with self.subTest(result=result), patch.object(gates, 'execute_control', return_value=result):
                report = gates.run_reviewer_gate(environment)
            self.assertEqual(report['accepted'], accepted)
            rendered = json.dumps(report)
            for secret in ['credential-secret', 'retention-secret', 'source-secret', 'configured-model', 'example.invalid']:
                self.assertNotIn(secret, rendered)
            self.assertEqual(report['authenticated_owner_uat'], 'unverified')
            self.assertEqual(report['private_admission']['status'], 'unverified')
