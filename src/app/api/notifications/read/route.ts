import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { db } from '@/lib/db';

// POST /api/notifications/read — { ids: [] } or { tower, all: true }. 05-API.md.
export async function POST(req: Request) {
  try {
    const { user } = await requireScope();
    const body = (await req.json().catch(() => null)) as { ids?: string[]; tower?: string; all?: boolean } | null;

    const sql = db();

    if (body?.all && body.tower) {
      await sql`update notifications set read_at = now() where recipient_id = ${user.id} and tower = ${body.tower} and read_at is null`;
    } else if (Array.isArray(body?.ids) && body.ids.length > 0) {
      await sql`update notifications set read_at = now() where recipient_id = ${user.id} and id = any(${body.ids}::bigint[]) and read_at is null`;
    } else {
      return NextResponse.json({ error: 'Provide either { ids: [] } or { tower, all: true }' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
