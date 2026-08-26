import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { putBlob } from '@/lib/blob-storage';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { bucketRows } from '@/lib/calc/vcp';
import { encryptField } from '@/lib/crypto/field-crypto';
import { parseIdentifiedWorkbookBuffer } from '@/lib/workbook/read';
import type { Initiative } from '@/lib/workbook/types';

/** target_date is a real `date` column — an unparseable original string (left
 * passed-through by normalizeDate) simply can't be represented and becomes null. */
function mdyToISODate(mdy: string): string | null {
  const m = mdy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// POST /api/vcp/uploads — 05-API.md. multipart/form-data: file, deptId, fy.
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

    const [existingLocked, priorReview, initiatives] = await Promise.all([
      sql`
        select id from vcp_uploads
        where fiscal_year_id = ${fy} and department_id = ${deptId} and state = 'locked' and superseded_by is null
      ` as unknown as Promise<{ id: string }[]>,
      sql`
        select id from vcp_uploads
        where fiscal_year_id = ${fy} and department_id = ${deptId} and state = 'review' and superseded_by is null
      ` as unknown as Promise<{ id: string }[]>,
      sql`select id, name from vcp_initiatives where active = true` as unknown as Promise<Initiative[]>,
    ]);

    if (existingLocked.length > 0) {
      return NextResponse.json(
        { error: 'A locked baseline already exists for this department — an admin must reject it before a new one can be uploaded.' },
        { status: 409 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseIdentifiedWorkbookBuffer(buffer, initiatives);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, row: parsed.row }, { status: 422 });
    }

    const uploadId = randomUUID();
    // Blob key convention per 06-ARCHITECTURE-NETLIFY-NEON.md "File storage rules".
    const storageKey = `vcp/${fy}/${deptId}/${uploadId}/${file.name}`;
    await putBlob(storageKey, buffer, file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const rowInserts = parsed.rows.map(
      // ee_id is encrypted at rest (see src/lib/crypto/field-crypto.ts) — it's
      // the one column that's a direct employee identifier. Everything else
      // in the row is stored as parsed, per the user's scoping decision.
      (r) => sql`
        insert into vcp_upload_rows (upload_id, row_no, initiative_id, dept_no, name, category, ee_id, country, frequency, target_date, identified_cents, notes)
        values (${uploadId}, ${r.rowNo}, ${r.initiativeId}, ${r.deptNo || null}, ${r.name}, ${r.category}, ${r.eeId ? encryptField(r.eeId) : null}, ${r.country || null}, ${r.frequency}, ${mdyToISODate(r.targetDate)}, ${r.identifiedCents}, ${r.notes || null})
      `,
    );

    // A partner re-uploading while still in review replaces the pending file —
    // supersede it rather than leaving two 'review' rows for the department.
    const supersedePrior = priorReview[0]
      ? [sql`update vcp_uploads set superseded_by = ${uploadId} where id = ${priorReview[0].id}`]
      : [];

    await sql.transaction([
      sql`
        insert into vcp_uploads (id, fiscal_year_id, department_id, file_name, storage_key, row_count, state, uploaded_by, uploaded_by_name)
        values (${uploadId}, ${fy}, ${deptId}, ${file.name}, ${storageKey}, ${parsed.rows.length}, 'review', ${user.id}, ${user.name})
      `,
      ...rowInserts,
      ...supersedePrior,
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, to_state, payload)
        values (
          ${user.id}, ${user.name}, ${user.role}, 'vcp', 'upload', ${uploadId}, ${deptId},
          ${priorReview[0] ? 'baseline.reupload' : 'baseline.upload'}, 'review',
          ${JSON.stringify({ fileName: file.name, rowCount: parsed.rows.length })}::jsonb
        )
      `,
    ]);

    const rollup = bucketRows(parsed.rows);
    const groups = new Map<string, typeof parsed.rows>();
    for (const r of parsed.rows) {
      const list = groups.get(r.initiativeId) ?? [];
      list.push(r);
      groups.set(r.initiativeId, list);
    }
    const byInitiative = Array.from(groups.entries()).map(([initiativeId, rows]) => ({
      initiativeId,
      netPL: bucketRows(rows).netPLCents,
    }));

    return NextResponse.json(
      {
        upload: {
          id: uploadId,
          fileName: file.name,
          rowCount: parsed.rows.length,
          state: 'review',
          uploadedByName: user.name,
          uploadedAt: new Date().toISOString(),
        },
        rollup: { gross: rollup.grossCents, reinvest: rollup.reinvestCents, oneTime: rollup.oneTimeCents, netPL: rollup.netPLCents },
        byInitiative,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
