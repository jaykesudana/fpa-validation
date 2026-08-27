import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyUser } from '@/lib/notify';

// PUT /api/admin/users/:id/access — admin only. { tower: 'vcp'|'inv', departmentIds: string[] }.
// Not in 05-API.md; replaces the FULL grant set for this user+tower (a diff,
// not an append) — the "User Assignee" screen shows a checklist per tower,
// so save always means "this is the complete set now."
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireScope({ role: 'admin' });
    const id = params.id;
    const body = (await req.json().catch(() => null)) as { tower?: string; departmentIds?: string[] } | null;
    const tower = body?.tower;
    const departmentIds = body?.departmentIds;
    if ((tower !== 'vcp' && tower !== 'inv') || !Array.isArray(departmentIds)) {
      return NextResponse.json({ error: "tower must be 'vcp' or 'inv', and departmentIds must be an array" }, { status: 400 });
    }

    const sql = db();
    const targetRows = (await sql`select id, name, role from users where id = ${id}`) as { id: string; name: string; role: 'admin' | 'fbp' }[];
    const target = targetRows[0];
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (target.role === 'admin') {
      return NextResponse.json({ error: 'Admins already have full department access in both towers — nothing to assign.' }, { status: 400 });
    }

    const deptRows = departmentIds.length
      ? ((await sql`select id, name from departments where id = any(${departmentIds}::text[])`) as { id: string; name: string }[])
      : [];
    if (deptRows.length !== departmentIds.length) {
      return NextResponse.json({ error: 'One or more department ids were not recognized.' }, { status: 400 });
    }

    await sql.transaction([
      sql`delete from dept_access where user_id = ${id} and tower = ${tower}`,
      ...departmentIds.map(
        (deptId) => sql`
          insert into dept_access (user_id, department_id, tower, granted_by) values (${id}, ${deptId}, ${tower}, ${user.id})
        `,
      ),
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, action, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'admin', 'access', ${id}, 'access.update', ${JSON.stringify({ tower, departmentIds, targetName: target.name })}::jsonb)
      `,
    ]);

    await notifyUser({
      tower,
      event: 'assign',
      userId: id,
      subject: `Department access updated — ${tower === 'vcp' ? 'Value Creation Plan' : 'Investment Requests'}`,
      body: `${user.name} set your ${tower === 'vcp' ? 'VCP' : 'Investment Requests'} department access to: ${deptRows.map((d) => d.name).join(', ') || '(none)'}.`,
      linkKind: 'department',
    });

    return NextResponse.json({ ok: true, departmentIds });
  } catch (err) {
    return toErrorResponse(err);
  }
}
