// Ported verbatim (formula-for-formula) from design_handoff_fpa_control_tower/
// reference/investments-data.js and 03-BUSINESS-RULES.md §B. Money fields are
// cents (integers), matching the Neon schema.
//
// Entirely separate from the VCP savings program — see vcp.ts. No function
// here reads a savings target, an identified baseline, or a validated amount.

export const DECISION_BODY = 'CFO + ELT';

export type Region = 'AMAS' | 'EMEA' | 'APAC';

export const COUNTRIES: Record<Region, string[]> = {
  AMAS: ['United States', 'Canada', 'Brazil', 'Mexico'],
  EMEA: ['United Kingdom', 'Germany', 'France', 'UAE', 'South Africa'],
  APAC: ['China', 'Japan', 'Australia', 'India', 'Singapore', 'Korea'],
};

export const COUNTRY_REGION: Record<string, Region> = (() => {
  const m: Record<string, Region> = {};
  (Object.keys(COUNTRIES) as Region[]).forEach((r) => COUNTRIES[r].forEach((c) => { m[c] = r; }));
  return m;
})();

/** Region is always derived server-side from country — never accept a client value. */
export function deriveRegion(country: string): Region {
  return COUNTRY_REGION[country] ?? 'AMAS';
}

// 07-UI-SPEC.md §5 "Request detail" — the three-step progress tracker.
export const STEPS = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'screened', label: 'FP&A screen' },
  { key: 'decided', label: 'CFO + ELT decision' },
] as const;

export const INV_TYPES = ['Headcount', 'Vendor', 'Capex', 'Program'] as const;
export type InvType = (typeof INV_TYPES)[number];
export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

export type ReqStatus = 'draft' | 'submitted' | 'screened' | 'approved' | 'rejected' | 'returned' | 'withdrawn';

export interface StatusMeta {
  label: string;
  clr: string;
  bg: string;
  stage: 0 | 1 | 2 | 3;
  counts: 'none' | 'pending' | 'approved';
}

// 01-DOMAIN-AND-ROLES.md §4 status table.
export const INV_STATUS: Record<ReqStatus, StatusMeta> = {
  draft: { label: 'Draft', clr: '#6A6A78', bg: 'rgba(29,29,127,0.07)', stage: 0, counts: 'none' },
  submitted: { label: 'Pending FP&A screen', clr: '#B0560F', bg: 'rgba(246,111,19,0.12)', stage: 1, counts: 'pending' },
  screened: { label: 'Pending CFO + ELT', clr: '#166BF4', bg: 'rgba(22,107,244,0.11)', stage: 2, counts: 'pending' },
  approved: { label: 'Approved', clr: '#628B48', bg: 'rgba(98,139,72,0.14)', stage: 3, counts: 'approved' },
  rejected: { label: 'Rejected', clr: '#B3001B', bg: 'rgba(179,0,27,0.10)', stage: 3, counts: 'none' },
  returned: { label: 'Returned for rework', clr: '#873142', bg: 'rgba(135,49,66,0.10)', stage: 1, counts: 'none' },
  withdrawn: { label: 'Withdrawn', clr: '#6A6A78', bg: 'rgba(29,29,127,0.07)', stage: 3, counts: 'none' },
};

export interface Bucket {
  totalCents: number;
  reserveCents: number;
}

export interface InvRequest {
  status: ReqStatus;
  amountCents: number;
  approvedAmountCents?: number | null;
  dept?: string;
  initiative?: string;
  submittedByName?: string;
  submittedAt?: string | null;
  screenedByName?: string;
  screenedAt?: string | null;
  decidedByName?: string;
  decidedAt?: string | null;
}

// ── B1. Bucket arithmetic ────────────────────────────────────────────────────
export function available(bucket: Bucket): number {
  return (bucket.totalCents || 0) - (bucket.reserveCents || 0);
}

export function amountOf(r: InvRequest): number {
  return r.status === 'approved' ? (r.approvedAmountCents ?? r.amountCents) : r.amountCents;
}

// ── B2. Rollup ────────────────────────────────────────────────────────────────
export interface Rollup {
  totalCents: number;
  reserveCents: number;
  availableCents: number;
  approvedCents: number;
  pendingCents: number;
  rejectedCents: number;
  draftCents: number;
  remainingCents: number;
  unallocatedCents: number;
  overcommitted: boolean;
  count: number;
  approvedCount: number;
  pendingCount: number;
}

export function rollup(requests: readonly InvRequest[], bucket: Bucket): Rollup {
  const sum = (pred: (r: InvRequest) => boolean) => requests.filter(pred).reduce((s, r) => s + amountOf(r), 0);

  const approvedCents = sum((r) => INV_STATUS[r.status]?.counts === 'approved');
  const pendingCents = sum((r) => INV_STATUS[r.status]?.counts === 'pending');
  const rejectedCents = sum((r) => r.status === 'rejected');
  const draftCents = sum((r) => r.status === 'draft');
  const availableCents = available(bucket);

  return {
    totalCents: bucket.totalCents || 0,
    reserveCents: bucket.reserveCents || 0,
    availableCents,
    approvedCents,
    pendingCents,
    rejectedCents,
    draftCents,
    remainingCents: availableCents - approvedCents,
    unallocatedCents: availableCents - approvedCents - pendingCents,
    overcommitted: approvedCents + pendingCents > availableCents,
    count: requests.length,
    approvedCount: requests.filter((r) => r.status === 'approved').length,
    pendingCount: requests.filter((r) => INV_STATUS[r.status]?.counts === 'pending').length,
  };
}

// ── B4. Last action (list columns) ───────────────────────────────────────────
export interface LastAction {
  at: string;
  by: string;
}

export function lastAction(r: InvRequest): LastAction {
  if (r.decidedAt) {
    return { at: r.decidedAt, by: (r.status === 'approved' ? 'Approved by ' : 'Rejected by ') + (r.decidedByName || DECISION_BODY) };
  }
  if (r.screenedAt) {
    return { at: r.screenedAt, by: (r.status === 'returned' ? 'Returned by ' : 'Screened by ') + (r.screenedByName || '') };
  }
  if (r.submittedAt) {
    return { at: r.submittedAt, by: 'Submitted by ' + (r.submittedByName || '—') };
  }
  return { at: '—', by: 'Draft — not submitted' };
}

export function groupBy<T extends Record<string, unknown>>(items: readonly T[], key: keyof T): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = String(item[key] ?? '—');
    (out[k] ??= []).push(item);
  }
  return out;
}

// Investment-tower notification events — separate stream from the VCP tower.
export const INV_EVENT_META = {
  submit: { label: 'Request submitted', clr: '#166BF4' },
  screen: { label: 'FP&A screened', clr: '#166BF4' },
  ret: { label: 'Returned', clr: '#873142' },
  approve: { label: 'Approved', clr: '#628B48' },
  reject: { label: 'Rejected', clr: '#B3001B' },
  bucket: { label: 'Bucket updated', clr: '#FFC933' },
  assign: { label: 'Access granted', clr: '#166BF4' },
} as const;
