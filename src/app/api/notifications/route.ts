import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import type { Tower } from '@/lib/auth/types';
import { db } from '@/lib/db';
import { eventMeta } from '@/lib/notify-meta';

interface NotificationRow {
  id: string; // bigserial — treated as an opaque id, never arithmetic, so left as the driver's native string
  tower: Tower;
  event: string;
  at: string;
  subject: string;
  body: string;
  link_kind: string | null;
  link_ref: string | null;
  read_at: string | null;
  is_cc: boolean;
}

// GET /api/notifications?tower=vcp|inv&unread=true&limit=50 — 05-API.md.
// Security boundary here is simple: a recipient only ever sees rows where
// recipient_id = their own user id — no department scoping needed on top.
export async function GET(req: Request) {
  try {
    const { user } = await requireScope();
    const url = new URL(req.url);
    const towerFilter = url.searchParams.get('tower');
    const unreadOnly = url.searchParams.get('unread') === 'true';
    const rawLimit = Number(url.searchParams.get('limit') ?? '50');
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200);

    const sql = db();
    const rows = (await sql`
      select id, tower, event, at, subject, body, link_kind, link_ref, read_at, is_cc
      from notifications
      where recipient_id = ${user.id}
        and (${towerFilter}::text is null or tower = ${towerFilter})
        and (${unreadOnly} = false or read_at is null)
      order by at desc
      limit ${limit}
    `) as NotificationRow[];

    return NextResponse.json({
      notifications: rows.map((r) => ({
        id: r.id,
        tower: r.tower,
        event: r.event,
        ...eventMeta(r.tower, r.event),
        at: r.at,
        subject: r.subject,
        body: r.body,
        link: r.link_kind && r.link_ref ? { kind: r.link_kind, ref: r.link_ref } : null,
        read: r.read_at != null,
        isCc: r.is_cc,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
