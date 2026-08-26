// 02-WORKBOOKS.md §5 "Parsing rules", ported faithfully — including the exact
// error message strings a finance user sees in the upload-rejected toast.

import { CATEGORIES, COUNTRIES, FREQUENCIES, LINE_STATUSES } from './constants';
import { mapHeaders, type FieldKey } from './header-alias';
import { normalizeDate, parseAmountCents } from './normalize';
import type { Initiative, ParsedIdentifiedRow, ParsedValidationRow, ParseFail, ParseResult } from './types';

function isBlankRow(row: unknown[] | undefined): boolean {
  if (!row) return true;
  return row.every((c) => c == null || String(c).trim() === '');
}

export interface SheetRecord {
  rowNo: number; // 1-based, matches the row number a user sees in Excel
  cells: unknown[];
}

/** §5 "Row and header handling": drop blank rows, first survivor is the header row. */
export function rowsFromAOA(aoa: readonly unknown[][]): { headers: string[]; records: SheetRecord[] } {
  let headerIdx = -1;
  for (let i = 0; i < aoa.length; i++) {
    if (!isBlankRow(aoa[i] as unknown[])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { headers: [], records: [] };

  const headers = (aoa[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  const records: SheetRecord[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[] | undefined;
    if (isBlankRow(row)) continue;
    records.push({ rowNo: i + 1, cells: row ?? [] });
  }
  return { headers, records };
}

/** Trim + case-insensitive match against an allowed list, canonicalised to the list's own casing.
 * Blank is valid-and-empty; a non-blank unmatched value returns null (reject). */
function canonicalize(value: string, allowed: readonly string[]): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const match = allowed.find((a) => a.toLowerCase() === trimmed.toLowerCase());
  return match ?? null;
}

function resolveInitiative(value: string, initiatives: readonly Initiative[]): Initiative | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return initiatives.find((i) => i.name.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

function rowLabel(rowNo: number, name: string): string {
  return `Row ${rowNo} (${name.trim() || '—'})`;
}

function checkDuplicateEeId(seen: Map<string, string>, eeId: string, name: string, rowNo: number): ParseFail | null {
  if (!eeId || eeId === '-') return null;
  const prior = seen.get(eeId);
  if (prior !== undefined) {
    return {
      ok: false,
      error: `EE ID ${eeId} (${name || prior}) appears more than once — a person can only be counted in one initiative. Fix the duplicate.`,
      row: rowNo,
    };
  }
  seen.set(eeId, name);
  return null;
}

interface CommonParsed {
  initiative: Initiative;
  deptNo: string;
  name: string;
  category: string;
  eeId: string;
  country: string;
  frequency: 'Run rate' | 'One-time';
  targetDate: string;
  identifiedCents: number;
  notes: string;
}

type CommonRowResult = { kind: 'skip' } | { kind: 'error'; error: string } | { kind: 'ok'; value: CommonParsed };

/** Columns 1–10, shared by the Identified and Validation workbooks. */
function parseCommonRow(cellByField: Partial<Record<FieldKey, unknown>>, rowNo: number, initiatives: readonly Initiative[]): CommonRowResult {
  const raw = (key: FieldKey) => String(cellByField[key] ?? '').trim();

  const nameRaw = raw('name');
  const identifiedRaw = cellByField['identifiedAmount'];
  const hasName = nameRaw !== '';
  const hasAmount = identifiedRaw != null && String(identifiedRaw).trim() !== '';
  if (!hasName && !hasAmount) return { kind: 'skip' };

  const label = () => rowLabel(rowNo, nameRaw);

  const initiativeRaw = raw('initiative');
  const initiative = resolveInitiative(initiativeRaw, initiatives);
  if (!initiative) {
    if (!initiativeRaw) return { kind: 'error', error: `${label()}: initiative is required.` };
    return { kind: 'error', error: `${label()}: initiative "${initiativeRaw}" is not an allowed value.` };
  }

  const categoryRaw = raw('category');
  const category = canonicalize(categoryRaw, CATEGORIES);
  if (category === null) {
    return { kind: 'error', error: `${label()}: category "${categoryRaw}" is not an allowed value.` };
  }

  const frequencyRaw = raw('frequency');
  const frequencyCanon = canonicalize(frequencyRaw, FREQUENCIES);
  if (frequencyCanon === null) {
    return { kind: 'error', error: `${label()}: frequency "${frequencyRaw}" must be Run rate or One-time.` };
  }
  const frequency = (frequencyCanon || 'Run rate') as 'Run rate' | 'One-time';

  const countryRaw = raw('country');
  const country = canonicalize(countryRaw, COUNTRIES);
  if (country === null) {
    return { kind: 'error', error: `${label()}: country "${countryRaw}" is not an allowed value.` };
  }

  return {
    kind: 'ok',
    value: {
      initiative,
      deptNo: raw('deptNo'),
      name: nameRaw,
      category,
      eeId: raw('eeId'),
      country,
      frequency,
      targetDate: normalizeDate(cellByField['targetDate']),
      identifiedCents: parseAmountCents(identifiedRaw),
      notes: raw('notes'),
    },
  };
}

function cellsByField(record: SheetRecord, fieldMap: Record<number, FieldKey>): Partial<Record<FieldKey, unknown>> {
  const out: Partial<Record<FieldKey, unknown>> = {};
  Object.entries(fieldMap).forEach(([idxStr, field]) => {
    out[field] = record.cells[Number(idxStr)];
  });
  return out;
}

const NO_LINE_ITEMS = 'No line items found — check the column headers match the template.';

export function parseIdentifiedRows(aoa: readonly unknown[][], initiatives: readonly Initiative[]): ParseResult<ParsedIdentifiedRow> {
  const { headers, records } = rowsFromAOA(aoa);
  const fieldMap = mapHeaders(headers, 2);

  const rows: ParsedIdentifiedRow[] = [];
  const seenEeIds = new Map<string, string>();

  for (const record of records) {
    const cellByField = cellsByField(record, fieldMap);
    const common = parseCommonRow(cellByField, record.rowNo, initiatives);
    if (common.kind === 'skip') continue;
    if (common.kind === 'error') return { ok: false, error: common.error, row: record.rowNo };

    const dup = checkDuplicateEeId(seenEeIds, common.value.eeId, common.value.name, record.rowNo);
    if (dup) return dup;

    const { initiative, ...rest } = common.value;
    rows.push({ rowNo: record.rowNo, initiativeId: initiative.id, initiativeName: initiative.name, ...rest });
  }

  if (rows.length === 0) return { ok: false, error: NO_LINE_ITEMS };
  return { ok: true, rows };
}

export function parseValidationRows(aoa: readonly unknown[][], initiatives: readonly Initiative[]): ParseResult<ParsedValidationRow> {
  const { headers, records } = rowsFromAOA(aoa);
  const fieldMap = mapHeaders(headers, 3);

  const rows: ParsedValidationRow[] = [];
  const seenEeIds = new Map<string, string>();

  for (const record of records) {
    const cellByField = cellsByField(record, fieldMap);
    const common = parseCommonRow(cellByField, record.rowNo, initiatives);
    if (common.kind === 'skip') continue;
    if (common.kind === 'error') return { ok: false, error: common.error, row: record.rowNo };

    const nameRaw = common.value.name;
    const statusRaw = String(cellByField['status'] ?? '').trim();
    const statusCanon = canonicalize(statusRaw, LINE_STATUSES);
    if (statusCanon === null) {
      return {
        ok: false,
        error: `${rowLabel(record.rowNo, nameRaw)}: status "${statusRaw}" must be Identified, Confirmed or Not confirmed.`,
        row: record.rowNo,
      };
    }
    const status = (statusCanon || 'Identified') as 'Identified' | 'Confirmed' | 'Not confirmed';

    const dup = checkDuplicateEeId(seenEeIds, common.value.eeId, common.value.name, record.rowNo);
    if (dup) return dup;

    const { initiative, ...rest } = common.value;
    rows.push({
      rowNo: record.rowNo,
      initiativeId: initiative.id,
      initiativeName: initiative.name,
      ...rest,
      status,
      validatedCents: parseAmountCents(cellByField['validatedAmount']),
      validatedDate: normalizeDate(cellByField['validatedDate']),
      statusUpdate: String(cellByField['statusUpdate'] ?? '').trim(),
    });
  }

  if (rows.length === 0) return { ok: false, error: NO_LINE_ITEMS };
  return { ok: true, rows };
}
