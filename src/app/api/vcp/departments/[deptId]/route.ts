import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { coverage, deptCurrentIdentified, deptGates, deptIdentifiedTotal, deptTarget, deptValidatedTotal } from '@/lib/calc/vcp';
import { decryptField } from '@/lib/crypto/field-crypto';
import { resolveFiscalYear } from '@/lib/fiscal-year';
import { lineKey, resolveLineOrigin } from '@/lib/vcp/line-origin';
import { loadDepartmentsForCalc } from '@/lib/vcp/load-department';

// Row-level ee_id is decrypted here — and ONLY here, after requireScope has
// already confirmed the caller is an admin or a granted FBP for this dept.
function decryptEeId(stored: string | null): string {
  return stored == null ? '' : decryptField(stored);
}

interface RawLineRow {
  row_no: number;
  initiative_id: string;
  initiative_name: string;
  dept_no: string | null;
  name: string;
  category: string;
  ee_id: string | null;
  country: string | null;
  frequency: string;
  target_date: string | null;
  identified_cents: number;
  notes: string | null;
}

interface RawValidationLineRow extends RawLineRow {
  status: string;
  validated_cents: number;
  validated_date: string | null;
  status_update: string | null;
  baseline_row_id: string | null;
}

// Minimal shape for building each baseline upload's lineKey() set — not
// the same query as uploadLineRows, which only covers the CURRENT baseline;
// a validation's baseline_upload_id can point at an older, since-superseded
// upload, so the key set is built per-upload-id, not per-department.
interface BaselineKeyRow {
  upload_id: string;
  initiative_id: string;
  dept_no: string | null;
  name: string;
  ee_id: string | null;
}

function shapeLineRow(r: RawLineRow) {
  return {
    rowNo: r.row_no,
    initiativeId: r.initiative_id,
    initiativeName: r.initiative_name,
    deptNo: r.dept_no ?? '',
    name: r.name,
    category: r.category,
    eeId: decryptEeId(r.ee_id),
    country: r.country ?? '',
    frequency: r.frequency,
    targetDate: r.target_date ?? '',
    identifiedCents: Number(r.identified_cents),
    notes: r.notes ?? '',
  };
}

export async function GET(req: Request, { params }: { params: { deptId: string } }) {
  try {
    const deptId = params.deptId;
    const { user } = await requireScope({ tower: 'vcp', dept: deptId });

    const url = new URL(req.url);
    const fy = await resolveFiscalYear(url.searchParams.get('fy'));
    if (!fy) return NextResponse.json({ error: 'No current fiscal year configured' }, { status: 400 });

    const sql = db();

    const deptRows = (await sql`select id, name, l1, summary_group from departments where id = ${deptId}`) as
      { id: string; name: string; l1: string; summary_group: string }[];
    const dept = deptRows[0];
    if (!dept) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [targetRows, uploadRows, validationRows, auditRows] = await Promise.all([
      sql`
        select vt.initiative_id, vi.name as initiative_name, vt.target_cents, vt.locked, vt.set_by_name, vt.set_at
        from vcp_targets vt join vcp_initiatives vi on vi.id = vt.initiative_id
        where vt.fiscal_year_id = ${fy} and vt.department_id = ${deptId}
        order by vi.sort_order
      ` as unknown as Promise<{ initiative_id: string; initiative_name: string; target_cents: number; locked: boolean; set_by_name: string | null; set_at: string | null }[]>,
      sql`
        select id, file_name, row_count, state, uploaded_by_name, uploaded_at, approved_by_name, approved_at, reject_note
        from vcp_uploads
        where fiscal_year_id = ${fy} and department_id = ${deptId} and superseded_by is null and state in ('review', 'locked')
        limit 1
      ` as unknown as Promise<{ id: string; file_name: string; row_count: number; state: string; uploaded_by_name: string; uploaded_at: string; approved_by_name: string | null; approved_at: string | null; reject_note: string | null }[]>,
      sql`
        select id, version, file_name, row_count, validated_subtotal_cents, state, uploaded_by_name, uploaded_at, approved_by_name, approved_at, note, baseline_upload_id
        from vcp_validations
        where fiscal_year_id = ${fy} and department_id = ${deptId}
        order by version desc
      ` as unknown as Promise<{ id: string; version: number; file_name: string; row_count: number; validated_subtotal_cents: number; state: string; uploaded_by_name: string; uploaded_at: string; approved_by_name: string | null; approved_at: string | null; note: string | null; baseline_upload_id: string }[]>,
      sql`
        select at, actor_name, action, from_state, to_state, note
        from audit_log where department_id = ${deptId}
        order by at desc limit 200
      ` as unknown as Promise<{ at: string; actor_name: string; action: string; from_state: string | null; to_state: string | null; note: string | null }[]>,
    ]);

    const upload = uploadRows[0];
    const validationIds = validationRows.map((v) => v.id);
    // Every baseline upload that any validation here was built from — not
    // just the current one — so lineOrigin can be resolved correctly even
    // for a validation whose baseline has since been superseded.
    const baselineKeyUploadIds = Array.from(new Set([...(upload ? [upload.id] : []), ...validationRows.map((v) => v.baseline_upload_id)]));

    const [uploadLineRows, evidenceRows, validationLineRows, baselineKeyRows] = await Promise.all([
      upload
        ? (sql`
            select r.row_no, r.initiative_id, vi.name as initiative_name, r.dept_no, r.name, r.category, r.ee_id, r.country, r.frequency, r.target_date, r.identified_cents, r.notes
            from vcp_upload_rows r join vcp_initiatives vi on vi.id = r.initiative_id
            where r.upload_id = ${upload.id}
            order by r.row_no
          ` as unknown as Promise<RawLineRow[]>)
        : Promise.resolve([] as RawLineRow[]),
      upload
        ? (sql`select id, file_name, size_bytes, uploaded_by, uploaded_at from vcp_evidence where upload_id = ${upload.id}` as unknown as Promise<
            { id: string; file_name: string; size_bytes: number | null; uploaded_by: string | null; uploaded_at: string }[]
          >)
        : Promise.resolve([]),
      validationIds.length
        ? (sql`
            select r.validation_id, r.row_no, r.initiative_id, vi.name as initiative_name, r.dept_no, r.name, r.category, r.ee_id, r.country, r.frequency, r.target_date, r.identified_cents, r.notes, r.status, r.validated_cents, r.validated_date, r.status_update, r.baseline_row_id
            from vcp_validation_rows r join vcp_initiatives vi on vi.id = r.initiative_id
            where r.validation_id = any(${validationIds}::uuid[])
            order by r.row_no
          ` as unknown as Promise<(RawValidationLineRow & { validation_id: string })[]>)
        : Promise.resolve([]),
      baselineKeyUploadIds.length
        ? (sql`
            select upload_id, initiative_id, dept_no, name, ee_id
            from vcp_upload_rows
            where upload_id = any(${baselineKeyUploadIds}::uuid[])
          ` as unknown as Promise<BaselineKeyRow[]>)
        : Promise.resolve([] as BaselineKeyRow[]),
    ]);

    const baselineKeysByUploadId = new Map<string, Set<string>>();
    for (const r of baselineKeyRows) {
      const set = baselineKeysByUploadId.get(r.upload_id) ?? new Set<string>();
      set.add(lineKey(r.initiative_id, decryptEeId(r.ee_id), r.dept_no, r.name));
      baselineKeysByUploadId.set(r.upload_id, set);
    }

    const calcDepts = await loadDepartmentsForCalc(fy, [deptId]);
    const cd = calcDepts.get(deptId)!;
    const target = deptTarget(cd);
    const identified = deptIdentifiedTotal(cd);
    const currentIdentified = deptCurrentIdentified(cd);
    const delivered = deptValidatedTotal(cd);

    return NextResponse.json({
      deptId: dept.id,
      name: dept.name,
      l1: dept.l1,
      summaryGroup: dept.summary_group,
      gates: deptGates(cd),
      target,
      identified,
      currentIdentified,
      delivered,
      coverage: coverage(target, delivered),
      initiatives: targetRows.map((t) => ({
        initiativeId: t.initiative_id,
        name: t.initiative_name,
        targetCents: Number(t.target_cents),
        locked: t.locked,
        setByName: t.set_by_name,
        setAt: t.set_at,
      })),
      baseline: upload
        ? {
            id: upload.id,
            fileName: upload.file_name,
            rowCount: upload.row_count,
            state: upload.state,
            uploadedByName: upload.uploaded_by_name,
            uploadedAt: upload.uploaded_at,
            approvedByName: upload.approved_by_name,
            approvedAt: upload.approved_at,
            rejectNote: upload.reject_note,
            rows: uploadLineRows.map(shapeLineRow),
            evidence: evidenceRows.map((e) => ({ id: e.id, fileName: e.file_name, sizeBytes: e.size_bytes == null ? null : Number(e.size_bytes), uploadedAt: e.uploaded_at })),
          }
        : null,
      validations: validationRows.map((v) => {
        const baselineKeys = baselineKeysByUploadId.get(v.baseline_upload_id) ?? new Set<string>();
        return {
          id: v.id,
          version: v.version,
          fileName: v.file_name,
          rowCount: v.row_count,
          validatedSubtotalCents: Number(v.validated_subtotal_cents),
          state: v.state,
          uploadedByName: v.uploaded_by_name,
          uploadedAt: v.uploaded_at,
          approvedByName: v.approved_by_name,
          approvedAt: v.approved_at,
          note: v.note,
          rows: validationLineRows
            .filter((r) => r.validation_id === v.id)
            .map((r) => {
              const shaped = shapeLineRow(r);
              return {
                ...shaped,
                status: r.status,
                validatedCents: Number(r.validated_cents),
                validatedDate: r.validated_date ?? '',
                statusUpdate: r.status_update ?? '',
                lineOrigin: resolveLineOrigin(r.baseline_row_id, r.initiative_id, shaped.eeId, r.dept_no, r.name, baselineKeys),
              };
            }),
        };
      }),
      audit: auditRows.map((a) => ({ at: a.at, actorName: a.actor_name, action: a.action, fromState: a.from_state, toState: a.to_state, note: a.note })),
      viewerRole: user.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
