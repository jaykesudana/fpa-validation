'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { api } from '@/lib/api-client';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';

interface LineItem {
  departmentId: string;
  departmentName: string;
  version: string;
  versionState: string;
  sourceFileName: string;
  uploadedByName: string;
  uploadedAt: string;
  rowNo: number;
  initiativeId: string;
  initiativeName: string;
  deptNo: string;
  name: string;
  category: string;
  eeId: string;
  country: string;
  frequency: string;
  targetDate: string;
  identifiedCents: number;
  notes: string;
  status: string | null;
  validatedCents: number | null;
  validatedDate: string | null;
  statusUpdate: string | null;
}

interface LineItemsResponse {
  fiscalYear: string;
  lineItems: LineItem[];
}

const ALL = '__all__';

export default function LineItemsPage() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';

  const [data, setData] = useState<LineItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deptFilter, setDeptFilter] = useState(ALL);
  const [initiativeFilter, setInitiativeFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    setError(false);
    api
      .get<LineItemsResponse>('/api/vcp/line-items')
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const depts = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of data?.lineItems ?? []) map.set(r.departmentId, r.departmentName);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const initiatives = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of data?.lineItems ?? []) map.set(r.initiativeId, r.initiativeName);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.lineItems ?? []) set.add(r.category);
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    return (data?.lineItems ?? []).filter(
      (r) =>
        (deptFilter === ALL || r.departmentId === deptFilter) &&
        (initiativeFilter === ALL || r.initiativeId === initiativeFilter) &&
        (categoryFilter === ALL || r.category === categoryFilter),
    );
  }, [data, deptFilter, initiativeFilter, categoryFilter]);

  if (!isAdmin) {
    return (
      <>
        <PageHeader eyebrow="Value Creation Plan" title="Line items" />
        <div className="empty-state">This view is restricted to Admins.</div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Value Creation Plan" title="Line items — all departments" subtitle={data ? data.fiscalYear : undefined} />

      <div className="row" style={{ marginBottom: 16, gap: 12 }}>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value={ALL}>All departments</option>
          {depts.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={initiativeFilter} onChange={(e) => setInitiativeFilter(e.target.value)}>
          <option value={ALL}>All initiatives</option>
          {initiatives.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value={ALL}>All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && error && <div className="empty-state">Could not load line items.</div>}
      {!loading && !error && filtered.length === 0 && <div className="empty-state">No line items match these filters.</div>}

      {!loading && !error && filtered.length > 0 && (
        <div className="panel">
          <table className="idc-table idc-table--dense idc-table--zebra">
            <thead>
              <tr>
                <th>Department</th>
                <th>Initiative</th>
                <th>Dept #</th>
                <th>Line item</th>
                <th>Category</th>
                <th>EE ID</th>
                <th>Country</th>
                <th>Frequency</th>
                <th className="num">Identified</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Version</th>
                <th>Uploaded by</th>
                <th>Last uploaded</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.departmentId}-${r.rowNo}-${r.initiativeId}`}>
                  <td>{r.departmentName}</td>
                  <td>{r.initiativeName}</td>
                  <td>{r.deptNo}</td>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td>{r.eeId}</td>
                  <td>{r.country}</td>
                  <td>{r.frequency}</td>
                  <td className="num">{fmtCents(r.identifiedCents)}</td>
                  <td>{r.status ?? '—'}</td>
                  <td style={{ maxWidth: 240 }}>{r.statusUpdate || r.notes}</td>
                  <td>
                    {r.version}
                    <br />
                    <span className="muted" style={{ fontSize: 11 }}>
                      {r.versionState}
                    </span>
                  </td>
                  <td>{r.uploadedByName}</td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    {new Date(r.uploadedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
