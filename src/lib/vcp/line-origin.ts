// Shared between the admin Line Items view (api/vcp/line-items) and the
// per-department Gate 3 "View rows" preview (api/vcp/departments/[deptId])
// so a validation row's baseline/added tag can never disagree between the
// two — both call resolveLineOrigin with the same inputs.
//
// Migration 0004: validations uploaded from a workbook with the "Row ID (do
// not edit)" column carry an EXACT baseline_row_id — a real FK to the
// vcp_upload_rows this line was pre-filled from, validated at upload time.
// That's authoritative whenever it's set; the heuristic below only covers
// validations uploaded before that column existed (baseline_row_id is null
// for every row on those) and genuinely hand-typed new rows.
//
// A "line" has no stable id across baseline → validation for those older
// rows — vcp_validation_rows only carries a validation_id and a row_no (a
// position, not an identity), so there's no foreign key to match against
// directly. Priority: (1) EE ID — the field that specifically identifies an
// individual employee, the most reliable signal for "is this the same
// person" and the reason this was re-checked: Dept # alone false-matched a
// new row against an existing baseline row (almost certainly a
// reused/copied Dept #); (2) Dept #, for non-headcount lines (vendor, etc.)
// that don't carry an EE ID; (3) initiative + normalized name, for rows
// with neither filled in.
export function lineKey(initiativeId: string, eeId: string, deptNo: string | null, name: string): string {
  const trimmedEeId = eeId.trim();
  if (trimmedEeId && trimmedEeId !== '-') return `ee::${initiativeId}::${trimmedEeId}`;
  const trimmedDeptNo = deptNo?.trim();
  if (trimmedDeptNo) return `deptno::${initiativeId}::${trimmedDeptNo}`;
  return `name::${initiativeId}::${name.trim().toLowerCase()}`;
}

// Exact match (validated against the real baseline at upload time — see
// validations/route.ts) wins outright; only fall back to the heuristic
// when no Row ID was captured for this row.
export function resolveLineOrigin(
  baselineRowId: string | null,
  initiativeId: string,
  eeId: string,
  deptNo: string | null,
  name: string,
  baselineKeys: Set<string>,
): 'baseline' | 'added' {
  if (baselineRowId != null) return 'baseline';
  return baselineKeys.has(lineKey(initiativeId, eeId, deptNo, name)) ? 'baseline' : 'added';
}
