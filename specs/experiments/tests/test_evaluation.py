import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from freeze_evaluation import freeze_manifest
from evaluate import evaluate, METHODS, BUDGET


class EvaluationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name); fixtures = []
        for split in ('development', 'held-out'):
            for label in ('clean', 'defective'):
                name = split + '-' + label + '.py'; data = name.encode(); (root / name).write_bytes(data)
                fixtures.append({'id': name, 'language': 'python', 'split': split, 'label': label,
                    'severity': 'high' if label == 'defective' else 'none', 'labeler': 'independent', 'independent': True,
                    'files': [{'path': name, 'sha256': hashlib.sha256(data).hexdigest()}]})
        self.manifest = freeze_manifest({'fixtures': fixtures, 'mandatoryChecks': ['required']}, root)
        self.export = {'schemaVersion': 1, 'manifestDigest': self.manifest['manifestDigest'],
                       'splitDigest': self.manifest['splitDigests']['held-out'], 'trustedExporter': 'operator', 'records': []}
        for fixture in self.manifest['fixtures']:
            if fixture['split'] != 'held-out': continue
            for method in METHODS:
                outcome = 'failed' if fixture['label'] == 'defective' else 'passed'
                self.export['records'].append({'fixtureId': fixture['id'], 'sourceDigest': fixture['sourceDigest'],
                    'baseSha': 'a'*40, 'commitSha': 'b'*40, 'method': method, 'budget': BUDGET,
                    'mandatoryChecks': ['required'], 'optionalChecks': ['extra'], 'expectedCases': {'required': 1, 'extra': 1}, 'executions': [
                        {'id': fixture['id']+method+'1', 'checkId': 'required', 'collector':'trusted_runner', 'runnerId':'runner', 'status':'completed', 'result':outcome, 'durationMs':5, 'executedTests':1, 'exitCode':1 if outcome == 'failed' else 0, **{k:'d'*64 for k in ('definitionDigest','oracleDigest','environmentDigest','dependencyDigest')}},
                        {'id': fixture['id']+method+'2', 'checkId': 'extra', 'collector':'trusted_runner', 'runnerId':'runner', 'status':'completed', 'result':'passed', 'durationMs':10, 'executedTests':1, 'exitCode':0, **{k:'d'*64 for k in ('definitionDigest','oracleDigest','environmentDigest','dependencyDigest')}}]})

    def test_real_record_counts_and_missing_are_not_passing(self):
        report = evaluate(self.manifest, self.export); self.assertTrue(report['complete'])
        for group in report['groups']:
            self.assertEqual((group['clean'],group['defective'],group['detected'],group['severeMisses'],group['falseAlarms'],group['costMs']), (1,1,1,0,0,30))
        missing = copy.deepcopy(self.export); missing['records'].pop()
        report = evaluate(self.manifest, missing); self.assertFalse(report['complete']); self.assertEqual(sum(row['unavailable'] for row in report['groups']),1)
        unavailable = copy.deepcopy(self.export); unavailable['records'][0]['executions'][0].update(status='timed_out',result='inconclusive')
        self.assertFalse(evaluate(self.manifest, unavailable)['complete'])

    def test_bad_bindings_duplicate_ids_and_budget_are_rejected(self):
        for change in ('manifest','source','revision','duplicate','budget','order','collector'):
            manifest, export = copy.deepcopy(self.manifest), copy.deepcopy(self.export)
            if change == 'manifest': manifest['fixtures'][0]['label'] = 'defective'
            if change == 'source': export['records'][0]['sourceDigest'] = 'f'*64
            if change == 'revision': export['records'][1]['commitSha'] = 'f'*40
            if change == 'duplicate': export['records'][1]['executions'][0]['id'] = export['records'][0]['executions'][0]['id']
            if change == 'budget': export['records'][0]['executions'][1]['durationMs'] = 60001
            if change == 'order': export['records'][0]['executions'].reverse()
            if change == 'collector': export['records'][0]['executions'][0]['collector'] = 'model'
            with self.subTest(change=change), self.assertRaises(ValueError): evaluate(manifest,export)

    def test_cli_writes_incomplete_report_and_returns_failure(self):
        root=Path(self.temp.name); (root/'manifest.json').write_text(json.dumps(self.manifest)); self.export['records'].pop()
        (root/'records.json').write_text(json.dumps(self.export)); report=root/'report.json'
        command=[sys.executable,str(ROOT/'evaluate.py'),'--manifest',str(root/'manifest.json'),'--records',str(root/'records.json'),'--require-executions','--report',str(report)]
        self.assertEqual(subprocess.run(command,check=False).returncode,1); self.assertFalse(json.loads(report.read_text())['complete'])

if __name__ == '__main__': unittest.main()
