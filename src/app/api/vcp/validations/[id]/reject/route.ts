import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyDept } from '@/lib/notify';

// POST /api/vcp/validations/:id/reject — admin only, note required. 05-API.md.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const validationId = params.id;
    const body = (await req.json().catch(() => null)) as { note?: string } | null;
    const note = body?.note;
    if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

    const sql = db();
    const rows = (await sql`
      select id, department_id, version, state from vcp_validations where id = ${validationId}
    `) as { id: string; department_id: string; version: number; state: string }[];
    const validation = rows[0];
    if (!validation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'vcp', dept: validation.department_id, role: 'admin' });

    if (validation.state !== 'pending') {
      return NextResponse.json({ error: 'Only a pending validation version can be rejected.' }, { status: 409 });
    }

    const deptRows = (await sql`select name from departments where id = ${validation.department_id}`) as { name: string }[];
    const deptName = deptRows[0]?.name ?? validation.department_id;

    await sql.transaction([
      sql`update vcp_validations set state = 'rejected', note = ${note} where id = ${validationId} and state = 'pending'`,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state, note, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'validation', ${validationId}, ${validation.department_id}, 'validation.reject', 'pending', 'rejected', ${note}, ${JSON.stringify({ version: validation.version })}::jsonb)
      `,
    ]);

    await notifyDept({
      tower: 'vcp',
      event: 'vreject',
      deptId: validation.department_id,
      subject: `Validation rejected — ${deptName} (v${validation.version})`,
      body: `${user.name} rejected validation version ${validation.version} for ${deptName}: ${note}`,
      linkKind: 'department',
      linkRef: validation.department_id,
    });

    return NextResponse.json({ ok: true, state: 'rejected' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
