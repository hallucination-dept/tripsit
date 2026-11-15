import copy
import json
import math
import unittest
from pathlib import Path

from token_capture import TOP_K, MappingError, capture_body, edit_tokens, negentropy, sse_events

# A real non-streamed edit call from gemma-4-31B-it behind vLLM's gemma4 parsers (top-k logprobs were not requested).
FIXTURE = json.loads((Path(__file__).parent / 'fixtures' / 'gemma4_edit_call.json').read_text())


def token(text=None, logprob=-0.01, top=None, data=None):
    data = list(text.encode('utf-8')) if data is None else data
    return {'token': text if text is not None else '', 'logprob': logprob, 'bytes': data, 'top_logprobs': top or []}


def write_choice(content_tokens, arguments):
    tokens = [token('<|tool_call>'), token('call'), token(':'), token('write'), token('{'), token('content'), token(':'),
              token('<|"|>'), *content_tokens, token('<|"|>'), token(',path:'), token('<|"|>'), token('x.py'),
              token('<|"|>'), token('}'), token('<tool_call|>')]
    return {'message': {'role': 'assistant', 'content': None, 'tool_calls': [
        {'id': 'call-1', 'type': 'function', 'function': {'name': 'write', 'arguments': json.dumps(arguments)}}]},
        'logprobs': {'content': tokens}}


def top(probabilities):
    return [{'token': f't{index}', 'logprob': math.log(p)} for index, p in enumerate(probabilities)]


class EditTokenTests(unittest.TestCase):
    def test_real_edit_call_maps_new_text_tokens_exactly(self):
        choice = FIXTURE['choices'][0]
        calls = edit_tokens(choice)
        self.assertEqual([call['name'] for call in calls], ['edit'])
        self.assertEqual(calls[0]['id'], choice['message']['tool_calls'][0]['id'])
        [value] = calls[0]['values']  # oldText and path are not written text
        self.assertEqual(value['path'], ['edits', 0, 'newText'])
        new_text = json.loads(choice['message']['tool_calls'][0]['function']['arguments'])['edits'][0]['newText']
        self.assertEqual(''.join(record[4] for record in value['tokens']), new_text)
        cursor = 0
        for start, end, logprob, score, text, _ in value['tokens']:
            self.assertEqual((start, end - start), (cursor, len(text)))
            self.assertLessEqual(logprob, 0)
            self.assertIsNone(score)  # no top-k logprobs in this response
            cursor = end
        self.assertEqual(cursor, len(new_text))
        weakest = min(value['tokens'], key=lambda record: record[2])
        self.assertEqual(weakest[4], 'amount')

    def test_offsets_are_utf16_and_split_characters_belong_to_their_first_byte(self):
        emoji = '😀'.encode('utf-8')
        choice = write_choice([token('a'), token('😀', data=list(emoji[:2])), token('', data=list(emoji[2:])), token('é'), token('b')],
                              {'content': 'a😀éb', 'path': 'x.py'})
        [call] = edit_tokens(choice)
        spans = [(record[0], record[1], record[4]) for record in call['values'][0]['tokens']]
        self.assertEqual(spans, [(0, 1, 'a'), (1, 3, '😀'), (3, 4, 'é'), (4, 5, 'b')])

    def test_values_that_do_not_match_the_parsed_arguments_are_left_out(self):
        choice = write_choice([token('print'), token('(1)')], {'content': 'print(2)', 'path': 'x.py'})
        self.assertEqual(edit_tokens(choice), [])

    def test_raw_and_parsed_call_counts_must_agree(self):
        choice = copy.deepcopy(FIXTURE['choices'][0])
        choice['message']['tool_calls'].append(copy.deepcopy(choice['message']['tool_calls'][0]))
        with self.assertRaises(MappingError):
            edit_tokens(choice)

    def test_other_tools_and_empty_responses_produce_nothing(self):
        choice = copy.deepcopy(FIXTURE['choices'][0])
        choice['message']['tool_calls'][0]['function']['name'] = 'bash'
        choice['logprobs']['content'][3] = token('bash')
        self.assertEqual(edit_tokens(choice), [])
        self.assertEqual(edit_tokens({'message': {'content': 'done'}, 'logprobs': {'content': [token('done')]}}), [])

    def test_uncertain_tokens_keep_their_most_likely_alternatives(self):
        # Even 97% leaves negentropy near 0.92 once its 3% tail is spread over 14 alternatives, so "sure" is 99.9%.
        sure = top([0.999] + [0.001 / 14] * 14)
        torn = top([0.5, 0.3, 0.1] + [0.1 / 12] * 12)
        choice = write_choice([token('x', math.log(0.999), sure), token('=', math.log(0.5), torn)], {'content': 'x=', 'path': 'x.py'})
        [first, second] = edit_tokens(choice)[0]['values'][0]['tokens']
        self.assertIsNone(first[5])
        self.assertEqual([alternative[0] for alternative in second[5]], ['t0', 't1', 't2'])
        self.assertLess(second[3], first[3])


class NegentropyTests(unittest.TestCase):
    def test_matches_uqlm_definition(self):
        self.assertAlmostEqual(negentropy([math.log(1 / TOP_K)] * TOP_K), 0.0)
        probabilities = [0.9] + [0.1 / 14] * 14
        entropy = -sum(p * math.log(p) for p in probabilities)
        self.assertAlmostEqual(negentropy([math.log(p) for p in probabilities]), 1 - entropy / math.log(TOP_K))

    def test_needs_k_alternatives_and_uses_the_k_most_likely(self):
        self.assertIsNone(negentropy([math.log(0.5)] * (TOP_K - 1)))
        extra = [math.log(1 / TOP_K)] * TOP_K + [math.log(1e-9)]
        self.assertAlmostEqual(negentropy(extra), 0.0)


class RequestTests(unittest.TestCase):
    def test_capture_body_asks_for_top_k_without_streaming(self):
        body = {'model': 'm', 'stream': True, 'stream_options': {'include_usage': True}, 'tools': [], 'top_logprobs': 0}
        upstream = capture_body(body)
        self.assertEqual(upstream, {'model': 'm', 'tools': [], 'logprobs': True, 'top_logprobs': TOP_K})
        self.assertTrue(body['stream'])

    def test_replays_a_completion_as_stream_chunks(self):
        result = copy.deepcopy(FIXTURE)
        result['choices'][0]['message']['content'] = 'Editing.'
        events = sse_events(result, include_usage=True)
        self.assertEqual(events[-1], b'data: [DONE]\n\n')
        chunks = [json.loads(event.decode()[len('data: '):]) for event in events[:-1]]
        self.assertEqual(chunks[0]['choices'][0]['delta'], {'role': 'assistant', 'content': 'Editing.'})
        call = chunks[1]['choices'][0]['delta']['tool_calls'][0]
        original = result['choices'][0]['message']['tool_calls'][0]
        self.assertEqual((call['index'], call['id'], call['function']), (0, original['id'], original['function']))
        self.assertEqual(chunks[2]['choices'][0]['finish_reason'], 'tool_calls')
        self.assertEqual(chunks[3], {**{key: chunks[0][key] for key in ('id', 'object', 'created', 'model')}, 'choices': [], 'usage': result['usage']})
        self.assertEqual(len(sse_events(result, include_usage=False)), len(events) - 1)


if __name__ == '__main__':
    unittest.main()
