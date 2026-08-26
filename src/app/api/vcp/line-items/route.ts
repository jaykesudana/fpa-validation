import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { decryptField } from '@/lib/crypto/field-crypto';
import { resolveFiscalYear } from '@/lib/fiscal-year';

interface DeptRow {
  id: string;
  name: string;
}
interface UploadRow {
  id: string;
  department_id: string;
  file_name: string;
  state: string;
  uploaded_by_name: string;
  uploaded_at: string;
}
interface ValidationMetaRow {
  id: string;
  department_id: string;
  version: number;
  state: string;
  file_name: string;
  uploaded_by_name: string;
  uploaded_at: string;
}
interface RawRow {
  parent_id: string;
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
interface RawValidationRow extends RawRow {
  status: string;
  validated_cents: number;
  validated_date: string | null;
  status_update: string | null;
}

// GET /api/vcp/line-items?fy=… — admin only. Not in 05-API.md; added per a
// follow-up request for an org-wide, row-level oversight view: "the exact
// names and lines from a department's Excel templates, consolidated across
// the org." For each department, shows whichever is the most recently
// uploaded source of line items — the latest validation version if one
// exists (labelled with its version number and approval state, whatever
// that state is), else the current Gate 2 baseline (labelled "Baseline").
export async function GET(req: Request) {
  try {
    const { user } = await requireScope({ role: 'admin' });
    const url = new URL(req.url);
    const fy = await resolveFiscalYear(url.searchParams.get('fy'));
    if (!fy) return NextResponse.json({ error: 'No current fiscal year configured' }, { status: 400 });

    const sql = db();

    const [depts, uploads, validationMeta] = await Promise.all([
      sql`select id, name from departments where active = true order by sort_order` as unknown as Promise<DeptRow[]>,
      sql`
        select id, department_id, file_name, state, uploaded_by_name, uploaded_at
        from vcp_uploads
        where fiscal_year_id = ${fy} and superseded_by is null and state in ('review', 'locked')
      ` as unknown as Promise<UploadRow[]>,
      sql`
        select id, department_id, version, state, file_name, uploaded_by_name, uploaded_at
        from vcp_validations
        where fiscal_year_id = ${fy}
        order by department_id, version
      ` as unknown as Promise<ValidationMetaRow[]>,
    ]);

    // Pick the latest-by-version validation per department, regardless of
    // its approval state — "last uploaded version" means literally that.
    const latestValidationByDept = new Map<string, ValidationMetaRow>();
    for (const v of validationMeta) {
      const current = latestValidationByDept.get(v.department_id);
      if (!current || v.version > current.version) latestValidationByDept.set(v.department_id, v);
    }
    const uploadByDept = new Map(uploads.map((u) => [u.department_id, u]));

    const validationIdsNeeded = Array.from(latestValidationByDept.values()).map((v) => v.id);
    const deptsUsingBaseline = depts.filter((d) => !latestValidationByDept.has(d.id) && uploadByDept.has(d.id));
    const uploadIdsNeeded = deptsUsingBaseline.map((d) => uploadByDept.get(d.id)!.id);

    const [validationRows, baselineRows] = await Promise.all([
      validationIdsNeeded.length
        ? (sql`
            select r.validation_id as parent_id, r.row_no, r.initiative_id, vi.name as initiative_name, r.dept_no, r.name, r.category,
                   r.ee_id, r.country, r.frequency, r.target_date, r.identified_cents, r.notes, r.status, r.validated_cents, r.validated_date, r.status_update
            from vcp_validation_rows r join vcp_initiatives vi on vi.id = r.initiative_id
            where r.validation_id = any(${validationIdsNeeded}::uuid[])
          ` as unknown as Promise<RawValidationRow[]>)
        : Promise.resolve([] as RawValidationRow[]),
      uploadIdsNeeded.length
        ? (sql`
            select r.upload_id as parent_id, r.row_no, r.initiative_id, vi.name as initiative_name, r.dept_no, r.name, r.category,
                   r.ee_id, r.country, r.frequency, r.target_date, r.identified_cents, r.notes
            from vcp_upload_rows r join vcp_initiatives vi on vi.id = r.initiative_id
            where r.upload_id = any(${uploadIdsNeeded}::uuid[])
          ` as unknown as Promise<RawRow[]>)
        : Promise.resolve([] as RawRow[]),
    ]);

    const deptNameById = new Map(depts.map((d) => [d.id, d.name]));

    const fromValidation = Array.from(latestValidationByDept.entries()).flatMap(([deptId, v]) =>
      validationRows
        .filter((r) => r.parent_id === v.id)
        .map((r) => ({
          departmentId: deptId,
          departmentName: deptNameById.get(deptId) ?? deptId,
          version: `v${v.version}`,
          versionState: v.state,
          sourceFileName: v.file_name,
          uploadedByName: v.uploaded_by_name,
          uploadedAt: v.uploaded_at,
          rowNo: r.row_no,
          initiativeId: r.initiative_id,
          initiativeName: r.initiative_name,
          deptNo: r.dept_no ?? '',
          name: r.name,
          category: r.category,
          eeId: r.ee_id == null ? '' : decryptField(r.ee_id),
          country: r.country ?? '',
          frequency: r.frequency,
          targetDate: r.target_date ?? '',
          identifiedCents: Number(r.identified_cents),
          notes: r.notes ?? '',
          status: r.status,
          validatedCents: Number(r.validated_cents),
          validatedDate: r.validated_date ?? '',
          statusUpdate: r.status_update ?? '',
        })),
    );

    const fromBaseline = deptsUsingBaseline.flatMap((d) => {
      const upload = uploadByDept.get(d.id)!;
      return baselineRows
        .filter((r) => r.parent_id === upload.id)
        .map((r) => ({
          departmentId: d.id,
          departmentName: d.name,
          version: 'Baseline',
          versionState: upload.state,
          sourceFileName: upload.file_name,
          uploadedByName: upload.uploaded_by_name,
          uploadedAt: upload.uploaded_at,
          rowNo: r.row_no,
          initiativeId: r.initiative_id,
          initiativeName: r.initiative_name,
          deptNo: r.dept_no ?? '',
          name: r.name,
          category: r.category,
          eeId: r.ee_id == null ? '' : decryptField(r.ee_id),
          country: r.country ?? '',
          frequency: r.frequency,
          targetDate: r.target_date ?? '',
          identifiedCents: Number(r.identified_cents),
          notes: r.notes ?? '',
          status: null as string | null,
          validatedCents: null as number | null,
          validatedDate: null as string | null,
          statusUpdate: null as string | null,
        }));
    });

    const lineItems = [...fromValidation, ...fromBaseline].sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.rowNo - b.rowNo);

    return NextResponse.json({ fiscalYear: fy, lineItems, viewerName: user.name });
  } catch (err) {
    return toErrorResponse(err);
  }
}
