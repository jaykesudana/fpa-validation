'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { onRosterChanged } from '@/lib/roster-events';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';

interface RosterUser {
  email: string;
  name: string;
  role: 'admin' | 'fbp';
}

/**
 * Temporary stand-in for real SSO — see src/lib/auth/session.ts. Renders
 * nothing if ALLOW_DEV_AUTH is off (GET /api/dev/users 404s, so the roster
 * fetch below fails and this returns null) — same disappearing behaviour
 * the prototype's role switcher was supposed to have in production.
 */
export function DevSignIn() {
  const { me, signedIn, refresh } = useSession();
  const { showToast } = useToast();
  const [roster, setRoster] = useState<RosterUser[] | null>(null);

  useEffect(() => {
    function loadRoster() {
      api
        .get<{ users: RosterUser[] }>('/api/dev/users')
        .then((r) => setRoster(r.users))
        .catch(() => setRoster([]));
    }
    loadRoster();
    return onRosterChanged(loadRoster);
  }, []);

  async function signInAs(email: string) {
    if (!email) return;
    try {
      await api.post('/api/dev/sign-in', { email });
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-in failed', 'error');
    }
  }

  async function signOut() {
    try {
      await api.post('/api/dev/sign-out');
      await refresh();
    } catch {
      // best-effort
    }
  }

  if (roster === null || roster.length === 0) return null;

  return (
    <div className="dev-sign-in">
      <span className="dev-sign-in__label">Dev sign-in</span>
      <select value={signedIn ? me?.user.email ?? '' : ''} onChange={(e) => signInAs(e.target.value)}>
        <option value="" disabled>
          {signedIn ? me?.displayName : 'Choose a user…'}
        </option>
        {roster.map((u) => (
          <option key={u.email} value={u.email}>
            {u.name} ({u.role})
          </option>
        ))}
      </select>
      {signedIn && (
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      )}
    </div>
  );
}
