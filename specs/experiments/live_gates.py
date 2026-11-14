"""Fail-closed admission report; never certify mocked checks as live evidence."""
import argparse
import os
from urllib.parse import urlparse
import re
import hashlib
import http.client
import json
from pathlib import Path
import time
import socket
import threading
from datetime import datetime, timezone


REQUIRED = ('TRIPSIT_LIVE_ORIGIN', 'TRIPSIT_LIVE_OWNER_COOKIE', 'TRIPSIT_LIVE_OTHER_COOKIE',
            'TRIPSIT_LIVE_REPOSITORY', 'TRIPSIT_LIVE_ISSUE_NUMBER', 'TRIPSIT_LIVE_REPOSITORY_ID',
            'TRIPSIT_LIVE_BASE_SHA', 'TRIPSIT_LIVE_REVOKED_ITEM_ID')


def configuration_errors(environment):
    errors = [f'Missing {key}' for key in REQUIRED if not environment.get(key)]
    try:
        target = urlparse(environment.get('TRIPSIT_LIVE_ORIGIN', ''))
        if environment.get('TRIPSIT_LIVE_ORIGIN') and (target.scheme != 'http' or target.hostname not in ('localhost', '127.0.0.1', '::1')
                or target.username or target.password or target.path or target.query or target.fragment
                or (target.port is not None and not 1 <= target.port <= 65535)):
            errors.append('Development origin must be an explicit loopback HTTP origin without a path')
    except ValueError:
        errors.append('Invalid development origin')
    for name in ('TRIPSIT_LIVE_OWNER_COOKIE', 'TRIPSIT_LIVE_OTHER_COOKIE'):
        cookie = environment.get(name, '')
        if cookie and (len(cookie) > 8192 or any(ord(char) < 32 or ord(char) > 126 for char in cookie)):
            errors.append(f'Invalid {name}')
    if environment.get('TRIPSIT_LIVE_OWNER_COOKIE') and environment.get('TRIPSIT_LIVE_OWNER_COOKIE') == environment.get('TRIPSIT_LIVE_OTHER_COOKIE'):
        errors.append('Owner and second-owner sessions must differ')
    patterns = {
        'TRIPSIT_LIVE_REPOSITORY': r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}',
        'TRIPSIT_LIVE_ISSUE_NUMBER': r'[1-9][0-9]{0,14}',
        'TRIPSIT_LIVE_REPOSITORY_ID': r'[1-9][0-9]{0,14}',
        'TRIPSIT_LIVE_BASE_SHA': r'(?:[a-f0-9]{40}|[a-f0-9]{64})',
        'TRIPSIT_LIVE_REVOKED_ITEM_ID': r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',
    }
    for name, pattern in patterns.items():
        if environment.get(name) and not re.fullmatch(pattern, environment[name]):
            errors.append(f'Invalid {name}')
    if environment.get('TRIPSIT_LIVE_REPOSITORY', '').split('/')[-1] in ('.', '..'):
        errors.append('Invalid TRIPSIT_LIVE_REPOSITORY')
    return errors


class ProbeFailure(Exception):
    """Only fixed stage names reach the source-free report."""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def request_json(origin, path, cookie=None, payload=None, timeout=35):
    target = urlparse(origin)
    # Resolve the accepted localhost alias numerically so DNS cannot outlive the request deadline.
    host = '127.0.0.1' if target.hostname == 'localhost' else target.hostname
    connection = http.client.HTTPConnection(host, target.port or 80, timeout=timeout)
    deadline = time.monotonic() + timeout
    expired = threading.Event()
    transport = None
    def interrupt():
        expired.set()
        active = connection.sock or transport
        if active is not None:
            try:
                active.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
    headers = {'Accept': 'application/json', 'Origin': origin, 'Host': target.netloc}
    if cookie:
        headers['Cookie'] = cookie
    body = None if payload is None else json.dumps(payload).encode()
    if body is not None:
        headers['Content-Type'] = 'application/json'
    timer = threading.Timer(max(0, deadline - time.monotonic()), interrupt)
    timer.daemon = True
    try:
        timer.start()
        connection.request('GET' if body is None else 'POST', path, body=body, headers=headers)
        transport = connection.sock
        if expired.is_set():
            raise ProbeFailure('request_timeout')
        transport.settimeout(max(.001, deadline - time.monotonic()))
        response = connection.getresponse()
        if expired.is_set():
            raise ProbeFailure('request_timeout')
        if 300 <= response.status < 400 or response.getheader('Content-Type', '').split(';')[0] != 'application/json':
            raise ProbeFailure('invalid_http_response')
        if response.getheader('Content-Length') and int(response.getheader('Content-Length')) > 1024 * 1024:
            raise ProbeFailure('oversized_response')
        chunks, size = [], 0
        while True:
            if response.isclosed():
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProbeFailure('request_timeout')
            transport.settimeout(remaining)
            chunk = response.read1(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > 1024 * 1024:
                raise ProbeFailure('oversized_response')
            chunks.append(chunk)
        payload = json.loads(b''.join(chunks).decode('utf-8'))
        if expired.is_set() or time.monotonic() >= deadline:
            raise ProbeFailure('request_timeout')
        return response.status, payload
    except (OSError, ValueError, http.client.HTTPException) as cause:
        raise ProbeFailure('http_request_failed') from cause
    finally:
        timer.cancel()
        connection.close()


def code_digest():
    root = Path(__file__).resolve().parents[2]
    paths = [Path(__file__).resolve(), root / 'frontend/migrations/001_work_items.sql',
             root / 'frontend/src/lib/auth.ts', root / 'frontend/src/env.ts']
    paths += sorted((root / 'frontend/src/lib/server').glob('*.ts'))
    paths += sorted((root / 'frontend/src/routes/api/work-items').rglob('*.ts'))
    return digest({str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})


def run_probes(environment, timeout=35):
    report = {'accepted': False, 'code_sha256': code_digest(),
              'public_api': {'status': 'unavailable', 'checks': []},
              'private_admission': {'status': 'unverified'},
              'periodic_retention': {'status': 'unverified'},
              'database_isolation_and_purge': {'status': 'unverified'},
              'authenticated_browser': {'status': 'unverified'}}
    errors = configuration_errors(environment)
    if errors:
        report['public_api']['configuration_errors'] = errors
        return report
    public_configuration = {key: environment[key] for key in REQUIRED if not key.endswith('_COOKIE')}
    report['configuration_sha256'] = digest(public_configuration)
    report['observed_at'] = datetime.now(timezone.utc).isoformat()
    origin, owner, other = (environment[key] for key in REQUIRED[:3])
    stage = 'anonymous_denial'
    checks = report['public_api']['checks']
    def checked(name, success):
        if not success:
            raise ProbeFailure(name)
        checks.append(name)
    def call(path, cookie=None, payload=None):
        return request_json(origin, path, cookie, payload, timeout)
    try:
        status, _ = call('/api/work-items')
        checked(stage, status == 401)
        stage = 'distinct_authenticated_owners'
        left_status, left = call('/api/auth/get-session', owner)
        right_status, right = call('/api/auth/get-session', other)
        left_id, right_id = left['user']['id'], right['user']['id']
        checked(stage, left_status == right_status == 200 and isinstance(left_id, str) and bool(left_id)
                and isinstance(right_id, str) and bool(right_id) and left_id != right_id)
        report['owner_pair_sha256'] = digest([left_id, right_id])
        stage = 'public_snapshot_creation_and_provenance'
        status, created = call('/api/work-items', owner, {'repository': environment['TRIPSIT_LIVE_REPOSITORY'],
                                  'issueNumber': int(environment['TRIPSIT_LIVE_ISSUE_NUMBER'])})
        item = created['item']
        snapshot = item['snapshot']
        checked(stage, status == 200 and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', item['id'])
                and snapshot['repository'] == environment['TRIPSIT_LIVE_REPOSITORY']
                and snapshot['repositoryId'] == int(environment['TRIPSIT_LIVE_REPOSITORY_ID'])
                and snapshot['issueNumber'] == int(environment['TRIPSIT_LIVE_ISSUE_NUMBER'])
                and snapshot['baseSha'] == environment['TRIPSIT_LIVE_BASE_SHA'] and snapshot['private'] is False
                and isinstance(snapshot['issueId'], int) and snapshot['issueId'] > 0
                and snapshot['supplied']['provenance'] == 'supplied'
                and isinstance(snapshot['supplied']['title'], str) and isinstance(snapshot['supplied']['body'], str)
                and snapshot['inferred'] == [] and snapshot['ownerConfirmed'] == [])
        created_at = datetime.fromisoformat(item['createdAt'].replace('Z', '+00:00'))
        expires_at = datetime.fromisoformat(item['expiresAt'].replace('Z', '+00:00'))
        checked('seven_day_expiry_metadata', created_at.tzinfo is not None and expires_at.tzinfo is not None
                and (expires_at - created_at).total_seconds() == 7 * 24 * 60 * 60
                and expires_at > datetime.now(timezone.utc))
        report['snapshot_sha256'] = digest(item)
        stage = 'owner_detail_revision_stability'
        status, detail = call('/api/work-items/' + item['id'], owner)
        checked(stage, status == 200 and detail['item'] == item)
        stage = 'owner_collection_revision_stability'
        status, listing = call('/api/work-items', owner)
        checked(stage, status == 200 and item in listing['items'])
        stage = 'second_owner_denial'
        status, denied = call('/api/work-items/' + item['id'], other)
        checked(stage, status == 404 and set(denied) == {'message'} and isinstance(denied['message'], str))
        stage = 'existing_inaccessible_snapshot_denial'
        status, denied = call('/api/work-items/' + environment['TRIPSIT_LIVE_REVOKED_ITEM_ID'], owner)
        # 404 could be a nonexistent fixture, so only a current authority denial proves this probe.
        checked(stage, status == 403 and set(denied) == {'message'} and isinstance(denied['message'], str))
        report['public_api']['status'] = 'passed'
    except (ProbeFailure, KeyError, TypeError, ValueError, AttributeError):
        report['public_api'].update(status='failed', failed_check=stage)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('story', nargs='?', choices=['e01s01'])
    parser.add_argument('--require-configured', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.self_test:
        assert configuration_errors({})
        assert not run_probes({})['accepted']
        print('PASS: missing live configuration cannot yield admission')
        return 0
    if args.story != 'e01s01' or not args.require_configured:
        parser.error('Use e01s01 --require-configured; there is no skip/pass mode')
    report = run_probes(os.environ)
    rendered = json.dumps(report, sort_keys=True, indent=2) + '\n'
    if args.report:
        args.report.write_text(rendered)
    print(rendered, end='')
    return 0 if report['accepted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
