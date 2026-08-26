'use client';

import { useState } from 'react';
import { GateChip } from '@/components/ui/GateChip';
import { api } from '@/lib/api-client';
import type { GateState } from '@/lib/calc/vcp';
import { fmtCents } from '@/lib/calc/format';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';
import type { VcpInitiativeTarget } from '@/lib/types/vcp';

interface Props {
  deptId: string;
  fy: string;
  gateState: GateState;
  initiatives: VcpInitiativeTarget[];
  catalogInitiatives: { id: string; name: string }[];
  onChanged: () => void;
}

export function Gate1Panel({ deptId, fy, gateState, initiatives, catalogInitiatives, onChanged }: Props) {
  const { me } = useSession();
  const { showToast } = useToast();
  const isAdmin = me?.user.role === 'admin';

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newInitiativeId, setNewInitiativeId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [unlockTarget, setUnlockTarget] = useState<string | 'all' | null>(null);
  const [unlockNote, setUnlockNote] = useState('');
  const [busy, setBusy] = useState(false);

  const carriedIds = new Set(initiatives.map((i) => i.initiativeId));
  const addableInitiatives = catalogInitiatives.filter((i) => !carriedIds.has(i.id));

  async function saveTargets(items: { initiativeId: string; targetCents: number }[]) {
    setBusy(true);
    try {
      await api.put('/api/vcp/targets', { fy, deptId, targets: items });
      showToast('Target saved.', 'success');
      setEdits({});
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the target.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function lock(initiativeIds?: string[]) {
    setBusy(true);
    try {
      await api.post('/api/vcp/targets/lock', { fy, deptId, initiativeIds });
      showToast('Locked.', 'success');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not lock the target.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    if (!unlockNote.trim()) {
      showToast('A note is required to unlock.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/vcp/targets/unlock', {
        fy,
        deptId,
        initiativeIds: unlockTarget === 'all' || unlockTarget === null ? undefined : [unlockTarget],
        note: unlockNote,
      });
      showToast('Unlocked.', 'success');
      setUnlockTarget(null);
      setUnlockNote('');
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not unlock.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row--between">
        <div>
          <p className="panel__title">Gate 1 · Target</p>
          <p className="panel__sub">Admin sets and locks a savings target per initiative.</p>
        </div>
        <GateChip state={gateState} />
      </div>

      {initiatives.length === 0 ? (
        <div className="empty-state">No initiatives carried yet.</div>
      ) : (
        <table className="idc-table">
          <thead>
            <tr>
              <th>Initiative</th>
              <th className="num">Target</th>
              <th>Status</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {initiatives.map((i) => (
              <tr key={i.initiativeId}>
                <td>{i.name}</td>
                <td className="num">
                  {isAdmin && !i.locked ? (
                    <input
                      type="number"
                      value={edits[i.initiativeId] ?? String(i.targetCents / 100)}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [i.initiativeId]: e.target.value }))}
                      style={{ width: 120, textAlign: 'right' }}
                    />
                  ) : (
                    fmtCents(i.targetCents)
                  )}
                </td>
                <td>
                  {i.locked ? (
                    <span className="chip" style={{ color: '#628B48', background: 'rgba(98,139,72,0.14)' }}>
                      Locked — set by {i.setByName} on {i.setAt ? new Date(i.setAt).toLocaleDateString() : ''}
                    </span>
                  ) : (
                    <span className="muted">Draft</span>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    <div className="row">
                      {!i.locked && (
                        <>
                          <button
                            type="button"
                            className="idc-btn idc-btn--ghost"
                            disabled={busy}
                            onClick={() =>
                              saveTargets([
                                { initiativeId: i.initiativeId, targetCents: Math.round(Number(edits[i.initiativeId] ?? i.targetCents / 100) * 100) },
                              ])
                            }
                          >
                            Save
                          </button>
                          <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={() => lock([i.initiativeId])}>
                            Lock
                          </button>
                        </>
                      )}
                      {i.locked && (
                        <button type="button" className="idc-btn idc-btn--ghost" disabled={busy} onClick={() => setUnlockTarget(i.initiativeId)}>
                          Unlock
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isAdmin && addableInitiatives.length > 0 && (
        <div className="row" style={{ marginTop: 16 }}>
          <select value={newInitiativeId} onChange={(e) => setNewInitiativeId(e.target.value)}>
            <option value="">Add an initiative…</option>
            {addableInitiatives.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <input type="number" placeholder="Target $" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} style={{ width: 120 }} />
          <button
            type="button"
            className="idc-btn idc-btn--primary"
            disabled={!newInitiativeId || busy}
            onClick={() => {
              saveTargets([{ initiativeId: newInitiativeId, targetCents: Math.round((Number(newAmount) || 0) * 100) }]);
              setNewInitiativeId('');
              setNewAmount('');
            }}
          >
            Add
          </button>
        </div>
      )}

      {isAdmin && initiatives.length > 0 && initiatives.some((i) => !i.locked) && (
        <button type="button" className="idc-btn idc-btn--ghost" style={{ marginTop: 12 }} disabled={busy} onClick={() => lock(undefined)}>
          Lock all
        </button>
      )}

      {unlockTarget !== null && (
        <div className="panel" style={{ marginTop: 12, background: 'var(--idc-bearing-gray)' }}>
          <p className="panel__sub">A note is required to unlock this target.</p>
          <textarea value={unlockNote} onChange={(e) => setUnlockNote(e.target.value)} rows={2} style={{ width: '100%' }} />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={unlock}>
              Confirm unlock
            </button>
            <button
              type="button"
              className="idc-btn idc-btn--ghost"
              onClick={() => {
                setUnlockTarget(null);
                setUnlockNote('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
