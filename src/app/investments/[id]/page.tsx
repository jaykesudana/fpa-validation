'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { AuditTrail } from '@/components/ui/AuditTrail';
import { InvStatusChip } from '@/components/ui/InvStatusChip';
import { api } from '@/lib/api-client';
import { STEPS } from '@/lib/calc/investments';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';
import type { InvRequestDetail } from '@/lib/types/investments';

const PRE_DECISION = ['draft', 'submitted', 'screened', 'returned'];

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function RequestDetailPage({ params }: { params: { id: string } }) {
  const { me } = useSession();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<InvRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<InvRequestDetail>(`/api/inv/requests/${params.id}`)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(load, [load]);

  const isAdmin = me?.user.role === 'admin';

  async function act(action: 'submit' | 'screen' | 'return' | 'approve' | 'reject' | 'withdraw', body?: unknown) {
    setBusy(true);
    try {
      const res = await api.post<{ warning?: string | null }>(`/api/inv/requests/${params.id}/${action}`, body);
      if (res?.warning) showToast(res.warning, 'error');
      else showToast('Done.', 'success');
      setNote('');
      setApprovedAmount('');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Investment Requests" title="Request" />
        <div className="empty-state">Loading…</div>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <PageHeader eyebrow="Investment Requests" title="Request" />
        <div className="empty-state">Could not load this request.</div>
      </>
    );
  }

  const stage = detail.status.stage;
  const status = detail.status.value;

  return (
    <>
      <PageHeader eyebrow="Investment Requests" title={`${detail.ref} · ${detail.title || 'Untitled'}`} />

      <div className="panel">
        <div className="row--between">
          <div className="row">
            <InvStatusChip status={status} />
            <span style={{ fontWeight: 700, fontSize: 18 }}>{fmtCents(detail.amount)}</span>
            {detail.approvedAmount != null && detail.approvedAmount !== detail.amount && (
              <span className="muted">(approved {fmtCents(detail.approvedAmount)})</span>
            )}
          </div>
          {PRE_DECISION.includes(status) && (
            <button type="button" className="idc-btn idc-btn--ghost" disabled={busy} onClick={() => act('withdraw')}>
              Withdraw
            </button>
          )}
        </div>

        <div className="progress-tracker">
          {STEPS.map((s, idx) => (
            <div key={s.key} className="row">
              <span className={idx < stage ? 'progress-step is-done' : idx === stage ? 'progress-step is-current' : 'progress-step'}>
                <span className="progress-dot" />
                {s.label}
              </span>
              {idx < STEPS.length - 1 && <span className="progress-rule" />}
            </div>
          ))}
        </div>

        <table className="idc-table idc-table--dense" style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td>Department</td>
              <td>{detail.dept}</td>
              <td>Initiative</td>
              <td>{detail.initiative ?? '—'}</td>
            </tr>
            <tr>
              <td>Type</td>
              <td>{detail.type}</td>
              <td>Country / region</td>
              <td>
                {detail.country} / {detail.region}
              </td>
            </tr>
            <tr>
              <td>Sponsor</td>
              <td>{detail.sponsor || '—'}</td>
              <td>Exec sponsor</td>
              <td>{detail.execSponsor || '—'}</td>
            </tr>
            <tr>
              <td>Expected return</td>
              <td>{fmtCents(detail.expectedReturn)}</td>
              <td>Payback</td>
              <td>{detail.payback || 'Not stated.'}</td>
            </tr>
          </tbody>
        </table>

        <p className="section-label">Quarterly phasing</p>
        <table className="idc-table idc-table--dense" style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th className="num">Q1</th>
              <th className="num">Q2</th>
              <th className="num">Q3</th>
              <th className="num">Q4</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="num">{fmtCents(detail.phasing.Q1)}</td>
              <td className="num">{fmtCents(detail.phasing.Q2)}</td>
              <td className="num">{fmtCents(detail.phasing.Q3)}</td>
              <td className="num">{fmtCents(detail.phasing.Q4)}</td>
            </tr>
          </tbody>
        </table>

        <p className="section-label">Business case</p>
        <p>{detail.businessCase || 'No business case recorded.'}</p>
        <p className="section-label">Risk</p>
        <p>{detail.risk || 'Not stated.'}</p>

        <p className="section-label">Attachments</p>
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
          {detail.attachments.length === 0 ? (
            <span className="muted">No attachments</span>
          ) : (
            detail.attachments.map((a) => (
              <a key={a.id} className="file-chip" href={`/api/inv/attachments/${a.id}/download`}>
                {a.fileName} ({formatBytes(a.sizeBytes)})
              </a>
            ))
          )}
        </div>

        {(detail.screenNote || detail.decisionNote) && (
          <>
            <p className="section-label">Feedback</p>
            {detail.screenNote && (
              <div className="feedback-entry" style={{ borderColor: status === 'returned' ? '#873142' : '#166BF4' }}>
                <p className="feedback-entry__meta">
                  {detail.screenedByName} · {detail.screenedAt ? new Date(detail.screenedAt).toLocaleString() : ''}
                </p>
                <p className="feedback-entry__body">{detail.screenNote}</p>
              </div>
            )}
            {detail.decisionNote && (
              <div className="feedback-entry" style={{ borderColor: status === 'approved' ? '#628B48' : '#B3001B' }}>
                <p className="feedback-entry__meta">
                  {detail.decidedByName} · {detail.decidedAt ? new Date(detail.decidedAt).toLocaleString() : ''}
                </p>
                <p className="feedback-entry__body">{detail.decisionNote}</p>
              </div>
            )}
          </>
        )}
      </div>

      {(status === 'draft' || status === 'returned') && (
        <div className="panel">
          <p className="panel__title">Submit this request</p>
          <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={() => act('submit')}>
            Submit
          </button>
        </div>
      )}

      {status === 'submitted' && isAdmin && (
        <div className="panel">
          <p className="panel__title">FP&A screen</p>
          <textarea
            rows={2}
            style={{ width: '100%' }}
            placeholder="Note (optional for screen-in, required to return)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={() => act('screen', { note: note || undefined })}>
              Screen in
            </button>
            <button type="button" className="idc-btn idc-btn--ghost" disabled={busy} onClick={() => act('return', { note })}>
              Return for rework
            </button>
          </div>
        </div>
      )}

      {status === 'screened' && isAdmin && (
        <div className="panel">
          <p className="panel__title">Record the CFO + ELT decision</p>
          <div className="idc-field">
            <label>Approved amount (defaults to the requested amount)</label>
            <input
              type="number"
              placeholder={String(detail.amount / 100)}
              value={approvedAmount}
              onChange={(e) => setApprovedAmount(e.target.value)}
            />
          </div>
          <textarea rows={2} style={{ width: '100%' }} placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="idc-btn idc-btn--primary"
              disabled={busy}
              onClick={() =>
                act('approve', {
                  approvedAmountCents: approvedAmount ? Math.round(Number(approvedAmount) * 100) : undefined,
                  note: note || undefined,
                })
              }
            >
              Approve
            </button>
            <button type="button" className="idc-btn idc-btn--ghost" disabled={busy} onClick={() => act('reject', { note })}>
              Reject
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <p className="panel__title">Request log</p>
        <AuditTrail entries={detail.log} />
      </div>
    </>
  );
}
