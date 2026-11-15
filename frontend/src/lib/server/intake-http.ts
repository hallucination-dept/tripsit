import { IntakeError, whileActive } from './intake.ts';

// Name, code and message only: upstream error objects can carry query values or response bodies.
function describeFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return typeof cause;
  const code = (cause as { code?: unknown }).code;
  return `${cause.name}${typeof code === 'string' ? ` [${code}]` : ''}: ${cause.message}`;
}

export async function withIntake(request: Request, owner: string | undefined, action: (signal: AbortSignal) => Promise<unknown>, timeoutMs = 30_000): Promise<Response> {
  try {
    if (!owner) throw new IntakeError(401, 'Sign in before selecting a GitHub issue.');
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== new URL(request.url).origin) throw new IntakeError(403, 'Submit issue selections from TripSit.');
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new IntakeError(415, 'Submit JSON content.');
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    const data = await whileActive(() => action(signal), signal);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (!(cause instanceof IntakeError)) console.error(`Intake ${request.method} ${new URL(request.url).pathname} failed: ${describeFailure(cause)}`);
    const failure = cause instanceof IntakeError ? cause : new IntakeError(503, 'Issue intake is temporarily unavailable.');
    return Response.json({ message: failure.message }, { status: failure.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
