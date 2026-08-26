import { NextResponse } from 'next/server';
import { getDeptGrants } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { db } from '@/lib/db';

interface AuditRow {
  at: string;
  actor_name: string;
  actor_role: string;
  tower: string;
  entity_type: string;
  entity_id: string | null;
  department_id: string | null;
  action: string;
  from_state: string | null;
  to_state: string | null;
  note: string | null;
  payload: unknown;
}

// GET /api/audit?entityType=…&entityId=…&dept=…&limit=100 — 05-API.md.
// Business partners see only their own departments' entries — scoped per
// tower (a VCP grant doesn't unlock INV audit rows and vice versa), and
// tower-less entries (bucket edits, roster changes — department_id is null)
// are admin-only since they aren't owned by any department the partner holds.
export async function GET(req: Request) {
  try {
    const { user } = await requireScope();
    const url = new URL(req.url);
    const entityType = url.searchParams.get('entityType');
    const entityId = url.searchParams.get('entityId');
    const deptFilter = url.searchParams.get('dept');
    const rawLimit = Number(url.searchParams.get('limit') ?? '100');
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);

    const isAdmin = user.role === 'admin';
    const [vcpDeptIds, invDeptIds] = await Promise.all([getDeptGrants(user, 'vcp'), getDeptGrants(user, 'inv')]);

    const sql = db();
    const rows = (await sql`
      select at, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state, note, payload
      from audit_log
      where (
        ${isAdmin}
        or (department_id is not null and (
          (tower = 'vcp' and department_id = any(${vcpDeptIds}::text[]))
          or (tower = 'inv' and department_id = any(${invDeptIds}::text[]))
        ))
      )
      and (${entityType}::text is null or entity_type = ${entityType})
      and (${entityId}::text is null or entity_id = ${entityId})
      and (${deptFilter}::text is null or department_id = ${deptFilter})
      order by at desc
      limit ${limit}
    `) as AuditRow[];

    return NextResponse.json({
      entries: rows.map((r) => ({
        at: r.at,
        actorName: r.actor_name,
        actorRole: r.actor_role,
        tower: r.tower,
        entityType: r.entity_type,
        entityId: r.entity_id,
        departmentId: r.department_id,
        action: r.action,
        fromState: r.from_state,
        toState: r.to_state,
        note: r.note,
        payload: r.payload,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
