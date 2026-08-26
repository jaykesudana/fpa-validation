import { db } from '@/lib/db';
import type { Department, Frequency, LineStatus, ValidationState } from '@/lib/calc/vcp';

interface TargetRow {
  department_id: string;
  initiative_id: string;
  target_cents: number;
  locked: boolean;
}

interface UploadRow {
  id: string;
  department_id: string;
  state: 'review' | 'locked' | 'rejected';
}

interface ValidationRowMeta {
  id: string;
  department_id: string;
  version: number;
  state: ValidationState;
  validated_subtotal_cents: number;
}

interface LineRowRaw {
  parent_id: string; // upload_id or validation_id, aliased the same for reuse below
  initiative_id: string;
  category: string;
  frequency: Frequency;
  identified_cents: number;
}

interface ValidationLineRowRaw extends LineRowRaw {
  status: LineStatus;
  validated_cents: number;
}

/**
 * Maps the Neon rows for a set of departments into the shape vcp.ts's calc
 * functions expect. Fetches by department id in bulk (not one query per
 * department) — fine at this tower's scale; the Summary tower gets the
 * single-round-trip SQL views instead (06-ARCHITECTURE-NETLIFY-NEON.md
 * "Performance notes").
 */
export async function loadDepartmentsForCalc(fy: string, deptIds: readonly string[]): Promise<Map<string, Department>> {
  const result = new Map<string, Department>();
  if (deptIds.length === 0) return result;

  const sql = db();
  const ids = [...deptIds];

  const [targets, uploads, validations] = await Promise.all([
    sql`
      select department_id, initiative_id, target_cents, locked
      from vcp_targets
      where fiscal_year_id = ${fy} and department_id = any(${ids}::text[])
    ` as unknown as Promise<TargetRow[]>,
    sql`
      select id, department_id, state
      from vcp_uploads
      where fiscal_year_id = ${fy} and department_id = any(${ids}::text[])
        and superseded_by is null and state in ('review', 'locked')
    ` as unknown as Promise<UploadRow[]>,
    sql`
      select id, department_id, version, state, validated_subtotal_cents
      from vcp_validations
      where fiscal_year_id = ${fy} and department_id = any(${ids}::text[])
      order by department_id, version
    ` as unknown as Promise<ValidationRowMeta[]>,
  ]);

  const uploadIds = uploads.map((u) => u.id);
  const validationIds = validations.map((v) => v.id);

  const [baselineLineRows, validationLineRows] = await Promise.all([
    uploadIds.length
      ? (sql`
          select upload_id as parent_id, initiative_id, category, frequency, identified_cents
          from vcp_upload_rows
          where upload_id = any(${uploadIds}::uuid[])
        ` as unknown as Promise<LineRowRaw[]>)
      : Promise.resolve([] as LineRowRaw[]),
    validationIds.length
      ? (sql`
          select validation_id as parent_id, initiative_id, category, frequency, identified_cents, status, validated_cents
          from vcp_validation_rows
          where validation_id = any(${validationIds}::uuid[])
        ` as unknown as Promise<ValidationLineRowRaw[]>)
      : Promise.resolve([] as ValidationLineRowRaw[]),
  ]);

  for (const deptId of ids) {
    const deptTargets = targets
      .filter((t) => t.department_id === deptId)
      .map((t) => ({ initiativeId: t.initiative_id, targetCents: Number(t.target_cents), locked: t.locked }));

    const upload = uploads.find((u) => u.department_id === deptId);
    const baselineRows = upload
      ? baselineLineRows
          .filter((r) => r.parent_id === upload.id)
          .map((r) => ({ initiativeId: r.initiative_id, category: r.category, frequency: r.frequency, identifiedCents: Number(r.identified_cents) }))
      : [];

    const deptValidations = validations
      .filter((v) => v.department_id === deptId)
      .map((v) => ({
        version: v.version,
        status: v.state,
        validatedSubtotalCents: Number(v.validated_subtotal_cents),
        rows: validationLineRows
          .filter((r) => r.parent_id === v.id)
          .map((r) => ({
            initiativeId: r.initiative_id,
            category: r.category,
            frequency: r.frequency,
            identifiedCents: Number(r.identified_cents),
            status: r.status,
            validatedCents: Number(r.validated_cents),
          })),
      }));

    result.set(deptId, {
      initiatives: deptTargets,
      baseline: upload ? { locked: upload.state === 'locked', rows: baselineRows } : null,
      validations: deptValidations,
    });
  }

  return result;
}
