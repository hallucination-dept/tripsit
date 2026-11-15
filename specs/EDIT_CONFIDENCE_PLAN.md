# Edit confidence plan

Status: implemented and deployed to Modal 2026-11-15 (from the uncommitted working tree; a push to `main` without
these changes redeploys the old service, and runs then fall back to `/v1`). Design and scorer choice: `specs/tech-architecture/UNCERTAINTY_LATEST.md`,
"White-box scorer choice per changed node".

Goal: every agent run scores each changed function, class and file with uqlm's `min_token_negentropy`
(`min_probability` when top-k data is missing) over the tokens that wrote it, plus a length-adjusted score.
Deploying the Modal change needs explicit authorization; until then runs report confidence as unavailable.

## Observed model output

A live edit call (2026-11-15, `gemma-4-31B-it`, vLLM `gemma4` parsers) produced these raw tokens:
`<|tool_call>call:edit{edits:[{newText:<|"|>…<|"|>,oldText:<|"|>…<|"|>}],path:<|"|>cart.py<|"|>}<tool_call|>`.
String values are unescaped between single `<|"|>` tokens, so a value's tokens are exactly the tokens between its
delimiters. The parsed `tool_calls` arguments are the check that a mapping is exact. pi keeps vLLM's tool-call ids.

## Tasks

1. **Modal capture** (`token_capture.py`, `modal_gemma.py`). `POST /runs/{run_id}/v1/chat/completions` calls vLLM
   non-streamed with `logprobs: true, top_logprobs: 15` and replays the result as SSE when `stream` is set. For
   `edit` and `write` calls it keeps each string argument's tokens: UTF-16 offsets within the value, logprob,
   uqlm-style negentropy over the top 15, the token text and, for uncertain tokens, the top alternatives. Records are
   appended to a `modal.Dict` under the run id; `GET` and `DELETE /runs/{run_id}/tokens` read and remove them.
   Mapping failures drop the record and never fail the model request.
   Verify: `python3 -m unittest discover -s tests`
2. **Edit recording** (`pi-agent.ts`). The edit and write tools run sequentially and record the file before and
   after each call with its tool-call id and arguments.
   Verify: `cd frontend && node --experimental-strip-types --test tests/pi-agent.test.ts`
3. **Scoring** (`edit-confidence.ts`). Replay the recorded edits over the base files to give every character of the
   final file the token that wrote it (none for text from other tools). Score only lines the run added or changed.
   Per graph node (every symbol around the line, so a class covers its methods, plus its file; `(module)` only for
   top-level code): token count, minimum negentropy, minimum probability,
   the weakest token with alternatives, and `1 - (1 - F)^n`, where F is the share of the run's scored tokens at or
   below the node's minimum and n its token count.
   Verify: `cd frontend && node --experimental-strip-types --test tests/edit-confidence.test.ts`
4. **Run wiring** (`agent-runtime.ts`, `agent-runs.ts`). The agent's base URL carries the run id; after the run the
   app fetches and deletes the tokens and stores `result.confidence`. Fetch failures leave confidence unavailable
   with a reason.
   Verify: `cd frontend && node --experimental-strip-types --test tests/agent-runs.test.ts tests/edit-confidence.test.ts`
5. **Display** (graph cards). Scored heads and rows get a violet tint whose strength grows as confidence falls;
   every scored edit, class and file gets a progress ring (files and classes show the lowest score of their edits).
   Below 70% an edit gets a "Low confidence" comment bubble with a branching icon beside the card, like review flags
   (one per least-sure token, on the most specific row); the ring opens it. The layout reserves closed bubble sizes,
   so opening any bubble (flags too) overlays its neighbours instead of moving cards. Other rings open a hover comment. Both
   show the confidence, Min. token
   negentropy, min. token probability, token count, length-adjusted score, the weakest token and its alternatives.
   Nodes with a length-adjusted score below 0.1 are marked unusual for their size.
   Verify: `cd frontend && npm run check && npm run build`

## Live verification (2026-11-15)

- The capture route replayed a streamed edit call (4 chunks, usage, `[DONE]`); the stored tokens reproduced the
  `newText` argument exactly with negentropy at all 45 positions; delete, invalid ids and the old `/v1` route behaved.
- A real pi run (39 s, two edits, one flag) scored 3 nodes from 165 tokens: `mostExpensive` 61% (weakest `prev`,
  alternatives `max` 23%, `expensive` 8%), `total` 68% (weakest `?:` for an optional parameter, ` =` 41% as the
  default-value alternative); the untouched `count` was not scored and no tokens remained on Modal.
- During the rollover (about 3 minutes) an old container still answered some requests, so a new route returned 404 once.

## Limits

- Text written by `bash` or other tools has no score. Edits pi had to match loosely, which no longer reproduce the
  recorded file exactly, are left unscored.
- Negentropy needs exactly 15 alternatives per position (uqlm's rule); positions with fewer fall back to probability.
- The length adjustment treats tokens as independent draws from the run's own tokens, which overstates n for
  correlated code; it ranks nodes within a run and is not calibrated across runs.
