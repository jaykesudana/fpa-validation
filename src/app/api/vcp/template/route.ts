import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { insertAudit } from '@/lib/audit';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { generateIdentifiedTemplate, workbookToBuffer } from '@/lib/workbook/generate';
import type { Initiative } from '@/lib/workbook/types';

// GET /api/vcp/template?deptId=…&kind=identified — 05-API.md
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const deptId = url.searchParams.get('deptId');
    const kind = url.searchParams.get('kind') ?? 'identified';
    if (!deptId) return NextResponse.json({ error: 'deptId is required' }, { status: 400 });
    if (kind !== 'identified') return NextResponse.json({ error: 'unsupported kind' }, { status: 400 });

    const { user } = await requireScope({ tower: 'vcp', dept: deptId });

    const sql = db();
    const [deptRows, allInitiatives, carriedRows] = await Promise.all([
      sql`select name from departments where id = ${deptId}` as Promise<{ name: string }[]>,
      sql`select id, name from vcp_initiatives where active = true order by sort_order` as Promise<Initiative[]>,
      // "First carried initiative" isn't an explicit column anywhere in the
      // schema — the catalogue's own sort_order is the least-arbitrary stand-in
      // for "the department's first carried initiative" used in the template
      // example rows (02-WORKBOOKS.md §1).
      sql`
        select vi.name
        from vcp_targets vt
        join vcp_initiatives vi on vi.id = vt.initiative_id
        where vt.department_id = ${deptId}
        order by vi.sort_order
        limit 1
      ` as Promise<{ name: string }[]>,
    ]);

    const deptName = deptRows[0]?.name;
    if (!deptName) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { fileName, workbook } = generateIdentifiedTemplate(deptName, allInitiatives, carriedRows[0]?.name);
    const buffer = workbookToBuffer(workbook);

    await insertAudit({
      actor: user,
      tower: 'vcp',
      entityType: 'department',
      entityId: deptId,
      departmentId: deptId,
      action: 'workbook.download',
      note: 'Downloaded the identified template',
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
