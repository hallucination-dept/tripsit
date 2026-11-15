"""Freeze externally labeled fixtures before outcomes; never execute fixture content.

Usage: python3 specs/experiments/freeze_evaluation.py --input labels.json --output frozen.json
Input: {"mandatoryChecks":["check-id"],"fixtures":[{"id":"case-id","language":"python",
"split":"held-out","label":"defective","severity":"high","labeler":"reviewer-id",
"independent":true,"files":[{"path":"relative.py","sha256":"<64 hex digits>"}]}]}.
Both development and held-out splits require clean and defective cases. File paths
are relative to the input directory. Independence is a declaration, not certification.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'))


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def require(condition: object) -> None:
    if not condition:
        raise ValueError('Invalid, stale or incomplete fixture manifest.')


def text(value: object, limit: int = 128) -> bool:
    return isinstance(value, str) and 0 < len(value) <= limit and value.strip() == value and all(ord(c) >= 32 for c in value)


def freeze_manifest(value: dict, root: Path) -> dict:
    require(isinstance(value, dict) and set(value) == {'fixtures', 'mandatoryChecks'})
    checks, supplied = value['mandatoryChecks'], value['fixtures']
    require(isinstance(checks, list) and 0 < len(checks) <= 128 and all(text(row) for row in checks))
    require(len(set(checks)) == len(checks))
    require(isinstance(supplied, list) and 4 <= len(supplied) <= 256)
    root = root.resolve(strict=True)
    fixtures, ids, sources, denominators = [], set(), {}, set()
    total_bytes, total_files = 0, 0
    for row in supplied:
        require(isinstance(row, dict) and set(row) == {'id', 'language', 'split', 'label', 'severity', 'labeler', 'independent', 'files'})
        require(all(text(row[key]) for key in ('id', 'language', 'labeler')) and row['id'] not in ids)
        require(row['independent'] is True and row['split'] in ('development', 'held-out') and row['label'] in ('clean', 'defective'))
        require(row['severity'] == 'none' if row['label'] == 'clean' else row['severity'] in ('low', 'medium', 'high', 'critical'))
        require(isinstance(row['files'], list) and 0 < len(row['files']) <= 32)
        files, paths = [], set()
        for entry in row['files']:
            require(isinstance(entry, dict) and set(entry) == {'path', 'sha256'})
            name = entry['path']
            require(text(name, 1024) and '\\' not in name and ':' not in name and name not in paths)
            path = PurePosixPath(name)
            require(not path.is_absolute() and str(path) == name and not any(part in ('.', '..', '.git') for part in path.parts))
            require(isinstance(entry['sha256'], str) and re.fullmatch('[a-f0-9]{64}', entry['sha256']))
            target = root
            for part in path.parts:
                target /= part
                require(not target.is_symlink())
            require(target.resolve(strict=True).is_relative_to(root) and target.is_file())
            with target.open('rb') as stream:
                content = stream.read(262145)
            require(len(content) <= 262144 and hashlib.sha256(content).hexdigest() == entry['sha256'])
            total_bytes += len(content)
            total_files += 1
            require(total_bytes <= 8388608 and total_files <= 512)
            paths.add(name)
            files.append({'path': name, 'sha256': entry['sha256']})
        # Compare content independently of filenames to catch renamed split leakage.
        source_digest = digest(sorted(entry['sha256'] for entry in files))
        require(source_digest not in sources)
        sources[source_digest] = row['split']
        ids.add(row['id'])
        denominators.add((row['split'], row['label']))
        fixtures.append({**row, 'files': sorted(files, key=lambda entry: entry['path']), 'sourceDigest': source_digest})
    require(denominators == {(split, label) for split in ('development', 'held-out') for label in ('clean', 'defective')})
    fixtures.sort(key=lambda row: row['id'])
    manifest = {
        'schemaVersion': 1, 'fixtures': fixtures, 'mandatoryChecks': sorted(checks),
        'methods': ['graph-only', 'uncertainty-only', 'combined'],
        'budget': {'optionalChecks': 3, 'perCheckMs': 60000, 'totalMs': 180000},
        'splitDigests': {split: digest([row for row in fixtures if row['split'] == split]) for split in ('development', 'held-out')},
        'labelIndependence': 'Declared by the supplied labeler; requires independent human verification.',
        'evaluationComplete': False,
    }
    return {**manifest, 'manifestDigest': digest(manifest)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        with args.input.open('rb') as stream:
            raw = stream.read(1048577)
        require(len(raw) <= 1048576)
        manifest = freeze_manifest(json.loads(raw), args.input.parent)
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(canonical(manifest) + '\n')
        print('Frozen fixture manifest; no evaluation executed.')
        return 0
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        print('Cannot freeze manifest: invalid input, source access, limits or existing output.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
