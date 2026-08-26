import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { putBlob } from '@/lib/blob-storage';
import { db } from '@/lib/db';
import { toErrorResponse } from '@/lib/auth/http';
import { requireScope } from '@/lib/auth/scope';

// POST /api/inv/requests/:id/attachments — multipart, one or more files. 05-API.md.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const sql = db();

    const rows = (await sql`select id, department_id from inv_requests where id = ${id}`) as { id: string; department_id: string }[];
    const request = rows[0];
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { user } = await requireScope({ tower: 'inv', dept: request.department_id });

    const form = await req.formData();
    const files = form.getAll('file').filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: 'at least one file is required' }, { status: 400 });

    // Blob writes happen before the DB transaction — an orphaned blob if the
    // transaction later fails is harmless; a DB row pointing at a blob that
    // was never written is not.
    const prepared = await Promise.all(
      files.map(async (file) => {
        const attId = randomUUID();
        const storageKey = `inv/${id}/${attId}/${file.name}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        await putBlob(storageKey, buffer, file.type || 'application/octet-stream');
        return { id: attId, file, storageKey };
      }),
    );

    await sql.transaction([
      ...prepared.map(
        ({ id: attId, file, storageKey }) => sql`
          insert into inv_attachments (id, request_id, file_name, storage_key, size_bytes, mime_type, uploaded_by)
          values (${attId}, ${id}, ${file.name}, ${storageKey}, ${file.size}, ${file.type || null}, ${user.id})
        `,
      ),
      sql`
        insert into audit_log (actor_user_id, actor_name, actor_role, tower, entity_type, entity_id, department_id, action, payload)
        values (${user.id}, ${user.name}, ${user.role}, 'inv', 'request', ${id}, ${request.department_id}, 'attachment.upload', ${JSON.stringify({ files: prepared.map((p) => p.file.name) })}::jsonb)
      `,
    ]);

    return NextResponse.json(
      { attachments: prepared.map((p) => ({ id: p.id, fileName: p.file.name, sizeBytes: p.file.size })) },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
