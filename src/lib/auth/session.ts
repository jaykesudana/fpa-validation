import { cookies } from 'next/headers';

const DEV_EMAIL_COOKIE = 'fpa_dev_email';

/** Gate for every /api/dev/* route — never let this be reachable once real data exists. */
export function devAuthEnabled(): boolean {
  return process.env.ALLOW_DEV_AUTH === 'true';
}

/**
 * Resolves the caller's email for the current request.
 *
 * STAND-IN FOR REAL SSO. There is no identity verification here — it reads
 * an "acting as" cookie set by /api/dev/sign-in. `requireScope` and every
 * route built on it only ever see an email string, so swapping this
 * function's body for a real Azure AD / SSO session lookup (see
 * 06-ARCHITECTURE-NETLIFY-NEON.md) is the ENTIRE integration point — nothing
 * in current-user.ts, scope.ts, or any API route needs to change.
 */
export async function getSessionEmail(): Promise<string | null> {
  return cookies().get(DEV_EMAIL_COOKIE)?.value ?? null;
}

export { DEV_EMAIL_COOKIE };
