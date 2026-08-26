// 03-BUSINESS-RULES.md §D. The reference formulas operate on raw dollars;
// our schema stores cents, so the *Cents wrappers convert once at the edge
// and the core fmt/fmtSign stay verbatim.

export function fmt(dollars: number | null | undefined): string {
  if (dollars == null) return '—';
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1e6).toFixed(2)}m`;
  return `${sign}$${Math.round(abs / 1000).toLocaleString()}k`;
}

export function fmtSign(dollars: number | null | undefined): string {
  if (dollars == null) return '—';
  const sign = dollars < 0 ? '-' : '+';
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1e6).toFixed(2)}m`;
  return `${sign}$${Math.round(abs / 1000).toLocaleString()}k`;
}

export function fmtCents(cents: number | null | undefined): string {
  return fmt(cents == null ? null : cents / 100);
}

export function fmtCentsSigned(cents: number | null | undefined): string {
  return fmtSign(cents == null ? null : cents / 100);
}
