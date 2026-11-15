import { database } from '#lib/auth.js';
import { assessmentRuntime } from '#lib/server/assessment-runtime.ts';
import { verificationContext } from '#lib/server/assessment.ts';
import { configuredChecks } from '#lib/server/verification.ts';
import { TRUSTED_CHECKS_JSON } from '$app/env/private';
import { createGenerationLimit } from '#lib/server/generation-limit.ts';
import { createPublication } from '#lib/server/publication.ts';
import { IntakeError, readJson } from '#lib/server/intake.ts';
import { withIntake } from '#lib/server/intake-http.ts';
const limit = createGenerationLimit();
export async function POST({ request, locals, params }) {
 return withIntake(request,locals.user?.id,async signal => {
  if ([params.id,params.candidateId,params.packetId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404,'Packet is unavailable.');
  if ([...new URL(request.url).searchParams].length) throw new IntakeError(400,'Publication overrides are unavailable.');
  const body=await readJson(request,1024,signal);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new IntakeError(400,'Request publication with an empty JSON object.');
  const owner=locals.user!.id;
  return limit.run(owner,async()=>{const runtime=await assessmentRuntime(request.headers,owner,signal);
    return {publication:await createPublication({...runtime,database,acceptance:async(user,item,candidate,active)=>{
      const assessment=await runtime.service.load(user,item,candidate,active);
      return {assessment,manifest:runtime.requiredManifest(assessment),checks:configuredChecks(TRUSTED_CHECKS_JSON,verificationContext(assessment))};
    }}).publish(owner,params.id,params.candidateId,params.packetId,signal)};});
 },300000);
}
