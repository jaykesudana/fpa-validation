// 02-WORKBOOKS.md §1–3: template + export generation, both sharing the
// "Allowed values" sheet so Excel users can see (and eventually data-validate
// against) the legal entries.

import * as XLSX from 'xlsx';
import {
  ALLOWED_VALUES_COLUMN_WIDTHS,
  CATEGORIES,
  COUNTRIES,
  FREQUENCIES,
  IDENTIFIED_COLUMN_WIDTHS,
  IDENTIFIED_HEADERS,
  LINE_STATUSES,
  VALIDATION_COLUMN_WIDTHS,
  VALIDATION_EXTRA_HEADERS,
} from './constants';
import type { Initiative } from './types';

function slugForFilename(departmentName: string): string {
  return departmentName.replace(/\W+/g, '_');
}

function applyColumnWidths(ws: XLSX.WorkSheet, widths: readonly number[]): void {
  ws['!cols'] = widths.map((w) => ({ wch: w }));
}

function allowedValuesSheet(initiatives: readonly Initiative[]): XLSX.WorkSheet {
  const columns: string[][] = [
    ['Initiative', ...initiatives.map((i) => i.name)],
    ['Category', ...CATEGORIES],
    ['Frequency', ...FREQUENCIES],
    ['Status', ...LINE_STATUSES],
    ['Country', ...COUNTRIES],
  ];
  const maxLen = Math.max(...columns.map((c) => c.length));
  const aoa: string[][] = [];
  for (let r = 0; r < maxLen; r++) {
    aoa.push(columns.map((c) => c[r] ?? ''));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyColumnWidths(ws, ALLOWED_VALUES_COLUMN_WIDTHS);
  return ws;
}

export interface GeneratedWorkbook {
  fileName: string;
  workbook: XLSX.WorkBook;
}

/** §1 template — two example rows the user is told to delete. */
export function generateIdentifiedTemplate(
  departmentName: string,
  allInitiatives: readonly Initiative[],
  firstCarriedInitiativeName?: string,
): GeneratedWorkbook {
  const firstInitiative = firstCarriedInitiativeName || 'Spans & Layers';
  const exampleRows: (string | number)[][] = [
    [firstInitiative, '638', 'Example — manager layer removed', 'HC savings', '12345', 'US', 'Run rate', '08-30-2026', 125000, 'Delete these example rows'],
    [firstInitiative, '638', 'Example — reinvestment', 'HC reinvestment', '-', 'US', 'Run rate', '09-15-2026', 50000, 'Reinvestment is subtracted from savings'],
  ];

  const ws = XLSX.utils.aoa_to_sheet([IDENTIFIED_HEADERS, ...exampleRows]);
  applyColumnWidths(ws, IDENTIFIED_COLUMN_WIDTHS);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Identified');
  XLSX.utils.book_append_sheet(wb, allowedValuesSheet(allInitiatives), 'Allowed values');

  return { fileName: `${slugForFilename(departmentName)}_Identified_TEMPLATE.xlsx`, workbook: wb };
}

export interface ValidationExportRow {
  initiativeName: string;
  deptNo: string;
  name: string;
  category: string;
  eeId: string;
  country: string;
  frequency: string;
  targetDate: string;
  identifiedDollars: number;
  notes: string;
  status: string;
  validatedDollars: number | '';
  validatedDate: string;
  statusUpdate: string;
  // The exporting vcp_upload_rows.id — echoed back on re-upload so a line
  // can be matched to its exact baseline row (see line-items/route.ts),
  // rather than by Dept #/EE ID/name, which can collide or change.
  baselineRowId: string;
}

/**
 * §2 — serves both the baseline download (caller passes status: 'Identified',
 * validatedDollars: '', validatedDate: '', statusUpdate: '' for every row)
 * and a version re-export (caller passes whatever that version holds).
 * `fileSuffix` is 'baseline' or `v${version}`.
 */
export function generateValidationWorkbook(
  departmentName: string,
  allInitiatives: readonly Initiative[],
  rows: readonly ValidationExportRow[],
  fileSuffix: string,
): GeneratedWorkbook {
  const aoa: (string | number)[][] = [
    [...IDENTIFIED_HEADERS, ...VALIDATION_EXTRA_HEADERS],
    ...rows.map((r) => [
      r.initiativeName, r.deptNo, r.name, r.category, r.eeId, r.country, r.frequency, r.targetDate,
      r.identifiedDollars, r.notes, r.status, r.validatedDollars, r.validatedDate, r.statusUpdate, r.baselineRowId,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyColumnWidths(ws, VALIDATION_COLUMN_WIDTHS);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Validation');
  XLSX.utils.book_append_sheet(wb, allowedValuesSheet(allInitiatives), 'Allowed values');

  return { fileName: `${slugForFilename(departmentName)}_Validation_${fileSuffix}.xlsx`, workbook: wb };
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
