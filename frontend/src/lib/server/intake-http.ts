import { IntakeError } from './intake.ts';

export async function withIntake(request: Request, owner: string | undefined, action: (signal: AbortSignal) => Promise<unknown>): Promise<Response> {
  try {
    if (!owner) throw new IntakeError(401, 'Sign in before selecting a GitHub issue.');
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== new URL(request.url).origin) throw new IntakeError(403, 'Submit issue selections from TripSit.');
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new IntakeError(415, 'Submit JSON content.');
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const data = await action(signal);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const failure = cause instanceof IntakeError ? cause : new IntakeError(503, 'Issue intake is temporarily unavailable.');
    return Response.json({ message: failure.message }, { status: failure.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
