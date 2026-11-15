import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import {
  AuthStorage, createAgentSession, createBashToolDefinition, createEditToolDefinition, createLocalBashOperations,
  createReadToolDefinition, createWriteToolDefinition, DefaultResourceLoader, ModelRegistry, SessionManager, SettingsManager,
  type ToolDefinition
} from '@mariozechner/pi-coding-agent';
import { RunFailure } from './agent-runs.ts';
import { isolatedEnvironment } from './repository-workspace.ts';

export type AgentModel = { baseUrl: string; apiKey: string; model: string; contextWindow: number; maxTokens: number };
export type AgentEvent = { kind: 'assistant' | 'tool' | 'status' | 'error'; text: string };
export type AgentOutcome = { summary: string };

const PROVIDER = 'tripsit-model';
const DEFAULT_COMMAND_SECONDS = 120, MAX_COMMAND_SECONDS = 600;

const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}…` : value;

function describeCall(tool: string, args: Record<string, unknown> | undefined) {
  const value = args?.command ?? args?.path ?? args?.file_path;
  return typeof value === 'string' ? `${tool}: ${clip(value.replace(/\s+/g, ' ').trim(), 300)}` : tool;
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

function workspaceTools(root: string, home: string): ToolDefinition[] {
  const inside = workspaceGuard(root);
  const local = createLocalBashOperations();
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
    createEditToolDefinition(root, { operations: {
      readFile: async path => readFile(await inside(path)),
      writeFile: async (path, content) => writeFile(await inside(path), content),
      access: async path => access(await inside(path), constants.R_OK | constants.W_OK)
    } }),
    createWriteToolDefinition(root, { operations: {
      writeFile: async (path, content) => writeFile(await inside(path), content),
      mkdir: async path => { await mkdir(await inside(path), { recursive: true }); }
    } })
  ] as unknown as ToolDefinition[];
}

const guidance = (repository: string) => [
  `You are working in a fresh checkout of the GitHub repository ${repository}.`,
  'Implement the requested change by editing files in this repository. Keep the change focused and consistent with the existing code.',
  'Do not commit, push, or create branches. Prefer reading code over guessing.',
  'When you are done, reply with a short summary of what you changed and any assumptions you made.'
].join('\n');

export async function runPiAgent(options: {
  workspace: string; agentDir: string; home: string; repository: string; instruction: string;
  model: AgentModel; signal: AbortSignal; onEvent: (event: AgentEvent) => void;
}): Promise<AgentOutcome> {
  const root = await realpath(options.workspace);
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
    sessionManager: SessionManager.inMemory(), noTools: 'builtin', customTools: workspaceTools(root, options.home)
  });
  let summary = '';
  let failure = '';
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'tool_execution_start') options.onEvent({ kind: 'tool', text: describeCall(event.toolName, event.args) });
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
    return { summary };
  } finally {
    options.signal.removeEventListener('abort', abort);
    unsubscribe();
    session.dispose();
  }
}
