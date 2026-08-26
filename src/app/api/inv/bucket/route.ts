import { NextResponse } from 'next/server';
import { rollup, type Bucket, type InvRequest, type ReqStatus } from '@/lib/calc/investments';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { resolveFiscalYear } from '@/lib/fiscal-year';
import { notifyAllPartners } from '@/lib/notify';

interface AllocationRow {
  department_id: string;
  department_name: string;
  allocated_cents: number;
}

// GET /api/inv/bucket?fy=… — 05-API.md, extended per a follow-up request:
// "Investment pool / Approved / In flight / Unallocated" are now scoped to
// what's actually allocated to the departments the caller can see, not the
// company-wide pool. `poolTotal` / `reserve` / `poolAvailable` remain the
// true global figures, for admins managing the allocation itself.
export async function GET(req: Request) {
  try {
    const { deptIds } = await requireScope({ tower: 'inv' });
    const url = new URL(req.url);
    const fy = await resolveFiscalYear(url.searchParams.get('fy'));
    if (!fy) return NextResponse.json({ error: 'No current fiscal year configured' }, { status: 400 });

    const sql = db();
    const bucketRows = (await sql`
      select total_cents, reserve_cents, locked, note, set_by_name, set_at from inv_bucket where fiscal_year_id = ${fy}
    `) as { total_cents: number; reserve_cents: number; locked: boolean; note: string | null; set_by_name: string | null; set_at: string }[];
    const bucketRow = bucketRows[0];
    if (!bucketRow) return NextResponse.json({ error: 'No investment bucket configured for this fiscal year' }, { status: 404 });

    const [allocationRows, requestRows] = await Promise.all([
      sql`
        select a.department_id, d.name as department_name, a.allocated_cents
        from inv_bucket_allocations a join departments d on d.id = a.department_id
        where a.fiscal_year_id = ${fy}
        order by d.sort_order
      ` as unknown as Promise<AllocationRow[]>,
      deptIds.length > 0
        ? (sql`
            select status, amount_cents, approved_amount_cents from inv_requests
            where fiscal_year_id = ${fy} and department_id = any(${deptIds}::text[])
          ` as unknown as Promise<{ status: ReqStatus; amount_cents: number; approved_amount_cents: number | null }[]>)
        : Promise.resolve([] as { status: ReqStatus; amount_cents: number; approved_amount_cents: number | null }[]),
    ]);

    const globalBucket: Bucket = { totalCents: Number(bucketRow.total_cents), reserveCents: Number(bucketRow.reserve_cents) };
    const poolAvailable = globalBucket.totalCents - globalBucket.reserveCents;
    const allocatedTotal = allocationRows.reduce((s, a) => s + Number(a.allocated_cents), 0);

    const deptIdSet = new Set(deptIds);
    const scopedAllocations = allocationRows.filter((a) => deptIdSet.has(a.department_id));
    const scopedAllocatedCents = scopedAllocations.reduce((s, a) => s + Number(a.allocated_cents), 0);

    const requests: InvRequest[] = requestRows.map((r) => ({
      status: r.status,
      amountCents: Number(r.amount_cents),
      approvedAmountCents: r.approved_amount_cents == null ? null : Number(r.approved_amount_cents),
    }));
    // Reuse rollup() with the SCOPED allocated amount standing in for
    // "totalCents" and reserveCents=0 (reserve is a company-wide concept,
    // already netted out of the pool before any department gets an
    // allocation) — this gives approved/pending/unallocated/overcommitted
    // all scoped consistently without duplicating the arithmetic.
    const scopedRoll = rollup(requests, { totalCents: scopedAllocatedCents, reserveCents: 0 });

    return NextResponse.json({
      fiscal: fy,
      poolTotal: globalBucket.totalCents,
      reserve: globalBucket.reserveCents,
      poolAvailable,
      allocatedTotal,
      total: scopedAllocatedCents,
      available: scopedRoll.availableCents,
      approved: scopedRoll.approvedCents,
      pending: scopedRoll.pendingCents,
      rejected: scopedRoll.rejectedCents,
      draft: scopedRoll.draftCents,
      remaining: scopedRoll.remainingCents,
      unallocated: scopedRoll.unallocatedCents,
      overcommitted: scopedRoll.overcommitted,
      count: scopedRoll.count,
      approvedCount: scopedRoll.approvedCount,
      pendingCount: scopedRoll.pendingCount,
      locked: bucketRow.locked,
      setByName: bucketRow.set_by_name,
      setAt: bucketRow.set_at,
      note: bucketRow.note,
      allocations: scopedAllocations.map((a) => ({
        departmentId: a.department_id,
        departmentName: a.department_name,
        allocatedCents: Number(a.allocated_cents),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT /api/inv/bucket — admin only. { fy, totalCents, reserveCents, note? }. 05-API.md.
// Edits the GLOBAL pool size — separate from per-department allocations below.
export async function PUT(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { fy?: string; totalCents?: number; reserveCents?: number; note?: string } | null;
    const fy = body?.fy;
    const totalCents = body?.totalCents;
    const reserveCents = body?.reserveCents;
    if (!fy || totalCents == null || reserveCents == null) {
      return NextResponse.json({ error: 'fy, totalCents, and reserveCents are required' }, { status: 400 });
    }
    if (reserveCents >= totalCents) {
      return NextResponse.json({ error: 'The reserve has to sit inside the total pool.' }, { status: 422 });
    }

    const { user } = await requireScope({ tower: 'inv', role: 'admin' });
    const sql = db();

    await sql.transaction([
      sql`
        insert into inv_bucket (fiscal_year_id, total_cents, reserve_cents, locked, note, set_by, set_by_name, set_at)
        values (${fy}, ${totalCents}, ${reserveCents}, true, ${body?.note ?? null}, ${user.id}, ${user.name}, now())
        on conflict (fiscal_year_id) do update set
          total_cents = excluded.total_cents, reserve_cents = excluded.reserve_cents,
          note = excluded.note, set_by = excluded.set_by, set_by_name = excluded.set_by_name, set_at = excluded.set_at
      `,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, action, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'inv', 'bucket', 'bucket.update', ${JSON.stringify({ fy, totalCents, reserveCents, note: body?.note ?? null })}::jsonb)
      `,
    ]);

    await notifyAllPartners({
      tower: 'inv',
      event: 'bucket',
      subject: `Investment bucket updated — ${fy}`,
      body: `${user.name} updated the ${fy} investment pool.`,
      linkKind: 'bucket',
      linkRef: fy,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
