import asyncio
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('node_uncertainty', Path(__file__).resolve().parents[1] / 'node_uncertainty.py')
nu = importlib.util.module_from_spec(spec)
sys.modules['node_uncertainty'] = nu  # dataclasses resolve annotations through sys.modules
spec.loader.exec_module(nu)

BASE = '''
LIMIT = 50

def f(x):
    return x > LIMIT

def g(x):
    return x + 1

class Box:
    size = 1
    def area(self):
        return self.size ** 2
'''


def nodes(source):
    return nu.split_nodes(source)


class FakeJudge:
    """Equivalent means identical normalized source; records calls."""
    def __init__(self, fail=()):
        self.calls, self.fail = [], set(fail)

    async def __call__(self, names, responses, sampled):
        self.calls.append(list(names))
        return [float('nan') if name in self.fail else sum(s == r for s in samples) / len(samples)
                for name, r, samples in zip(names, responses, sampled)]


def assess(base, candidate, samples, judge):
    return {r.node: r for r in asyncio.run(nu.assess(nodes(base), nodes(candidate), [nodes(s) for s in samples], judge))}


class SplitTests(unittest.TestCase):
    def test_functions_methods_and_module_statements_become_nodes(self):
        result = nodes(BASE)
        self.assertEqual(set(result), {'f', 'g', 'Box.area', nu.MODULE_NODE})
        self.assertIn('LIMIT = 50', result[nu.MODULE_NODE])
        self.assertIn('size = 1', result[nu.MODULE_NODE])
        self.assertNotIn('def area', result[nu.MODULE_NODE])

    def test_formatting_and_comments_do_not_change_a_node(self):
        reformatted = BASE.replace('return x + 1', 'return (x + 1)  # increment')
        self.assertEqual(nodes(BASE), nodes(reformatted))

    def test_code_is_taken_from_a_fenced_reply(self):
        self.assertEqual(nu.extract_code('Here:\n```python\nx = 1\n```\nDone.'), 'x = 1\n')
        self.assertEqual(nu.extract_code('x = 1'), 'x = 1\n')

    def test_invalid_python_is_rejected(self):
        with self.assertRaises(SyntaxError):
            nodes('def f(:\n')


class AssessTests(unittest.TestCase):
    def test_disagreeing_samples_flag_only_the_ambiguous_node(self):
        candidate = BASE.replace('x > LIMIT', 'x >= LIMIT').replace('x + 1', 'x + 2')
        other = BASE.replace('x > LIMIT', 'x > LIMIT + 1').replace('x + 1', 'x + 2')
        judge = FakeJudge()
        reports = assess(BASE, candidate, [candidate, candidate, other, other], judge)
        self.assertEqual(judge.calls, [['f', 'g']])
        self.assertEqual(reports['f'].agreement, 0.5)
        self.assertEqual(reports['f'].flag, '2/4 samples behave differently')
        self.assertEqual(reports['g'].agreement, 1.0)
        self.assertIsNone(reports['g'].flag)
        self.assertEqual(reports['Box.area'].candidate, 'unchanged')
        self.assertIsNone(reports['Box.area'].flag)

    def test_a_node_only_samples_edit_is_reported_as_a_possible_missed_edit(self):
        sample = BASE.replace('self.size ** 2', 'self.size * self.size * 1')
        reports = assess(BASE, BASE, [sample, BASE], FakeJudge())
        self.assertEqual(reports['Box.area'].samples_editing, 1)
        self.assertEqual(reports['Box.area'].flag, 'possible missed edit: 1/2 samples edited this node')

    def test_added_and_removed_nodes_compare_against_the_removal_marker(self):
        candidate = BASE.replace('def g(x):\n    return x + 1\n', 'def h(x):\n    return 0\n')
        reports = assess(BASE, candidate, [BASE], FakeJudge())
        self.assertEqual((reports['g'].candidate, reports['h'].candidate), ('removed', 'added'))
        self.assertEqual((reports['g'].agreement, reports['h'].agreement), (0.0, 0.0))

    def test_missing_judge_signal_is_flagged_not_trusted(self):
        candidate = BASE.replace('x + 1', 'x + 2')
        reports = assess(BASE, candidate, [candidate], FakeJudge(fail={'g'}))
        self.assertIsNone(reports['g'].agreement)
        self.assertEqual(reports['g'].flag, 'no agreement signal: review as uncertain')

    def test_no_edits_means_no_judge_calls(self):
        judge = FakeJudge()
        reports = assess(BASE, BASE, [BASE], judge)
        self.assertEqual(judge.calls, [])
        self.assertTrue(all(r.flag is None for r in reports.values()))


class SettingsTests(unittest.TestCase):
    def test_env_file_supplies_only_the_endpoint_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / '.env'
            env.write_text('MODAL_API_URL=https://example.test\nMODAL_PROXY_TOKEN="t"\nMODEL_ID=m\nDATABASE_URL=secret\n')
            self.assertEqual(nu.load_settings(env, {}), {'MODAL_API_URL': 'https://example.test', 'MODAL_PROXY_TOKEN': 't', 'MODEL_ID': 'm'})

    def test_missing_settings_name_keys_without_values(self):
        with self.assertRaises(SystemExit) as raised:
            nu.load_settings(None, {'MODAL_PROXY_TOKEN': 'hidden'})
        self.assertIn('MODAL_API_URL', str(raised.exception))
        self.assertNotIn('hidden', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
