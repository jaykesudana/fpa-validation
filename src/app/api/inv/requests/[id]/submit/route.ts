import { NextResponse } from 'next/server';
import { fmtCents } from '@/lib/calc/format';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { notifyAdmins } from '@/lib/notify';

// POST /api/inv/requests/:id/submit — draft|returned → submitted. 05-API.md.
// Requires title, department, amount > 0. Warns (never blocks) on a phasing mismatch.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const sql = db();

    const rows = (await sql`
      select id, ref, department_id, title, amount_cents, phase_q1_cents, phase_q2_cents, phase_q3_cents, phase_q4_cents, status
      from inv_requests where id = ${id}
    `) as {
      id: string; ref: string; department_id: string; title: string; amount_cents: number;
      phase_q1_cents: number; phase_q2_cents: number; phase_q3_cents: number; phase_q4_cents: number; status: string;
    }[];
    const request = rows[0];
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'inv', dept: request.department_id });

    if (!['draft', 'returned'].includes(request.status)) {
      return NextResponse.json({ error: 'Only a draft or returned request can be submitted.' }, { status: 409 });
    }
    if (!request.title?.trim() || Number(request.amount_cents) <= 0) {
      return NextResponse.json({ error: 'Title and an amount greater than 0 are required to submit.' }, { status: 422 });
    }

    await sql.transaction([
      sql`update inv_requests set status = 'submitted', submitted_by_name = ${user.name}, submitted_at = now() where id = ${id}`,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state)
        values (${user.id}, ${user.name}, ${user.role}, 'inv', 'request', ${id}, ${request.department_id}, 'request.submit', ${request.status}, 'submitted')
      `,
    ]);

    await notifyAdmins({
      tower: 'inv',
      event: 'submit',
      subject: `Request submitted — ${request.ref}`,
      body: `${user.name} submitted ${request.ref} (${request.title}) for FP&A screening.`,
      linkKind: 'request',
      linkRef: request.ref,
      ccUserIds: [user.id],
    });

    const phasingSum = Number(request.phase_q1_cents) + Number(request.phase_q2_cents) + Number(request.phase_q3_cents) + Number(request.phase_q4_cents);
    const warning =
      phasingSum !== Number(request.amount_cents)
        ? `Quarterly phasing (${fmtCents(phasingSum)}) doesn't match the requested amount (${fmtCents(Number(request.amount_cents))}).`
        : null;

    return NextResponse.json({ ok: true, status: 'submitted', warning });
  } catch (err) {
    return toErrorResponse(err);
  }
}
