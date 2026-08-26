import { NextResponse } from 'next/server';
import { rollup, type InvRequest, type ReqStatus } from '@/lib/calc/investments';
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

    // Scoped to THIS request's department allocation — not the global pool —
    // consistent with how Summary/Investments now scope "available" and
    // "overcommitted" everywhere else (see migrations/0003 and
    // src/app/api/inv/bucket/route.ts).
    const [allocationRows, deptRequestRows] = await Promise.all([
      sql`
        select allocated_cents from inv_bucket_allocations
        where fiscal_year_id = ${request.fiscal_year_id} and department_id = ${request.department_id}
      ` as unknown as Promise<{ allocated_cents: number }[]>,
      sql`
        select status, amount_cents, approved_amount_cents from inv_requests
        where fiscal_year_id = ${request.fiscal_year_id} and department_id = ${request.department_id}
      ` as unknown as Promise<{ status: ReqStatus; amount_cents: number; approved_amount_cents: number | null }[]>,
    ]);

    const allocatedCents = allocationRows[0] ? Number(allocationRows[0].allocated_cents) : 0;
    const deptRequests: InvRequest[] = deptRequestRows.map((r) => ({
      status: r.status,
      amountCents: Number(r.amount_cents),
      approvedAmountCents: r.approved_amount_cents == null ? null : Number(r.approved_amount_cents),
    }));
    const roll = rollup(deptRequests, { totalCents: allocatedCents, reserveCents: 0 });

    return NextResponse.json({
      ok: true,
      status: 'approved',
      approvedAmountCents,
      bucket: { available: roll.availableCents, approved: roll.approvedCents, pending: roll.pendingCents, overcommitted: roll.overcommitted },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
