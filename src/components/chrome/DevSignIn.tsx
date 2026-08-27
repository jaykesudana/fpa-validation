'use client';

import { api } from '@/lib/api-client';
import { useRoster } from '@/lib/roster-context';
import { useSession } from '@/lib/session-context';
import { useToast } from '@/lib/toast-context';

/**
 * Temporary stand-in for real SSO — see src/lib/auth/session.ts. Renders
 * nothing if ALLOW_DEV_AUTH is off (GET /api/dev/users 404s via RosterProvider,
 * so `roster` stays empty) — same disappearing behaviour the prototype's role
 * switcher was supposed to have in production. Reads `roster` from the same
 * shared context the User Access page writes to — see roster-context.tsx —
 * so there's no separate fetch of its own to go stale.
 */
export function DevSignIn() {
  const { me, signedIn, refresh } = useSession();
  const { roster } = useRoster();
  const { showToast } = useToast();

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

  if (roster.length === 0) return null;

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
