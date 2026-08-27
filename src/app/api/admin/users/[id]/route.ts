import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

// PUT /api/admin/users/:id — admin only. { role?: 'admin'|'fbp', active?: boolean }.
// Not in 05-API.md; the "manages the roster" admin responsibility
// (01-DOMAIN-AND-ROLES.md §1) had no screen for role/active changes before.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireScope({ role: 'admin' });
    const id = params.id;
    const body = (await req.json().catch(() => null)) as { role?: string; active?: boolean } | null;
    if (body?.role !== undefined && body.role !== 'admin' && body.role !== 'fbp') {
      return NextResponse.json({ error: "role must be 'admin' or 'fbp'" }, { status: 400 });
    }

    const sql = db();
    const rows = (await sql`select id, email, name, role, active from users where id = ${id}`) as {
      id: string;
      email: string;
      name: string;
      role: 'admin' | 'fbp';
      active: boolean;
    }[];
    const target = rows[0];
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const nextRole = body?.role ?? target.role;
    const nextActive = body?.active ?? target.active;
    const losingAdmin = target.role === 'admin' && (nextRole !== 'admin' || !nextActive);

    if (losingAdmin) {
      const otherAdmins = (await sql`
        select count(*)::int as n from users where role = 'admin' and active = true and id <> ${id}
      `) as { n: number }[];
      if ((otherAdmins[0]?.n ?? 0) === 0) {
        return NextResponse.json({ error: 'Cannot remove the last active admin.' }, { status: 400 });
      }
    }

    await sql`update users set role = ${nextRole}, active = ${nextActive} where id = ${id}`;
    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, action, from_state, to_state, payload)
      values (
        ${user.id}, ${user.name}, ${user.role}, 'admin', 'user', ${id}, 'user.update',
        ${target.role}, ${nextRole},
        ${JSON.stringify({ email: target.email, activeBefore: target.active, activeAfter: nextActive })}::jsonb
      )
    `;

    return NextResponse.json({ ok: true, role: nextRole, active: nextActive });
  } catch (err) {
    return toErrorResponse(err);
  }
}
