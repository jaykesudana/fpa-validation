import { NextResponse } from 'next/server';
import { getBlob } from '@/lib/blob-storage';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

// GET /api/inv/attachments/:id/download — 05-API.md: "short-lived signed URL
// or a streamed response." Netlify Blobs isn't natively link-shareable, so
// this route IS the permission-checked access point — it streams the bytes
// back directly rather than minting a separate signed URL.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const attachmentId = params.id;
    const sql = db();

    const rows = (await sql`
      select a.file_name, a.storage_key, a.mime_type, r.department_id
      from inv_attachments a join inv_requests r on r.id = a.request_id
      where a.id = ${attachmentId}
    `) as { file_name: string; storage_key: string; mime_type: string | null; department_id: string }[];
    const attachment = rows[0];
    if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'inv', dept: attachment.department_id });

    const bytes = await getBlob(attachment.storage_key);
    if (!bytes) return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });

    await sql`
      insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action)
      values (${user.id}, ${user.name}, ${user.role}, 'inv', 'attachment', ${attachmentId}, ${attachment.department_id}, 'attachment.download')
    `;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': attachment.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${attachment.file_name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
