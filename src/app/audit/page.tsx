'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { api } from '@/lib/api-client';
import { auditLink } from '@/lib/audit-link';

interface AuditEntry {
  at: string;
  actorName: string;
  actorRole: string;
  tower: string;
  entityType: string;
  entityId: string | null;
  departmentId: string | null;
  action: string;
  fromState: string | null;
  toState: string | null;
  note: string | null;
}

interface CatalogDept {
  id: string;
  name: string;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [towerFilter, setTowerFilter] = useState<'all' | 'vcp' | 'inv'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<{ entries: AuditEntry[] }>('/api/audit?limit=300').then((r) => r.entries),
      api
        .get<{ departments: CatalogDept[] }>('/api/catalog')
        .then((c) => new Map(c.departments.map((d) => [d.id, d.name])))
        .catch(() => new Map<string, string>()),
    ])
      .then(([e, names]) => {
        setEntries(e);
        setDeptNames(names);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (towerFilter !== 'all' && e.tower !== towerFilter) return false;
      if (!q) return true;
      const haystack = [e.actorName, e.action, e.note ?? '', e.departmentId ? deptNames.get(e.departmentId) ?? e.departmentId : '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, towerFilter, search, deptNames]);

  return (
    <>
      <PageHeader eyebrow="Audit" title="Audit log" subtitle="Every mutation across both towers, newest first." />

      <div className="row" style={{ marginBottom: 16, gap: 12 }}>
        <select value={towerFilter} onChange={(e) => setTowerFilter(e.target.value as 'all' | 'vcp' | 'inv')}>
          <option value="all">All towers</option>
          <option value="vcp">Value Creation Plan</option>
          <option value="inv">Investment Requests</option>
        </select>
        <input
          type="text"
          placeholder="Search actor, action, note, department…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 360 }}
        />
      </div>

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && filtered.length === 0 && <div className="empty-state">No activity found.</div>}

      {!loading && filtered.length > 0 && (
        <div className="panel">
          <table className="idc-table idc-table--dense idc-table--zebra">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Tower</th>
                <th>Action</th>
                <th>Department</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => {
                const link = auditLink(e);
                const deptLabel = e.departmentId ? deptNames.get(e.departmentId) ?? e.departmentId : '—';
                return (
                  <tr key={idx}>
                    <td className="muted" style={{ fontSize: 11 }}>
                      {new Date(e.at).toLocaleString()}
                    </td>
                    <td>
                      {e.actorName}
                      <br />
                      <span className="muted" style={{ fontSize: 11 }}>
                        {e.actorRole}
                      </span>
                    </td>
                    <td>{e.tower === 'vcp' ? 'VCP' : e.tower === 'inv' ? 'Investments' : e.tower}</td>
                    <td>
                      {e.action}
                      {e.fromState && e.toState && (
                        <>
                          <br />
                          <span className="muted" style={{ fontSize: 11 }}>
                            {e.fromState} → {e.toState}
                          </span>
                        </>
                      )}
                    </td>
                    <td>{deptLabel}</td>
                    <td style={{ maxWidth: 280 }}>{e.note ?? ''}</td>
                    <td>
                      {link && (
                        <Link href={link.href} className="idc-btn idc-btn--ghost">
                          {link.label}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
