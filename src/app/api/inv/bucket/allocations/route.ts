import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyDept } from '@/lib/notify';

// PUT /api/inv/bucket/allocations — admin only. { fy, departmentId, allocatedCents }.
// Extends beyond 05-API.md per a follow-up request: earmarks a portion of
// the FY pool to a specific department. Upserts — same call edits an
// existing allocation or creates a new one.
export async function PUT(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { fy?: string; departmentId?: string; allocatedCents?: number } | null;
    const fy = body?.fy;
    const departmentId = body?.departmentId;
    const allocatedCents = body?.allocatedCents;
    if (!fy || !departmentId || allocatedCents == null || allocatedCents < 0) {
      return NextResponse.json({ error: 'fy, departmentId, and a non-negative allocatedCents are required' }, { status: 400 });
    }

    const { user } = await requireScope({ tower: 'inv', role: 'admin' });
    const sql = db();

    const deptRows = (await sql`select name from departments where id = ${departmentId}`) as { name: string }[];
    const deptName = deptRows[0]?.name;
    if (!deptName) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await sql.transaction([
      sql`
        insert into inv_bucket_allocations (fiscal_year_id, department_id, allocated_cents, set_by, set_by_name, set_at)
        values (${fy}, ${departmentId}, ${allocatedCents}, ${user.id}, ${user.name}, now())
        on conflict (fiscal_year_id, department_id) do update set
          allocated_cents = excluded.allocated_cents, set_by = excluded.set_by, set_by_name = excluded.set_by_name, set_at = excluded.set_at
      `,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, department_id, action, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'inv', 'bucket', ${departmentId}, 'bucket.allocate', ${JSON.stringify({ fy, allocatedCents })}::jsonb)
      `,
    ]);

    await notifyDept({
      tower: 'inv',
      event: 'bucket',
      deptId: departmentId,
      subject: `Investment allocation updated — ${deptName}`,
      body: `${user.name} set ${deptName}'s ${fy} investment allocation.`,
      linkKind: 'department',
      linkRef: departmentId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
