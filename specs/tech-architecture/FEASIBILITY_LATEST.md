# Local feasibility evidence

## Current reproducible check

Run `python3 specs/experiments/elaborate_selfcheck.py`. It passed on 2026-11-14: synthetic UTF-8 reconstruction and line-ending identity, Python import alias resolution, deleted-symbol reachability through a base graph, cycle termination, visible traversal-budget exhaustion, and unresolved dynamic calls. The graph traversal fixtures are hand-authored; they do not demonstrate automated graph extraction for deletions or general semantic resolution. No live service, sandbox, or other-language coverage is certified. ADR 0003 defines the deferred live implementation gates.

## Historical inline experiment

Executed on 2026-11-14 using Python 3 standard-library assertions through an inline command. Synthetic fixtures only; no repository code executed, packages installed, live APIs called, or infrastructure changed. The command was exploratory and is preserved in the session tool history, not as a shipping test suite.

## Dependency experiment

Three in-memory files defined `pricing.discount`, `refund.refund`, and `dynamic.invoke`. `refund.py` imported `discount as price`; its function called `price(total)`. `dynamic.invoke` called a function parameter.

AST extraction plus a module import-alias map resolved `refund.refund → pricing.discount`. Reverse traversal from `pricing.discount` reached both symbols. The dynamic `fn(value)` remained unresolved, as did the builtin `round` under this deliberately narrow resolver.

Result: direct imported aliases can support an initial Python dependency graph without an additional parser dependency. This is not proof of general resolution, deletion handling, cyclic traversal, shared-resource analysis, or repository-scale performance. No deletion or cycle fixture was executed.

## Token byte experiment

The fixture `def café():\r\n    return "🧪"\r\n` was encoded as UTF-8 and divided into synthetic one-byte token fragments. Concatenating the bytes before decoding reconstructed the source exactly. Decoding fragments individually with replacement and concatenating the strings did not.

Assertions also confirmed that normalizing CRLF to LF changes the source digest. Result: retain original bytes and line endings; string reconstruction needs explicit validation. These fragments are synthetic, not observed Gemma tokenization or evidence of a provider bug.

Minimal reproducible byte self-check:

```sh
python3 - <<'PY'
import hashlib
source = 'def café():\r\n    return "🧪"\r\n'
raw = source.encode('utf-8')
tokens = [raw[i:i+1] for i in range(len(raw))]
assert b''.join(tokens).decode('utf-8') == source
assert ''.join(t.decode('utf-8', errors='replace') for t in tokens) != source
assert hashlib.sha256(raw).digest() != hashlib.sha256(source.replace('\r\n', '\n').encode()).digest()
print('byte reconstruction checks passed')
PY
```

## Environment and remaining evidence

Python Tree-sitter bindings and the local frontend TypeScript package directory were unavailable. No dependencies were installed. Python AST is a viable experiment candidate, not a locked replacement for common-language parsing.

Live reviewer validation awaits endpoint/model selection and configured access. Sandbox isolation validation awaits an identified disposable setup or a concrete reviewed configuration. Token bytes must be checked against actual Gemma responses. Multi-file output decoding and edit mapping remain untested.

No calibration, correctness probability, independent-review quality, or sandbox security gate has passed. Elaborate remains in progress.
