'use client';

import { fmtCents } from '@/lib/calc/format';
import type { VcpLineRow, VcpValidationLineRow } from '@/lib/types/vcp';

// dd-mm-yyyy, no time — same convention as the admin Line Items page, for
// the same fields (target date / validated date), shown here too now.
function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Lets an admin (or the department's own partner) look at a pending
 * upload's/validation's actual line items in-app before deciding to
 * approve or reject — the data was already being sent to the browser
 * (VcpDeptDetail.baseline.rows / .validations[].rows) for the rollup
 * calcs; this just makes it visible instead of requiring a download.
 */
export function LineRowsModal({
  title,
  subtitle,
  rows,
  variant,
  onClose,
}: {
  title: string;
  subtitle?: string;
  // VcpValidationLineRow extends VcpLineRow, so validation rows satisfy
  // this too — kept as a single array type (not a union of array types,
  // which makes .map's callback parameter type ambiguous).
  rows: VcpLineRow[];
  variant: 'baseline' | 'validation';
  onClose: () => void;
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel" style={{ width: '90vw', maxWidth: 1100, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="row--between">
          <div>
            <p className="panel__title">{title}</p>
            {subtitle && <p className="panel__sub">{subtitle}</p>}
          </div>
          <button type="button" className="idc-btn idc-btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">No rows.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="idc-table idc-table--dense idc-table--zebra">
              <thead>
                <tr>
                  <th>Initiative</th>
                  <th>Dept #</th>
                  <th>Line item</th>
                  <th>Category</th>
                  <th>EE ID</th>
                  <th>Country</th>
                  <th>Frequency</th>
                  <th>Target date</th>
                  <th className="num">Identified</th>
                  {variant === 'validation' && (
                    <>
                      <th>Status</th>
                      <th className="num">Validated</th>
                      <th>Validated date</th>
                      <th>Status update</th>
                    </>
                  )}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  // Only valid when variant === 'validation' — guaranteed by the
                  // caller (Gate3Panel only passes validation rows with that variant).
                  const vr = r as VcpValidationLineRow;
                  return (
                    <tr key={`${r.initiativeId}-${r.rowNo}-${idx}`}>
                      <td>{r.initiativeName}</td>
                      <td>{r.deptNo}</td>
                      <td>{r.name}</td>
                      <td>{r.category}</td>
                      <td>{r.eeId}</td>
                      <td>{r.country}</td>
                      <td>{r.frequency}</td>
                      <td>{formatDate(r.targetDate)}</td>
                      <td className="num">{fmtCents(r.identifiedCents)}</td>
                      {variant === 'validation' && (
                        <>
                          <td>{vr.status}</td>
                          <td className="num">{fmtCents(vr.validatedCents)}</td>
                          <td>{formatDate(vr.validatedDate)}</td>
                          <td style={{ maxWidth: 200 }}>{vr.statusUpdate}</td>
                        </>
                      )}
                      <td style={{ maxWidth: 200 }}>{r.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
