import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  AuthStorage, createAgentSession, createBashToolDefinition, createEditToolDefinition, createLocalBashOperations,
  createReadToolDefinition, createWriteToolDefinition, DefaultResourceLoader, defineTool, ModelRegistry, SessionManager, SettingsManager,
  type ToolDefinition
} from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import { RunFailure } from './agent-runs.ts';
import { flagConfidences, FlagInputError, flagKinds, maxFlags, parseFlag, type FlagInput } from './flags.ts';
import { isolatedEnvironment } from './repository-workspace.ts';

export type AgentModel = { baseUrl: string; apiKey: string; model: string; contextWindow: number; maxTokens: number };
export type AgentEvent = { kind: 'assistant' | 'tool' | 'status' | 'error'; text: string };
// A file write by the edit or write tool: the file before and after it and the text the model wrote, which the run
// scores for edit confidence (see edit-confidence.ts). Paths are repository-relative with forward slashes.
export type FileEdit = {
  toolCallId: string; tool: 'edit' | 'write'; path: string; before: string | null; after: string;
  // Each replacement of an edit call, or the content of a write (oldText null).
  parts: { oldText: string | null; newText: string }[];
};
export type AgentOutcome = { summary: string; flags: FlagInput[]; edits: FileEdit[] };

const PROVIDER = 'tripsit-model';
const DEFAULT_COMMAND_SECONDS = 120, MAX_COMMAND_SECONDS = 600;

const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}…` : value;

function describeCall(tool: string, args: Record<string, unknown> | undefined) {
  const value = args?.command ?? args?.path ?? args?.file_path;
  return typeof value === 'string' ? `${tool}: ${clip(value.replace(/\s+/g, ' ').trim(), 300)}` : tool;
}

function describeFlag(args: Record<string, unknown> | undefined) {
  const where = [args?.path, args?.symbol].filter(value => typeof value === 'string').join(' › ');
  return clip(`flag (${String(args?.kind ?? '?')}, ${String(args?.confidence ?? '?')} confidence): ${where} — ${String(args?.reason ?? '')}`, 600);
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text).join('\n').trim();
}

// File tools refuse paths that resolve outside the workspace. With bash enabled this is a guard
// against mistakes, not a security boundary.
function workspaceGuard(root: string) {
  return async (target: string) => {
    const absolute = resolve(target);
    let probe = absolute;
    for (;;) {
      try {
        const actual = resolve(await realpath(probe), relative(probe, absolute));
        if (actual !== root && !actual.startsWith(root + sep)) throw new RunFailure(`Path is outside the repository: ${target}`);
        return absolute;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(probe) === probe) throw cause;
        probe = dirname(probe);
      }
    }
  };
}

// Files larger than this are written without being recorded for edit confidence.
const MAX_RECORDED_CHARS = 1_000_000;

// The edit and write tools run one at a time (no other tool runs alongside them), so each file write belongs to the
// call that is running. Writes are recorded with that call's id and replacements.
function editRecorder(root: string, edits: FileEdit[]) {
  let active: Pick<FileEdit, 'toolCallId' | 'tool' | 'parts'> | null = null;
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  const partsOf = (tool: FileEdit['tool'], params: Record<string, unknown>): FileEdit['parts'] => tool === 'write'
    ? [{ oldText: null, newText: text(params.content) ?? '' }]
    : (Array.isArray(params.edits) ? params.edits : []).map(edit => ({ oldText: text(edit?.oldText) ?? '', newText: text(edit?.newText) ?? '' }));
  return {
    // Wraps a tool definition so its file writes are attributed to the running call.
    track(definition: ToolDefinition, tool: FileEdit['tool']): ToolDefinition {
      return { ...definition, executionMode: 'sequential', async execute(toolCallId, params, ...rest) {
        active = { toolCallId, tool, parts: partsOf(tool, params as Record<string, unknown>) };
        try { return await definition.execute(toolCallId, params, ...rest); }
        finally { active = null; }
      } };
    },
    async write(absolute: string, content: string) {
      const before = active ? await readFile(absolute, 'utf8').catch(() => null) : null;
      await writeFile(absolute, content);
      const path = relative(root, absolute);
      if (!active || path.startsWith('..') || isAbsolute(path) || content.length > MAX_RECORDED_CHARS || (before?.length ?? 0) > MAX_RECORDED_CHARS) return;
      edits.push({ ...active, path: path.split(sep).join('/'), before, after: content });
    }
  };
}

function workspaceTools(root: string, home: string, edits: FileEdit[]): ToolDefinition[] {
  const inside = workspaceGuard(root);
  const local = createLocalBashOperations();
  const recorder = editRecorder(root, edits);
  // Each definition is typed by its own schema; pi accepts them as a heterogeneous list.
  return [
    createReadToolDefinition(root, { operations: {
      readFile: async path => readFile(await inside(path)),
      access: async path => access(await inside(path), constants.R_OK)
    } }),
    createBashToolDefinition(root, {
      spawnHook: ({ command, cwd }) => ({ command, cwd, env: isolatedEnvironment(home) }),
      operations: { exec: (command, cwd, options) => local.exec(command, cwd, { ...options,
        timeout: Math.min(options.timeout && options.timeout > 0 ? options.timeout : DEFAULT_COMMAND_SECONDS, MAX_COMMAND_SECONDS) }) }
    }),
    recorder.track(createEditToolDefinition(root, { operations: {
      readFile: async path => readFile(await inside(path)),
      writeFile: async (path, content) => recorder.write(await inside(path), content),
      access: async path => access(await inside(path), constants.R_OK | constants.W_OK)
    } }) as unknown as ToolDefinition, 'edit'),
    recorder.track(createWriteToolDefinition(root, { operations: {
      writeFile: async (path, content) => recorder.write(await inside(path), content),
      mkdir: async path => { await mkdir(await inside(path), { recursive: true }); }
    } }) as unknown as ToolDefinition, 'write')
  ] as unknown as ToolDefinition[];
}

// Records review flags; the run attaches them to the change graph afterwards.
export function flagTool(flags: FlagInput[]) {
  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined });
  return defineTool({
    name: 'flag', label: 'Flag for review',
    description: 'Mark a spot in your change that the human reviewer should look at closely: an assumption you made because the ' +
      'request or code was unclear, a judgement call between reasonable alternatives, or a high-impact edit (security, data loss, ' +
      'public API, concurrency, payments, migrations). Call it right after the edit it concerns. Flag sparingly.',
    promptSnippet: 'flag: mark an assumption, judgement call or high-impact edit for the reviewer',
    parameters: Type.Object({
      path: Type.String({ description: 'Repository-relative path of the file the flag is about' }),
      symbol: Type.Optional(Type.String({ description: 'Function, class or method (Class.method) the flag is about; omit for the whole file' })),
      kind: Type.Union(flagKinds.map(kind => Type.Literal(kind)), { description: 'assumption, judgement_call or high_impact' }),
      confidence: Type.Union(flagConfidences.map(level => Type.Literal(level)), { description: 'How confident you are that your choice is what the requester wants' }),
      reason: Type.String({ description: 'One or two sentences: what you assumed or decided, and why it needs a look' }),
      alternatives: Type.Optional(Type.String({ description: 'The other reasonable options, if any' }))
    }),
    // Models sometimes send null for optional fields; drop them before validation.
    prepareArguments: (args: unknown) => Object.fromEntries(Object.entries(args && typeof args === 'object' ? args : {})
      .filter(([, value]) => value !== null)) as never,
    async execute(_id, params) {
      if (flags.length >= maxFlags) return text(`Flag limit (${maxFlags}) reached. Only the most important spots should be flagged.`);
      try { flags.push(parseFlag(params)); }
      catch (cause) { if (cause instanceof FlagInputError) throw new Error(`Flag not recorded: ${cause.message}`); throw cause; }
      return text(`Flag recorded (${flags.length}).`);
    }
  });
}

// Models tend to describe their assumptions in prose instead of flagging them while they work, so a run that
// edited files ends with one more turn in which the agent reviews its change and flags what needs a look.
export const flagReviewPrompt = [
  'Before you finish, review your change as the human reviewer will see it.',
  'Call the flag tool once for each assumption, judgement call or high-impact edit you made, naming the function or method in symbol.',
  'Most changes have 0 to 5 flags. Do not edit files in this step. If nothing needs a closer look, reply "No flags."'
].join('\n');

const guidance = (repository: string) => [
  `You are working in a fresh checkout of the GitHub repository ${repository}.`,
  'Implement the requested change by editing files in this repository. Keep the change focused and consistent with the existing code.',
  'Do not commit, push, or create branches. Prefer reading code over guessing.',
  'When you are done, reply with a short summary of what you changed.',
  '',
  'Review flags: a human reviews your change. Use the flag tool to point them at the spots that need judgement:',
  '- assumption: the request or the code left something open and you filled the gap.',
  '- judgement_call: you chose between reasonable alternatives (behaviour, data shape, error handling, naming in public APIs).',
  '- high_impact: the edit can break security, data, public interfaces, concurrency, payments or migrations if it is wrong.',
  'Flag only what a careful reviewer would want pointed out; most changes need 0 to 5 flags. Do not flag routine edits.',
  'Name the function or method (Class.method) in symbol when the flag is about one.'
].join('\n');

export async function runPiAgent(options: {
  workspace: string; agentDir: string; home: string; repository: string; instruction: string;
  model: AgentModel; signal: AbortSignal; onEvent: (event: AgentEvent) => void;
}): Promise<AgentOutcome> {
  const root = await realpath(options.workspace);
  const flags: FlagInput[] = [];
  const edits: FileEdit[] = [];
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(PROVIDER, options.model.apiKey);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir: options.agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    // Ignore a repository-supplied .pi/SYSTEM.md; keep pi's built-in prompt plus our guidance.
    systemPromptOverride: () => undefined,
    appendSystemPrompt: [guidance(options.repository)]
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: root, agentDir: options.agentDir, thinkingLevel: 'off',
    model: {
      id: options.model.model, name: options.model.model, api: 'openai-completions', provider: PROVIDER,
      baseUrl: options.model.baseUrl, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: options.model.contextWindow, maxTokens: options.model.maxTokens,
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' }
    },
    authStorage, modelRegistry: ModelRegistry.inMemory(authStorage), resourceLoader, settingsManager,
    sessionManager: SessionManager.inMemory(), noTools: 'builtin',
    customTools: [...workspaceTools(root, options.home, edits), flagTool(flags) as unknown as ToolDefinition]
  });
  let summary = '';
  let failure = '';
  let edited = false;
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'tool_execution_end' && !event.isError && ['edit', 'write', 'bash'].includes(event.toolName)) edited = true;
    if (event.type === 'tool_execution_start') options.onEvent({ kind: 'tool', text: event.toolName === 'flag' ? describeFlag(event.args) : describeCall(event.toolName, event.args) });
    else if (event.type === 'tool_execution_end' && event.isError) {
      options.onEvent({ kind: 'error', text: clip(`${event.toolName} failed: ${textOf(event.result?.content) || 'no output'}`, 600) });
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = textOf(event.message.content);
      if (text) { summary = text; options.onEvent({ kind: 'assistant', text: clip(text, 4000) }); }
      if (event.message.stopReason === 'error') failure = event.message.errorMessage || 'The model request failed.';
    } else if (event.type === 'auto_retry_start') options.onEvent({ kind: 'status', text: 'Retrying the model request' });
    else if (event.type === 'compaction_start') options.onEvent({ kind: 'status', text: 'Compacting the conversation to fit the context window' });
  });
  const abort = () => { void session.abort(); };
  options.signal.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal.aborted) throw new RunFailure('The agent run was cancelled or timed out.');
    await session.prompt(options.instruction);
    if (options.signal.aborted) throw new RunFailure('The agent run was cancelled or timed out.');
    if (failure) throw new RunFailure(clip(`The agent stopped: ${failure}`, 600));
    const finalSummary = summary;
    if (edited) {
      options.onEvent({ kind: 'status', text: 'Asking the agent to flag its change for review' });
      await session.prompt(flagReviewPrompt);
      if (options.signal.aborted) throw new RunFailure('The agent run was cancelled or timed out.');
      // The review turn only adds flags; a failure there keeps the change and its summary.
      if (failure) options.onEvent({ kind: 'error', text: clip(`The flag review stopped: ${failure}`, 600) });
    }
    return { summary: finalSummary, flags, edits };
  } finally {
    options.signal.removeEventListener('abort', abort);
    unsubscribe();
    session.dispose();
  }
}
