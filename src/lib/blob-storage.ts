import { getStore } from '@netlify/blobs';

// Zero-config once actually deployed on Netlify (or run via `netlify dev`
// locally) — siteID/token are ambient in that runtime. Plain `next dev`
// cannot exercise these calls; see README "Trying the mechanics" for the
// netlify dev requirement.
function store() {
  return getStore(process.env.BLOB_STORE_NAME || 'fpa-control-tower');
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export async function putBlob(key: string, data: Buffer, contentType?: string): Promise<void> {
  await store().set(key, toArrayBuffer(data), contentType ? { metadata: { contentType } } : undefined);
}

export async function getBlob(key: string): Promise<Buffer | null> {
  const result = await store().get(key, { type: 'arrayBuffer' });
  if (result == null) return null;
  return Buffer.from(result);
}

export async function deleteBlob(key: string): Promise<void> {
  await store().delete(key);
}
