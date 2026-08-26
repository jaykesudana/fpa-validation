import { NextResponse } from 'next/server';
import { AuthError } from './scope';

/** Every route: `catch (err) { return toErrorResponse(err); }` */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  throw err;
}
