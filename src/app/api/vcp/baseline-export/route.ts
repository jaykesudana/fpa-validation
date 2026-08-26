import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { decryptField } from '@/lib/crypto/field-crypto';
import { resolveFiscalYear } from '@/lib/fiscal-year';
import { generateValidationWorkbook, workbookToBuffer, type ValidationExportRow } from '@/lib/workbook/generate';
import type { Initiative } from '@/lib/workbook/types';

// GET /api/vcp/baseline-export?deptId=…&fy=… — 05-API.md.
// The locked baseline extended with Status (pre-filled "Identified"),
// Validated Amount / Date, Status Update — all blank. 409 if not locked.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const deptId = url.searchParams.get('deptId');
    if (!deptId) return NextResponse.json({ error: 'deptId is required' }, { status: 400 });

    const { user } = await requireScope({ tower: 'vcp', dept: deptId });
    const fy = await resolveFiscalYear(url.searchParams.get('fy'));
    if (!fy) return NextResponse.json({ error: 'No current fiscal year configured' }, { status: 400 });

    const sql = db();

    const [deptRows, uploadRows, allInitiatives] = await Promise.all([
      sql`select name from departments where id = ${deptId}` as Promise<{ name: string }[]>,
      sql`
        select id from vcp_uploads
        where fiscal_year_id = ${fy} and department_id = ${deptId} and state = 'locked' and superseded_by is null
      ` as Promise<{ id: string }[]>,
      sql`select id, name from vcp_initiatives where active = true order by sort_order` as Promise<Initiative[]>,
    ]);

    const deptName = deptRows[0]?.name;
    if (!deptName) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const upload = uploadRows[0];
    if (!upload) {
      return NextResponse.json({ error: 'Gate 2 must be approved and locked before the validation baseline can be downloaded.' }, { status: 409 });
    }

    const baseRows = (await sql`
      select r.dept_no, r.name, vi.name as initiative_name, r.category, r.ee_id, r.country, r.frequency, r.target_date, r.identified_cents, r.notes
      from vcp_upload_rows r join vcp_initiatives vi on vi.id = r.initiative_id
      where r.upload_id = ${upload.id}
      order by r.row_no
    `) as {
      dept_no: string | null;
      name: string;
      initiative_name: string;
      category: string;
      ee_id: string | null;
      country: string | null;
      frequency: string;
      target_date: string | null;
      identified_cents: number;
      notes: string | null;
    }[];

    const rows: ValidationExportRow[] = baseRows.map((r) => ({
      initiativeName: r.initiative_name,
      deptNo: r.dept_no ?? '',
      name: r.name,
      category: r.category,
      eeId: r.ee_id == null ? '' : decryptField(r.ee_id),
      country: r.country ?? '',
      frequency: r.frequency,
      targetDate: r.target_date ?? '',
      identifiedDollars: Number(r.identified_cents) / 100,
      notes: r.notes ?? '',
      status: 'Identified',
      validatedDollars: '',
      validatedDate: '',
      statusUpdate: '',
    }));

    const { fileName, workbook } = generateValidationWorkbook(deptName, allInitiatives, rows, 'baseline');
    const buffer = workbookToBuffer(workbook);

    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, note)
      values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'upload', ${upload.id}, ${deptId}, 'workbook.download', 'Downloaded the validation baseline')
    `;

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
