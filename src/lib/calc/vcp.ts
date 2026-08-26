// Ported verbatim (formula-for-formula) from design_handoff_fpa_control_tower/
// reference/gates-data.js and 03-BUSINESS-RULES.md §A. Money fields are cents
// (integers), matching the Neon schema — the reference prototype used raw
// dollars, so only the unit changes, never the arithmetic.
//
// This module is the single source of truth for VCP rollups. Both the API
// layer and any client-side display must import from here — never
// reimplement a formula inline.

export type Frequency = 'Run rate' | 'One-time';
export type LineStatus = 'Identified' | 'Confirmed' | 'Not confirmed';
export type ValidationState = 'pending' | 'approved' | 'rejected';
export type GateState = 'todo' | 'draft' | 'review' | 'ready' | 'active' | 'locked' | 'blocked';

export interface LineRow {
  initiativeId: string;
  category: string;
  frequency: Frequency;
  identifiedCents: number;
}

export interface ValidationRow extends LineRow {
  status: LineStatus;
  validatedCents: number;
}

export interface BucketResult {
  grossCents: number;
  reinvestCents: number;
  oneTimeCents: number;
  netPLCents: number;
}

export interface InitiativeTarget {
  initiativeId: string;
  targetCents: number;
  locked: boolean;
}

export interface Baseline {
  locked: boolean;
  rows: LineRow[];
}

export interface ValidationVersion {
  version: number;
  status: ValidationState;
  rows: ValidationRow[];
  /** Stored at upload time; must equal validatedSubtotal(rows) — see 05-API.md. */
  validatedSubtotalCents: number;
}

export interface Department {
  initiatives: InitiativeTarget[];
  baseline: Baseline | null;
  validations: ValidationVersion[];
}

// ── A1. P&L bucketing of identified rows ────────────────────────────────────
export function bucketRows(rows: readonly LineRow[]): BucketResult {
  let gross = 0;
  let reinvest = 0;
  let oneTime = 0;
  for (const row of rows) {
    const amt = Number(row.identifiedCents) || 0;
    const cat = String(row.category || '').toLowerCase();
    const freq = String(row.frequency || '').toLowerCase();
    if (cat.includes('reinvestment')) {
      reinvest += Math.abs(amt);
    } else if (freq === 'one-time' || cat === 'implementation') {
      oneTime += Math.abs(amt);
    } else {
      gross += amt;
    }
  }
  return { grossCents: gross, reinvestCents: reinvest, oneTimeCents: oneTime, netPLCents: gross - reinvest };
}

function rowsForInit(rows: readonly LineRow[], initiativeId: string): LineRow[] {
  return rows.filter((r) => r.initiativeId === initiativeId);
}

function isNotConfirmed(row: ValidationRow): boolean {
  return String(row.status || '').toLowerCase() === 'not confirmed';
}

// ── A2. Department and initiative rollups ───────────────────────────────────
export function deptTarget(d: Department): number {
  return d.initiatives.reduce((s, i) => s + (Number(i.targetCents) || 0), 0);
}

export function deptIdentifiedTotal(d: Department): number {
  return d.baseline ? bucketRows(d.baseline.rows).netPLCents : 0;
}

export function initIdentified(d: Department, initiativeId: string): number {
  return d.baseline ? bucketRows(rowsForInit(d.baseline.rows, initiativeId)).netPLCents : 0;
}

// ── A3. Which validation version counts ─────────────────────────────────────
export function latestApprovedValidation(d: Department): ValidationVersion | null {
  const approved = d.validations.filter((v) => v.status === 'approved');
  return approved.length ? approved[approved.length - 1]! : null;
}

export function latestValidation(d: Department): ValidationVersion | null {
  return d.validations.length ? d.validations[d.validations.length - 1]! : null;
}

export function pendingValidation(d: Department): ValidationVersion | null {
  return d.validations.find((v) => v.status === 'pending') ?? null;
}

// ── A4. Delivered (formerly "Validated") ─────────────────────────────────────
export function validatedSubtotal(rows: readonly ValidationRow[]): number {
  return rows.filter((r) => !isNotConfirmed(r)).reduce((s, r) => s + (Number(r.validatedCents) || 0), 0);
}

export function deptValidatedTotal(d: Department): number {
  const v = latestApprovedValidation(d);
  return v ? Number(v.validatedSubtotalCents) || 0 : 0;
}

export function initValidated(d: Department, initiativeId: string): number {
  const v = latestApprovedValidation(d);
  if (!v) return 0;
  return validatedSubtotal(rowsForInit(v.rows, initiativeId) as ValidationRow[]);
}

// ── A5. Live identified — "Not confirmed" rows fall out ─────────────────────
export function deptCurrentIdentified(d: Department): number {
  if (!d.baseline) return 0;
  const v = latestApprovedValidation(d);
  if (!v) return deptIdentifiedTotal(d);
  const live = v.rows.filter((r) => !isNotConfirmed(r));
  return bucketRows(live).netPLCents;
}

export function initCurrentIdentified(d: Department, initiativeId: string): number {
  if (!d.baseline) return 0;
  const v = latestApprovedValidation(d);
  if (!v) return initIdentified(d, initiativeId);
  const live = rowsForInit(v.rows, initiativeId).filter((r) => !isNotConfirmed(r as ValidationRow));
  return bucketRows(live).netPLCents;
}

// ── A6. Portfolio rollup ──────────────────────────────────────────────────────
export interface PortfolioRollup {
  targetCents: number;
  identifiedCents: number;
  currentIdentifiedCents: number;
  validatedCents: number;
  count: number;
}

export function rollupDepts(list: readonly Department[]): PortfolioRollup {
  return list.reduce(
    (a, d) => ({
      targetCents: a.targetCents + deptTarget(d),
      identifiedCents: a.identifiedCents + deptIdentifiedTotal(d),
      currentIdentifiedCents: a.currentIdentifiedCents + deptCurrentIdentified(d),
      validatedCents: a.validatedCents + deptValidatedTotal(d),
      count: a.count + 1,
    }),
    { targetCents: 0, identifiedCents: 0, currentIdentifiedCents: 0, validatedCents: 0, count: 0 },
  );
}

// ── A7. Coverage and status chip ─────────────────────────────────────────────
export function coverage(targetCents: number, deliveredCents: number): number {
  return targetCents > 0 ? deliveredCents / targetCents : deliveredCents > 0 ? 1 : 0;
}

export interface StatusMeta {
  label: 'On track' | 'At risk' | 'Behind';
  clr: string;
}

export function statusMeta(targetCents: number, deliveredCents: number): StatusMeta {
  const c = coverage(targetCents, deliveredCents);
  if (c >= 0.95) return { label: 'On track', clr: '#628B48' };
  if (c >= 0.6) return { label: 'At risk', clr: '#B0560F' };
  return { label: 'Behind', clr: '#B3001B' };
}

// ── A8. Gate state machine (per department) ─────────────────────────────────
export interface Gates {
  g1: 'todo' | 'draft' | 'locked';
  g2: 'todo' | 'review' | 'locked';
  g3: 'blocked' | 'ready' | 'active';
}

export function deptGates(d: Department): Gates {
  const inits = d.initiatives;
  const g1: Gates['g1'] =
    inits.length > 0 && inits.every((i) => i.locked)
      ? 'locked'
      : inits.some((i) => i.locked || i.targetCents > 0)
        ? 'draft'
        : 'todo';

  let g2: Gates['g2'] = 'todo';
  if (d.baseline) g2 = d.baseline.locked ? 'locked' : 'review';

  let g3: Gates['g3'] = 'blocked';
  if (g2 === 'locked') g3 = d.validations.length > 0 ? 'active' : 'ready';

  return { g1, g2, g3 };
}

export function anyTargetLocked(d: Department): boolean {
  return d.initiatives.some((i) => i.locked);
}

export const gateColors: Record<GateState, { label: string; text: string; bg: string }> = {
  todo: { label: 'Not started', text: 'var(--fg-3)', bg: 'var(--idc-bearing-gray)' },
  draft: { label: 'In progress', text: '#B0560F', bg: 'rgba(246,111,19,0.14)' },
  review: { label: 'In review', text: '#166BF4', bg: 'rgba(22,107,244,0.14)' },
  ready: { label: 'Ready', text: '#166BF4', bg: 'rgba(22,107,244,0.14)' },
  active: { label: 'In progress', text: '#628B48', bg: 'rgba(98,139,72,0.14)' },
  locked: { label: 'Locked', text: '#628B48', bg: 'rgba(98,139,72,0.14)' },
  blocked: { label: 'Locked', text: 'var(--fg-3)', bg: 'var(--idc-bearing-gray)' },
};

// ── A9. Cross-cutting breakdowns ──────────────────────────────────────────────
export const CATEGORIES = [
  'Revenue increase',
  'HC savings',
  'Vendor elimination',
  'Process efficiency',
  'Risk / compliance reduction',
  'HC reinvestment',
  'Vendor reinvestment',
  'Implementation',
] as const;

export interface CategoryBreakdownRow {
  category: string;
  group: 'run' | 'onetime';
  identifiedCents: number;
  validatedCents: number;
}

export function initDeptCategoryBreakdown(d: Department, initiativeId: string): CategoryBreakdownRow[] {
  const baseRows = d.baseline ? rowsForInit(d.baseline.rows, initiativeId) : [];
  const v = latestApprovedValidation(d);
  const valRows = v ? rowsForInit(v.rows, initiativeId).filter((r) => !isNotConfirmed(r as ValidationRow)) : [];

  const isOneTime = (r: LineRow) => String(r.frequency || '').toLowerCase() === 'one-time' || String(r.category || '').toLowerCase() === 'implementation';
  const sums = new Map<string, CategoryBreakdownRow>();
  const keyOf = (r: LineRow) => `${isOneTime(r) ? 'onetime' : 'run'}|${r.category || '—'}`;
  const touch = (r: LineRow): CategoryBreakdownRow => {
    const k = keyOf(r);
    let entry = sums.get(k);
    if (!entry) {
      entry = { category: r.category || '—', group: isOneTime(r) ? 'onetime' : 'run', identifiedCents: 0, validatedCents: 0 };
      sums.set(k, entry);
    }
    return entry;
  };
  baseRows.forEach((r) => {
    touch(r).identifiedCents += Number(r.identifiedCents) || 0;
  });
  valRows.forEach((r) => {
    const entry = touch(r);
    entry.validatedCents += Number((r as ValidationRow).validatedCents) || 0;
  });

  const order = (cat: string) => {
    const i = (CATEGORIES as readonly string[]).indexOf(cat);
    return i < 0 ? 99 : i;
  };
  return Array.from(sums.values()).sort((a, b) => (a.group === b.group ? order(a.category) - order(b.category) : a.group === 'run' ? -1 : 1));
}

export interface InitiativeDeptRow {
  initiativeId: string;
  targetCents: number;
  targetLocked: boolean;
  identifiedCents: number;
  currentIdentifiedCents: number;
  validatedCents: number;
}

export function initiativeDeptRows(depts: readonly Department[], initiativeId: string): InitiativeDeptRow[] {
  const rows: InitiativeDeptRow[] = [];
  for (const d of depts) {
    const iv = d.initiatives.find((i) => i.initiativeId === initiativeId);
    if (!iv) continue;
    rows.push({
      initiativeId,
      targetCents: iv.targetCents || 0,
      targetLocked: iv.locked,
      identifiedCents: initIdentified(d, initiativeId),
      currentIdentifiedCents: initCurrentIdentified(d, initiativeId),
      validatedCents: initValidated(d, initiativeId),
    });
  }
  return rows;
}
