import { NextResponse } from 'next/server';
import { deriveRegion, INV_STATUS, type ReqStatus } from '@/lib/calc/investments';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { resolveFiscalYear } from '@/lib/fiscal-year';
import { DRAFT_LAST_ACTION, loadLastActions } from '@/lib/inv/last-action';

interface RequestRow {
  id: string;
  ref: string;
  title: string;
  department_id: string;
  dept_name: string;
  initiative_id: string | null;
  initiative_name: string | null;
  type: string;
  country: string;
  region: string;
  amount_cents: number;
  approved_amount_cents: number | null;
  status: ReqStatus;
}

// GET /api/inv/requests?fy=…&status=…&dept=…&initiative=…&region=… — 05-API.md.
export async function GET(req: Request) {
  try {
    const { deptIds } = await requireScope({ tower: 'inv' });
    const url = new URL(req.url);
    const fy = await resolveFiscalYear(url.searchParams.get('fy'));
    if (!fy) return NextResponse.json({ error: 'No current fiscal year configured' }, { status: 400 });

    if (deptIds.length === 0) return NextResponse.json({ requests: [] });

    const sql = db();
    const rows = (await sql`
      select r.id, r.ref, r.title, r.department_id, d.name as dept_name, r.initiative_id, ii.name as initiative_name,
             r.type, r.country, r.region, r.amount_cents, r.approved_amount_cents, r.status
      from inv_requests r
      join departments d on d.id = r.department_id
      left join inv_initiatives ii on ii.id = r.initiative_id
      where r.fiscal_year_id = ${fy} and r.department_id = any(${deptIds}::text[])
      order by r.created_at desc
    `) as RequestRow[];

    const statusFilter = url.searchParams.get('status');
    const deptFilter = url.searchParams.get('dept');
    const initiativeFilter = url.searchParams.get('initiative');
    const regionFilter = url.searchParams.get('region');

    const filtered = rows.filter(
      (r) =>
        (!statusFilter || r.status === statusFilter) &&
        (!deptFilter || r.department_id === deptFilter) &&
        (!initiativeFilter || r.initiative_id === initiativeFilter) &&
        (!regionFilter || r.region === regionFilter),
    );

    const lastActions = await loadLastActions(filtered.map((r) => r.id));

    const requests = filtered.map((r) => ({
      id: r.id,
      ref: r.ref,
      title: r.title,
      dept: r.dept_name,
      deptId: r.department_id,
      initiative: r.initiative_name,
      type: r.type,
      country: r.country,
      region: r.region,
      amount: Number(r.amount_cents),
      approvedAmount: r.approved_amount_cents == null ? null : Number(r.approved_amount_cents),
      status: { value: r.status, ...INV_STATUS[r.status] },
      lastAction: lastActions.get(r.id) ?? DRAFT_LAST_ACTION,
    }));

    return NextResponse.json({ requests });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/inv/requests — partner (in-scope) or admin. Creates a draft. 05-API.md.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { fy?: string; title?: string; deptId?: string; initiativeId?: string; type?: string; country?: string }
      | null;
    const fy = body?.fy;
    const deptId = body?.deptId;
    if (!fy || !deptId) return NextResponse.json({ error: 'fy and deptId are required' }, { status: 400 });

    const { user } = await requireScope({ tower: 'inv', dept: deptId });
    const sql = db();

    const country = body?.country || 'United States';
    const region = deriveRegion(country); // always derived server-side — never trust a client value

    const refRows = (await sql`select nextval('inv_request_ref_seq') as n`) as { n: number }[];
    const ref = `INV-${String(refRows[0]!.n).padStart(3, '0')}`;

    const inserted = (await sql`
      insert into inv_requests (ref, fiscal_year_id, title, department_id, initiative_id, type, country, region, status, created_by)
      values (${ref}, ${fy}, ${body?.title || ''}, ${deptId}, ${body?.initiativeId || null}, ${body?.type || 'Headcount'}, ${country}, ${region}, 'draft', ${user.id})
      returning id
    `) as { id: string }[];
    const id = inserted[0]!.id;

    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, to_state)
      values (${user.id}, ${user.name}, ${user.role}, 'inv', 'request', ${id}, ${deptId}, 'request.create', 'draft')
    `;

    return NextResponse.json({ id, ref, status: 'draft' }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
