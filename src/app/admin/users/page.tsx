'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/chrome/PageHeader';
import { api } from '@/lib/api-client';
import { emitRosterChanged } from '@/lib/roster-events';
import { useRoster } from '@/lib/roster-context';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'fbp';
  active: boolean;
  createdAt: string;
  vcpDeptIds: string[];
  invDeptIds: string[];
}

interface CatalogDept {
  id: string;
  name: string;
}

function AccessModal({
  userName,
  tower,
  allDepts,
  currentIds,
  onClose,
  onSave,
}: {
  userName: string;
  tower: 'vcp' | 'inv';
  allDepts: CatalogDept[];
  currentIds: string[];
  onClose: () => void;
  onSave: (departmentIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentIds));
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel" style={{ width: 420, maxHeight: '80vh', overflowY: 'auto' }}>
        <p className="panel__title">
          {tower === 'vcp' ? 'VCP' : 'Investment Requests'} access — {userName}
        </p>
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" className="idc-btn idc-btn--ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setSelected(new Set(allDepts.map((d) => d.id)))}>
            Select all
          </button>
          <button type="button" className="idc-btn idc-btn--ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
        {allDepts.map((d) => (
          <label key={d.id} style={{ display: 'block', padding: '3px 0' }}>
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} style={{ marginRight: 8 }} />
            {d.name}
          </label>
        ))}
        <div className="row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="idc-btn idc-btn--primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(Array.from(selected));
              setSaving(false);
            }}
          >
            Save
          </button>
          <button type="button" className="idc-btn idc-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  const { showToast } = useToast();
  const { refresh: refreshRoster } = useRoster();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [depts, setDepts] = useState<CatalogDept[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'fbp'>('fbp');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ userId: string; userName: string; tower: 'vcp' | 'inv' } | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api.get<{ users: AdminUserRow[] }>('/api/admin/users').then((r) => r.users),
      api.get<{ departments: CatalogDept[] }>('/api/catalog').then((c) => c.departments),
    ])
      .then(([u, d]) => {
        setUsers(u);
        setDepts(d);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const deptNameById = useMemo(() => new Map(depts.map((d) => [d.id, d.name])), [depts]);

  async function addUser() {
    if (!newEmail.trim() || !newName.trim()) {
      showToast('Email and name are required.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/admin/users', { email: newEmail.trim(), name: newName.trim(), role: newRole });
      showToast('User added.', 'success');
      setNewEmail('');
      setNewName('');
      setNewRole('fbp');
      load();
      refreshRoster();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add the user.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: 'admin' | 'fbp') {
    try {
      await api.put(`/api/admin/users/${userId}`, { role });
      showToast('Role updated.', 'success');
      load();
      refreshRoster();
      emitRosterChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the role.', 'error');
    }
  }

  async function toggleActive(userId: string, active: boolean) {
    try {
      await api.put(`/api/admin/users/${userId}`, { active });
      showToast(active ? 'User reactivated.' : 'User deactivated.', 'success');
      load();
      refreshRoster();
      emitRosterChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the user.', 'error');
    }
  }

  async function saveProfile(userId: string) {
    if (!profileName.trim() || !profileEmail.trim()) {
      showToast('Name and email cannot be blank.', 'error');
      return;
    }
    try {
      await api.put(`/api/admin/users/${userId}`, { name: profileName.trim(), email: profileEmail.trim() });
      showToast('User updated.', 'success');
      setEditingProfileId(null);
      load();
      refreshRoster();
      emitRosterChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the user.', 'error');
    }
  }

  async function saveAccess(departmentIds: string[]) {
    if (!editing) return;
    try {
      await api.put(`/api/admin/users/${editing.userId}/access`, { tower: editing.tower, departmentIds });
      showToast('Access updated.', 'success');
      setEditing(null);
      load();
      emitRosterChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update access.', 'error');
    }
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader eyebrow="Admin" title="User access" />
        <div className="empty-state">This view is restricted to Admins.</div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title="User access" subtitle="Roster, roles, and per-tower department access." />

      <div className="panel">
        <p className="panel__title">Add user</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input type="email" placeholder="name@idc.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={{ width: 220 }} />
          <input type="text" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: 200 }} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'fbp')}>
            <option value="fbp">Business partner</option>
            <option value="admin">Admin</option>
          </select>
          <button type="button" className="idc-btn idc-btn--primary" disabled={busy} onClick={addUser}>
            Add user
          </button>
        </div>
      </div>

      {loading && <div className="empty-state">Loading…</div>}

      {!loading && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="idc-table idc-table--dense idc-table--zebra">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>VCP access</th>
                <th>Investment access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {editingProfileId === u.id ? (
                      <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} style={{ width: 160 }} />
                    ) : (
                      u.name
                    )}
                  </td>
                  <td className="muted">
                    {editingProfileId === u.id ? (
                      <input type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} style={{ width: 200 }} />
                    ) : (
                      u.email
                    )}
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value as 'admin' | 'fbp')}>
                      <option value="fbp">Business partner</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{u.active ? 'Active' : <span className="muted">Deactivated</span>}</td>
                  <td style={{ maxWidth: 220 }}>
                    {u.role === 'admin' ? (
                      <span className="muted">All departments</span>
                    ) : u.vcpDeptIds.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      u.vcpDeptIds.map((id) => deptNameById.get(id) ?? id).join(', ')
                    )}
                  </td>
                  <td style={{ maxWidth: 220 }}>
                    {u.role === 'admin' ? (
                      <span className="muted">All departments</span>
                    ) : u.invDeptIds.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      u.invDeptIds.map((id) => deptNameById.get(id) ?? id).join(', ')
                    )}
                  </td>
                  <td>
                    <div className="row">
                      {editingProfileId === u.id ? (
                        <>
                          <button type="button" className="idc-btn idc-btn--primary" onClick={() => saveProfile(u.id)}>
                            Save
                          </button>
                          <button type="button" className="idc-btn idc-btn--ghost" onClick={() => setEditingProfileId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="idc-btn idc-btn--ghost"
                          onClick={() => {
                            setEditingProfileId(u.id);
                            setProfileName(u.name);
                            setProfileEmail(u.email);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {u.role !== 'admin' && (
                        <>
                          <button
                            type="button"
                            className="idc-btn idc-btn--ghost"
                            onClick={() => setEditing({ userId: u.id, userName: u.name, tower: 'vcp' })}
                          >
                            Edit VCP
                          </button>
                          <button
                            type="button"
                            className="idc-btn idc-btn--ghost"
                            onClick={() => setEditing({ userId: u.id, userName: u.name, tower: 'inv' })}
                          >
                            Edit Inv
                          </button>
                        </>
                      )}
                      <button type="button" className="idc-btn idc-btn--ghost" onClick={() => toggleActive(u.id, !u.active)}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AccessModal
          userName={editing.userName}
          tower={editing.tower}
          allDepts={depts}
          currentIds={(editing.tower === 'vcp' ? users.find((u) => u.id === editing.userId)?.vcpDeptIds : users.find((u) => u.id === editing.userId)?.invDeptIds) ?? []}
          onClose={() => setEditing(null)}
          onSave={saveAccess}
        />
      )}
    </>
  );
}
