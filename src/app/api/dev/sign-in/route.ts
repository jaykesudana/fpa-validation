import { NextResponse } from 'next/server';
import { DEV_EMAIL_COOKIE, devAuthEnabled } from '@/lib/auth/session';

/** Dev-only stand-in for real SSO — see session.ts. Not reachable unless ALLOW_DEV_AUTH=true. */
export async function POST(req: Request) {
  if (!devAuthEnabled()) {
    return NextResponse.json({ error: 'Dev auth is disabled.' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const res = NextResponse.json({ ok: true, email });
  res.cookies.set(DEV_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return res;
}
