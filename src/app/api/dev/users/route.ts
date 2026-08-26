import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devAuthEnabled } from '@/lib/auth/session';

/** Convenience roster listing for picking who to "sign in as" while there's no admin UI yet. */
export async function GET() {
  if (!devAuthEnabled()) {
    return NextResponse.json({ error: 'Dev auth is disabled.' }, { status: 404 });
  }
  const sql = db();
  const users = await sql`select email, name, role from users where active = true order by name`;
  return NextResponse.json({ users });
}
