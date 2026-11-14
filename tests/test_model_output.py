import copy
import unittest

from model_output import add_token_probabilities


class ModelOutputTests(unittest.TestCase):
    def test_raw_token_observations_survive_legacy_probability_conversion(self):
        raw = {"content": [{"token": "雪", "bytes": [233, 155, 170], "logprob": -0.5}]}
        original = copy.deepcopy(raw)
        result = add_token_probabilities({"choices": [{"message": {"content": "雪"}, "logprobs": raw}]})
        choice = result["choices"][0]
        self.assertEqual(choice["logprobs"], original)
        self.assertEqual(choice["message"]["content"], "雪")
        self.assertEqual(choice["token_probabilities"][0]["token"], "雪")
        self.assertAlmostEqual(choice["token_probabilities"][0]["probability_percent"], 60.65306597)

    def test_missing_or_invalid_observations_do_not_fabricate_probabilities(self):
        for value in [None, {"content": []}, {"content": [{"token": "x", "logprob": None},
            {"token": "x", "logprob": float("nan")}, {"token": "x", "logprob": 1},
            {"token": "x", "logprob": True}]}]:
            with self.subTest(value=value):
                result = add_token_probabilities({"choices": [{"logprobs": value}]})
                self.assertEqual(result["choices"][0]["token_probabilities"], [])


if __name__ == "__main__":
    unittest.main()
