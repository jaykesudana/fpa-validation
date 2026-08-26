'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { InvStatusChip } from '@/components/ui/InvStatusChip';
import { api } from '@/lib/api-client';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';
import type { BucketResponse, InvRequestListItem } from '@/lib/types/investments';

type Tab = 'list' | 'dept' | 'initiative' | 'region';

export default function InvestmentsPage() {
  const { me } = useSession();
  const { showToast } = useToast();
  const [bucket, setBucket] = useState<BucketResponse | null>(null);
  const [requests, setRequests] = useState<InvRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('list');
  const [editingBucket, setEditingBucket] = useState(false);
  const [totalInput, setTotalInput] = useState('');
  const [reserveInput, setReserveInput] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api.get<BucketResponse>('/api/inv/bucket').catch(() => null),
      api.get<{ requests: InvRequestListItem[] }>('/api/inv/requests').then((r) => r.requests),
    ])
      .then(([b, r]) => {
        setBucket(b);
        setRequests(r);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const isAdmin = me?.user.role === 'admin';

  async function saveBucket() {
    if (!bucket) return;
    try {
      await api.put('/api/inv/bucket', {
        fy: bucket.fiscal,
        totalCents: Math.round(Number(totalInput) * 100),
        reserveCents: Math.round(Number(reserveInput) * 100),
      });
      showToast('Bucket updated.', 'success');
      setEditingBucket(false);
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the bucket.', 'error');
    }
  }

  const grouped = useMemo(() => {
    if (tab === 'dept') return groupBy(requests, (r) => r.dept);
    if (tab === 'initiative') return groupBy(requests, (r) => r.initiative ?? '—');
    if (tab === 'region') return groupBy(requests, (r) => r.region);
    return null;
  }, [requests, tab]);

  return (
    <>
      <PageHeader eyebrow="Investment Requests" title="Capital & program requests" subtitle={bucket ? bucket.fiscal : undefined} />

      {loading && <div className="empty-state">Loading…</div>}

      {!loading && bucket && (
        <div className="panel">
          <div className="row--between">
            <p className="panel__title">{bucket.fiscal} pool</p>
            {isAdmin && !editingBucket && (
              <button
                type="button"
                className="idc-btn idc-btn--ghost"
                onClick={() => {
                  setEditingBucket(true);
                  setTotalInput(String(bucket.total / 100));
                  setReserveInput(String(bucket.reserve / 100));
                }}
              >
                Edit
              </button>
            )}
          </div>

          {bucket.overcommitted && (
            <div className="chip" style={{ color: '#B0560F', background: 'rgba(246,111,19,0.14)', marginBottom: 12 }}>
              Overcommitted — approved + pending exceeds available.
            </div>
          )}

          {editingBucket ? (
            <div className="row" style={{ gap: 16 }}>
              <div>
                <label className="section-label">Total</label>
                <br />
                <input type="number" value={totalInput} onChange={(e) => setTotalInput(e.target.value)} />
              </div>
              <div>
                <label className="section-label">Reserve</label>
                <br />
                <input type="number" value={reserveInput} onChange={(e) => setReserveInput(e.target.value)} />
              </div>
              <button type="button" className="idc-btn idc-btn--primary" onClick={saveBucket}>
                Save
              </button>
              <button type="button" className="idc-btn idc-btn--ghost" onClick={() => setEditingBucket(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="kpi-strip" style={{ boxShadow: 'none' }}>
              <div className="kpi-group">
                <div className="kpi-tile">
                  <p className="kpi-tile__label">Total</p>
                  <p className="kpi-tile__value">{fmtCents(bucket.total)}</p>
                </div>
                <div className="kpi-tile">
                  <p className="kpi-tile__label">Reserve</p>
                  <p className="kpi-tile__value">{fmtCents(bucket.reserve)}</p>
                </div>
                <div className="kpi-tile">
                  <p className="kpi-tile__label">Available</p>
                  <p className="kpi-tile__value">{fmtCents(bucket.available)}</p>
                </div>
                <div className="kpi-tile">
                  <p className="kpi-tile__label">Approved</p>
                  <p className="kpi-tile__value">{fmtCents(bucket.approved)}</p>
                </div>
                <div className="kpi-tile">
                  <p className="kpi-tile__label">In flight</p>
                  <p className="kpi-tile__value">{fmtCents(bucket.pending)}</p>
                </div>
                <div className="kpi-tile">
                  <p className="kpi-tile__label">Unallocated</p>
                  <p className="kpi-tile__value">{fmtCents(bucket.unallocated)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="row--between" style={{ marginBottom: 16 }}>
        <div className="pill-tabs" style={{ margin: 0 }}>
          <button type="button" className={tab === 'list' ? 'pill-tab is-active' : 'pill-tab'} onClick={() => setTab('list')}>
            List
          </button>
          <button type="button" className={tab === 'dept' ? 'pill-tab is-active' : 'pill-tab'} onClick={() => setTab('dept')}>
            By department
          </button>
          <button type="button" className={tab === 'initiative' ? 'pill-tab is-active' : 'pill-tab'} onClick={() => setTab('initiative')}>
            By initiative
          </button>
          <button type="button" className={tab === 'region' ? 'pill-tab is-active' : 'pill-tab'} onClick={() => setTab('region')}>
            By region
          </button>
        </div>
        <Link href="/investments/new" className="idc-btn idc-btn--primary">
          New request
        </Link>
      </div>

      {!loading && requests.length === 0 && <div className="empty-state">No investment requests yet.</div>}

      {!loading &&
        requests.length > 0 &&
        (tab === 'list' ? (
          <div className="panel">
            <RequestTable rows={requests} />
          </div>
        ) : (
          Object.entries(grouped ?? {}).map(([key, rows]) => (
            <div className="panel" key={key}>
              <p className="panel__title">{key}</p>
              <RequestTable rows={rows} />
            </div>
          ))
        ))}
    </>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

function RequestTable({ rows }: { rows: InvRequestListItem[] }) {
  return (
    <table className="idc-table idc-table--zebra">
      <thead>
        <tr>
          <th>Ref</th>
          <th>Title</th>
          <th>Department</th>
          <th>Initiative</th>
          <th>Type</th>
          <th>Country / region</th>
          <th className="num">Amount</th>
          <th>Status</th>
          <th>Last action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <Link href={`/investments/${r.id}`}>{r.ref}</Link>
            </td>
            <td>{r.title || <span className="muted">Untitled</span>}</td>
            <td>{r.dept}</td>
            <td>{r.initiative ?? '—'}</td>
            <td>{r.type}</td>
            <td>
              {r.country} / {r.region}
            </td>
            <td className="num">{fmtCents(r.amount)}</td>
            <td>
              <InvStatusChip status={r.status.value} />
            </td>
            <td>
              {r.lastAction.by}
              {r.lastAction.at && (
                <>
                  <br />
                  <span className="muted" style={{ fontSize: 11 }}>
                    {new Date(r.lastAction.at).toLocaleString()}
                  </span>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
