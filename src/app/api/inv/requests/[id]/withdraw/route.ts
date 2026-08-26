import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

const PRE_DECISION_STATES = ['draft', 'submitted', 'screened', 'returned'];

// POST /api/inv/requests/:id/withdraw — owner dept partner or admin, from any pre-decision state. 05-API.md.
// No notification event exists for withdraw in INV_EVENT_META — audit only.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const sql = db();

    const rows = (await sql`select id, department_id, status from inv_requests where id = ${id}`) as
      { id: string; department_id: string; status: string }[];
    const request = rows[0];
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'inv', dept: request.department_id });

    if (!PRE_DECISION_STATES.includes(request.status)) {
      return NextResponse.json({ error: 'Only a request that has not yet been decided can be withdrawn.' }, { status: 409 });
    }

    await sql.transaction([
      sql`update inv_requests set status = 'withdrawn' where id = ${id}`,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, from_state, to_state)
        values (${user.id}, ${user.name}, ${user.role}, 'inv', 'request', ${id}, ${request.department_id}, 'request.withdraw', ${request.status}, 'withdrawn')
      `,
    ]);

    return NextResponse.json({ ok: true, status: 'withdrawn' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
