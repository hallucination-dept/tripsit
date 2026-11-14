"""Fail-closed admission report; never certify mocked checks as live evidence."""
import argparse
import os
from urllib.parse import urlparse
import re


REQUIRED = ('TRIPSIT_LIVE_ORIGIN', 'TRIPSIT_LIVE_OWNER_COOKIE', 'TRIPSIT_LIVE_OTHER_COOKIE',
            'TRIPSIT_LIVE_REPOSITORY', 'TRIPSIT_LIVE_ISSUE_NUMBER', 'TRIPSIT_LIVE_REPOSITORY_ID',
            'TRIPSIT_LIVE_BASE_SHA', 'TRIPSIT_LIVE_REVOKED_ITEM_ID')


def configuration_errors(environment):
    errors = [f'Missing {key}' for key in REQUIRED if not environment.get(key)]
    try:
        target = urlparse(environment.get('TRIPSIT_LIVE_ORIGIN', ''))
        if (target.scheme != 'http' or target.hostname not in ('localhost', '127.0.0.1', '::1')
                or target.username or target.password or target.path or target.query or target.fragment
                or (target.port is not None and not 1 <= target.port <= 65535)):
            errors.append('Development origin must be an explicit loopback HTTP origin without a path')
    except ValueError:
        errors.append('Invalid development origin')
    for name in ('TRIPSIT_LIVE_OWNER_COOKIE', 'TRIPSIT_LIVE_OTHER_COOKIE'):
        cookie = environment.get(name, '')
        if not cookie or len(cookie) > 8192 or any(ord(char) < 32 or ord(char) > 126 for char in cookie):
            errors.append(f'Invalid {name}')
    if environment.get('TRIPSIT_LIVE_OWNER_COOKIE') == environment.get('TRIPSIT_LIVE_OTHER_COOKIE'):
        errors.append('Owner and second-owner sessions must differ')
    patterns = {
        'TRIPSIT_LIVE_REPOSITORY': r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}',
        'TRIPSIT_LIVE_ISSUE_NUMBER': r'[1-9][0-9]{0,14}',
        'TRIPSIT_LIVE_REPOSITORY_ID': r'[1-9][0-9]{0,14}',
        'TRIPSIT_LIVE_BASE_SHA': r'(?:[a-f0-9]{40}|[a-f0-9]{64})',
        'TRIPSIT_LIVE_REVOKED_ITEM_ID': r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',
    }
    for name, pattern in patterns.items():
        if not re.fullmatch(pattern, environment.get(name, '')):
            errors.append(f'Invalid {name}')
    if environment.get('TRIPSIT_LIVE_REPOSITORY', '').split('/')[-1] in ('.', '..'):
        errors.append('Invalid TRIPSIT_LIVE_REPOSITORY')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('story', nargs='?', choices=['e01s01'])
    parser.add_argument('--require-configured', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        assert len(configuration_errors({})) == 5
        example = {key: 'fixture' for key in ('GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY',
                   'TRIPSIT_TEST_DATABASE_URL', 'TRIPSIT_LIVE_ORIGIN', 'TRIPSIT_LIVE_OWNER_COOKIE')}
        assert configuration_errors(example)
        example['TRIPSIT_LIVE_ORIGIN'] = 'http://127.0.0.1:5173'
        assert not configuration_errors(example)
        print('PASS: admission reporter configuration denials')
        return 0
    if args.story != 'e01s01' or not args.require_configured:
        parser.error('Use e01s01 --require-configured; there is no skip/pass mode')
    for reason in configuration_errors(os.environ):
        print(f'UNAVAILABLE: {reason}')
    # No success receipt exists until actual service probes and recurring deletion are verified.
    print('BLOCKED: actual GitHub user/installation and revocation probes, authenticated browser UAT,')
    print('periodic retention invocation, and private-source admission are not verified.')
    print('Private persistence remains refused; no live admission receipt was emitted.')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
