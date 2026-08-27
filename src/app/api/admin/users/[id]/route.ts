import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PUT /api/admin/users/:id — admin only. { role?, active?, name?, email? }.
// Not in 05-API.md; the "manages the roster" admin responsibility
// (01-DOMAIN-AND-ROLES.md §1) had no screen for roster edits before. name/email
// are corrections (typos, an address that changed) — not part of the
// original role/active toggle, but the same admin-only edit surface.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireScope({ role: 'admin' });
    const id = params.id;
    const body = (await req.json().catch(() => null)) as { role?: string; active?: boolean; name?: string; email?: string } | null;
    if (body?.role !== undefined && body.role !== 'admin' && body.role !== 'fbp') {
      return NextResponse.json({ error: "role must be 'admin' or 'fbp'" }, { status: 400 });
    }
    const nextName = body?.name?.trim();
    if (body?.name !== undefined && !nextName) {
      return NextResponse.json({ error: 'name cannot be blank' }, { status: 400 });
    }
    const nextEmail = body?.email?.trim().toLowerCase();
    if (body?.email !== undefined && (!nextEmail || !EMAIL_RE.test(nextEmail))) {
      return NextResponse.json({ error: 'email must be a valid address' }, { status: 400 });
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

    if (nextEmail && nextEmail !== target.email.toLowerCase()) {
      const clash = (await sql`select id from users where lower(email) = ${nextEmail} and id <> ${id}`) as { id: string }[];
      if (clash.length > 0) return NextResponse.json({ error: 'Another user already has that email.' }, { status: 409 });
    }

    const nextRole = body?.role ?? target.role;
    const nextActive = body?.active ?? target.active;
    const finalName = nextName ?? target.name;
    const finalEmail = nextEmail ?? target.email;
    const losingAdmin = target.role === 'admin' && (nextRole !== 'admin' || !nextActive);

    if (losingAdmin) {
      const otherAdmins = (await sql`
        select count(*)::int as n from users where role = 'admin' and active = true and id <> ${id}
      `) as { n: number }[];
      if ((otherAdmins[0]?.n ?? 0) === 0) {
        return NextResponse.json({ error: 'Cannot remove the last active admin.' }, { status: 400 });
      }
    }

    await sql`update users set role = ${nextRole}, active = ${nextActive}, name = ${finalName}, email = ${finalEmail} where id = ${id}`;
    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, action, from_state, to_state, payload)
      values (
        ${user.id}, ${user.name}, ${user.role}, 'admin', 'user', ${id}, 'user.update',
        ${target.role}, ${nextRole},
        ${JSON.stringify({
          emailBefore: target.email,
          emailAfter: finalEmail,
          nameBefore: target.name,
          nameAfter: finalName,
          activeBefore: target.active,
          activeAfter: nextActive,
        })}::jsonb
      )
    `;

    return NextResponse.json({ ok: true, role: nextRole, active: nextActive, name: finalName, email: finalEmail });
  } catch (err) {
    return toErrorResponse(err);
  }
}
