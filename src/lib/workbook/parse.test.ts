import { describe, expect, it } from 'vitest';
import { resolveHeader } from './header-alias';
import { normalizeDate, parseAmountCents } from './normalize';
import { parseIdentifiedRows, parseValidationRows, rowsFromAOA } from './parse';
import type { Initiative } from './types';

const INITIATIVES: Initiative[] = [
  { id: 'ai', name: 'AI Automation' },
  { id: 'entity', name: 'Entity Rationalization' },
  { id: 'spans', name: 'Spans & Layers' },
];

// A valid, complete Gate 2 filler row — used to pad AOAs so an error row lands
// on a specific, doc-matching row number without affecting the outcome.
const fillerRow = (n: number) => ['AI Automation', '638', `Filler ${n}`, 'HC savings', '-', 'US', 'Run rate', '', 1000, ''];

const GATE2_HEADERS = ['Initiative', 'Dept #', 'Name', 'Category', 'EE ID', 'Country', 'Frequency', 'Target date', 'Identified amount', 'Notes'];
const GATE3_HEADERS = [...GATE2_HEADERS, 'Status', 'Validated Amount', 'Validated Date', 'Status Update'];

describe('rowsFromAOA — §5 row and header handling', () => {
  it('drops leading blank rows before finding the header row', () => {
    const aoa = [[], ['', '', ''], GATE2_HEADERS, fillerRow(1)];
    const { headers, records } = rowsFromAOA(aoa);
    expect(headers).toEqual(GATE2_HEADERS);
    expect(records).toHaveLength(1);
    expect(records[0]!.rowNo).toBe(4); // header at aoa index 2 → excel row 3; data at index 3 → row 4
  });

  it('drops blank rows between data rows without breaking row numbering', () => {
    const aoa = [GATE2_HEADERS, fillerRow(1), [], fillerRow(2)];
    const { records } = rowsFromAOA(aoa);
    expect(records.map((r) => r.rowNo)).toEqual([2, 4]);
  });

  it('returns no headers/records for an all-blank sheet', () => {
    expect(rowsFromAOA([[], ['']])).toEqual({ headers: [], records: [] });
  });
});

describe('resolveHeader — §5 header aliasing, Status vs Status Update', () => {
  it('resolves "Status Update" to statusUpdate, never falling through to Status\'s bare catch-all', () => {
    expect(resolveHeader('Status Update', 3)).toBe('statusUpdate');
  });

  it('resolves bare "Status" to status', () => {
    expect(resolveHeader('Status', 3)).toBe('status');
  });

  it('resolves a header ending in just "status" text with nothing after to status', () => {
    expect(resolveHeader('Current Status', 3)).toBe('status');
  });

  it('Gate 2 "Date" (unanchored) resolves to targetDate', () => {
    expect(resolveHeader('Date', 2)).toBe('targetDate');
  });

  it('Gate 3 "Date" (anchored) still resolves to targetDate on its own', () => {
    expect(resolveHeader('Date', 3)).toBe('targetDate');
  });

  it('Gate 3 "Validated Date" resolves to validatedDate, not targetDate', () => {
    expect(resolveHeader('Validated Date', 3)).toBe('validatedDate');
  });

  it('Gate 3 "Amount" (anchored) resolves to identifiedAmount', () => {
    expect(resolveHeader('Amount', 3)).toBe('identifiedAmount');
  });

  it('Gate 3 "Validated Amount" resolves to validatedAmount, not identifiedAmount', () => {
    expect(resolveHeader('Validated Amount', 3)).toBe('validatedAmount');
  });

  it('accepts the documented header variants (line item, dept no, employee id)', () => {
    expect(resolveHeader('Line Item', 2)).toBe('name');
    expect(resolveHeader('Dept No', 2)).toBe('deptNo');
    expect(resolveHeader('Employee ID', 2)).toBe('eeId');
  });

  it('returns null for a header matching nothing', () => {
    expect(resolveHeader('Random Column', 2)).toBeNull();
  });
});

describe('normalizeDate — §5 date normalisation', () => {
  it('converts an Excel serial number', () => {
    // 45900 → Aug 30 2025 (Date.UTC(1899,11,30) + 45900 days)
    expect(normalizeDate(45900)).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });

  it('zero-pads m-d-yyyy and m/d/yyyy', () => {
    expect(normalizeDate('8-30-2026')).toBe('08-30-2026');
    expect(normalizeDate('8/3/2026')).toBe('08-03-2026');
  });

  it('converts yyyy-mm-dd and defaults yyyy-mm to day 01', () => {
    expect(normalizeDate('2026-08-30')).toBe('08-30-2026');
    expect(normalizeDate('2026-08')).toBe('08-01-2026');
  });

  it('passes through anything else unparseable unchanged', () => {
    expect(normalizeDate('not a date')).toBe('not a date');
  });

  it('returns empty string for blank', () => {
    expect(normalizeDate('')).toBe('');
    expect(normalizeDate(null)).toBe('');
  });
});

describe('parseAmountCents — §5 amount parsing', () => {
  it('strips currency symbols, commas, and spaces', () => {
    expect(parseAmountCents('$125,000.00')).toBe(12_500_000);
    expect(parseAmountCents(' 1 234 ')).toBe(123_400);
  });

  it('treats parenthesised values as negative', () => {
    expect(parseAmountCents('(1,234.56)')).toBe(-123_456);
  });

  it('treats a plain negative number as negative without needing parens', () => {
    expect(parseAmountCents('-30000')).toBe(-3_000_000);
  });

  it('blank is 0', () => {
    expect(parseAmountCents('')).toBe(0);
    expect(parseAmountCents(null)).toBe(0);
  });

  it('a literal 0 cell is 0 cents but is still a present value (see skip-row tests)', () => {
    expect(parseAmountCents('0')).toBe(0);
  });
});

describe('parseIdentifiedRows — skip vs reject (§5)', () => {
  it('silently skips a row with neither name nor amount', () => {
    const aoa = [GATE2_HEADERS, fillerRow(1), ['AI Automation', '', '', '', '', '', '', '', '', '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(1);
  });

  it('keeps a row with an amount but no name', () => {
    const aoa = [GATE2_HEADERS, ['AI Automation', '', '', 'HC savings', '', 'US', 'Run rate', '', 5000, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.name).toBe('');
      expect(result.rows[0]!.identifiedCents).toBe(500_000);
    }
  });

  it('keeps a row whose amount cell is literally "0" (present, not blank)', () => {
    const aoa = [GATE2_HEADERS, ['AI Automation', '', '', 'HC savings', '', 'US', 'Run rate', '', 0, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(1);
  });

  it('rejects the whole file on a blank Initiative', () => {
    const aoa = [GATE2_HEADERS, ['', '', 'Some line', 'HC savings', '', 'US', 'Run rate', '', 100, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result).toEqual({ ok: false, error: 'Row 2 (Some line): initiative is required.', row: 2 });
  });

  it('matches the doc\'s exact wording for an unmatched initiative, at the doc\'s row number', () => {
    const aoa = [GATE2_HEADERS, fillerRow(1), fillerRow(2), ['AI Autmation', '', 'Manager layer removed', 'HC savings', '', 'US', 'Run rate', '', 100, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result).toEqual({
      ok: false,
      error: 'Row 4 (Manager layer removed): initiative "AI Autmation" is not an allowed value.',
      row: 4,
    });
  });

  it('matches the doc\'s exact wording for an unmatched category, at the doc\'s row number', () => {
    const filler = [fillerRow(1), fillerRow(2), fillerRow(3), fillerRow(4), fillerRow(5)];
    const aoa = [GATE2_HEADERS, ...filler, ['AI Automation', '', 'Vendor cut', 'Vendor cuts', '', 'US', 'Run rate', '', 100, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result).toEqual({
      ok: false,
      error: 'Row 7 (Vendor cut): category "Vendor cuts" is not an allowed value.',
      row: 7,
    });
  });

  it('matches the doc\'s exact wording for an invalid frequency, on a nameless-but-amounted row', () => {
    const filler = [fillerRow(1), fillerRow(2), fillerRow(3), fillerRow(4), fillerRow(5), fillerRow(6), fillerRow(7)];
    const aoa = [GATE2_HEADERS, ...filler, ['AI Automation', '', '', 'HC savings', '', 'US', 'Monthly', '', 100, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result).toEqual({
      ok: false,
      error: 'Row 9 (—): frequency "Monthly" must be Run rate or One-time.',
      row: 9,
    });
  });

  it('rejects on an unknown country', () => {
    const aoa = [GATE2_HEADERS, ['AI Automation', '', 'Some line', 'HC savings', '', 'Narnia', 'Run rate', '', 100, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Row 2 (Some line): country "Narnia" is not an allowed value.');
  });

  it('treats a blank Category / Frequency / Country as valid-and-empty, not a reject', () => {
    const aoa = [GATE2_HEADERS, ['AI Automation', '', 'Some line', '', '', '', '', '', 100, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]!.category).toBe('');
      expect(result.rows[0]!.frequency).toBe('Run rate'); // blank frequency defaults
      expect(result.rows[0]!.country).toBe('');
    }
  });

  it('canonicalises casing regardless of how the user typed it', () => {
    const aoa = [GATE2_HEADERS, ['ai automation', '', 'Some line', 'hc savings', '', 'us', 'run rate', '', 100, '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]!.initiativeName).toBe('AI Automation');
      expect(result.rows[0]!.category).toBe('HC savings');
      expect(result.rows[0]!.country).toBe('US');
      expect(result.rows[0]!.frequency).toBe('Run rate');
    }
  });

  it('rejects on a duplicate EE ID with the doc\'s exact wording', () => {
    const aoa = [
      GATE2_HEADERS,
      ['AI Automation', '', 'John Smith', 'HC savings', '12345', 'US', 'Run rate', '', 100, ''],
      ['Entity Rationalization', '', 'John Smith', 'HC savings', '12345', 'US', 'Run rate', '', 50, ''],
    ];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result).toEqual({
      ok: false,
      error: 'EE ID 12345 (John Smith) appears more than once — a person can only be counted in one initiative. Fix the duplicate.',
      row: 3,
    });
  });

  it('exempts "-" from the EE ID uniqueness check', () => {
    const aoa = [
      GATE2_HEADERS,
      ['AI Automation', '', 'Row A', 'HC savings', '-', 'US', 'Run rate', '', 100, ''],
      ['AI Automation', '', 'Row B', 'HC savings', '-', 'US', 'Run rate', '', 50, ''],
    ];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it('rejects with "No line items found" when every row is skipped', () => {
    const aoa = [GATE2_HEADERS, ['', '', '', '', '', '', '', '', '', '']];
    const result = parseIdentifiedRows(aoa, INITIATIVES);
    expect(result).toEqual({ ok: false, error: 'No line items found — check the column headers match the template.' });
  });

  it('rejects with "No line items found" when the sheet has no data rows at all', () => {
    const result = parseIdentifiedRows([GATE2_HEADERS], INITIATIVES);
    expect(result).toEqual({ ok: false, error: 'No line items found — check the column headers match the template.' });
  });
});

describe('parseValidationRows — Gate 3 extra columns', () => {
  it('matches the doc\'s exact wording for an invalid status, at the doc\'s row number', () => {
    const filler = Array.from({ length: 10 }, (_, i) => [...fillerRow(i + 1), 'Confirmed', 100, '', '']);
    const aoa = [
      GATE3_HEADERS,
      ...filler,
      ['AI Automation', '', 'Contractor', 'HC savings', '', 'US', 'Run rate', '', 100, '', 'Done', 100, '', ''],
    ];
    const result = parseValidationRows(aoa, INITIATIVES);
    expect(result).toEqual({
      ok: false,
      error: 'Row 12 (Contractor): status "Done" must be Identified, Confirmed or Not confirmed.',
      row: 12,
    });
  });

  it('defaults a blank Status to Identified', () => {
    const aoa = [GATE3_HEADERS, ['AI Automation', '', 'Some line', 'HC savings', '', 'US', 'Run rate', '', 100, '', '', '', '', '']];
    const result = parseValidationRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]!.status).toBe('Identified');
  });

  it('carries Validated Amount / Date / Status Update through, and excludes Not confirmed rows from validatedSubtotal-style consumers by leaving status queryable', () => {
    const aoa = [
      GATE3_HEADERS,
      ['AI Automation', '', 'Confirmed line', 'HC savings', '', 'US', 'Run rate', '', 100_000, '', 'Confirmed', 60_000, '07-01-2026', 'Evidence attached'],
      ['Entity Rationalization', '', 'Dropped line', 'HC savings', '', 'US', 'Run rate', '', 40_000, '', 'Not confirmed', 0, '', 'Could not evidence'],
    ];
    const result = parseValidationRows(aoa, INITIATIVES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]!.status).toBe('Confirmed');
      expect(result.rows[0]!.validatedCents).toBe(6_000_000);
      expect(result.rows[0]!.validatedDate).toBe('07-01-2026');
      expect(result.rows[1]!.status).toBe('Not confirmed');
      expect(result.rows[1]!.statusUpdate).toBe('Could not evidence');
    }
  });
});
