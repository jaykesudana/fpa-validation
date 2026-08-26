import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyDept } from '@/lib/notify';

// POST /api/vcp/validations/:id/approve — admin only. { note? }. 05-API.md.
// The only action that changes reported Delivered and live Identified.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const validationId = params.id;
    const body = (await req.json().catch(() => ({}))) as { note?: string };

    const sql = db();
    const rows = (await sql`
      select id, department_id, version, state, file_name from vcp_validations where id = ${validationId}
    `) as { id: string; department_id: string; version: number; state: string; file_name: string }[];
    const validation = rows[0];
    if (!validation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'vcp', dept: validation.department_id, role: 'admin' });

    if (validation.state !== 'pending') {
      return NextResponse.json({ error: 'Only a pending validation version can be approved.' }, { status: 409 });
    }

    const deptRows = (await sql`select name from departments where id = ${validation.department_id}`) as { name: string }[];
    const deptName = deptRows[0]?.name ?? validation.department_id;

    await sql.transaction([
      sql`
        update vcp_validations set state = 'approved', approved_by = ${user.id}, approved_by_name = ${user.name}, approved_at = now(), note = ${body.note ?? null}
        where id = ${validationId} and state = 'pending'
      `,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state, note, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'validation', ${validationId}, ${validation.department_id}, 'validation.approve', 'pending', 'approved', ${body.note ?? null}, ${JSON.stringify({ version: validation.version })}::jsonb)
      `,
    ]);

    await notifyDept({
      tower: 'vcp',
      event: 'vapprove',
      deptId: validation.department_id,
      subject: `Validation approved — ${deptName} (v${validation.version})`,
      body: `${user.name} approved validation version ${validation.version} for ${deptName}. It now counts toward Delivered.`,
      linkKind: 'department',
      linkRef: validation.department_id,
    });

    return NextResponse.json({ ok: true, state: 'approved' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
