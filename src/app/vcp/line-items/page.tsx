'use client';

import { ArrowLeft, Download, Filter } from 'lucide-react';
import Link from 'next/link';
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

// dd-mm-yyyy, no time — uses UTC components so date-only columns (target
// date, validated date) don't shift a day depending on the viewer's
// timezone offset from a stored midnight-UTC value.
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

interface Column {
  key: string;
  label: string;
  get: (r: LineItem) => string;
  sortValue?: (r: LineItem) => number;
  exportValue?: (r: LineItem) => string | number;
}

// Baseline (Gate 2) and Validation (Gate 3) rows have genuinely different
// shapes — validation adds status/validated-amount/validated-date/status
// update on top of what a baseline row has — so each source gets its own
// column set rather than one table with columns that are blank half the time.
const BASELINE_COLUMNS: Column[] = [
  { key: 'department', label: 'Department', get: (r) => r.departmentName },
  { key: 'initiative', label: 'Initiative', get: (r) => r.initiativeName },
  { key: 'deptNo', label: 'Dept #', get: (r) => r.deptNo },
  { key: 'name', label: 'Line item', get: (r) => r.name },
  { key: 'category', label: 'Category', get: (r) => r.category },
  { key: 'eeId', label: 'EE ID', get: (r) => r.eeId },
  { key: 'country', label: 'Country', get: (r) => r.country },
  { key: 'frequency', label: 'Frequency', get: (r) => r.frequency },
  { key: 'targetDate', label: 'Target date', get: (r) => formatDate(r.targetDate) },
  {
    key: 'identified',
    label: 'Identified',
    get: (r) => fmtCents(r.identifiedCents),
    sortValue: (r) => r.identifiedCents,
    exportValue: (r) => r.identifiedCents / 100,
  },
  { key: 'notes', label: 'Notes', get: (r) => r.notes },
  { key: 'uploadedBy', label: 'Uploaded by', get: (r) => r.uploadedByName },
  {
    key: 'uploadedAt',
    label: 'Last uploaded',
    get: (r) => formatDate(r.uploadedAt),
    sortValue: (r) => new Date(r.uploadedAt).getTime(),
  },
];

const VALIDATION_COLUMNS: Column[] = [
  { key: 'department', label: 'Department', get: (r) => r.departmentName },
  { key: 'version', label: 'Version', get: (r) => r.version },
  { key: 'initiative', label: 'Initiative', get: (r) => r.initiativeName },
  { key: 'deptNo', label: 'Dept #', get: (r) => r.deptNo },
  { key: 'name', label: 'Line item', get: (r) => r.name },
  { key: 'category', label: 'Category', get: (r) => r.category },
  { key: 'eeId', label: 'EE ID', get: (r) => r.eeId },
  { key: 'country', label: 'Country', get: (r) => r.country },
  { key: 'frequency', label: 'Frequency', get: (r) => r.frequency },
  { key: 'targetDate', label: 'Target date', get: (r) => formatDate(r.targetDate) },
  {
    key: 'identified',
    label: 'Identified',
    get: (r) => fmtCents(r.identifiedCents),
    sortValue: (r) => r.identifiedCents,
    exportValue: (r) => r.identifiedCents / 100,
  },
  { key: 'status', label: 'Status', get: (r) => r.status ?? '—' },
  {
    key: 'validated',
    label: 'Validated',
    get: (r) => (r.validatedCents == null ? '' : fmtCents(r.validatedCents)),
    sortValue: (r) => r.validatedCents ?? 0,
    exportValue: (r) => (r.validatedCents == null ? '' : r.validatedCents / 100),
  },
  { key: 'validatedDate', label: 'Validated date', get: (r) => formatDate(r.validatedDate) },
  { key: 'statusUpdate', label: 'Status update', get: (r) => r.statusUpdate ?? '' },
  { key: 'notes', label: 'Notes', get: (r) => r.notes },
  { key: 'uploadedBy', label: 'Uploaded by', get: (r) => r.uploadedByName },
  {
    key: 'uploadedAt',
    label: 'Last uploaded',
    get: (r) => formatDate(r.uploadedAt),
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
  const [sourceTab, setSourceTab] = useState<'baseline' | 'validation'>('baseline');
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

  const COLUMNS = sourceTab === 'baseline' ? BASELINE_COLUMNS : VALIDATION_COLUMNS;
  const rows = useMemo(() => (data?.lineItems ?? []).filter((r) => r.source === sourceTab), [data, sourceTab]);

  const valuesByColumn = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      out[col.key] = Array.from(new Set(rows.map((r) => col.get(r)))).sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [rows, COLUMNS]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) =>
      COLUMNS.every((col) => {
        const filter = columnFilters[col.key];
        return !filter || filter.has(col.get(r));
      }),
    );
  }, [rows, columnFilters, COLUMNS]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return filteredRows;
    const withVal = filteredRows.map((r) => ({ r, v: col.sortValue ? col.sortValue(r) : col.get(r) }));
    withVal.sort((a, b) => (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))));
    const ordered = withVal.map((x) => x.r);
    return sort.dir === 'desc' ? ordered.reverse() : ordered;
  }, [filteredRows, sort, COLUMNS]);

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
    const body = sortedRows.map((r) => COLUMNS.map((c) => (c.exportValue ? c.exportValue(r) : c.get(r))));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Line items');
    const sheetLabel = sourceTab === 'baseline' ? 'baseline' : 'validation';
    XLSX.writeFile(wb, `vcp-line-items-${sheetLabel}-${data?.fiscalYear ?? 'export'}.xlsx`);
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
        <div className="row" style={{ gap: 12 }}>
          <Link href="/vcp" className="idc-btn idc-btn--ghost">
            <ArrowLeft size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
            Back
          </Link>
          <div className="pill-tabs" style={{ margin: 0 }}>
            <button
              type="button"
              className={sourceTab === 'baseline' ? 'pill-tab is-active' : 'pill-tab'}
              onClick={() => {
                setSourceTab('baseline');
                setSort(null);
              }}
            >
              Baseline (Gate 2)
            </button>
            <button
              type="button"
              className={sourceTab === 'validation' ? 'pill-tab is-active' : 'pill-tab'}
              onClick={() => {
                setSourceTab('validation');
                setSort(null);
              }}
            >
              Validation (Gate 3)
            </button>
          </div>
        </div>
        <button type="button" className="idc-btn idc-btn--primary" onClick={handleExport} disabled={sortedRows.length === 0}>
          <Download size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          Export
        </button>
      </div>

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && error && <div className="empty-state">Could not load line items.</div>}
      {!loading && !error && sortedRows.length === 0 && <div className="empty-state">No line items match these filters.</div>}

      {!loading && !error && sortedRows.length > 0 && (
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
    </>
  );
}
