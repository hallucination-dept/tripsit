"""Validate planning contracts; does not execute planned application/live checks."""
from pathlib import Path
import re
import shlex
import yaml

ROOT = Path(__file__).resolve().parents[1]


def read_yaml(path: Path):
    return yaml.safe_load(path.read_text())


def main() -> None:
    release = read_yaml(ROOT / 'release-plan.yaml')
    scope_ids = {row['id'] for row in read_yaml(ROOT / 'product/SCOPE_LATEST.yaml')['in_scope']}
    statuses = read_yaml(ROOT / 'execution-status.yaml')
    queue = release['story_queue']
    assert len(queue) == len(set(queue)) and set(queue) == scope_ids
    story_statuses = {sid: status for sid, status in statuses.items() if sid != 'stories'}
    assert set(story_statuses) == scope_ids
    assert set(story_statuses.values()) <= {'todo', 'in_progress', 'done', 'blocked'}
    for sid, record in statuses.get('stories', {}).items():
        assert sid in scope_ids and record['status'] == story_statuses[sid]
    scores = [epic['wsjf'] for epic in release['epics']]
    assert scores == sorted(scores, reverse=True)
    seen, task_count, total_bcps = set(), 0, 0
    positions = {sid: index for index, sid in enumerate(queue)}
    for index in release['epics']:
        capsule = ROOT / index['capsule_dir']
        epic = read_yaml(capsule / 'epic.yaml')
        assert epic['id'] == index['id'] and epic['type'] == 'feat'
        assert epic['total_bcps'] == sum(story['bcps'] for story in epic['stories']) == index['bcps']
        total_bcps += index['bcps']
        inputs = index['wsjf_inputs']
        assert index['wsjf'] == round((inputs['business_value'] + inputs['time_criticality'] + inputs['risk_reduction']) / inputs['job_size'], 3)
        for story in epic['stories']:
            sid = story['id']
            assert sid not in seen
            seen.add(sid)
            spec = (capsule / story['spec']).read_text()
            sections = re.findall(r'^## (\d+)\. ', spec, flags=re.M)
            assert sections == [str(number) for number in range(1, 21)], sid
            assert 'gherkin' in spec and 'Scenario: Required outcome' in spec and 'Scenario: Edge or denial' in spec
            if story['delta'] != 'ADDED':
                assert '**Before:**' in spec and '**After:**' in spec
            tasks = read_yaml(capsule / story['tasks'])
            assert tasks['story_id'] == sid and tasks['spec'] == story['spec']
            assert tasks['status'] == 'failing' and tasks['type'] == 'feat' and tasks['context'] == 'domain'
            assert tasks['bcps'] == story['bcps']
            for dependency in tasks['depends_on']:
                assert dependency in scope_ids and positions[dependency] < positions[sid], (sid, dependency)
            assert len(tasks['tasks']) >= 3
            for task in tasks['tasks']:
                assert task['status'] == 'failing' and task['risk'] in {'P0', 'P1', 'P2', 'P3'}
                assert task['verify'] and shlex.split(task['verify'])
                assert 'verify:' in spec and task['verify'] in spec
                assert task['allure']['severity'] in {'critical', 'high', 'normal', 'minor'}
                assert task['security'] in {'medium', 'high'}
                task_count += 1
    assert seen == scope_ids and total_bcps == release['sizing']['total_bcps']
    for sid in ['e01s01', 'e01s02', 'e02s02', 'e03s02', 'e01s03']:
        assert sid in (ROOT / 'tech-architecture/TEST_PLAN_LATEST.md').read_text()
    assert positions['e04s02'] < positions['e01s03']
    evaluation = read_yaml(ROOT / 'epics/e05-evaluation/e05s01-tasks.yaml')
    evaluation_command = evaluation['tasks'][1]['verify']
    for required in ['evaluate.py', '--manifest', '--split held-out',
                     '--methods graph-only uncertainty-only combined',
                     '--require-executions', '--report']:
        assert required in evaluation_command
    assert positions['e01s03'] < positions['e05s01']
    print(f'PASS: {len(release["epics"])} epics, {len(seen)} scope stories, {task_count} unrun tasks, {total_bcps} BCP; YAML, sections, IDs, WSJF and dependencies consistent.')
    print('Application tests, UAT and live gates remain unrun; command paths are implementation deliverables.')


if __name__ == '__main__':
    main()
