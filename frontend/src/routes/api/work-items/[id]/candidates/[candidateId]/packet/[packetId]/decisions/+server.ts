import { database } from '#lib/auth.js';
import { assessmentRuntime } from '#lib/server/assessment-runtime.ts';
import { createGenerationLimit } from '#lib/server/generation-limit.ts';
import { createHumanDecision } from '#lib/server/human-decision.ts';
import { IntakeError, readJson } from '#lib/server/intake.ts';
import { withIntake } from '#lib/server/intake-http.ts';

const limit = createGenerationLimit();
export async function POST({ request, locals, params }) {
 return withIntake(request, locals.user?.id, async signal => {
  if ([params.id,params.candidateId,params.packetId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Packet is unavailable.');
  if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Decision overrides are unavailable.');
  const body = await readJson(request, 16384, signal);
  const owner = locals.user!.id;
  return limit.run(owner, async () => {
   const runtime = await assessmentRuntime(request.headers, owner, signal);
   return { decision: await createHumanDecision({ database, intake: runtime.intake }).record(owner, params.id, params.candidateId, params.packetId, body, signal) };
  });
 }, 90_000);
}

export async function GET({ request, locals, params }) {
 return withIntake(request, locals.user?.id, async signal => {
  if ([params.id,params.candidateId,params.packetId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Packet is unavailable.');
  if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Decision overrides are unavailable.');
  const owner=locals.user!.id;
  const runtime=await assessmentRuntime(request.headers,owner,signal);
  return { decisions: await createHumanDecision({ database,intake:runtime.intake }).list(owner,params.id,params.candidateId,params.packetId,signal) };
 },90_000);
}
