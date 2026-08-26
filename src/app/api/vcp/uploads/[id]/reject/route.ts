import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyDept } from '@/lib/notify';

// POST /api/vcp/uploads/:id/reject — admin only, note required. 05-API.md.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const uploadId = params.id;
    const body = (await req.json().catch(() => null)) as { note?: string } | null;
    const note = body?.note;
    if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

    const sql = db();
    const rows = (await sql`select id, department_id, state, file_name from vcp_uploads where id = ${uploadId}`) as
      { id: string; department_id: string; state: string; file_name: string }[];
    const upload = rows[0];
    if (!upload) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'vcp', dept: upload.department_id, role: 'admin' });

    if (upload.state !== 'review') {
      return NextResponse.json({ error: 'Only an upload in review can be rejected.' }, { status: 409 });
    }

    const deptRows = (await sql`select name from departments where id = ${upload.department_id}`) as { name: string }[];
    const deptName = deptRows[0]?.name ?? upload.department_id;

    await sql.transaction([
      sql`update vcp_uploads set state = 'rejected', reject_note = ${note} where id = ${uploadId} and state = 'review'`,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state, note, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'upload', ${uploadId}, ${upload.department_id}, 'baseline.reject', 'review', 'rejected', ${note}, ${JSON.stringify({ fileName: upload.file_name })}::jsonb)
      `,
    ]);

    await notifyDept({
      tower: 'vcp',
      event: 'reject',
      deptId: upload.department_id,
      subject: `Baseline rejected — ${deptName}`,
      body: `${user.name} rejected the identified baseline for ${deptName}: ${note}`,
      linkKind: 'department',
      linkRef: upload.department_id,
    });

    return NextResponse.json({ ok: true, state: 'rejected' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
