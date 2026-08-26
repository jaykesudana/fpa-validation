'use client';

import { useState } from 'react';
import { GateChip } from '@/components/ui/GateChip';
import { api, uploadFile } from '@/lib/api-client';
import type { GateState } from '@/lib/calc/vcp';
import { fmtCents, fmtCentsSigned } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';
import type { VcpValidationVersion } from '@/lib/types/vcp';
import { UploadDropzone } from './UploadDropzone';

interface Props {
  deptId: string;
  fy: string;
  gateState: GateState;
  targetCents: number;
  validations: VcpValidationVersion[];
  onChanged: () => void;
}

export function Gate3Panel({ deptId, fy, gateState, targetCents, validations, onChanged }: Props) {
  const { me } = useSession();
  const { showToast } = useToast();
  const isAdmin = me?.user.role === 'admin';
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleUpload(file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('deptId', deptId);
    form.append('fy', fy);
    try {
      const res = await uploadFile<{ validation: { version: number } }>('/api/vcp/validations', form);
      showToast(`Validation v${res.validation.version} uploaded — pending approval.`, 'success');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed.', 'error');
    }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await api.post(`/api/vcp/validations/${id}/approve`);
      showToast('Validation approved.', 'success');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not approve.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    if (!note.trim()) {
      showToast('A note is required to reject.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/vcp/validations/${id}/reject`, { note });
      showToast('Validation rejected.', 'success');
      setRejectingId(null);
      setNote('');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reject.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (gateState === 'blocked') {
    return (
      <div className="panel">
        <div className="row--between">
          <p className="panel__title">Gate 3 · Validation</p>
          <GateChip state={gateState} />
        </div>
        <div className="empty-state">Gate 2 must be approved before validation can begin.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="row--between">
        <div>
          <p className="panel__title">Gate 3 · Validation</p>
          <p className="panel__sub">Records a new version · submitted for admin approval before it rolls into totals.</p>
        </div>
        <GateChip state={gateState} />
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <UploadDropzone label="Drop your validation file, or click to browse" onFile={handleUpload} />
        </div>
        <div className="panel" style={{ width: 260, margin: 0, background: 'var(--idc-bearing-gray)' }}>
          <p className="panel__sub" style={{ margin: '0 0 12px' }}>
            Start from the baseline
          </p>
          <p style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 16 }}>
            Pull the locked Gate 2 file with Status, Validated amount, Validated date &amp; Status update columns added.
          </p>
          <a className="idc-btn idc-btn--primary idc-btn--full" href={`/api/vcp/baseline-export?deptId=${deptId}&fy=${fy}`}>
            Download baseline
          </a>
        </div>
      </div>

      {validations.length === 0 ? (
        <div className="empty-state">No validation versions yet.</div>
      ) : (
        <table className="idc-table idc-table--dense">
          <thead>
            <tr>
              <th>Version</th>
              <th>File</th>
              <th>Uploaded by</th>
              <th className="num">Rows</th>
              <th className="num">Delivered</th>
              <th className="num">Δ vs target</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {validations.map((v) => {
              const delta = v.validatedSubtotalCents - targetCents;
              return (
                <tr key={v.id}>
                  <td>v{v.version}</td>
                  <td>{v.fileName}</td>
                  <td>
                    {v.uploadedByName}
                    <br />
                    <span className="muted" style={{ fontSize: 11 }}>
                      {new Date(v.uploadedAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="num">{v.rowCount}</td>
                  <td className="num">{fmtCents(v.validatedSubtotalCents)}</td>
                  <td className="num" style={{ color: delta >= 0 ? '#628B48' : '#B3001B', fontWeight: 700 }}>
                    {fmtCentsSigned(delta)}
                  </td>
                  <td>
                    {v.state === 'pending' ? (
                      <span className="chip" style={{ color: '#166BF4', background: 'rgba(22,107,244,0.14)' }}>
                        Pending — not counted yet
                      </span>
                    ) : v.state === 'approved' ? (
                      <span className="chip" style={{ color: '#628B48', background: 'rgba(98,139,72,0.14)' }}>
                        Approved
                      </span>
                    ) : (
                      <span className="chip" style={{ color: '#B3001B', background: 'rgba(179,0,27,0.10)' }}>
                        Rejected
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <a className="idc-btn idc-btn--ghost" href={`/api/vcp/validations/${v.id}/export`}>
                        Download
                      </a>
                      {isAdmin && v.state === 'pending' && (
                        <>
                          <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={() => approve(v.id)}>
                            Approve
                          </button>
                          <button type="button" className="idc-btn idc-btn--ghost" disabled={busy} onClick={() => setRejectingId(v.id)}>
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                    {rejectingId === v.id && (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={2}
                          style={{ width: '100%' }}
                          placeholder="Reason for rejection…"
                        />
                        <div className="row" style={{ marginTop: 6 }}>
                          <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={() => reject(v.id)}>
                            Confirm reject
                          </button>
                          <button
                            type="button"
                            className="idc-btn idc-btn--ghost"
                            onClick={() => {
                              setRejectingId(null);
                              setNote('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
