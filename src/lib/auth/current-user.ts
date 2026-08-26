// 06-ARCHITECTURE-NETLIFY-NEON.md §"Auth and authorization":
//   1. SSO resolves a verified email.
//   2. Look the email up in `users`. No row and not in ADMIN_EMAILS ⇒ deny.
//   3. Load `role` and both department grant sets into the session.
//   4. Every data route re-derives scope server-side — never trust the client.

import { db } from '@/lib/db';
import type { AppUser, Tower } from './types';

function bootstrapAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolves the app's `users` row for a verified SSO email. If no row exists
 * but the email is a configured bootstrap admin, provisions one so the very
 * first admin can log in before the roster exists. Returns null for anyone
 * else — the caller (requireScope) turns that into a 401 / request-access.
 */
export async function loadOrBootstrapUser(email: string, displayName?: string): Promise<AppUser | null> {
  const normalized = email.trim().toLowerCase();
  const sql = db();

  const rows = (await sql`
    select id, email, name, role, active from users where lower(email) = ${normalized} limit 1
  `) as AppUser[];

  if (rows.length > 0) {
    const user = rows[0]!;
    return user.active ? user : null;
  }

  if (!bootstrapAdminEmails().includes(normalized)) return null;

  const inserted = (await sql`
    insert into users (email, name, role, active)
    values (${normalized}, ${displayName || normalized}, 'admin', true)
    on conflict (email) do update set active = true
    returning id, email, name, role, active
  `) as AppUser[];

  return inserted[0] ?? null;
}

/**
 * Per-tower department grants. Admins implicitly hold every active
 * department in both towers (05-API.md: "Admins get every department id in
 * both lists") — they never need an explicit dept_access row.
 */
export async function getDeptGrants(user: AppUser, tower: Tower): Promise<string[]> {
  const sql = db();

  if (user.role === 'admin') {
    const rows = (await sql`select id from departments where active = true`) as { id: string }[];
    return rows.map((r) => r.id);
  }

  const rows = (await sql`
    select department_id from dept_access where user_id = ${user.id} and tower = ${tower}
  `) as { department_id: string }[];

  return rows.map((r) => r.department_id);
}
