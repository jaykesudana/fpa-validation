import { describe, expect, it } from 'vitest';
import { amountOf, available, deriveRegion, lastAction, rollup, type Bucket, type InvRequest } from './investments';

const req = (over: Partial<InvRequest>): InvRequest => ({
  status: 'draft',
  amountCents: 0,
  ...over,
});

describe('available — B1 bucket arithmetic', () => {
  it('is total minus reserve', () => {
    const bucket: Bucket = { totalCents: 1_400_000_000, reserveCents: 250_000_000 };
    expect(available(bucket)).toBe(1_150_000_000);
  });
});

describe('amountOf — bucket drawdown with a reduced approved amount', () => {
  it('draws down the full requested amount when approved without a cut', () => {
    const r = req({ status: 'approved', amountCents: 500_000 });
    expect(amountOf(r)).toBe(500_000);
  });

  it('draws down the REDUCED approvedAmountCents when the admin cut the request', () => {
    const r = req({ status: 'approved', amountCents: 500_000, approvedAmountCents: 300_000 });
    expect(amountOf(r)).toBe(300_000);
  });

  it('treats approvedAmountCents of 0 as a real cut, not a fallback to amountCents', () => {
    const r = req({ status: 'approved', amountCents: 500_000, approvedAmountCents: 0 });
    expect(amountOf(r)).toBe(0);
  });

  it('uses the raw requested amount for any non-approved status', () => {
    const r = req({ status: 'screened', amountCents: 500_000, approvedAmountCents: 300_000 });
    expect(amountOf(r)).toBe(500_000);
  });
});

describe('rollup — B2', () => {
  const bucket: Bucket = { totalCents: 1_000_000, reserveCents: 100_000 }; // available = 900_000

  it('sums approved at the (possibly reduced) approved amount and pending at requested amount', () => {
    const requests: InvRequest[] = [
      req({ status: 'approved', amountCents: 400_000, approvedAmountCents: 250_000 }),
      req({ status: 'submitted', amountCents: 200_000 }),
      req({ status: 'screened', amountCents: 100_000 }),
      req({ status: 'rejected', amountCents: 999_999 }),
      req({ status: 'draft', amountCents: 50_000 }),
    ];
    const r = rollup(requests, bucket);
    expect(r.approvedCents).toBe(250_000);
    expect(r.pendingCents).toBe(300_000);
    expect(r.rejectedCents).toBe(999_999);
    expect(r.draftCents).toBe(50_000);
    expect(r.availableCents).toBe(900_000);
    expect(r.remainingCents).toBe(650_000);
    expect(r.unallocatedCents).toBe(350_000);
    expect(r.count).toBe(5);
    expect(r.approvedCount).toBe(1);
    expect(r.pendingCount).toBe(2);
  });

  it('flags overcommitted when approved + pending exceeds available, but never blocks', () => {
    const requests: InvRequest[] = [
      req({ status: 'approved', amountCents: 700_000 }),
      req({ status: 'screened', amountCents: 300_000 }),
    ];
    const r = rollup(requests, bucket);
    expect(r.approvedCents + r.pendingCents).toBeGreaterThan(r.availableCents);
    expect(r.overcommitted).toBe(true);
  });

  it('is not overcommitted when approved + pending sit inside available', () => {
    const requests: InvRequest[] = [req({ status: 'approved', amountCents: 400_000 })];
    const r = rollup(requests, bucket);
    expect(r.overcommitted).toBe(false);
  });

  it('never lets draft, rejected, returned, or withdrawn consume the pool', () => {
    const requests: InvRequest[] = [
      req({ status: 'draft', amountCents: 100_000 }),
      req({ status: 'rejected', amountCents: 100_000 }),
      req({ status: 'returned', amountCents: 100_000 }),
      req({ status: 'withdrawn', amountCents: 100_000 }),
    ];
    const r = rollup(requests, bucket);
    expect(r.approvedCents).toBe(0);
    expect(r.pendingCents).toBe(0);
  });
});

describe('lastAction — B4', () => {
  it('prefers the decision stamp over everything else', () => {
    const r = req({ status: 'approved', decidedAt: '2026-07-01', decidedByName: 'CFO + ELT', screenedAt: '2026-06-01', submittedAt: '2026-05-01' });
    expect(lastAction(r)).toEqual({ at: '2026-07-01', by: 'Approved by CFO + ELT' });
  });

  it('labels a rejection distinctly from an approval', () => {
    const r = req({ status: 'rejected', decidedAt: '2026-07-01', decidedByName: 'CFO + ELT' });
    expect(lastAction(r).by).toBe('Rejected by CFO + ELT');
  });

  it('falls back to the screen stamp, distinguishing return from screen-in', () => {
    expect(lastAction(req({ status: 'returned', screenedAt: '2026-06-01', screenedByName: 'Tina Pan' })).by).toBe('Returned by Tina Pan');
    expect(lastAction(req({ status: 'screened', screenedAt: '2026-06-01', screenedByName: 'Tina Pan' })).by).toBe('Screened by Tina Pan');
  });

  it('falls back to the submit stamp, then to "not submitted" for a bare draft', () => {
    expect(lastAction(req({ status: 'submitted', submittedAt: '2026-05-01', submittedByName: 'Margaret Yin' })).by).toBe('Submitted by Margaret Yin');
    expect(lastAction(req({ status: 'draft' }))).toEqual({ at: '—', by: 'Draft — not submitted' });
  });
});

describe('deriveRegion', () => {
  it('maps known countries to their region', () => {
    expect(deriveRegion('United States')).toBe('AMAS');
    expect(deriveRegion('Germany')).toBe('EMEA');
    expect(deriveRegion('Singapore')).toBe('APAC');
  });

  it('defaults to AMAS for an unmapped country rather than throwing', () => {
    expect(deriveRegion('Atlantis')).toBe('AMAS');
  });
});
