export interface Initiative {
  id: string;
  name: string;
}

export interface ParsedRowBase {
  rowNo: number;
  initiativeId: string;
  initiativeName: string;
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

export type ParsedIdentifiedRow = ParsedRowBase;

export interface ParsedValidationRow extends ParsedRowBase {
  status: 'Identified' | 'Confirmed' | 'Not confirmed';
  validatedCents: number;
  validatedDate: string;
  statusUpdate: string;
  // Echoes the "Row ID (do not edit)" column — the exporting vcp_upload_rows.id
  // this line was pre-filled from, so a re-upload can be matched back to its
  // exact baseline row rather than by Dept #/EE ID/name. Blank for a row the
  // partner added by hand, or a file downloaded before this column existed.
  baselineRowId: string;
}

export interface ParseOk<T> {
  ok: true;
  rows: T[];
}

export interface ParseFail {
  ok: false;
  error: string;
  row?: number;
}

export type ParseResult<T> = ParseOk<T> | ParseFail;
