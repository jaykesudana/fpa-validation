import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'fbp';
  active: boolean;
  created_at: string;
}
interface GrantRow {
  user_id: string;
  department_id: string;
  tower: 'vcp' | 'inv';
}

// GET /api/admin/users — admin only. Not in 05-API.md; added per a follow-up
// request for a "User Assignee" screen where an admin manages the roster and
// department access directly (01-DOMAIN-AND-ROLES.md §1: "manages the
// roster and department access" is listed as an Admin responsibility, there
// was just no screen for it yet). Admins hold every department implicitly
// (see getDeptGrants) so their vcpDeptIds/invDeptIds come back empty — the
// UI shows "Admin — full access" instead of a checklist for those rows.
export async function GET() {
  try {
    await requireScope({ role: 'admin' });
    const sql = db();

    const [users, grants] = await Promise.all([
      sql`select id, email, name, role, active, created_at from users order by name` as unknown as Promise<UserRow[]>,
      sql`select user_id, department_id, tower from dept_access` as unknown as Promise<GrantRow[]>,
    ]);

    const grantsByUser = new Map<string, { vcp: string[]; inv: string[] }>();
    for (const g of grants) {
      const entry = grantsByUser.get(g.user_id) ?? { vcp: [], inv: [] };
      entry[g.tower].push(g.department_id);
      grantsByUser.set(g.user_id, entry);
    }

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        active: u.active,
        createdAt: u.created_at,
        vcpDeptIds: grantsByUser.get(u.id)?.vcp ?? [],
        invDeptIds: grantsByUser.get(u.id)?.inv ?? [],
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/admin/users — admin only. { email, name, role }. Creates a new
// roster entry — this is how a new FBP or a second admin gets in before real
// SSO is wired in (dev sign-in only lets you act as someone already here).
export async function POST(req: Request) {
  try {
    const { user } = await requireScope({ role: 'admin' });
    const body = (await req.json().catch(() => null)) as { email?: string; name?: string; role?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    const name = body?.name?.trim();
    const role = body?.role;
    if (!email || !name || (role !== 'admin' && role !== 'fbp')) {
      return NextResponse.json({ error: 'email, name, and a role of admin or fbp are required' }, { status: 400 });
    }

    const sql = db();
    const existing = (await sql`select id from users where lower(email) = ${email}`) as { id: string }[];
    if (existing.length > 0) {
      return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 });
    }

    const inserted = (await sql`
      insert into users (email, name, role) values (${email}, ${name}, ${role})
      returning id, email, name, role, active
    `) as { id: string; email: string; name: string; role: string; active: boolean }[];
    const newUser = inserted[0];
    if (!newUser) return NextResponse.json({ error: 'Could not create the user.' }, { status: 500 });

    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, action, payload)
      values (${user.id}, ${user.name}, ${user.role}, 'admin', 'user', ${newUser.id}, 'user.create', ${JSON.stringify({ email, name, role })}::jsonb)
    `;

    return NextResponse.json({ user: newUser });
  } catch (err) {
    return toErrorResponse(err);
  }
}
