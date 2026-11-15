"""Compare frozen, independently labeled fixtures using externally trusted runner exports.

The caller must authenticate the export outside this script. This program validates
bindings and budgets but cannot certify the runner, labeler, or selection algorithm.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from freeze_evaluation import digest

METHODS = ('graph-only', 'uncertainty-only', 'combined')
BUDGET = {'optionalChecks': 3, 'perCheckMs': 60000, 'totalMs': 180000}
HEX = re.compile(r'^[a-f0-9]{64}$')
SHA = re.compile(r'^[a-f0-9]{40}$')


def need(condition):
    if not condition:
        raise ValueError('Invalid or inconsistent frozen manifest or execution export.')


def name(value):
    return isinstance(value, str) and 0 < len(value) <= 128 and value.strip() == value and all(ord(c) >= 32 for c in value)


def evaluate(manifest, export, split='held-out'):
    need(isinstance(manifest, dict) and manifest.get('schemaVersion') == 1 and manifest.get('methods') == list(METHODS)
         and manifest.get('budget') == BUDGET and manifest.get('evaluationComplete') is False)
    need(HEX.fullmatch(str(manifest.get('manifestDigest'))) and digest({k: v for k, v in manifest.items() if k != 'manifestDigest'}) == manifest['manifestDigest'])
    fixtures = manifest.get('fixtures'); checks = manifest.get('mandatoryChecks')
    need(isinstance(fixtures, list) and 0 < len(fixtures) <= 256 and isinstance(checks, list) and checks and all(name(c) for c in checks) and len(set(checks)) == len(checks))
    need(split == 'held-out' and isinstance(manifest.get('splitDigests'), dict))
    need(manifest['splitDigests'].get(split) == digest([f for f in fixtures if f.get('split') == split]))
    selected = [f for f in fixtures if f.get('split') == split]
    need(selected and all(name(f.get('id')) and name(f.get('language')) and f.get('independent') is True and name(f.get('labeler'))
        and f.get('label') in ('clean', 'defective') and (f.get('severity') == 'none' if f.get('label') == 'clean' else f.get('severity') in ('low', 'medium', 'high', 'critical')) and HEX.fullmatch(str(f.get('sourceDigest'))) for f in selected))
    need(len({f['id'] for f in selected}) == len(selected) and {f['label'] for f in selected} == {'clean', 'defective'})
    need(isinstance(export, dict) and export.get('schemaVersion') == 1 and export.get('manifestDigest') == manifest['manifestDigest']
         and export.get('splitDigest') == manifest['splitDigests'][split] and name(export.get('trustedExporter')) and isinstance(export.get('records'), list)
         and len(export['records']) <= len(selected) * len(METHODS))
    fixture_by_id = {f['id']: f for f in selected}; records = {}; execution_ids = set(); revisions = {}
    for record in export['records']:
        need(isinstance(record, dict)); fid, method = record.get('fixtureId'), record.get('method')
        need(fid in fixture_by_id and method in METHODS and (fid, method) not in records)
        need(record.get('sourceDigest') == fixture_by_id[fid]['sourceDigest'] and SHA.fullmatch(str(record.get('baseSha')))
             and SHA.fullmatch(str(record.get('commitSha'))) and record.get('budget') == BUDGET)
        revision = (record['baseSha'], record['commitSha']); need(fid not in revisions or revisions[fid] == revision); revisions[fid] = revision
        mandatory, optional, executions = record.get('mandatoryChecks'), record.get('optionalChecks'), record.get('executions')
        need(isinstance(mandatory, list) and mandatory == checks and isinstance(optional, list)
             and len(optional) <= BUDGET['optionalChecks'] and all(name(c) for c in optional)
             and len(set(optional)) == len(optional) and not set(optional) & set(mandatory) and isinstance(executions, list))
        expected = mandatory + optional; case_counts = record.get('expectedCases')
        need(len(executions) == len(expected) and isinstance(case_counts, dict) and set(case_counts) == set(expected)
             and all(type(v) is int and 1 <= v <= 16 for v in case_counts.values()))
        actual = [] ; optional_time = 0
        for execution in executions:
            need(isinstance(execution, dict) and name(execution.get('id')) and execution['id'] not in execution_ids
                 and execution.get('collector') == 'trusted_runner' and name(execution.get('runnerId'))
                 and execution.get('checkId') in expected and execution.get('checkId') not in actual
                 and execution.get('status') in ('completed', 'timed_out', 'cancelled', 'infrastructure_error')
                 and execution.get('result') in ('passed', 'failed', 'inconclusive')
                 and all(HEX.fullmatch(str(execution.get(key))) for key in ('definitionDigest','oracleDigest','environmentDigest','dependencyDigest'))
                 and type(execution.get('executedTests')) is int and 0 <= execution['executedTests'] <= 65536
                 and (execution.get('exitCode') is None or type(execution['exitCode']) is int and -255 <= execution['exitCode'] <= 255)
                 and type(execution.get('durationMs')) is int and 0 <= execution['durationMs'] <= 3600000)
            need(execution['status'] == 'completed' or execution['result'] == 'inconclusive')
            need(execution['executedTests'] <= case_counts[execution['checkId']])
            need(execution['result'] != 'passed' or execution['status'] == 'completed' and execution['executedTests'] == case_counts[execution['checkId']] and execution['exitCode'] == 0)
            if execution['checkId'] in optional:
                need(execution['durationMs'] <= BUDGET['perCheckMs']); optional_time += execution['durationMs']
            actual.append(execution['checkId']); execution_ids.add(execution['id'])
        need(actual == expected and optional_time <= BUDGET['totalMs'])
        records[(fid, method)] = record
    groups = {}
    for fixture in selected:
        for method in METHODS:
            group = groups.setdefault((method, fixture['language']), {'method': method, 'language': fixture['language'], 'clean': 0, 'defective': 0, 'detected': 0, 'severeMisses': 0, 'falseAlarms': 0, 'unavailable': 0, 'costMs': 0, 'executionIds': []})
            group[fixture['label']] += 1
            record = records.get((fixture['id'], method))
            if record is None:
                group['unavailable'] += 1; continue
            executions = record['executions']; group['executionIds'].extend(e['id'] for e in executions)
            group['costMs'] += sum(e['durationMs'] for e in executions)
            if any(e['status'] != 'completed' or e['result'] == 'inconclusive' for e in executions):
                group['unavailable'] += 1; continue
            failed = any(e['result'] == 'failed' for e in executions)
            if fixture['label'] == 'defective':
                group['detected'] += int(failed)
                if not failed and fixture.get('severity') in ('high', 'critical'): group['severeMisses'] += 1
            elif failed: group['falseAlarms'] += 1
    rows = [groups[key] for key in sorted(groups)]
    return {'manifestDigest': manifest['manifestDigest'], 'splitDigest': manifest['splitDigests'][split], 'split': split,
            'trustedExporter': export['trustedExporter'], 'budget': BUDGET, 'complete': all(row['unavailable'] == 0 for row in rows),
            'groups': rows, 'limitations': ['External exporter and independent labels are asserted, not authenticated.', 'Recorded selections are not proof of selection algorithm or check adequacy.', 'Counts are fixture observations, not calibrated correctness claims.']}


def read(path):
    with Path(path).open('rb') as stream: data = stream.read(4_194_305)
    need(len(data) <= 4_194_304)
    return json.loads(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True); parser.add_argument('--records', default='specs/experiments/fixtures/execution-records.json')
    parser.add_argument('--split', default='held-out'); parser.add_argument('--methods', nargs='+', default=list(METHODS))
    parser.add_argument('--require-executions', action='store_true'); parser.add_argument('--report', required=True)
    args = parser.parse_args()
    try:
        need(args.methods == list(METHODS)); report = evaluate(read(args.manifest), read(args.records), args.split)
        Path(args.report).write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        return 1 if args.require_executions and not report['complete'] else 0
    except (ValueError, OSError, TypeError, KeyError, json.JSONDecodeError):
        print('Evaluation unavailable: input missing, invalid or inconsistent.', file=sys.stderr); return 2


if __name__ == '__main__':
    sys.exit(main())
