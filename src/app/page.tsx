'use client';

import { Presentation } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { CoverageChip } from '@/components/ui/CoverageChip';
import { api } from '@/lib/api-client';
import { coverage } from '@/lib/calc/vcp';
import { fmtCents } from '@/lib/calc/format';
import { exportPresentationDeck } from '@/lib/export/presentation';
import { useToast } from '@/lib/toast-context';

interface SummaryDeptRow {
  dept: string;
  deptId: string;
  seesV: boolean;
  seesI: boolean;
  target: number;
  identified: number;
  delivered: number;
  coverage: number;
  invApproved: number;
  invPending: number;
  invApprovedCount: number;
  invPendingCount: number;
}
interface SummaryTotals {
  target: number;
  identified: number;
  delivered: number;
  invApproved: number;
  invPending: number;
  invApprovedCount: number;
  invPendingCount: number;
  coverage: number;
}
interface SummaryGroup {
  key: string;
  name: string;
  rows: SummaryDeptRow[];
  totals: SummaryTotals;
}
interface VcpInitiativeRow {
  name: string;
  target: number;
  identified: number;
  delivered: number;
  coverage: number;
}
interface InvInitiativeRow {
  name: string;
  approved: number;
  pending: number;
  requestCount: number;
}
interface SummaryResponse {
  fiscalYear: string;
  groups: SummaryGroup[];
  initiatives: { vcp: VcpInitiativeRow[]; inv: InvInitiativeRow[] };
}
interface BucketResponse {
  total: number;
  approved: number;
  pending: number;
  unallocated: number;
}

export default function SummaryPage() {
  const { showToast } = useToast();
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [bucket, setBucket] = useState<BucketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState('all');
  const [lens, setLens] = useState<'dept' | 'initiative'>('dept');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<SummaryResponse>('/api/summary?group=all'),
      api.get<BucketResponse>('/api/inv/bucket').catch(() => null),
    ])
      .then(([summary, b]) => {
        setData(summary);
        setBucket(b);
      })
      .finally(() => setLoading(false));
  }, []);

  const vcpTotals = useMemo(() => {
    const base = { target: 0, identified: 0, delivered: 0 };
    if (!data) return base;
    return data.groups.reduce(
      (acc, g) => ({
        target: acc.target + g.totals.target,
        identified: acc.identified + g.totals.identified,
        delivered: acc.delivered + g.totals.delivered,
      }),
      base,
    );
  }, [data]);

  const groupTabs = useMemo(
    () => [{ key: 'all', name: 'All' }, ...(data?.groups.map((g) => ({ key: g.key, name: g.name })) ?? [])],
    [data],
  );
  const visibleGroups = useMemo(() => {
    if (!data) return [];
    return activeGroup === 'all' ? data.groups : data.groups.filter((g) => g.key === activeGroup);
  }, [data, activeGroup]);

  async function handleExportDeck() {
    if (!data) return;
    setExporting(true);
    try {
      // Always the full "all groups" breadth, regardless of the tab
      // currently selected on-screen — a presentation deck is meant to be
      // the complete picture, not whatever narrow filter someone's looking
      // at when they click Export. Otherwise scoped exactly like the page
      // itself: only what this viewer's own department grants show them.
      await exportPresentationDeck({
        fiscalYearLabel: data.fiscalYear,
        groups: data.groups,
        vcpInitiatives: data.initiatives.vcp,
        invInitiatives: data.initiatives.inv,
        bucket,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not build the presentation.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Summary"
        title="Portfolio summary"
        subtitle={data ? `${data.fiscalYear} — combined view of savings and investment` : undefined}
      />

      {!loading && data && (
        <div className="row" style={{ marginBottom: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="idc-btn idc-btn--primary" disabled={exporting} onClick={handleExportDeck}>
            <Presentation size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
            {exporting ? 'Building…' : 'Export presentation'}
          </button>
        </div>
      )}

      {loading && <div className="empty-state">Loading…</div>}

      {!loading && !data && <div className="empty-state">Could not load the summary.</div>}

      {!loading && data && (
        <>
          <div className="kpi-strip">
            <div className="kpi-group">
              <div className="kpi-tile">
                <p className="kpi-tile__label">VCP target</p>
                <p className="kpi-tile__value">{fmtCents(vcpTotals.target)}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Identified</p>
                <p className="kpi-tile__value">{fmtCents(vcpTotals.identified)}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Delivered</p>
                <p className="kpi-tile__value">{fmtCents(vcpTotals.delivered)}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Coverage</p>
                <p className="kpi-tile__value">{Math.round(coverage(vcpTotals.target, vcpTotals.delivered) * 100)}%</p>
              </div>
            </div>
            <div className="kpi-group">
              <div className="kpi-tile">
                <p className="kpi-tile__label">Investment pool</p>
                <p className="kpi-tile__value">{bucket ? fmtCents(bucket.total) : '—'}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Approved</p>
                <p className="kpi-tile__value">{bucket ? fmtCents(bucket.approved) : '—'}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">In flight</p>
                <p className="kpi-tile__value">{bucket ? fmtCents(bucket.pending) : '—'}</p>
              </div>
              <div className="kpi-tile">
                <p className="kpi-tile__label">Unallocated</p>
                <p className="kpi-tile__value">{bucket ? fmtCents(bucket.unallocated) : '—'}</p>
              </div>
            </div>
          </div>

          <div className="pill-tabs">
            {groupTabs.map((g) => (
              <button
                key={g.key}
                type="button"
                className={activeGroup === g.key ? 'pill-tab is-active' : 'pill-tab'}
                onClick={() => setActiveGroup(g.key)}
              >
                {g.name}
              </button>
            ))}
          </div>

          <div className="pill-tabs">
            <button type="button" className={lens === 'dept' ? 'pill-tab is-active' : 'pill-tab'} onClick={() => setLens('dept')}>
              By department
            </button>
            <button
              type="button"
              className={lens === 'initiative' ? 'pill-tab is-active' : 'pill-tab'}
              onClick={() => setLens('initiative')}
            >
              By initiative
            </button>
          </div>

          {lens === 'dept' &&
            (visibleGroups.length === 0 ? (
              <div className="empty-state">No departments visible in this group.</div>
            ) : (
              visibleGroups.map((g) => (
                <div className="panel" key={g.key}>
                  <p className="panel__title">{g.name}</p>
                  <table className="idc-table idc-table--zebra">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th className="num">Target</th>
                        <th className="num">Identified</th>
                        <th className="num">Delivered</th>
                        <th className="num">Coverage</th>
                        <th className="num">Approved</th>
                        <th className="num">In flight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.deptId}>
                          <td>{r.dept}</td>
                          <td className="num">{r.seesV ? fmtCents(r.target) : '—'}</td>
                          <td className="num">{r.seesV ? fmtCents(r.identified) : '—'}</td>
                          <td className="num">{r.seesV ? fmtCents(r.delivered) : '—'}</td>
                          <td className="num">{r.seesV ? <CoverageChip targetCents={r.target} deliveredCents={r.delivered} /> : '—'}</td>
                          <td className="num">{r.seesI ? fmtCents(r.invApproved) : '—'}</td>
                          <td className="num">{r.seesI ? fmtCents(r.invPending) : '—'}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '1.5px solid var(--idc-ink)', fontWeight: 700 }}>
                        <td>Subtotal</td>
                        <td className="num">{fmtCents(g.totals.target)}</td>
                        <td className="num">{fmtCents(g.totals.identified)}</td>
                        <td className="num">{fmtCents(g.totals.delivered)}</td>
                        <td className="num">{Math.round(g.totals.coverage * 100)}%</td>
                        <td className="num">{fmtCents(g.totals.invApproved)}</td>
                        <td className="num">{fmtCents(g.totals.invPending)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))
            ))}

          {lens === 'initiative' && (
            <>
              <div className="panel">
                <p className="panel__title">VCP initiatives</p>
                <table className="idc-table idc-table--zebra">
                  <thead>
                    <tr>
                      <th>Initiative</th>
                      <th className="num">Target</th>
                      <th className="num">Identified</th>
                      <th className="num">Delivered</th>
                      <th className="num">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.initiatives.vcp.map((i) => (
                      <tr key={i.name}>
                        <td>{i.name}</td>
                        <td className="num">{fmtCents(i.target)}</td>
                        <td className="num">{fmtCents(i.identified)}</td>
                        <td className="num">{fmtCents(i.delivered)}</td>
                        <td className="num">
                          <CoverageChip targetCents={i.target} deliveredCents={i.delivered} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel">
                <p className="panel__title">Investment initiatives</p>
                <table className="idc-table idc-table--zebra">
                  <thead>
                    <tr>
                      <th>Initiative</th>
                      <th className="num">Approved</th>
                      <th className="num">In flight</th>
                      <th className="num">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.initiatives.inv.map((i) => (
                      <tr key={i.name}>
                        <td>{i.name}</td>
                        <td className="num">{fmtCents(i.approved)}</td>
                        <td className="num">{fmtCents(i.pending)}</td>
                        <td className="num">{i.requestCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
