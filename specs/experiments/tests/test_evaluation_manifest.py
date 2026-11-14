import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'freeze_evaluation.py'
spec = importlib.util.spec_from_file_location('freeze_evaluation', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rows = []
        for split in ('development', 'held-out'):
            for label in ('clean', 'defective'):
                name = f'{split}-{label}.py'
                content = f'# {split} {label}\nprint("雪")\n'.encode()
                (self.root / name).write_bytes(content)
                self.rows.append(dict(id=name, language='python', split=split, label=label,
                                      severity='none' if label == 'clean' else 'high',
                                      labeler='independent-human', independent=True,
                                      files=[dict(path=name, sha256=hashlib.sha256(content).hexdigest())]))
        self.source = dict(fixtures=self.rows, mandatoryChecks=['baseline-auth', 'baseline-build'])

    def freeze(self, value=None):
        return module.freeze_manifest(self.source if value is None else value, self.root)

    def test_deterministic_frozen_splits_and_identical_budgets(self):
        result = self.freeze()
        reordered = copy.deepcopy(self.source)
        reordered['fixtures'].reverse()
        reordered['mandatoryChecks'].reverse()
        self.assertEqual(result, self.freeze(reordered))
        self.assertEqual(len(result['manifestDigest']), 64)
        self.assertEqual(set(result['splitDigests']), {'development', 'held-out'})
        self.assertEqual(result['budget'], dict(optionalChecks=3, perCheckMs=60000, totalMs=180000))
        self.assertEqual(result['methods'], ['graph-only', 'uncertainty-only', 'combined'])
        self.assertFalse(result['evaluationComplete'])
        self.assertNotIn('print(', json.dumps(result))
        changed = copy.deepcopy(self.source)
        changed['fixtures'][0]['severity'] = 'low'
        changed['fixtures'][0]['label'] = 'defective'
        changed['fixtures'][1]['label'] = 'clean'
        changed['fixtures'][1]['severity'] = 'none'
        self.assertNotEqual(result['manifestDigest'], self.freeze(changed)['manifestDigest'])

    def test_rejects_missing_denominators_duplicates_and_unreviewed_labels(self):
        for mutate in (
            lambda v: v['fixtures'].pop(),
            lambda v: v['fixtures'].append(v['fixtures'][0]),
            lambda v: v['fixtures'][0].update(independent=False),
            lambda v: v['fixtures'][0].update(labeler=''),
            lambda v: v['fixtures'][0].update(label='unknown'),
            lambda v: v['fixtures'][0].update(severity='critical'),
            lambda v: v.update(mandatoryChecks=[]),
            lambda v: v.update(results={'combined': 'passed'}),
        ):
            value = copy.deepcopy(self.source)
            mutate(value)
            with self.assertRaises(ValueError):
                self.freeze(value)

    def test_rejects_stale_bytes_traversal_links_and_cross_split_leakage(self):
        for path in ('../outside.py', '/etc/passwd', 'nested/../file.py', 'link.py'):
            value = copy.deepcopy(self.source)
            value['fixtures'][0]['files'][0]['path'] = path
            (self.root / 'link.py').unlink(missing_ok=True)
            (self.root / 'link.py').symlink_to(self.root / self.rows[0]['files'][0]['path'])
            with self.assertRaises(ValueError):
                self.freeze(value)
        value = copy.deepcopy(self.source)
        value['fixtures'][0]['files'][0]['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            self.freeze(value)
        value = copy.deepcopy(self.source)
        value['fixtures'][2]['files'] = value['fixtures'][0]['files']
        with self.assertRaises(ValueError):
            self.freeze(value)

    def test_cli_refuses_overwrite_and_invalid_input_without_output(self):
        source, output = self.root / 'labels.json', self.root / 'frozen.json'
        source.write_text(json.dumps(self.source))
        args = [sys.executable, str(SCRIPT), '--input', str(source), '--output', str(output)]
        first = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        retained = output.read_bytes()
        self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)
        self.assertEqual(output.read_bytes(), retained)
        output.unlink()
        source.write_text('{invalid')
        failed = subprocess.run(args, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
