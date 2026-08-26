import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

// POST /api/vcp/targets/unlock — admin only, note required. 05-API.md.
// { fy, deptId, initiativeIds?: [], note }
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { fy?: string; deptId?: string; initiativeIds?: string[]; note?: string } | null;
    const fy = body?.fy;
    const deptId = body?.deptId;
    const initiativeIds = body?.initiativeIds;
    const note = body?.note;
    if (!fy || !deptId || !note) return NextResponse.json({ error: 'fy, deptId, and note are required' }, { status: 400 });

    const { user } = await requireScope({ tower: 'vcp', dept: deptId, role: 'admin' });
    const sql = db();

    const updateQuery =
      initiativeIds && initiativeIds.length > 0
        ? sql`
            update vcp_targets set locked = false
            where fiscal_year_id = ${fy} and department_id = ${deptId} and initiative_id = any(${initiativeIds}::text[]) and locked = true
            returning initiative_id
          `
        : sql`
            update vcp_targets set locked = false
            where fiscal_year_id = ${fy} and department_id = ${deptId} and locked = true
            returning initiative_id
          `;

    const auditQuery = sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, department_id, action, to_state, note, payload)
      values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'target', ${deptId}, 'target.unlock', 'draft', ${note}, ${JSON.stringify({ initiativeIds: initiativeIds ?? 'all' })}::jsonb)
    `;

    const [updatedRows] = (await sql.transaction([updateQuery, auditQuery])) as [{ initiative_id: string }[], unknown];

    return NextResponse.json({ ok: true, unlockedInitiativeIds: updatedRows.map((r) => r.initiative_id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
