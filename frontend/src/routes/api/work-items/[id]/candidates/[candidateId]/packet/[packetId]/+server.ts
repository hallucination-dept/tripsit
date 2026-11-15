import { database } from '#lib/auth.js';
import { assessmentRuntime } from '#lib/server/assessment-runtime.ts';
import { IntakeError } from '#lib/server/intake.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { createRevisionPacket } from '#lib/server/revision-packet.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if ([params.id, params.candidateId, params.packetId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Packet is unavailable.');
    if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Packet overrides are unavailable.');
    const owner = locals.user!.id;
    const runtime = await assessmentRuntime(request.headers, owner, signal);
    return createRevisionPacket({ database, assessment: runtime.service, github: runtime.github, intake: runtime.intake, generation: runtime.generation }).get(owner, params.id, params.candidateId, params.packetId, signal);
  }, 90_000);
}
