import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getDeptGrants } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

export async function GET() {
  try {
    const { user } = await requireScope();
    const sql = db();

    const [vcpDeptIds, invDeptIds, fyRows, unreadRows] = await Promise.all([
      getDeptGrants(user, 'vcp'),
      getDeptGrants(user, 'inv'),
      sql`select id, label from fiscal_years where is_current = true limit 1` as Promise<{ id: string; label: string }[]>,
      sql`
        select tower, count(*)::int as count
        from notifications
        where recipient_id = ${user.id} and read_at is null
        group by tower
      ` as Promise<{ tower: 'vcp' | 'inv'; count: number }[]>,
    ]);

    const unread = { vcp: 0, inv: 0 };
    for (const row of unreadRows) unread[row.tower] = row.count;

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      displayName: user.role === 'admin' ? `${user.name} (Central FP&A)` : user.name,
      access: { vcp: vcpDeptIds, inv: invDeptIds },
      fiscalYear: fyRows[0] ?? null,
      unread,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
