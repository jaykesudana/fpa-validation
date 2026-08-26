import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyDept } from '@/lib/notify';

// POST /api/inv/requests/:id/reject — admin only, note required. screened → rejected. 05-API.md.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = (await req.json().catch(() => null)) as { note?: string } | null;
    const note = body?.note;
    if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

    const sql = db();
    const rows = (await sql`select id, ref, department_id, created_by, status from inv_requests where id = ${id}`) as
      { id: string; ref: string; department_id: string; created_by: string | null; status: string }[];
    const request = rows[0];
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'inv', dept: request.department_id, role: 'admin' });

    if (request.status !== 'screened') {
      return NextResponse.json({ error: 'Only a screened request can be rejected.' }, { status: 409 });
    }

    await sql.transaction([
      sql`
        update inv_requests set status = 'rejected', decided_by_name = 'CFO + ELT', decided_at = now(), decision_note = ${note}
        where id = ${id} and status = 'screened'
      `,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state, note)
        values (${user.id}, ${user.name}, ${user.role}, 'inv', 'request', ${id}, ${request.department_id}, 'request.reject', 'screened', 'rejected', ${note})
      `,
    ]);

    await notifyDept({
      tower: 'inv',
      event: 'reject',
      deptId: request.department_id,
      alsoNotifyUserIds: request.created_by ? [request.created_by] : [],
      subject: `Request rejected — ${request.ref}`,
      body: `${user.name} rejected ${request.ref}: ${note}`,
      linkKind: 'request',
      linkRef: request.ref,
    });

    return NextResponse.json({ ok: true, status: 'rejected' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
