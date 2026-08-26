'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { CoverageChip } from '@/components/ui/CoverageChip';
import { GateChip } from '@/components/ui/GateChip';
import { api } from '@/lib/api-client';
import type { GateState } from '@/lib/calc/vcp';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';

interface VcpDeptRow {
  deptId: string;
  name: string;
  l1: string;
  summaryGroup: string;
  gates: { g1: GateState; g2: GateState; g3: GateState };
  target: number;
  identified: number;
  delivered: number;
  coverage: number;
}
interface VcpDeptResponse {
  fiscalYear: string;
  departments: VcpDeptRow[];
}

const L1_ORDER = ['COGS', 'S&M', 'R&D', 'G&A'];

export default function VcpOverviewPage() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  const [data, setData] = useState<VcpDeptResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<VcpDeptResponse>('/api/vcp/departments')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const byL1 = new Map<string, VcpDeptRow[]>();
    for (const d of data.departments) {
      const list = byL1.get(d.l1) ?? [];
      list.push(d);
      byL1.set(d.l1, list);
    }
    const order = [...L1_ORDER.filter((l1) => byL1.has(l1)), ...Array.from(byL1.keys()).filter((l1) => !L1_ORDER.includes(l1))];
    return order.map((l1) => ({ l1, rows: byL1.get(l1) ?? [] }));
  }, [data]);

  return (
    <>
      <PageHeader eyebrow="Value Creation Plan" title="Savings by department" subtitle={data ? data.fiscalYear : undefined} />
      {isAdmin && (
        <div className="row" style={{ marginBottom: 16 }}>
          <Link href="/vcp/line-items" className="idc-btn idc-btn--ghost">
            Line items (all departments)
          </Link>
        </div>
      )}
      {loading && <div className="empty-state">Loading…</div>}
      {!loading && (!data || data.departments.length === 0) && <div className="empty-state">No departments in scope yet.</div>}
      {!loading &&
        data &&
        groups.map((group) => {
          const subtotal = group.rows.reduce(
            (acc, r) => ({ target: acc.target + r.target, identified: acc.identified + r.identified, delivered: acc.delivered + r.delivered }),
            { target: 0, identified: 0, delivered: 0 },
          );
          return (
            <div className="panel" key={group.l1}>
              <p className="panel__title">{group.l1}</p>
              <table className="idc-table idc-table--zebra">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Gate 1</th>
                    <th>Gate 2</th>
                    <th>Gate 3</th>
                    <th className="num">Target</th>
                    <th className="num">Identified</th>
                    <th className="num">Delivered</th>
                    <th className="num">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => (
                    <tr key={r.deptId}>
                      <td>
                        <Link href={`/vcp/${r.deptId}`}>{r.name}</Link>
                      </td>
                      <td>
                        <GateChip state={r.gates.g1} />
                      </td>
                      <td>
                        <GateChip state={r.gates.g2} />
                      </td>
                      <td>
                        <GateChip state={r.gates.g3} />
                      </td>
                      <td className="num">{fmtCents(r.target)}</td>
                      <td className="num">{fmtCents(r.identified)}</td>
                      <td className="num">{fmtCents(r.delivered)}</td>
                      <td className="num">
                        <CoverageChip targetCents={r.target} deliveredCents={r.delivered} />
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1.5px solid var(--idc-ink)', fontWeight: 700 }}>
                    <td colSpan={4}>Subtotal</td>
                    <td className="num">{fmtCents(subtotal.target)}</td>
                    <td className="num">{fmtCents(subtotal.identified)}</td>
                    <td className="num">{fmtCents(subtotal.delivered)}</td>
                    <td className="num" />
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
    </>
  );
}
