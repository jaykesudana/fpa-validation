// Field-level encryption for the one column identified as a direct employee
// identifier: `ee_id` on vcp_upload_rows / vcp_validation_rows. Encrypted at
// write time (right after parsing, before the insert); decrypted only in a
// response path that requireScope() has already authorized — an admin or an
// FBP granted this specific department. The DB column stays `text`; it just
// holds a base64 blob instead of plaintext, so no schema change was needed.
//
// AES-256-GCM, random IV per value (so identical EE IDs encrypt differently
// each time — no equality pattern leaks, and nothing in the app needs
// DB-side equality search on this column: the EE ID uniqueness check runs
// at parse time, in memory, against the plaintext values in a single
// upload, before any of this ever touches the database).
//
// "" and "-" (the workbook's own "no employee" marker) pass through
// unencrypted in both directions — there's nothing to protect, and a real
// ciphertext is always far longer than either, so there is no ambiguity
// between a passthrough marker and a genuine encrypted value.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PASSTHROUGH = new Set(['', '-']);

function loadKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error('FIELD_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)');
  return key;
}

export function encryptField(plain: string): string {
  if (PASSTHROUGH.has(plain)) return plain;
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptField(stored: string): string {
  if (PASSTHROUGH.has(stored)) return stored;
  const key = loadKey();
  const raw = Buffer.from(stored, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
