import { IntakeError, readJson, whileActive } from './intake.ts';
import type { GenerationPrompt, ModelGeneration } from './generation.ts';

type Configuration = { url?: string; token?: string; model?: string; fetcher?: typeof fetch };
const settings = { temperature: 0, max_tokens: 2048, logprobs: true, top_logprobs: 0 };

export function createModelGeneration(configuration: Configuration) {
  return {
    async generate(prompt: GenerationPrompt, signal: AbortSignal): Promise<ModelGeneration> {
      let endpoint: URL;
      const { token, model } = configuration;
      try {
        endpoint = new URL(configuration.url ?? '');
        const fixture = configuration.fetcher && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
        if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && fixture))
          || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token || !model?.trim()) throw new Error();
        endpoint.pathname = endpoint.pathname.replace(/\/$/u, '') + '/v1/chat/completions';
      } catch { throw new IntakeError(503, 'Candidate model is not configured.'); }
      const active = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
      try {
        return await whileActive(async () => {
          const response = await whileActive(() => (configuration.fetcher ?? fetch)(endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: prompt.instruction }, { role: 'user', content: prompt.data }], ...settings }),
            signal: active
          }), active);
          if (!response.ok) { await response.body?.cancel(); throw new Error(); }
          const value = await readJson(response, 2_097_152, active);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          const body = value as Record<string, unknown>;
          if (body.model !== model || !Array.isArray(body.choices) || body.choices.length !== 1) throw new Error();
          const choice = body.choices[0];
          if (!choice || typeof choice !== 'object' || choice.finish_reason !== 'stop') throw new Error();
          const content: unknown = choice.message?.content;
          if (typeof content !== 'string') throw new Error();
          const rawOutput = new TextEncoder().encode(content);
          if (rawOutput.byteLength > 1_048_576 || new TextDecoder('utf-8', { ignoreBOM: true }).decode(rawOutput) !== content) throw new Error();
          return { rawOutput, model: model!, settings: { ...settings } };
        }, active);
      } catch { throw new IntakeError(502, 'Candidate model is unavailable or returned invalid output.'); }
    }
  };
}
