# Agent review flags — plan

Status: first slice of the flagging work (2026-11-15). The agent flags its own edits through a tool; flags are shown on
the change graph, in the pull request and in the graph picture. No fine-tuning, sampling-based or token-level signals
yet: those are the next slices (see "Later").

## Decision

Flags are structured tool calls made while the agent edits, not prose in its summary. A prompted baseline comes
first because it is cheap, produces the data a later fine-tune needs, and is the baseline that fine-tune must beat.

## Flag

`flag({ path, symbol?, kind, confidence, reason, alternatives? })`

- `kind`: `assumption` (filled a gap in the ticket or code), `judgement_call` (chose between reasonable options),
  `high_impact` (security, data loss, public API, concurrency, money, migrations).
- `confidence`: `low | medium | high`, the agent's confidence that its choice is what the requester wants. Verbal
  levels, because models are poorly calibrated on numbers.
- Bounded: at most 25 flags per run, reason ≤ 600 and alternatives ≤ 400 characters; paths must be relative and stay
  inside the repository. The prompt asks for few flags (usually 0–5) and only for things a careful reviewer would want
  pointed out.

## Flow

1. `pi-agent.ts` registers the `flag` tool next to read/bash/edit/write and appends flagging guidance to the system
   prompt. When the agent edited anything, it gets one more turn asking it to review its change and flag what needs
   a look (added after a live run in which Gemma described its judgement calls in prose but never flagged them).
   Recorded flags are returned with the original summary.
2. After the change graph is built, each flag is attached to a node: the symbol (`name` or `Class.method`) in that
   file, else the file node, else none (still listed).
3. Flags are stored in the run result, listed in the pull request body, drawn on the interactive graph and on the PR
   graph picture.

## Display

- Attention level per flag: low confidence → high attention, medium → medium, high → low; `high_impact` raises it
  one level. Attention is the graph's colour coding: flagged rows and cards get a tint and left accent in one
  violet hue whose strength is the attention level, distinct from the green/orange/red change badges.
- Each flag is a comment bubble beside its card. A right-triangle notch at the bubble's top-left corner (its right
  angle at the top, continuing the top edge) points at the row the flag is about; flags on the file, or on rows that
  are not shown, point at the card header. Bubbles hang from their row and may overlap; the hovered or open one comes
  to the front. A bubble shows the kind's icon (assumption: question bubble, judgement call: scales, high impact:
  warning triangle), the kind label and the first two lines of the reason, with `code` styled. Clicking opens it in
  place with the confidence, the full reason and the alternatives.
- Below zoom 0.8 (`bubbleGeometry.iconBelowZoom`), closed bubbles shrink to the kind's icon and an expand chevron;
  clicking one opens it in full, and zooming back in shows the two-line previews again. Open bubbles stay open at
  any zoom.
- Bubbles keep their on-screen size when the graph zooms (scaled by 1/zoom around the point they point at); cards with
  bubbles are drawn above the others. The layout still reserves the bubble column at zoom 1, and edges of a card with
  bubbles attach on its left side. The PR picture draws the same bubbles.
- Cards show a flag count; the details panel lists a node's flags, and with nothing selected lists all flags as
  links to their nodes.

## Later

- Sampling disagreement per changed node (the UQLM functional-equivalence prototype) and token-level signals at the
  same symbols, combined with self-reported flags.
- Hand-labelled eval set (~100 runs) for flag precision/recall; then a LoRA fine-tune on Gemma's own trajectories
  with labelled flags if the prompted baseline is noisy.

## Verification

- `cd frontend && node --experimental-strip-types --test tests/agent-flags.test.ts tests/pi-agent.test.ts tests/graph-comment.test.ts`
- `cd frontend && npm run check && npm run build`
- Browser: flagged rows and the details list on a fixture graph.

## Verification results (2026-11-15)

- `npm run check`: 0 errors; `npm run build`: succeeded. Offline frontend tests: 296 of 297 pass. The failure is
  `tests/github-auth.test.ts`, which also fails without these changes (logged in `specs/bugs/github-auth-test-pool-mock.md`).
- New tests: flag validation, attention levels, attachment to symbols/methods/files, per-card index, PR markdown
  (`agent-flags.test.ts`); the scripted pi model calling `flag`, invalid flags reported back, the review turn only after
  edits and keeping the summary (`pi-agent.test.ts`); flag tints and counts in the SVG (`graph-comment.test.ts`).
- Live runs on `sindresorhus/ky` ("Make retries back off longer when the server is rate limiting us"), Gemma 4 on Modal:
  run 1 (prompt guidance only) made the change and named its choices in the summary but flagged nothing; run 2 (with
  the review turn) flagged the 2× multiplier for 429 responses as a high-confidence judgement call, attached to
  `Ky.#calculateRetryDelay`. It did not flag treating only 429 as rate limiting, and rated an arbitrary multiplier as high
  confidence: early evidence that calibration, not format, is the weak spot.
- Browser: flagged rows and cards tinted by attention, flag counts on cards, the details list selecting nodes, and the
  PR picture in light and dark (temporary fixture page, removed).
