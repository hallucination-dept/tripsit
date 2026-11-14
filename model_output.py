"""Keep raw selected-token observations alongside the existing review fields."""
import math


def add_token_probabilities(result: dict) -> dict:
    for choice in result.get("choices", []):
        logprobs = choice.get("logprobs") or {}
        choice["token_probabilities"] = [
            {"token": item.get("token"), "probability_percent": math.exp(item["logprob"]) * 100}
            for item in (logprobs.get("content") or [])
            if isinstance(item, dict) and isinstance(item.get("logprob"), (float, int))
            and not isinstance(item["logprob"], bool)
            and math.isfinite(item["logprob"]) and item["logprob"] <= 0
        ]
    return result
