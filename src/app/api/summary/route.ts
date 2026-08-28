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

interface InvByInitiativeDeptRow {
  initiative_id: string | null;
  department_id: string;
  approved_cents: number;
  pending_cents: number;
  request_count: number;
}

interface VcpInitiativeFigures {
  target: number;
  identified: number;
  delivered: number;
}

// GET /api/summary?fy=…&view=dept|initiative&group=all|rdi|sales|… — 05-API.md.
// Read-only, never writes. `view` is advisory — both lenses are cheap once
// the calc data is loaded, so both are always returned and the UI toggles
// client-side without a second round trip. Each group also carries its OWN
// by-initiative breakdown (initiatives.vcp/inv, scoped to that group's
// departments only) — added for the presentation export's per-group
// appendix slides, which need "this group's initiatives," not just the
// org-wide totals the top-level `initiatives` field already provided.
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

    const [calcDepts, invRollupRows, vcpInitiatives, invInitiatives] = await Promise.all([
      loadDepartmentsForCalc(fy, vcpVisibleIds),
      invVisibleIds.length
        ? (sql`
            select department_id, approved_cents, pending_cents, approved_count, pending_count
            from v_inv_dept_rollup where fiscal_year_id = ${fy} and department_id = any(${invVisibleIds}::text[])
          ` as unknown as Promise<InvRollupRow[]>)
        : Promise.resolve([] as InvRollupRow[]),
      sql`select id, name from vcp_initiatives where active = true order by sort_order` as unknown as Promise<{ id: string; name: string }[]>,
      sql`select id, name from inv_initiatives where active = true order by sort_order` as unknown as Promise<{ id: string; name: string }[]>,
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

    // Per-department, per-initiative VCP figures — computed once, then
    // aggregated two ways below: org-wide (all vcpVisibleIds) and per-group
    // (just that group's dept ids). Avoids running the same calc-module
    // lookups twice for the same department.
    const vcpFiguresByDept = new Map<string, Map<string, VcpInitiativeFigures>>();
    for (const deptId of vcpVisibleIds) {
      const cd = calcDepts.get(deptId);
      if (!cd) continue;
      const perInitiative = new Map<string, VcpInitiativeFigures>();
      for (const init of vcpInitiatives) {
        const iv = cd.initiatives.find((i) => i.initiativeId === init.id);
        perInitiative.set(init.id, {
          target: iv ? iv.targetCents : 0,
          identified: initCurrentIdentified(cd, init.id),
          delivered: initValidated(cd, init.id),
        });
      }
      vcpFiguresByDept.set(deptId, perInitiative);
    }

    function vcpInitiativeRowsFor(deptIds: readonly string[]) {
      return vcpInitiatives.map((init) => {
        let target = 0;
        let identified = 0;
        let delivered = 0;
        for (const deptId of deptIds) {
          const figures = vcpFiguresByDept.get(deptId)?.get(init.id);
          if (!figures) continue;
          target += figures.target;
          identified += figures.identified;
          delivered += figures.delivered;
        }
        return { name: init.name, target, identified, delivered, coverage: coverage(target, delivered) };
      });
    }

    // Per-department, per-initiative investment figures — same idea as
    // above, one query instead of the previous org-wide-only aggregate, so
    // the same rows can be summed either org-wide or per-group.
    const invByInitiativeDeptRows: InvByInitiativeDeptRow[] = invVisibleIds.length
      ? ((await sql`
          select initiative_id, department_id,
                 sum(case when status = 'approved' then coalesce(approved_amount_cents, amount_cents) else 0 end) as approved_cents,
                 sum(case when status in ('submitted', 'screened') then amount_cents else 0 end) as pending_cents,
                 count(*) filter (where status in ('approved', 'submitted', 'screened', 'rejected')) as request_count
          from inv_requests
          where fiscal_year_id = ${fy} and department_id = any(${invVisibleIds}::text[])
          group by initiative_id, department_id
        `) as unknown as Promise<InvByInitiativeDeptRow[]>)
      : [];

    function invInitiativeRowsFor(deptIds: readonly string[]) {
      const deptIdSet = new Set(deptIds);
      const scoped = invByInitiativeDeptRows.filter((r) => deptIdSet.has(r.department_id));
      return invInitiatives.map((init) => {
        const rows = scoped.filter((r) => r.initiative_id === init.id);
        return {
          name: init.name,
          approved: rows.reduce((s, r) => s + Number(r.approved_cents), 0),
          pending: rows.reduce((s, r) => s + Number(r.pending_cents), 0),
          requestCount: rows.reduce((s, r) => s + Number(r.request_count), 0),
        };
      });
    }

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
      const groupDeptIds = rows.map((r) => r.deptId);
      return {
        key: slug(name),
        name,
        rows,
        totals: { ...totals, coverage: coverage(totals.target, totals.delivered) },
        initiatives: {
          vcp: vcpInitiativeRowsFor(groupDeptIds.filter((id) => vcpSet.has(id))),
          inv: invInitiativeRowsFor(groupDeptIds.filter((id) => invSet.has(id))),
        },
      };
    });

    return NextResponse.json({
      fiscalYear: fy,
      groups,
      initiatives: { vcp: vcpInitiativeRowsFor(vcpVisibleIds), inv: invInitiativeRowsFor(invVisibleIds) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
