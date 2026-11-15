import { database } from '#lib/auth.js';
import { candidateServices } from '#lib/server/generation-runtime.ts';
import { createOutcomeFeedback } from '#lib/server/outcome-feedback.ts';
import { readJson } from '#lib/server/intake.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { createGenerationLimit } from '#lib/server/generation-limit.ts';
const limit=createGenerationLimit();
export async function GET({request,locals,params}) {
 return withIntake(request,locals.user?.id,async signal=>{
  const owner=locals.user!.id, services=await candidateServices(request.headers,owner,signal);
  return createOutcomeFeedback({...services,database}).list(owner,params.id,params.candidateId,signal);
 },90000);
}
export async function POST({request,locals,params}) {
 return withIntake(request,locals.user?.id,async signal=>{
  const owner=locals.user!.id, body=await readJson(request,4096,signal);
  return limit.run(owner,async()=>{const services=await candidateServices(request.headers,owner,signal);return createOutcomeFeedback({...services,database}).record(owner,params.id,params.candidateId,body,signal);});
 },90000);
}
