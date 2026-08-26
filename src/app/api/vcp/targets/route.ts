import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

interface TargetInput {
  initiativeId: string;
  targetCents: number;
}

// PUT /api/vcp/targets — admin only. 05-API.md.
// { fy, deptId, targets: [{ initiativeId, targetCents }] }
export async function PUT(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { fy?: string; deptId?: string; targets?: TargetInput[] } | null;
    const fy = body?.fy;
    const deptId = body?.deptId;
    const targets = body?.targets;
    if (!fy || !deptId || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: 'fy, deptId, and a non-empty targets array are required' }, { status: 400 });
    }

    const { user } = await requireScope({ tower: 'vcp', dept: deptId, role: 'admin' });
    const sql = db();

    const initiativeIds = targets.map((t) => t.initiativeId);
    const existing = (await sql`
      select initiative_id, locked from vcp_targets
      where fiscal_year_id = ${fy} and department_id = ${deptId} and initiative_id = any(${initiativeIds}::text[])
    `) as { initiative_id: string; locked: boolean }[];

    const lockedIds = existing.filter((e) => e.locked).map((e) => e.initiative_id);
    if (lockedIds.length > 0) {
      return NextResponse.json(
        { error: `These initiatives are locked and cannot be edited without an admin unlock: ${lockedIds.join(', ')}`, code: 'locked' },
        { status: 409 },
      );
    }

    await sql.transaction([
      ...targets.map(
        (t) => sql`
          insert into vcp_targets (fiscal_year_id, department_id, initiative_id, target_cents, locked)
          values (${fy}, ${deptId}, ${t.initiativeId}, ${t.targetCents}, false)
          on conflict (fiscal_year_id, department_id, initiative_id)
          do update set target_cents = excluded.target_cents
        `,
      ),
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, department_id, action, to_state, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'target', ${deptId}, 'target.set', 'draft', ${JSON.stringify({ targets })}::jsonb)
      `,
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
