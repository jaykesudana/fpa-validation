import { NextResponse } from 'next/server';
import { rollup, type Bucket, type InvRequest, type ReqStatus } from '@/lib/calc/investments';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyDept } from '@/lib/notify';

// POST /api/inv/requests/:id/approve — admin only. { approvedAmountCents?, note? }.
// screened → approved. This is the moment the bucket is drawn down. 05-API.md.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = (await req.json().catch(() => ({}))) as { approvedAmountCents?: number; note?: string };

    const sql = db();
    const rows = (await sql`
      select id, ref, department_id, fiscal_year_id, amount_cents, created_by, status from inv_requests where id = ${id}
    `) as { id: string; ref: string; department_id: string; fiscal_year_id: string; amount_cents: number; created_by: string | null; status: string }[];
    const request = rows[0];
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'inv', dept: request.department_id, role: 'admin' });

    if (request.status !== 'screened') {
      return NextResponse.json({ error: 'Only a screened request can be approved.' }, { status: 409 });
    }

    const approvedAmountCents = body.approvedAmountCents ?? Number(request.amount_cents);
    if (approvedAmountCents > Number(request.amount_cents)) {
      // An admin may cut the amount, not raise it — raising requires a new request.
      return NextResponse.json({ error: 'approvedAmountCents cannot exceed the requested amount.' }, { status: 422 });
    }

    await sql.transaction([
      sql`
        update inv_requests set status = 'approved', approved_amount_cents = ${approvedAmountCents},
          decided_by_name = 'CFO + ELT', decided_at = now(), decision_note = ${body.note ?? null}
        where id = ${id} and status = 'screened'
      `,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state, note, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'inv', 'request', ${id}, ${request.department_id}, 'request.approve', 'screened', 'approved', ${body.note ?? null}, ${JSON.stringify({ approvedAmountCents })}::jsonb)
      `,
    ]);

    const deptRows = (await sql`select name from departments where id = ${request.department_id}`) as { name: string }[];
    await notifyDept({
      tower: 'inv',
      event: 'approve',
      deptId: request.department_id,
      alsoNotifyUserIds: request.created_by ? [request.created_by] : [],
      subject: `Request approved — ${request.ref}`,
      body: `${user.name} approved ${request.ref} for ${deptRows[0]?.name ?? request.department_id}.`,
      linkKind: 'request',
      linkRef: request.ref,
    });

    const [bucketRows, allRequestRows] = await Promise.all([
      sql`select total_cents, reserve_cents from inv_bucket where fiscal_year_id = ${request.fiscal_year_id}` as Promise<
        { total_cents: number; reserve_cents: number }[]
      >,
      sql`select status, amount_cents, approved_amount_cents from inv_requests where fiscal_year_id = ${request.fiscal_year_id}` as Promise<
        { status: ReqStatus; amount_cents: number; approved_amount_cents: number | null }[]
      >,
    ]);

    let overcommitted: boolean | null = null;
    let available: number | null = null;
    let approvedTotal: number | null = null;
    let pendingTotal: number | null = null;
    if (bucketRows[0]) {
      const bucket: Bucket = { totalCents: Number(bucketRows[0].total_cents), reserveCents: Number(bucketRows[0].reserve_cents) };
      const requests: InvRequest[] = allRequestRows.map((r) => ({
        status: r.status,
        amountCents: Number(r.amount_cents),
        approvedAmountCents: r.approved_amount_cents == null ? null : Number(r.approved_amount_cents),
      }));
      const roll = rollup(requests, bucket);
      overcommitted = roll.overcommitted;
      available = roll.availableCents;
      approvedTotal = roll.approvedCents;
      pendingTotal = roll.pendingCents;
    }

    return NextResponse.json({
      ok: true,
      status: 'approved',
      approvedAmountCents,
      bucket: { available, approved: approvedTotal, pending: pendingTotal, overcommitted },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
