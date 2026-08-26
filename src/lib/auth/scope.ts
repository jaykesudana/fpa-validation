import { getSessionEmail } from './session';
import { getDeptGrants, loadOrBootstrapUser } from './current-user';
import type { AppUser, Tower } from './types';

export class AuthError extends Error {
  status: 401 | 403 | 404;
  code: string;

  constructor(status: 401 | 403 | 404, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ScopeOptions {
  /** When set, `deptIds` is loaded for this tower. */
  tower?: Tower;
  /** When set, the caller must hold this department in `tower` (admins always pass). */
  dept?: string;
  /** When 'admin', the caller must be an admin. */
  role?: 'admin';
}

export interface Scope {
  user: AppUser;
  /** Every department id the caller may see in `opts.tower` — empty if `tower` was omitted. */
  deptIds: string[];
}

/**
 * The single authorization gate every API route must call. Never accept a
 * department list or role from the client — this always re-derives scope
 * server-side from the session and the database.
 *
 * 05-API.md: 403 when the caller lacks the role; 404 (not 403) when a
 * business partner references a department outside their grant for that
 * tower — never leak that the department exists.
 */
export async function requireScope(opts: ScopeOptions = {}): Promise<Scope> {
  const email = await getSessionEmail();
  if (!email) throw new AuthError(401, 'unauthenticated', 'Sign in required.');

  const user = await loadOrBootstrapUser(email);
  if (!user) {
    throw new AuthError(401, 'no_access', 'This email has no FP&A Control Tower access yet — ask an admin to add you to the roster.');
  }

  if (opts.role === 'admin' && user.role !== 'admin') {
    throw new AuthError(403, 'admin_only', 'This action is admin-only.');
  }

  const deptIds = opts.tower ? await getDeptGrants(user, opts.tower) : [];

  if (opts.dept && user.role !== 'admin' && !deptIds.includes(opts.dept)) {
    throw new AuthError(404, 'not_found', 'Not found.');
  }

  return { user, deptIds };
}
