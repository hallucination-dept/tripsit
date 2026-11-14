"""Fail-closed admission report; never certify mocked checks as live evidence."""
import argparse
import os
from urllib.parse import urlparse


def configuration_errors(environment):
    required = ('GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'TRIPSIT_TEST_DATABASE_URL',
                'TRIPSIT_LIVE_ORIGIN', 'TRIPSIT_LIVE_OWNER_COOKIE')
    errors = [f'Missing {key}' for key in required if not environment.get(key)]
    if environment.get('TRIPSIT_LIVE_ORIGIN'):
        target = urlparse(environment['TRIPSIT_LIVE_ORIGIN'])
        if target.scheme != 'http' or target.hostname not in ('localhost', '127.0.0.1', '::1') or target.username or target.password:
            errors.append('Live development probe must target an explicitly local HTTP origin')
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
