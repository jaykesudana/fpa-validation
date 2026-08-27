import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devAuthEnabled } from '@/lib/auth/session';

// This is the one GET route that deliberately skips requireScope() (it must
// work before anyone's signed in, to power the sign-in picker itself) — so
// unlike every other route here, it never touches a Next.js "dynamic API"
// (cookies()/headers()) during execution. `dynamic = 'force-dynamic'` alone
// proved insufficient on Netlify's adapter: the route's own response
// correctly showed as never cached, but the underlying database read still
// came back stale after edits — consistent with the outbound fetch made by
// the DB driver getting Next's default fetch-caching treatment because
// nothing in this handler ever triggers dynamic-rendering detection.
// Fixed two ways, independent of which exact layer was responsible:
//   1. Call cookies() (unused) so Next unambiguously marks this dynamic.
//   2. Make the query itself non-identical per call, so nothing can key a
//      cache on "the same request body as last time."
export const dynamic = 'force-dynamic';

/** Convenience roster listing for picking who to "sign in as" while there's no admin UI yet. */
export async function GET() {
  cookies();
  if (!devAuthEnabled()) {
    return NextResponse.json({ error: 'Dev auth is disabled.' }, { status: 404 });
  }
  const sql = db();
  const cacheBuster = Date.now();
  const users = await sql`select email, name, role from users where active = true and ${cacheBuster}::bigint > 0 order by name`;
  return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store, must-revalidate' } });
}
