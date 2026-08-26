import { NextResponse } from 'next/server';
import { deriveRegion, INV_STATUS, type ReqStatus } from '@/lib/calc/investments';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

// GET /api/inv/requests/:id — not explicitly enumerated in 05-API.md, but the
// UI spec's request detail view (fields grid, phasing, feedback panel,
// attachments, request log) needs a single-request read, so it lives here
// alongside PATCH.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const sql = db();

    const rows = (await sql`
      select r.id, r.ref, r.title, r.department_id, d.name as dept_name, r.initiative_id, ii.name as initiative_name,
             r.type, r.country, r.region, r.amount_cents, r.phase_q1_cents, r.phase_q2_cents, r.phase_q3_cents, r.phase_q4_cents,
             r.expected_return_cents, r.payback, r.sponsor, r.exec_sponsor, r.business_case, r.risk, r.status,
             r.submitted_by_name, r.submitted_at, r.screened_by_name, r.screened_at, r.screen_note,
             r.decided_by_name, r.decided_at, r.decision_note, r.approved_amount_cents
      from inv_requests r
      join departments d on d.id = r.department_id
      left join inv_initiatives ii on ii.id = r.initiative_id
      where r.id = ${id}
    `) as {
      id: string; ref: string; title: string; department_id: string; dept_name: string; initiative_id: string | null; initiative_name: string | null;
      type: string; country: string; region: string; amount_cents: number;
      phase_q1_cents: number; phase_q2_cents: number; phase_q3_cents: number; phase_q4_cents: number;
      expected_return_cents: number; payback: string | null; sponsor: string | null; exec_sponsor: string | null;
      business_case: string | null; risk: string | null; status: ReqStatus;
      submitted_by_name: string | null; submitted_at: string | null; screened_by_name: string | null; screened_at: string | null; screen_note: string | null;
      decided_by_name: string | null; decided_at: string | null; decision_note: string | null; approved_amount_cents: number | null;
    }[];
    const r = rows[0];
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await requireScope({ tower: 'inv', dept: r.department_id });

    const [attachmentRows, auditRows] = await Promise.all([
      sql`select id, file_name, size_bytes, uploaded_at from inv_attachments where request_id = ${id} order by uploaded_at` as unknown as Promise<
        { id: string; file_name: string; size_bytes: number | null; uploaded_at: string }[]
      >,
      sql`select at, actor_name, action, note from audit_log where entity_type = 'request' and entity_id = ${id} order by at desc` as unknown as Promise<
        { at: string; actor_name: string; action: string; note: string | null }[]
      >,
    ]);

    return NextResponse.json({
      id: r.id,
      ref: r.ref,
      title: r.title,
      deptId: r.department_id,
      dept: r.dept_name,
      initiativeId: r.initiative_id,
      initiative: r.initiative_name,
      type: r.type,
      country: r.country,
      region: r.region,
      amount: Number(r.amount_cents),
      approvedAmount: r.approved_amount_cents == null ? null : Number(r.approved_amount_cents),
      phasing: { Q1: Number(r.phase_q1_cents), Q2: Number(r.phase_q2_cents), Q3: Number(r.phase_q3_cents), Q4: Number(r.phase_q4_cents) },
      expectedReturn: Number(r.expected_return_cents),
      payback: r.payback,
      sponsor: r.sponsor,
      execSponsor: r.exec_sponsor,
      businessCase: r.business_case,
      risk: r.risk,
      status: { value: r.status, ...INV_STATUS[r.status] },
      submittedByName: r.submitted_by_name,
      submittedAt: r.submitted_at,
      screenedByName: r.screened_by_name,
      screenedAt: r.screened_at,
      screenNote: r.screen_note,
      decidedByName: r.decided_by_name,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
      attachments: attachmentRows.map((a) => ({ id: a.id, fileName: a.file_name, sizeBytes: a.size_bytes == null ? null : Number(a.size_bytes), uploadedAt: a.uploaded_at })),
      log: auditRows.map((a) => ({ at: a.at, actorName: a.actor_name, action: a.action, note: a.note })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface PatchBody {
  title?: string;
  initiativeId?: string;
  type?: string;
  country?: string;
  amountCents?: number;
  phasing?: { Q1?: number; Q2?: number; Q3?: number; Q4?: number };
  expectedReturnCents?: number;
  payback?: string;
  sponsor?: string;
  execSponsor?: string;
  businessCase?: string;
  risk?: string;
}

// PATCH /api/inv/requests/:id — editable only while draft or returned. 05-API.md.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = (await req.json().catch(() => ({}))) as PatchBody;

    const sql = db();
    const rows = (await sql`select id, department_id, status from inv_requests where id = ${id}`) as
      { id: string; department_id: string; status: string }[];
    const request = rows[0];
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'inv', dept: request.department_id });

    if (!['draft', 'returned'].includes(request.status)) {
      return NextResponse.json({ error: 'Only a draft or returned request can be edited.' }, { status: 409 });
    }

    const region = body.country ? deriveRegion(body.country) : null;

    await sql`
      update inv_requests set
        title = coalesce(${body.title ?? null}, title),
        initiative_id = coalesce(${body.initiativeId ?? null}, initiative_id),
        type = coalesce(${body.type ?? null}, type),
        country = coalesce(${body.country ?? null}, country),
        region = coalesce(${region}, region),
        amount_cents = coalesce(${body.amountCents ?? null}, amount_cents),
        phase_q1_cents = coalesce(${body.phasing?.Q1 ?? null}, phase_q1_cents),
        phase_q2_cents = coalesce(${body.phasing?.Q2 ?? null}, phase_q2_cents),
        phase_q3_cents = coalesce(${body.phasing?.Q3 ?? null}, phase_q3_cents),
        phase_q4_cents = coalesce(${body.phasing?.Q4 ?? null}, phase_q4_cents),
        expected_return_cents = coalesce(${body.expectedReturnCents ?? null}, expected_return_cents),
        payback = coalesce(${body.payback ?? null}, payback),
        sponsor = coalesce(${body.sponsor ?? null}, sponsor),
        exec_sponsor = coalesce(${body.execSponsor ?? null}, exec_sponsor),
        business_case = coalesce(${body.businessCase ?? null}, business_case),
        risk = coalesce(${body.risk ?? null}, risk)
      where id = ${id}
    `;

    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, payload)
      values (${user.id}, ${user.name}, ${user.role}, 'inv', 'request', ${id}, ${request.department_id}, 'request.update', ${JSON.stringify(body)}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
