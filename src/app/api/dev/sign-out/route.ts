import { NextResponse } from 'next/server';
import { DEV_EMAIL_COOKIE, devAuthEnabled } from '@/lib/auth/session';

export async function POST() {
  if (!devAuthEnabled()) {
    return NextResponse.json({ error: 'Dev auth is disabled.' }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEV_EMAIL_COOKIE);
  return res;
}
