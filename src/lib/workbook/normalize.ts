// 02-WORKBOOKS.md §5 "Date normalisation" and "Amount parsing".

function pad2(n: number | string): string {
  return String(n).padStart(2, '0');
}

function formatMDY(year: number, month: number, day: number): string {
  return `${pad2(month)}-${pad2(day)}-${year}`;
}

/** Normalises a cell value to mm-dd-yyyy. Unparseable input passes through unchanged. */
export function normalizeDate(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'number') {
    const ms = Date.UTC(1899, 11, 30) + value * 86400000;
    const d = new Date(ms);
    return formatMDY(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const str = String(value).trim();
  if (!str) return '';

  const mdy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mdy) return formatMDY(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));

  const ymd = str.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (ymd) return formatMDY(Number(ymd[1]), Number(ymd[2]), Number(ymd[3] ?? '1'));

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return formatMDY(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }

  return str;
}

/** Strips currency symbols/commas/spaces, treats parens as negative, blank → 0. Returns CENTS. */
export function parseAmountCents(value: unknown): number {
  if (value == null || value === '') return 0;

  if (typeof value === 'number') return Math.round(value * 100);

  let str = String(value).trim();
  if (!str) return 0;

  let negative = false;
  const parenMatch = str.match(/^\((.*)\)$/);
  if (parenMatch) {
    negative = true;
    str = parenMatch[1] ?? '';
  }

  str = str.replace(/[^0-9.\-]/g, '');
  if (!str || str === '-') return 0;

  const n = Number(str);
  if (Number.isNaN(n)) return 0;

  const cents = Math.round(n * 100);
  return negative ? -Math.abs(cents) : cents;
}
