import { NextResponse } from 'next/server';
import { getDeptGrants } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { coverage, deptCurrentIdentified, deptTarget, deptValidatedTotal, initCurrentIdentified, initValidated } from '@/lib/calc/vcp';
import { db } from '@/lib/db';
import { resolveFiscalYear } from '@/lib/fiscal-year';
import { loadDepartmentsForCalc } from '@/lib/vcp/load-department';

// Display order per 01-DOMAIN-AND-ROLES.md §5, extended per a follow-up
// request: Events was originally grouped under "Other" (departments not
// named in the spec's Summary group list) but is now split out as its own
// group — see migrations/0003. "Other" remains a real seeded summary_group
// value for anything else uncategorized.
const GROUP_ORDER = ['RDI', 'Events', 'Sales', 'Marketing', 'Customer Success', 'CTO', 'IT', 'Finance', 'HR', 'Legal', 'Executive Leadership', 'Other'];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

interface DeptCatalogRow {
  id: string;
  name: string;
  summary_group: string;
}

interface InvRollupRow {
  department_id: string;
  approved_cents: number;
  pending_cents: number;
  approved_count: number;
  pending_count: number;
}

// GET /api/summary?fy=…&view=dept|initiative&group=all|rdi|sales|… — 05-API.md.
// Read-only, never writes. `view` is advisory — both lenses are cheap once
// the calc data is loaded, so both are always returned and the UI toggles
// client-side without a second round trip.
export async function GET(req: Request) {
  try {
    const { user } = await requireScope();
    const [vcpDeptIds, invDeptIds] = await Promise.all([getDeptGrants(user, 'vcp'), getDeptGrants(user, 'inv')]);
    const vcpSet = new Set(vcpDeptIds);
    const invSet = new Set(invDeptIds);

    const url = new URL(req.url);
    const fy = await resolveFiscalYear(url.searchParams.get('fy'));
    if (!fy) return NextResponse.json({ error: 'No current fiscal year configured' }, { status: 400 });

    const requestedGroup = url.searchParams.get('group');
    const sql = db();

    const allDepts = (await sql`
      select id, name, summary_group from departments where active = true order by sort_order
    `) as DeptCatalogRow[];

    // A department appears at all only if the viewer sees it in at least one
    // tower (01-DOMAIN-AND-ROLES.md §5); a group tab only appears if it has
    // at least one such department. The requested `group` further narrows
    // both the department rows AND the by-initiative rollups below, so the
    // two lenses always agree on what's in view.
    const visibleDepts = allDepts.filter(
      (d) => (vcpSet.has(d.id) || invSet.has(d.id)) && (!requestedGroup || requestedGroup === 'all' || slug(d.summary_group) === requestedGroup),
    );

    const vcpVisibleIds = visibleDepts.filter((d) => vcpSet.has(d.id)).map((d) => d.id);
    const invVisibleIds = visibleDepts.filter((d) => invSet.has(d.id)).map((d) => d.id);

    const [calcDepts, invRollupRows] = await Promise.all([
      loadDepartmentsForCalc(fy, vcpVisibleIds),
      invVisibleIds.length
        ? (sql`
            select department_id, approved_cents, pending_cents, approved_count, pending_count
            from v_inv_dept_rollup where fiscal_year_id = ${fy} and department_id = any(${invVisibleIds}::text[])
          ` as unknown as Promise<InvRollupRow[]>)
        : Promise.resolve([] as InvRollupRow[]),
    ]);
    const invRollupMap = new Map(invRollupRows.map((r) => [r.department_id, r]));

    const deptRows = visibleDepts.map((d) => {
      const seesV = vcpSet.has(d.id);
      const seesI = invSet.has(d.id);

      let target = 0;
      let identified = 0;
      let delivered = 0;
      if (seesV) {
        const cd = calcDepts.get(d.id);
        if (cd) {
          target = deptTarget(cd);
          identified = deptCurrentIdentified(cd);
          delivered = deptValidatedTotal(cd);
        }
      }

      const invRoll = seesI ? invRollupMap.get(d.id) : undefined;

      return {
        dept: d.name,
        deptId: d.id,
        summaryGroup: d.summary_group,
        seesV,
        seesI,
        target,
        identified,
        delivered,
        coverage: coverage(target, delivered),
        invApproved: invRoll ? Number(invRoll.approved_cents) : 0,
        invPending: invRoll ? Number(invRoll.pending_cents) : 0,
        invApprovedCount: invRoll ? Number(invRoll.approved_count) : 0,
        invPendingCount: invRoll ? Number(invRoll.pending_count) : 0,
      };
    });

    const groupNamesPresent = Array.from(new Set(deptRows.map((r) => r.summaryGroup)));
    const orderedGroupNames = [
      ...GROUP_ORDER.filter((g) => groupNamesPresent.includes(g)),
      ...groupNamesPresent.filter((g) => !GROUP_ORDER.includes(g)),
    ];

    const groups = orderedGroupNames.map((name) => {
      const rows = deptRows.filter((r) => r.summaryGroup === name).map(({ summaryGroup: _drop, ...rest }) => rest);
      const totals = rows.reduce(
        (acc, r) => ({
          target: acc.target + r.target,
          identified: acc.identified + r.identified,
          delivered: acc.delivered + r.delivered,
          invApproved: acc.invApproved + r.invApproved,
          invPending: acc.invPending + r.invPending,
          invApprovedCount: acc.invApprovedCount + r.invApprovedCount,
          invPendingCount: acc.invPendingCount + r.invPendingCount,
        }),
        { target: 0, identified: 0, delivered: 0, invApproved: 0, invPending: 0, invApprovedCount: 0, invPendingCount: 0 },
      );
      return { key: slug(name), name, rows, totals: { ...totals, coverage: coverage(totals.target, totals.delivered) } };
    });

    // By-initiative lens — scoped by the same visibleDepts as above.
    const [vcpInitiatives, invInitiatives] = await Promise.all([
      sql`select id, name from vcp_initiatives where active = true order by sort_order` as unknown as Promise<{ id: string; name: string }[]>,
      sql`select id, name from inv_initiatives where active = true order by sort_order` as unknown as Promise<{ id: string; name: string }[]>,
    ]);

    const vcpInitiativeRows = vcpInitiatives.map((init) => {
      let target = 0;
      let identified = 0;
      let delivered = 0;
      for (const deptId of vcpVisibleIds) {
        const cd = calcDepts.get(deptId);
        if (!cd) continue;
        const iv = cd.initiatives.find((i) => i.initiativeId === init.id);
        if (iv) target += iv.targetCents;
        identified += initCurrentIdentified(cd, init.id);
        delivered += initValidated(cd, init.id);
      }
      return { name: init.name, target, identified, delivered, coverage: coverage(target, delivered) };
    });

    const invByInitiativeRows = invVisibleIds.length
      ? ((await sql`
          select initiative_id,
                 sum(case when status = 'approved' then coalesce(approved_amount_cents, amount_cents) else 0 end) as approved_cents,
                 sum(case when status in ('submitted', 'screened') then amount_cents else 0 end) as pending_cents,
                 count(*) filter (where status in ('approved', 'submitted', 'screened', 'rejected')) as request_count
          from inv_requests
          where fiscal_year_id = ${fy} and department_id = any(${invVisibleIds}::text[])
          group by initiative_id
        `) as { initiative_id: string | null; approved_cents: number; pending_cents: number; request_count: number }[])
      : [];
    const invByInitiativeMap = new Map(invByInitiativeRows.map((r) => [r.initiative_id, r]));

    const invInitiativeRows = invInitiatives.map((init) => {
      const row = invByInitiativeMap.get(init.id);
      return {
        name: init.name,
        approved: row ? Number(row.approved_cents) : 0,
        pending: row ? Number(row.pending_cents) : 0,
        requestCount: row ? Number(row.request_count) : 0,
      };
    });

    return NextResponse.json({
      fiscalYear: fy,
      groups,
      initiatives: { vcp: vcpInitiativeRows, inv: invInitiativeRows },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
