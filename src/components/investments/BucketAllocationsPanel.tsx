'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { fmtCents } from '@/lib/calc/format';
import { useToast } from '@/lib/toast-context';
import type { BucketAllocation } from '@/lib/types/investments';

interface CatalogDept {
  id: string;
  name: string;
}

export function BucketAllocationsPanel({
  fy,
  allocations,
  isAdmin,
  onChanged,
}: {
  fy: string;
  allocations: BucketAllocation[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [catalogDepts, setCatalogDepts] = useState<CatalogDept[]>([]);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [newDeptId, setNewDeptId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<{ departments: CatalogDept[] }>('/api/catalog')
      .then((c) => setCatalogDepts(c.departments))
      .catch(() => setCatalogDepts([]));
  }, [isAdmin]);

  const allocatedDeptIds = new Set(allocations.map((a) => a.departmentId));
  const addableDepts = catalogDepts.filter((d) => !allocatedDeptIds.has(d.id));

  async function save(departmentId: string, allocatedCents: number) {
    setBusy(true);
    try {
      await api.put('/api/inv/bucket/allocations', { fy, departmentId, allocatedCents });
      showToast('Allocation saved.', 'success');
      setEditingDeptId(null);
      setNewDeptId('');
      setNewAmount('');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the allocation.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <p className="panel__title">Department allocations</p>
      <p className="panel__sub">How much of the pool is earmarked to each department — Investment pool / Unallocated above are scoped to this.</p>

      <table className="idc-table idc-table--dense">
        <thead>
          <tr>
            <th>Department</th>
            <th className="num">Allocated</th>
            {isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {allocations.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 3 : 2} className="muted">
                No allocations yet.
              </td>
            </tr>
          )}
          {allocations.map((a) => (
            <tr key={a.departmentId}>
              <td>{a.departmentName}</td>
              <td className="num">
                {editingDeptId === a.departmentId ? (
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 120, textAlign: 'right' }} />
                ) : (
                  fmtCents(a.allocatedCents)
                )}
              </td>
              {isAdmin && (
                <td>
                  {editingDeptId === a.departmentId ? (
                    <div className="row">
                      <button
                        type="button"
                        className="idc-btn idc-btn--primary"
                        disabled={busy}
                        onClick={() => save(a.departmentId, Math.round((Number(amount) || 0) * 100))}
                      >
                        Save
                      </button>
                      <button type="button" className="idc-btn idc-btn--ghost" onClick={() => setEditingDeptId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="idc-btn idc-btn--ghost"
                      onClick={() => {
                        setEditingDeptId(a.departmentId);
                        setAmount(String(a.allocatedCents / 100));
                      }}
                    >
                      Edit
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {isAdmin && addableDepts.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          <select value={newDeptId} onChange={(e) => setNewDeptId(e.target.value)}>
            <option value="">Assign to a department…</option>
            {addableDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input type="number" placeholder="Amount $" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} style={{ width: 140 }} />
          <button
            type="button"
            className="idc-btn idc-btn--primary"
            disabled={!newDeptId || busy}
            onClick={() => save(newDeptId, Math.round((Number(newAmount) || 0) * 100))}
          >
            Assign
          </button>
        </div>
      )}
    </div>
  );
}
