'use client';

import { useMemo, useState } from 'react';
import { GateChip } from '@/components/ui/GateChip';
import { api, uploadFile } from '@/lib/api-client';
import { bucketRows, type GateState } from '@/lib/calc/vcp';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';
import type { VcpBaseline } from '@/lib/types/vcp';
import { LineRowsModal } from './LineRowsModal';
import { UploadDropzone } from './UploadDropzone';

const IDENTIFIED_COLUMNS = ['Initiative', 'Name', 'Category', 'EE ID', 'Country', 'Frequency', 'Target date', 'Identified amount', 'Notes'];

interface Props {
  deptId: string;
  fy: string;
  gateState: GateState;
  baseline: VcpBaseline | null;
  onChanged: () => void;
}

export function Gate2Panel({ deptId, fy, gateState, baseline, onChanged }: Props) {
  const { me } = useSession();
  const { showToast } = useToast();
  const isAdmin = me?.user.role === 'admin';
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const [busy, setBusy] = useState(false);

  const rollup = useMemo(() => (baseline ? bucketRows(baseline.rows) : null), [baseline]);
  const byInitiative = useMemo(() => {
    if (!baseline) return [];
    const groups = new Map<string, { name: string; rows: typeof baseline.rows }>();
    for (const r of baseline.rows) {
      const g = groups.get(r.initiativeId) ?? { name: r.initiativeName, rows: [] };
      g.rows.push(r);
      groups.set(r.initiativeId, g);
    }
    return Array.from(groups.values()).map((g) => ({ name: g.name, netPL: bucketRows(g.rows).netPLCents }));
  }, [baseline]);

  async function handleUpload(file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('deptId', deptId);
    form.append('fy', fy);
    try {
      await uploadFile('/api/vcp/uploads', form);
      showToast('Workbook uploaded — in review.', 'success');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed.', 'error');
    }
  }

  async function approve() {
    if (!baseline) return;
    setBusy(true);
    try {
      await api.post(`/api/vcp/uploads/${baseline.id}/approve`);
      showToast('Baseline approved and locked.', 'success');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not approve.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!baseline || !rejectNote.trim()) {
      showToast('A note is required to reject.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/vcp/uploads/${baseline.id}/reject`, { note: rejectNote });
      showToast('Baseline rejected.', 'success');
      setShowReject(false);
      setRejectNote('');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reject.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row--between">
        <div>
          <p className="panel__title">Gate 2 · Identified</p>
          <p className="panel__sub">The department's single identified-savings workbook.</p>
        </div>
        <GateChip state={gateState} />
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <a className="idc-btn idc-btn--ghost" href={`/api/vcp/template?deptId=${deptId}&kind=identified`}>
          Download Excel template
        </a>
      </div>

      {!baseline ? (
        <>
          <UploadDropzone label="Drop the department identified file, or click to browse" onFile={handleUpload} />
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Columns: {IDENTIFIED_COLUMNS.join(' · ')}
          </p>
        </>
      ) : (
        <>
          <div className="row--between" style={{ marginBottom: 12 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700 }}>{baseline.fileName}</p>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {baseline.uploadedByName} · {new Date(baseline.uploadedAt).toLocaleString()} · {baseline.rowCount} rows
              </p>
            </div>
            <div className="row">
              <button type="button" className="idc-btn idc-btn--ghost" onClick={() => setShowRows(true)}>
                View rows
              </button>
              <a className="idc-btn idc-btn--ghost" href={`/api/vcp/uploads/${baseline.id}/export`}>
                Download
              </a>
              {isAdmin && baseline.state === 'review' && (
                <>
                  <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={approve}>
                    Approve
                  </button>
                  <button type="button" className="idc-btn idc-btn--ghost" disabled={busy} onClick={() => setShowReject(true)}>
                    Reject
                  </button>
                </>
              )}
            </div>
          </div>

          {baseline.state === 'rejected' && baseline.rejectNote && (
            <div className="feedback-entry" style={{ borderColor: '#B3001B' }}>
              <p className="feedback-entry__meta">Rejected</p>
              <p className="feedback-entry__body">{baseline.rejectNote}</p>
            </div>
          )}

          {rollup && (
            <div className="row" style={{ gap: 24, margin: '16px 0' }}>
              <div>
                <p className="section-label">Gross</p>
                <p style={{ margin: 0 }}>{fmtCents(rollup.grossCents)}</p>
              </div>
              <div>
                <p className="section-label">Reinvestment</p>
                <p style={{ margin: 0 }}>{fmtCents(rollup.reinvestCents)}</p>
              </div>
              <div>
                <p className="section-label">One-time (memo)</p>
                <p style={{ margin: 0 }}>{fmtCents(rollup.oneTimeCents)}</p>
              </div>
              <div>
                <p className="section-label">Net P&amp;L</p>
                <p style={{ margin: 0, fontWeight: 700 }}>{fmtCents(rollup.netPLCents)}</p>
              </div>
            </div>
          )}

          {byInitiative.length > 0 && (
            <table className="idc-table idc-table--dense" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Initiative</th>
                  <th className="num">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {byInitiative.map((i) => (
                  <tr key={i.name}>
                    <td>{i.name}</td>
                    <td className="num">{fmtCents(i.netPL)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="section-label">Supporting evidence · click to download</p>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            {baseline.evidence.length === 0 ? (
              <span className="muted">No evidence attached yet.</span>
            ) : (
              baseline.evidence.map((e) => (
                <a key={e.id} className="file-chip" href={`/api/vcp/evidence/${e.id}/download`}>
                  {e.fileName}
                </a>
              ))
            )}
          </div>

          {baseline.state === 'review' && (
            <div style={{ marginTop: 16 }}>
              <UploadDropzone label="Re-upload while in review (replaces the pending file)" onFile={handleUpload} />
            </div>
          )}

          {showReject && (
            <div className="panel" style={{ marginTop: 12, background: 'var(--idc-bearing-gray)' }}>
              <p className="panel__sub">A note is required to reject.</p>
              <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} style={{ width: '100%' }} />
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={reject}>
                  Confirm reject
                </button>
                <button type="button" className="idc-btn idc-btn--ghost" onClick={() => setShowReject(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showRows && baseline && (
        <LineRowsModal
          title={baseline.fileName}
          subtitle={`${baseline.uploadedByName} · ${new Date(baseline.uploadedAt).toLocaleString()} · ${baseline.rowCount} rows`}
          rows={baseline.rows}
          variant="baseline"
          onClose={() => setShowRows(false)}
        />
      )}
    </div>
  );
}
