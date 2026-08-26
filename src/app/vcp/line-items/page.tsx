'use client';

import { Download, Filter } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { PageHeader } from '@/components/chrome/PageHeader';
import { api } from '@/lib/api-client';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';

interface LineItem {
  departmentId: string;
  departmentName: string;
  departmentSummaryGroup: string;
  source: 'baseline' | 'validation';
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

// Same display order used by the Summary tower (src/app/api/summary/route.ts)
// so "Group" reads consistently across the app.
const GROUP_ORDER = ['RDI', 'Events', 'Sales', 'Marketing', 'Customer Success', 'CTO', 'IT', 'Finance', 'HR', 'Legal', 'Executive Leadership', 'Other'];

interface Column {
  key: string;
  label: string;
  get: (r: LineItem) => string;
  sortValue?: (r: LineItem) => number;
  exportValue?: (r: LineItem) => string | number;
}

const COLUMNS: Column[] = [
  { key: 'group', label: 'Group', get: (r) => r.departmentSummaryGroup },
  { key: 'department', label: 'Department', get: (r) => r.departmentName },
  { key: 'source', label: 'Source', get: (r) => (r.source === 'baseline' ? 'Baseline (Gate 2)' : 'Validation (Gate 3)') },
  { key: 'version', label: 'Version', get: (r) => r.version },
  { key: 'initiative', label: 'Initiative', get: (r) => r.initiativeName },
  { key: 'deptNo', label: 'Dept #', get: (r) => r.deptNo },
  { key: 'name', label: 'Line item', get: (r) => r.name },
  { key: 'category', label: 'Category', get: (r) => r.category },
  { key: 'eeId', label: 'EE ID', get: (r) => r.eeId },
  { key: 'country', label: 'Country', get: (r) => r.country },
  { key: 'frequency', label: 'Frequency', get: (r) => r.frequency },
  { key: 'targetDate', label: 'Target date', get: (r) => r.targetDate },
  {
    key: 'identified',
    label: 'Identified',
    get: (r) => fmtCents(r.identifiedCents),
    sortValue: (r) => r.identifiedCents,
    exportValue: (r) => r.identifiedCents / 100,
  },
  { key: 'status', label: 'Status', get: (r) => r.status ?? '—' },
  { key: 'notes', label: 'Notes', get: (r) => r.statusUpdate || r.notes },
  { key: 'uploadedBy', label: 'Uploaded by', get: (r) => r.uploadedByName },
  {
    key: 'uploadedAt',
    label: 'Last uploaded',
    get: (r) => new Date(r.uploadedAt).toLocaleString(),
    sortValue: (r) => new Date(r.uploadedAt).getTime(),
  },
];

function ColumnHeader({
  col,
  values,
  selected,
  onFilterChange,
  sortDir,
  onSort,
}: {
  col: Column;
  values: string[];
  selected: Set<string> | null;
  onFilterChange: (next: Set<string> | null) => void;
  sortDir: 'asc' | 'desc' | null;
  onSort: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const isFiltered = selected !== null;
  const visibleValues = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));

  function toggleValue(v: string) {
    const base = selected ?? new Set(values);
    const next = new Set(base);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onFilterChange(next.size === values.length ? null : next);
  }

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen((o) => !o);
  }

  return (
    <th style={{ whiteSpace: 'nowrap' }}>
      <span style={{ cursor: 'pointer', userSelect: 'none' }} onClick={onSort}>
        {col.label}
        {sortDir === 'asc' && ' ▲'}
        {sortDir === 'desc' && ' ▼'}
      </span>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-label={`Filter ${col.label}`}
        style={{ marginLeft: 4, border: 'none', background: 'none', cursor: 'pointer', color: isFiltered ? '#B0560F' : 'inherit', verticalAlign: 'middle' }}
      >
        <Filter size={12} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 1000,
              minWidth: 200,
              maxHeight: 280,
              overflowY: 'auto',
              padding: 8,
              background: '#fff',
              border: '1px solid var(--idc-ink, #1a1a1a)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              fontWeight: 400,
              fontSize: 12,
            }}
          >
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', marginBottom: 6, fontSize: 12 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <button type="button" className="idc-btn idc-btn--ghost" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => onFilterChange(null)}>
                Select all
              </button>
              <button
                type="button"
                className="idc-btn idc-btn--ghost"
                style={{ padding: '2px 6px', fontSize: 11 }}
                onClick={() => onFilterChange(new Set())}
              >
                Clear
              </button>
            </div>
            {visibleValues.map((v) => (
              <label key={v || '(blank)'} style={{ display: 'block', padding: '2px 0' }}>
                <input type="checkbox" checked={selected === null || selected.has(v)} onChange={() => toggleValue(v)} style={{ marginRight: 6 }} />
                {v || <span className="muted">(blank)</span>}
              </label>
            ))}
            {visibleValues.length === 0 && <div className="muted">No matches.</div>}
          </div>,
          document.body,
        )}
    </th>
  );
}

export default function LineItemsPage() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';

  const [data, setData] = useState<LineItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});

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

  const rows = data?.lineItems ?? [];

  const valuesByColumn = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      out[col.key] = Array.from(new Set(rows.map((r) => col.get(r)))).sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => COLUMNS.every((col) => !columnFilters[col.key] || columnFilters[col.key].has(col.get(r))));
  }, [rows, columnFilters]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return filteredRows;
    const withVal = filteredRows.map((r) => ({ r, v: col.sortValue ? col.sortValue(r) : col.get(r) }));
    withVal.sort((a, b) => (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))));
    const ordered = withVal.map((x) => x.r);
    return sort.dir === 'desc' ? ordered.reverse() : ordered;
  }, [filteredRows, sort]);

  const groupedSections = useMemo(() => {
    const byGroup = new Map<string, LineItem[]>();
    for (const r of sortedRows) {
      const g = r.departmentSummaryGroup || 'Other';
      const list = byGroup.get(g);
      if (list) list.push(r);
      else byGroup.set(g, [r]);
    }
    const present = Array.from(byGroup.keys());
    const order = [...GROUP_ORDER.filter((g) => present.includes(g)), ...present.filter((g) => !GROUP_ORDER.includes(g))];
    return order.map((g) => ({ group: g, rows: byGroup.get(g) ?? [] }));
  }, [sortedRows]);

  const displayRows = viewMode === 'grouped' ? groupedSections.flatMap((s) => s.rows) : sortedRows;

  function handleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  function handleFilterChange(key: string, next: Set<string> | null) {
    setColumnFilters((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }

  function handleExport() {
    const header = COLUMNS.map((c) => c.label);
    const body = displayRows.map((r) => COLUMNS.map((c) => (c.exportValue ? c.exportValue(r) : c.get(r))));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Line items');
    XLSX.writeFile(wb, `vcp-line-items-${data?.fiscalYear ?? 'export'}.xlsx`);
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader eyebrow="Value Creation Plan" title="Line items" />
        <div className="empty-state">This view is restricted to Admins.</div>
      </>
    );
  }

  function renderRow(r: LineItem, idx: number) {
    return (
      <tr key={`${r.departmentId}-${r.source}-${r.rowNo}-${r.initiativeId}-${idx}`}>
        {COLUMNS.map((col) => (
          <td key={col.key} className={col.key === 'identified' ? 'num' : undefined} style={col.key === 'notes' ? { maxWidth: 240 } : undefined}>
            {col.get(r)}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Value Creation Plan" title="Line items — all departments" subtitle={data ? data.fiscalYear : undefined} />

      <div className="row--between" style={{ marginBottom: 16 }}>
        <div className="pill-tabs" style={{ margin: 0 }}>
          <button type="button" className={viewMode === 'flat' ? 'pill-tab is-active' : 'pill-tab'} onClick={() => setViewMode('flat')}>
            Flat list
          </button>
          <button type="button" className={viewMode === 'grouped' ? 'pill-tab is-active' : 'pill-tab'} onClick={() => setViewMode('grouped')}>
            By group
          </button>
        </div>
        <button type="button" className="idc-btn idc-btn--primary" onClick={handleExport} disabled={displayRows.length === 0}>
          <Download size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          Export
        </button>
      </div>

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && error && <div className="empty-state">Could not load line items.</div>}
      {!loading && !error && displayRows.length === 0 && <div className="empty-state">No line items match these filters.</div>}

      {!loading && !error && displayRows.length > 0 && viewMode === 'flat' && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="idc-table idc-table--dense idc-table--zebra">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <ColumnHeader
                    key={col.key}
                    col={col}
                    values={valuesByColumn[col.key] ?? []}
                    selected={columnFilters[col.key] ?? null}
                    onFilterChange={(next) => handleFilterChange(col.key, next)}
                    sortDir={sort?.key === col.key ? sort.dir : null}
                    onSort={() => handleSort(col.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>{sortedRows.map(renderRow)}</tbody>
          </table>
        </div>
      )}

      {!loading &&
        !error &&
        displayRows.length > 0 &&
        viewMode === 'grouped' &&
        groupedSections
          .filter((s) => s.rows.length > 0)
          .map((section) => (
            <div className="panel" key={section.group} style={{ overflowX: 'auto' }}>
              <p className="panel__title">{section.group}</p>
              <table className="idc-table idc-table--dense idc-table--zebra">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <ColumnHeader
                        key={col.key}
                        col={col}
                        values={valuesByColumn[col.key] ?? []}
                        selected={columnFilters[col.key] ?? null}
                        onFilterChange={(next) => handleFilterChange(col.key, next)}
                        sortDir={sort?.key === col.key ? sort.dir : null}
                        onSort={() => handleSort(col.key)}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>{section.rows.map(renderRow)}</tbody>
              </table>
            </div>
          ))}
    </>
  );
}
