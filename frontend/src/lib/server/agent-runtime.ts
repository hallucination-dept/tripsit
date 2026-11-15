import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL, MODAL_API_URL, MODAL_PROXY_TOKEN, MODEL_ID } from '$app/env/private';
import { database } from '#lib/auth.js';
import { createAgentRunRecords } from './agent-run-records.ts';
import { createAgentRuns, RunFailure, type RunExecutor, type RunFinisher } from './agent-runs.ts';
import { buildChangeGraph } from './change-graph.ts';
import { CaptureError, collectEditTokens, editTokensAvailable, forgetEditTokens, scoreEdits } from './edit-confidence.ts';
import type { RunConfidence } from '../edit-confidence.ts';
import type { PullRequest } from './github.ts';
import { attachFlags, flagsMarkdown, type FlagInput } from './flags.ts';
import { graphComment, graphImageKey, publicOrigin, validGraphImageKey } from './graph-comment.ts';
import { IntakeError } from './intake.ts';
import { runPiAgent } from './pi-agent.ts';
import { collectChanges, commitBase, extractArchive, publishableFiles, readWorkspaceText } from './repository-workspace.ts';

export const agentConfigured = () => Boolean(MODAL_API_URL && MODAL_PROXY_TOKEN);

const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}…` : value;

export function pullRequestText(runId: string, instruction: string, summary: string, sha: string, flags: FlagInput[] = []) {
  const title = clip(instruction.split('\n').find(line => line.trim())?.trim() ?? 'Agent change', 120);
  const review = flagsMarkdown(flags);
  const body = [
    instruction, '', '---', '', '**Agent summary**', '', clip(summary || 'The agent did not leave a summary.', 20_000), '',
    ...(review ? ['---', '', review, ''] : []), '---',
    `Opened by TripSit from agent run \`${runId}\` (pi with Gemma 4) on \`${sha.slice(0, 7)}\`. ` +
    'The change has not been reviewed yet: check its change graph and diff before merging.'
  ].join('\n');
  return { title, body, message: `${title}\n\nOpened by TripSit agent run ${runId}.` };
}

const executeRun: RunExecutor = async ({ id, archive, instruction, signal, emit, stage }) => {
  if (!agentConfigured()) throw new RunFailure('The agent model is not configured.');
  const root = await mkdtemp(join(tmpdir(), 'tripsit-run-'));
  // Requests under /runs/<id> let the model service keep the tokens behind each edit (edit confidence).
  const modal = MODAL_API_URL!.replace(/\/$/, ''), runBase = `${modal}/runs/${id}`;
  let capturing = false, collected = false;
  try {
    const workspace = join(root, 'repo'), home = join(root, 'home'), agentDir = join(root, 'agent');
    await Promise.all([mkdir(workspace), mkdir(home), mkdir(agentDir)]);
    emit('status', 'Downloading the repository');
    const { entries } = await extractArchive(await archive.download(signal), workspace, signal);
    const base = await commitBase(workspace, home);
    capturing = await editTokensAvailable(runBase, MODAL_PROXY_TOKEN!, signal);
    emit('status', `Repository ready (${entries} entries); starting the agent`);
    stage('running');
    const outcome = await runPiAgent({
      workspace, agentDir, home, repository: archive.repository, instruction, signal,
      onEvent: event => emit(event.kind, event.text),
      model: { baseUrl: capturing ? `${runBase}/v1` : `${modal}/v1`, apiKey: MODAL_PROXY_TOKEN!,
        model: MODEL_ID || 'google/gemma-4-31B-it', contextWindow: 65_536, maxTokens: 8_192 }
    });
    stage('analyzing');
    emit('status', 'Building the change graph');
    const { changes, files, truncated } = await collectChanges(workspace, home, base);
    const graph = await buildChangeGraph({ files, changes, read: path => readWorkspaceText(workspace, path) });
    const flags = attachFlags(outcome.flags, graph);
    if (flags.length) emit('status', `The agent flagged ${flags.length} spot${flags.length === 1 ? '' : 's'} for review`);
    let confidence: RunConfidence = { status: 'unavailable',
      reason: capturing ? 'The agent did not change any files.' : 'The model service does not keep edit tokens yet.' };
    if (capturing) {
      try {
        const calls = await collectEditTokens(runBase, MODAL_PROXY_TOKEN!, signal);
        collected = true;
        if (changes.length) confidence = scoreEdits({ edits: outcome.edits, calls, graph,
          files: changes.map(({ path, before, after }) => ({ path, before, after })) });
      } catch (cause) {
        confidence = { status: 'unavailable', reason: cause instanceof CaptureError ? cause.message : 'The edit tokens could not be scored.' };
      }
    }
    emit('status', confidence.status === 'scored'
      ? `Scored edit confidence for ${confidence.nodes.length} graph node${confidence.nodes.length === 1 ? '' : 's'}`
      : `No edit confidence: ${confidence.reason}`);

    let pullRequest: PullRequest | null = null, publishNote: string | null = null;
    if (!changes.length) publishNote = 'No pull request: the agent did not change any files.';
    else if (!archive.publish.available) publishNote = `No pull request: ${archive.publish.reason}.`;
    else {
      stage('publishing');
      emit('status', 'Opening a pull request');
      try {
        const text = pullRequestText(id, instruction, outcome.summary, archive.sha, flags);
        pullRequest = await archive.publish.create({ ...text, branch: `tripsit/${id.slice(0, 8)}`,
          files: await publishableFiles(workspace, home, changes) }, signal);
        emit('status', `Opened pull request #${pullRequest.number}: ${pullRequest.url}`);
      } catch (cause) {
        publishNote = `The pull request could not be opened: ${cause instanceof IntakeError ? cause.message : 'GitHub rejected it.'}`;
      }
    }
    if (publishNote) emit(changes.length && archive.publish.available ? 'error' : 'status', publishNote);
    return { summary: outcome.summary, graph, flags, confidence, truncated, pullRequest, publishNote,
      files: changes.map(({ path, change, binary, diff }) => ({ path, change, binary, diff })) };
  } finally {
    if (capturing && !collected) forgetEditTokens(runBase, MODAL_PROXY_TOKEN!);
    await rm(root, { recursive: true, force: true });
  }
};

// After the run is saved (so GitHub can fetch the image at once), comment the change graph on its pull request.
const commentGraph: RunFinisher = async ({ id, archive, result }) => {
  if (!result.pullRequest || !archive.publish.available) return null;
  const origin = publicOrigin(BETTER_AUTH_URL);
  if (!origin || !BETTER_AUTH_SECRET) return 'No graph comment on the pull request: the app has no public HTTPS address (BETTER_AUTH_URL).';
  try {
    await archive.publish.comment(result.pullRequest.number, graphComment(origin, id, graphImageKey(BETTER_AUTH_SECRET, id)), AbortSignal.timeout(20_000));
    return `Added the change graph to pull request #${result.pullRequest.number}`;
  } catch (cause) {
    return `The change graph could not be added to the pull request: ${cause instanceof IntakeError ? cause.message : 'GitHub rejected the comment.'}`;
  }
};

export const agentRuns = createAgentRuns({ execute: executeRun, store: createAgentRunRecords(database), finish: commentGraph });
export const graphImageAllowed = (id: string, key: string | null) => validGraphImageKey(BETTER_AUTH_SECRET ?? '', id, key);
