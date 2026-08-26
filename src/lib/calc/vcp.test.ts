import { describe, expect, it } from 'vitest';
import {
  bucketRows,
  coverage,
  deptCurrentIdentified,
  deptGates,
  deptIdentifiedTotal,
  deptTarget,
  deptValidatedTotal,
  initCurrentIdentified,
  statusMeta,
  validatedSubtotal,
  type Department,
  type LineRow,
  type ValidationRow,
} from './vcp';

const row = (over: Partial<LineRow>): LineRow => ({
  initiativeId: 'ai',
  category: 'HC savings',
  frequency: 'Run rate',
  identifiedCents: 0,
  ...over,
});

const vrow = (over: Partial<ValidationRow>): ValidationRow => ({
  ...row({}),
  status: 'Confirmed',
  validatedCents: 0,
  ...over,
});

describe('bucketRows — A1 P&L bucketing', () => {
  it('sums run-rate rows into gross', () => {
    const result = bucketRows([row({ identifiedCents: 10_000 }), row({ identifiedCents: 5_000 })]);
    expect(result.grossCents).toBe(15_000);
    expect(result.netPLCents).toBe(15_000);
  });

  it('subtracts reinvestment categories from netPL but keeps gross untouched', () => {
    const result = bucketRows([
      row({ identifiedCents: 100_000, category: 'HC savings' }),
      row({ identifiedCents: 30_000, category: 'HC reinvestment' }),
    ]);
    expect(result.grossCents).toBe(100_000);
    expect(result.reinvestCents).toBe(30_000);
    expect(result.netPLCents).toBe(70_000);
  });

  it('takes the absolute value of a negative reinvestment amount', () => {
    const result = bucketRows([row({ identifiedCents: -30_000, category: 'Vendor reinvestment' })]);
    expect(result.reinvestCents).toBe(30_000);
    expect(result.netPLCents).toBe(-30_000);
  });

  it('routes one-time frequency or Implementation category to oneTime, excluded from netPL', () => {
    const result = bucketRows([
      row({ identifiedCents: 100_000, category: 'HC savings' }),
      row({ identifiedCents: 20_000, frequency: 'One-time', category: 'HC savings' }),
      row({ identifiedCents: 15_000, category: 'Implementation', frequency: 'Run rate' }),
    ]);
    expect(result.oneTimeCents).toBe(35_000);
    expect(result.grossCents).toBe(100_000);
    expect(result.netPLCents).toBe(100_000);
  });

  it('is case-insensitive on category and frequency', () => {
    const result = bucketRows([row({ identifiedCents: 10_000, category: 'hc REINVESTMENT' })]);
    expect(result.reinvestCents).toBe(10_000);
  });
});

describe('validatedSubtotal — A4', () => {
  it('excludes Not confirmed rows regardless of case', () => {
    const rows: ValidationRow[] = [
      vrow({ validatedCents: 50_000, status: 'Confirmed' }),
      vrow({ validatedCents: 20_000, status: 'Not confirmed' }),
      vrow({ validatedCents: 5_000, status: 'not confirmed' as ValidationRow['status'] }),
    ];
    expect(validatedSubtotal(rows)).toBe(50_000);
  });

  it('is zero when every row is Not confirmed', () => {
    expect(validatedSubtotal([vrow({ validatedCents: 1_000, status: 'Not confirmed' })])).toBe(0);
  });
});

function deptWith(over: Partial<Department>): Department {
  return { initiatives: [], baseline: null, validations: [], ...over };
}

describe('deptCurrentIdentified — A5 live identified restatement', () => {
  it('returns 0 with no baseline at all', () => {
    expect(deptCurrentIdentified(deptWith({}))).toBe(0);
  });

  it('falls back to the baseline total when no validation has been approved', () => {
    const d = deptWith({ baseline: { locked: true, rows: [row({ identifiedCents: 100_000 })] } });
    expect(deptCurrentIdentified(d)).toBe(deptIdentifiedTotal(d));
    expect(deptCurrentIdentified(d)).toBe(100_000);
  });

  it('falls back to baseline when the only validation is still pending', () => {
    const d = deptWith({
      baseline: { locked: true, rows: [row({ identifiedCents: 100_000 })] },
      validations: [{ version: 1, status: 'pending', validatedSubtotalCents: 40_000, rows: [vrow({ identifiedCents: 100_000, validatedCents: 40_000, status: 'Confirmed' })] }],
    });
    expect(deptCurrentIdentified(d)).toBe(100_000);
  });

  it('excludes rows the approved version marks Not confirmed, restating identified', () => {
    const d = deptWith({
      baseline: {
        locked: true,
        rows: [row({ identifiedCents: 100_000, initiativeId: 'ai' }), row({ identifiedCents: 40_000, initiativeId: 'entity' })],
      },
      validations: [
        {
          version: 1,
          status: 'approved',
          validatedSubtotalCents: 60_000,
          rows: [
            vrow({ identifiedCents: 100_000, initiativeId: 'ai', status: 'Confirmed', validatedCents: 60_000 }),
            vrow({ identifiedCents: 40_000, initiativeId: 'entity', status: 'Not confirmed', validatedCents: 0 }),
          ],
        },
      ],
    });
    // The Not confirmed 'entity' row (40k) drops out of the live netPL entirely.
    expect(deptCurrentIdentified(d)).toBe(100_000);
    expect(initCurrentIdentified(d, 'entity')).toBe(0);
    expect(initCurrentIdentified(d, 'ai')).toBe(100_000);
  });

  it('only ever reads the LATEST approved version, not an earlier one', () => {
    const d = deptWith({
      baseline: { locked: true, rows: [row({ identifiedCents: 100_000 })] },
      validations: [
        { version: 1, status: 'approved', validatedSubtotalCents: 100_000, rows: [vrow({ identifiedCents: 100_000, validatedCents: 100_000, status: 'Confirmed' })] },
        { version: 2, status: 'approved', validatedSubtotalCents: 0, rows: [vrow({ identifiedCents: 100_000, validatedCents: 0, status: 'Not confirmed' })] },
      ],
    });
    expect(deptCurrentIdentified(d)).toBe(0);
    expect(deptValidatedTotal(d)).toBe(0);
  });
});

describe('coverage / statusMeta thresholds — A7', () => {
  it('computes ratio of delivered to target', () => {
    expect(coverage(100_000, 95_000)).toBeCloseTo(0.95);
  });

  it('treats a zero target with zero delivered as 0 coverage', () => {
    expect(coverage(0, 0)).toBe(0);
  });

  it('treats a zero target with any delivered dollars as 100% coverage', () => {
    expect(coverage(0, 1)).toBe(1);
  });

  it('labels >=95% On track (green)', () => {
    expect(statusMeta(100_000, 95_000)).toEqual({ label: 'On track', clr: '#628B48' });
  });

  it('labels >=60% and <95% At risk (amber)', () => {
    expect(statusMeta(100_000, 60_000)).toEqual({ label: 'At risk', clr: '#B0560F' });
    expect(statusMeta(100_000, 94_999)).toEqual({ label: 'At risk', clr: '#B0560F' });
  });

  it('labels <60% Behind (red)', () => {
    expect(statusMeta(100_000, 59_999)).toEqual({ label: 'Behind', clr: '#B3001B' });
    expect(statusMeta(100_000, 0)).toEqual({ label: 'Behind', clr: '#B3001B' });
  });
});

describe('deptGates — A8 gate state machine', () => {
  it('g1 todo when no initiative has a target or a lock', () => {
    const d = deptWith({ initiatives: [{ initiativeId: 'ai', targetCents: 0, locked: false }] });
    expect(deptGates(d).g1).toBe('todo');
  });

  it('g1 draft when some but not all initiatives are locked or have a value', () => {
    const d = deptWith({
      initiatives: [
        { initiativeId: 'ai', targetCents: 50_000, locked: false },
        { initiativeId: 'entity', targetCents: 0, locked: false },
      ],
    });
    expect(deptGates(d).g1).toBe('draft');
  });

  it('g1 locked only when every carried initiative is locked', () => {
    const d = deptWith({
      initiatives: [
        { initiativeId: 'ai', targetCents: 50_000, locked: true },
        { initiativeId: 'entity', targetCents: 20_000, locked: true },
      ],
    });
    expect(deptGates(d).g1).toBe('locked');
  });

  it('g2 todo with no baseline, review while unlocked, locked once approved', () => {
    const noBaseline = deptWith({});
    const inReview = deptWith({ baseline: { locked: false, rows: [] } });
    const locked = deptWith({ baseline: { locked: true, rows: [] } });
    expect(deptGates(noBaseline).g2).toBe('todo');
    expect(deptGates(inReview).g2).toBe('review');
    expect(deptGates(locked).g2).toBe('locked');
  });

  it('g3 blocked until g2 is locked, then ready with zero versions, then active', () => {
    const blocked = deptWith({ baseline: { locked: false, rows: [] } });
    const ready = deptWith({ baseline: { locked: true, rows: [] } });
    const active = deptWith({
      baseline: { locked: true, rows: [] },
      validations: [{ version: 1, status: 'pending', validatedSubtotalCents: 0, rows: [] }],
    });
    expect(deptGates(blocked).g3).toBe('blocked');
    expect(deptGates(ready).g3).toBe('ready');
    expect(deptGates(active).g3).toBe('active');
  });

  it('deptTarget sums every carried initiative regardless of lock state', () => {
    const d = deptWith({
      initiatives: [
        { initiativeId: 'ai', targetCents: 50_000, locked: true },
        { initiativeId: 'entity', targetCents: 20_000, locked: false },
      ],
    });
    expect(deptTarget(d)).toBe(70_000);
  });
});
