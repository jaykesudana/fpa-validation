import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { putBlob } from '@/lib/blob-storage';
import { validatedSubtotal } from '@/lib/calc/vcp';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { encryptField } from '@/lib/crypto/field-crypto';
import { notifyDept } from '@/lib/notify';
import { parseValidationWorkbookBuffer } from '@/lib/workbook/read';
import type { Initiative, ParsedValidationRow } from '@/lib/workbook/types';

function mdyToISODate(mdy: string): string | null {
  const m = mdy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

const MAX_VERSION_ATTEMPTS = 5;

// POST /api/vcp/validations — partner (in-scope) or admin. 05-API.md.
// multipart/form-data: file, deptId, fy.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const deptId = String(form.get('deptId') ?? '');
    const fy = String(form.get('fy') ?? '');

    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (!deptId || !fy) return NextResponse.json({ error: 'deptId and fy are required' }, { status: 400 });

    const { user } = await requireScope({ tower: 'vcp', dept: deptId });
    const sql = db();

    const [baselineRows, initiatives] = await Promise.all([
      sql`
        select id from vcp_uploads
        where fiscal_year_id = ${fy} and department_id = ${deptId} and state = 'locked' and superseded_by is null
      ` as Promise<{ id: string }[]>,
      sql`select id, name from vcp_initiatives where active = true` as Promise<Initiative[]>,
    ]);

    const baseline = baselineRows[0];
    if (!baseline) {
      return NextResponse.json({ error: 'Gate 2 must be approved and locked before a validation version can be uploaded.' }, { status: 409 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseValidationWorkbookBuffer(buffer, initiatives);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, row: parsed.row }, { status: 422 });
    }

    const validatedSubtotalCents = validatedSubtotal(parsed.rows);
    const rowInsertsFor = (validationId: string, rows: readonly ParsedValidationRow[]) =>
      rows.map(
        // ee_id encrypted at rest — same rule as Gate 2's vcp_upload_rows.
        (r) => sql`
          insert into vcp_validation_rows (validation_id, row_no, initiative_id, dept_no, name, category, ee_id, country, frequency, target_date, identified_cents, notes, status, validated_cents, validated_date, status_update)
          values (${validationId}, ${r.rowNo}, ${r.initiativeId}, ${r.deptNo || null}, ${r.name}, ${r.category}, ${r.eeId ? encryptField(r.eeId) : null}, ${r.country || null}, ${r.frequency}, ${mdyToISODate(r.targetDate)}, ${r.identifiedCents}, ${r.notes || null}, ${r.status}, ${r.validatedCents}, ${mdyToISODate(r.validatedDate)}, ${r.statusUpdate || null})
        `,
      );

    // Written once, before the retry loop, so a retry never re-uploads the
    // same bytes under a second key — the DB rows across attempts all point
    // at this one blob regardless of which attempt's version number wins.
    const blobId = randomUUID();
    const storageKey = `vcp/${fy}/${deptId}/validations/${blobId}/${file.name}`;
    await putBlob(storageKey, buffer, file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    let version: number | null = null;
    let validationId: string | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt++) {
      const nextVersionRows = (await sql`
        select coalesce(max(version), 0) + 1 as next_version from vcp_validations
        where fiscal_year_id = ${fy} and department_id = ${deptId}
      `) as { next_version: number }[];
      const candidateVersion = nextVersionRows[0]?.next_version ?? 1;
      const candidateId = randomUUID();

      try {
        await sql.transaction([
          sql`
            insert into vcp_validations (id, fiscal_year_id, department_id, baseline_upload_id, version, file_name, storage_key, row_count, validated_subtotal_cents, state, uploaded_by, uploaded_by_name)
            values (${candidateId}, ${fy}, ${deptId}, ${baseline.id}, ${candidateVersion}, ${file.name}, ${storageKey}, ${parsed.rows.length}, ${validatedSubtotalCents}, 'pending', ${user.id}, ${user.name})
          `,
          ...rowInsertsFor(candidateId, parsed.rows),
          sql`
            insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, to_state, payload)
            values (${user.id}, ${user.name}, ${user.role}, 'vcp', 'validation', ${candidateId}, ${deptId}, 'validation.upload', 'pending', ${JSON.stringify({ fileName: file.name, version: candidateVersion, rowCount: parsed.rows.length })}::jsonb)
          `,
        ]);
        version = candidateVersion;
        validationId = candidateId;
        break;
      } catch (err) {
        lastError = err;
        if (!isUniqueViolation(err)) throw err;
        // Someone else claimed this version number between our SELECT and
        // INSERT — retry with a freshly computed next_version.
      }
    }

    if (version === null || validationId === null) {
      throw lastError instanceof Error ? lastError : new Error('Could not assign a validation version after retrying — please try again.');
    }

    const deptRows = (await sql`select name from departments where id = ${deptId}`) as { name: string }[];
    const deptName = deptRows[0]?.name ?? deptId;

    await notifyDept({
      tower: 'vcp',
      event: 'validation',
      deptId,
      subject: `Validation uploaded — ${deptName} (v${version})`,
      body: `${user.name} uploaded validation version ${version} for ${deptName}. Pending admin approval before it counts toward totals.`,
      linkKind: 'department',
      linkRef: deptId,
    });

    return NextResponse.json(
      {
        validation: {
          id: validationId,
          version,
          fileName: file.name,
          rowCount: parsed.rows.length,
          validatedSubtotal: validatedSubtotalCents,
          state: 'pending',
          uploadedByName: user.name,
          uploadedAt: new Date().toISOString(),
        },
        note: 'Pending admin approval — does not count toward totals yet.',
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
