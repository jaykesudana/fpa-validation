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
