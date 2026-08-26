import { NextResponse } from 'next/server';
import { rollup, type Bucket, type InvRequest, type ReqStatus } from '@/lib/calc/investments';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { resolveFiscalYear } from '@/lib/fiscal-year';
import { notifyAllPartners } from '@/lib/notify';

// GET /api/inv/bucket?fy=… — 05-API.md. Rollup figures scoped to the caller.
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

    const requestRows =
      deptIds.length > 0
        ? ((await sql`
            select status, amount_cents, approved_amount_cents from inv_requests
            where fiscal_year_id = ${fy} and department_id = any(${deptIds}::text[])
          `) as { status: ReqStatus; amount_cents: number; approved_amount_cents: number | null }[])
        : [];

    const bucket: Bucket = { totalCents: Number(bucketRow.total_cents), reserveCents: Number(bucketRow.reserve_cents) };
    const requests: InvRequest[] = requestRows.map((r) => ({
      status: r.status,
      amountCents: Number(r.amount_cents),
      approvedAmountCents: r.approved_amount_cents == null ? null : Number(r.approved_amount_cents),
    }));
    const roll = rollup(requests, bucket);

    return NextResponse.json({
      fiscal: fy,
      total: bucket.totalCents,
      reserve: bucket.reserveCents,
      available: roll.availableCents,
      approved: roll.approvedCents,
      pending: roll.pendingCents,
      rejected: roll.rejectedCents,
      draft: roll.draftCents,
      remaining: roll.remainingCents,
      unallocated: roll.unallocatedCents,
      overcommitted: roll.overcommitted,
      count: roll.count,
      approvedCount: roll.approvedCount,
      pendingCount: roll.pendingCount,
      locked: bucketRow.locked,
      setByName: bucketRow.set_by_name,
      setAt: bucketRow.set_at,
      note: bucketRow.note,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT /api/inv/bucket — admin only. { fy, totalCents, reserveCents, note? }. 05-API.md.
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
