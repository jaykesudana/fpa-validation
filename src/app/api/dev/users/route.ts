import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devAuthEnabled } from '@/lib/auth/session';

// This handler takes no request param and reads no dynamic API (cookies(),
// headers()), so Next.js's App Router would otherwise treat it as static
// and cache the response — potentially baked in at build/deploy time and
// never re-run. Force it dynamic so role/active changes show up live.
export const dynamic = 'force-dynamic';

/** Convenience roster listing for picking who to "sign in as" while there's no admin UI yet. */
export async function GET() {
  if (!devAuthEnabled()) {
    return NextResponse.json({ error: 'Dev auth is disabled.' }, { status: 404 });
  }
  const sql = db();
  const users = await sql`select email, name, role from users where active = true order by name`;
  // Belt-and-suspenders alongside `dynamic = 'force-dynamic'` — explicitly
  // tell any CDN/edge cache in front of the function not to store this.
  return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store, must-revalidate' } });
}
