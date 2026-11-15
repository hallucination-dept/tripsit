"""Prototype: flag edited functions whose behavior varies across sampled edits.

Generates one greedy candidate and N sampled versions of an edited Python file
through the Modal Gemma endpoint, splits every version into nodes, and scores
each node the candidate changed with UQLM's functional-equivalence rate (Gemma
judges whether each sample's node behaves like the candidate's). Experiment
only; see specs/tech-architecture/UNCERTAINTY_LATEST.md.

Live run (needs MODAL_API_URL, MODAL_PROXY_TOKEN, MODEL_ID):
  uv run --python 3.12 --with uqlm --with langchain-openai \
    python specs/experiments/node_uncertainty.py specs/experiments/fixtures/node_uncertainty \
    --env-file frontend/.env
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import copy
import json
import math
import os
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Awaitable, Callable, Mapping

MODULE_NODE = "<module>"
REMOVED = "# node removed"
SETTINGS = ("MODAL_API_URL", "MODAL_PROXY_TOKEN", "MODEL_ID")
SYSTEM_PROMPT = (
    "You edit one Python file to implement a ticket. Change only what the ticket needs. "
    "Reply with the complete updated file in a single ```python code block and nothing else."
)
FENCE = re.compile(r"```(?:python|py)?[ \t]*\n(.*?)```", re.DOTALL)

# Scores one candidate node against its sampled versions: list of rates in [0, 1], NaN when unavailable.
Judge = Callable[[list[str], list[str], list[list[str]]], Awaitable[list[float]]]


@dataclass
class NodeReport:
    node: str
    candidate: str  # changed | added | removed | unchanged
    samples: int
    samples_editing: int
    agreement: float | None  # share of samples whose node behaves like the candidate's
    flag: str | None


def extract_code(reply: str) -> str:
    match = FENCE.search(reply)
    return (match.group(1) if match else reply).strip() + "\n"


def split_nodes(source: str) -> dict[str, str]:
    """Map node names to AST-normalized source, so formatting and comments never count as edits."""
    nodes: dict[str, str] = {}
    rest: list[ast.stmt] = []
    for stmt in ast.parse(source).body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            nodes[stmt.name] = ast.unparse(stmt)
        elif isinstance(stmt, ast.ClassDef):
            shell = copy.copy(stmt)
            shell.body = []
            for item in stmt.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    nodes[f"{stmt.name}.{item.name}"] = ast.unparse(item)
                else:
                    shell.body.append(item)
            shell.body = shell.body or [ast.Pass()]
            rest.append(shell)
        else:
            rest.append(stmt)
    if rest:
        nodes[MODULE_NODE] = ast.unparse(ast.Module(body=rest, type_ignores=[]))
    return nodes


def _status(base: str, candidate: str) -> str:
    if base == candidate:
        return "unchanged"
    if base == REMOVED:
        return "added"
    return "removed" if candidate == REMOVED else "changed"


async def assess(base: Mapping[str, str], candidate: Mapping[str, str], samples: list[Mapping[str, str]],
                 judge: Judge, threshold: float = 0.6) -> list[NodeReport]:
    names = sorted(set(base) | set(candidate) | {name for sample in samples for name in sample})
    changed = [name for name in names if candidate.get(name, REMOVED) != base.get(name, REMOVED)]
    rates = await judge(
        changed,
        [candidate.get(name, REMOVED) for name in changed],
        [[sample.get(name, REMOVED) for sample in samples] for name in changed],
    ) if changed and samples else []
    rate_by_name = dict(zip(changed, rates))
    reports = []
    for name in names:
        before, after = base.get(name, REMOVED), candidate.get(name, REMOVED)
        editing = sum(sample.get(name, REMOVED) != before for sample in samples)
        status, agreement, flag = _status(before, after), None, None
        if status == "unchanged":
            if editing:
                flag = f"possible missed edit: {editing}/{len(samples)} samples edited this node"
        elif name not in rate_by_name or not math.isfinite(rate_by_name[name]):
            flag = "no agreement signal: review as uncertain"
        else:
            agreement = float(rate_by_name[name])
            if agreement < threshold:
                differing = round((1 - agreement) * len(samples))
                flag = f"{differing}/{len(samples)} samples behave differently"
        reports.append(NodeReport(name, status, len(samples), editing, agreement, flag))
    return sorted(reports, key=lambda r: (r.flag is None, r.agreement if r.agreement is not None else -1, r.node))


def load_settings(env_file: Path | None, environ: Mapping[str, str]) -> dict[str, str]:
    values = {key: environ[key] for key in SETTINGS if environ.get(key)}
    if env_file is not None:
        for line in env_file.read_text().splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() in SETTINGS and key.strip() not in values:
                values[key.strip()] = value.strip().strip('"').strip("'")
    missing = [key for key in SETTINGS if not values.get(key)]
    if missing:
        raise SystemExit(f"Missing configuration: {', '.join(missing)}")
    return values


def _chat_model(settings: Mapping[str, str], temperature: float, max_tokens: int):
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=settings["MODEL_ID"], base_url=settings["MODAL_API_URL"].rstrip("/") + "/v1",
        api_key=settings["MODAL_PROXY_TOKEN"], temperature=temperature, max_tokens=max_tokens,
        timeout=300, max_retries=1, use_responses_api=False,
    )


def uqlm_judge(settings: Mapping[str, str]) -> Judge:
    from uqlm import CodeGenUQ

    scorer = CodeGenUQ(llm=_chat_model(settings, 0.0, 16), scorers=["functional_equivalence_rate"])

    async def judge(names: list[str], responses: list[str], sampled: list[list[str]]) -> list[float]:
        result = await scorer.score(prompts=names, responses=responses, sampled_responses=sampled,
                                    logprobs_results=None, sampled_logprobs_results=None, show_progress_bars=False)
        return [float(value) for value in result.data["functional_equivalence_rate"]]

    return judge


async def generate_replies(settings: Mapping[str, str], ticket: str, source: str, samples: int) -> dict:
    prompt = [("system", SYSTEM_PROMPT), ("human", f"Ticket:\n{ticket}\n\nFile:\n```python\n{source}```")]
    greedy, sampler = _chat_model(settings, 0.0, 2048), _chat_model(settings, 1.0, 2048)
    replies = await asyncio.gather(greedy.ainvoke(prompt), *(sampler.ainvoke(prompt) for _ in range(samples)))
    return {"candidate": replies[0].content, "samples": [reply.content for reply in replies[1:]]}


def _render(reports: list[NodeReport], dropped: int) -> str:
    lines = [f"{'node':32} {'candidate':10} {'edited by':10} {'agreement':10} flag"]
    for r in reports:
        agreement = "-" if r.agreement is None else f"{r.agreement:.2f}"
        lines.append(f"{r.node:32} {r.candidate:10} {f'{r.samples_editing}/{r.samples}':10} {agreement:10} {r.flag or ''}")
    if dropped:
        lines.append(f"{dropped} sample(s) did not parse and were excluded.")
    return "\n".join(lines)


async def run(args: argparse.Namespace) -> int:
    source = (args.fixture / "source.py").read_text()
    settings = load_settings(args.env_file, os.environ)  # the judge always needs the endpoint
    if args.replies:
        replies = json.loads(args.replies.read_text())
    else:
        replies = await generate_replies(settings, (args.fixture / "ticket.md").read_text(), source, args.samples)
    if args.save:
        args.save.write_text(json.dumps(replies, ensure_ascii=False, indent=2))
    try:
        candidate = split_nodes(extract_code(replies["candidate"]))
    except SyntaxError:
        print("The candidate edit is not valid Python; nothing to score.", file=sys.stderr)
        return 1
    samples = []
    for reply in replies["samples"]:
        try:
            samples.append(split_nodes(extract_code(reply)))
        except SyntaxError:
            pass
    reports = await assess(split_nodes(source), candidate, samples, uqlm_judge(settings), args.threshold)
    dropped = len(replies["samples"]) - len(samples)
    if args.json:
        print(json.dumps({"dropped_samples": dropped, "nodes": [asdict(r) for r in reports]}, indent=2))
    else:
        print(_render(reports, dropped))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fixture", type=Path, help="directory containing ticket.md and source.py")
    parser.add_argument("--env-file", type=Path, help="reads only MODAL_API_URL, MODAL_PROXY_TOKEN and MODEL_ID")
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--threshold", type=float, default=0.6)
    parser.add_argument("--save", type=Path, help="write the raw model replies here")
    parser.add_argument("--replies", type=Path, help="rescore saved replies instead of generating")
    parser.add_argument("--json", action="store_true")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
