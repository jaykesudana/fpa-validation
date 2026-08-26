import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { decryptField } from '@/lib/crypto/field-crypto';
import { generateValidationWorkbook, workbookToBuffer, type ValidationExportRow } from '@/lib/workbook/generate';
import type { Initiative } from '@/lib/workbook/types';

// GET /api/vcp/validations/:id/export — 05-API.md. .xlsx in the Validation format.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const validationId = params.id;
    const sql = db();

    const rows = (await sql`
      select id, department_id, version from vcp_validations where id = ${validationId}
    `) as { id: string; department_id: string; version: number }[];
    const validation = rows[0];
    if (!validation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'vcp', dept: validation.department_id });

    const [deptRows, allInitiatives, lineRows] = await Promise.all([
      sql`select name from departments where id = ${validation.department_id}` as Promise<{ name: string }[]>,
      sql`select id, name from vcp_initiatives where active = true order by sort_order` as Promise<Initiative[]>,
      sql`
        select r.dept_no, r.name, vi.name as initiative_name, r.category, r.ee_id, r.country, r.frequency, r.target_date, r.identified_cents, r.notes, r.status, r.validated_cents, r.validated_date, r.status_update
        from vcp_validation_rows r join vcp_initiatives vi on vi.id = r.initiative_id
        where r.validation_id = ${validationId}
        order by r.row_no
      ` as Promise<
        {
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
          status: string;
          validated_cents: number;
          validated_date: string | null;
          status_update: string | null;
        }[]
      >,
    ]);

    const deptName = deptRows[0]?.name;
    if (!deptName) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const exportRows: ValidationExportRow[] = lineRows.map((r) => ({
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
      status: r.status,
      validatedDollars: Number(r.validated_cents) / 100,
      validatedDate: r.validated_date ?? '',
      statusUpdate: r.status_update ?? '',
    }));

    const { fileName, workbook } = generateValidationWorkbook(deptName, allInitiatives, exportRows, `v${validation.version}`);
    const buffer = workbookToBuffer(workbook);

    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, note)
      values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'validation', ${validationId}, ${validation.department_id}, 'workbook.download', ${`Downloaded validation v${validation.version}`})
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
