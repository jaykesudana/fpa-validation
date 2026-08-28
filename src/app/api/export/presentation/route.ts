import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';
import { buildPresentationBuffer, type PresentationDeckInput } from '@/lib/export/presentation';

// POST /api/export/presentation — any signed-in user. Not in 05-API.md.
// The client POSTs data it already fetched (properly scoped by
// /api/summary and /api/inv/bucket per the caller's own department grants)
// and gets a .pptx binary back — this route only formats what it's given,
// it doesn't grant any new data access. Deliberately server-side: pptxgenjs
// pulls in node:fs/node:https, which only Route Handlers (never bundled for
// the browser) can host without a webpack build failure.
export async function POST(req: Request) {
  try {
    await requireScope();
    const body = (await req.json().catch(() => null)) as PresentationDeckInput | null;
    if (!body || !Array.isArray(body.groups)) {
      return NextResponse.json({ error: 'A deck payload with groups/initiatives is required.' }, { status: 400 });
    }

    const buffer = await buildPresentationBuffer(body);
    const safeFy = (body.fiscalYearLabel || 'export').replace(/[^a-zA-Z0-9-]+/g, '-');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="IDC-Portfolio-Summary-${safeFy}.pptx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
