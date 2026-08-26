import * as XLSX from 'xlsx';
import { parseIdentifiedRows, parseValidationRows } from './parse';
import type { Initiative, ParsedIdentifiedRow, ParsedValidationRow, ParseResult } from './types';

const READ_FAILURE = 'Could not read that file. Use the Excel/CSV template.';

/** Reads the named sheet if present, else the first sheet — covers CSV, which has no sheet name to match. */
function bufferToAOA(buffer: Buffer | ArrayBuffer, preferredSheetName: string): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const name = wb.Sheets[preferredSheetName] ? preferredSheetName : wb.SheetNames[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws) throw new Error('workbook has no sheets');
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];
}

export function parseIdentifiedWorkbookBuffer(buffer: Buffer | ArrayBuffer, initiatives: readonly Initiative[]): ParseResult<ParsedIdentifiedRow> {
  let aoa: unknown[][];
  try {
    aoa = bufferToAOA(buffer, 'Identified');
  } catch {
    return { ok: false, error: READ_FAILURE };
  }
  return parseIdentifiedRows(aoa, initiatives);
}

export function parseValidationWorkbookBuffer(buffer: Buffer | ArrayBuffer, initiatives: readonly Initiative[]): ParseResult<ParsedValidationRow> {
  let aoa: unknown[][];
  try {
    aoa = bufferToAOA(buffer, 'Validation');
  } catch {
    return { ok: false, error: READ_FAILURE };
  }
  return parseValidationRows(aoa, initiatives);
}
