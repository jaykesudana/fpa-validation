import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyDept } from '@/lib/notify';

// POST /api/vcp/targets/lock — admin only. 05-API.md.
// { fy, deptId, initiativeIds?: [] }  (omit for all)
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { fy?: string; deptId?: string; initiativeIds?: string[] } | null;
    const fy = body?.fy;
    const deptId = body?.deptId;
    const initiativeIds = body?.initiativeIds;
    if (!fy || !deptId) return NextResponse.json({ error: 'fy and deptId are required' }, { status: 400 });

    const { user } = await requireScope({ tower: 'vcp', dept: deptId, role: 'admin' });
    const sql = db();

    const deptRows = (await sql`select name from departments where id = ${deptId}`) as { name: string }[];
    const deptName = deptRows[0]?.name;
    if (!deptName) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updateQuery =
      initiativeIds && initiativeIds.length > 0
        ? sql`
            update vcp_targets set locked = true, set_by_user_id = ${user.id}, set_by_name = ${user.name}, set_at = now()
            where fiscal_year_id = ${fy} and department_id = ${deptId} and initiative_id = any(${initiativeIds}::text[]) and locked = false
            returning initiative_id
          `
        : sql`
            update vcp_targets set locked = true, set_by_user_id = ${user.id}, set_by_name = ${user.name}, set_at = now()
            where fiscal_year_id = ${fy} and department_id = ${deptId} and locked = false
            returning initiative_id
          `;

    const auditQuery = sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, department_id, action, to_state, payload)
      values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'target', ${deptId}, 'target.lock', 'locked', ${JSON.stringify({ initiativeIds: initiativeIds ?? 'all' })}::jsonb)
    `;

    const [updatedRows] = (await sql.transaction([updateQuery, auditQuery])) as [{ initiative_id: string }[], unknown];

    await notifyDept({
      tower: 'vcp',
      event: 'target',
      deptId,
      subject: `Target set — ${deptName}`,
      body: `${user.name} locked the ${fy} savings target for ${deptName}.`,
      linkKind: 'department',
      linkRef: deptId,
    });

    return NextResponse.json({ ok: true, lockedInitiativeIds: updatedRows.map((r) => r.initiative_id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
