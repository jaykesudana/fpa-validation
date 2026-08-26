import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptField, encryptField } from './field-crypto';

const TEST_KEY = randomBytes(32).toString('base64');
const ORIGINAL_KEY = process.env.FIELD_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.FIELD_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe('encryptField / decryptField', () => {
  it('round-trips a real EE ID', () => {
    const encrypted = encryptField('12345');
    expect(encrypted).not.toBe('12345');
    expect(decryptField(encrypted)).toBe('12345');
  });

  it('passes "" and "-" through unencrypted in both directions', () => {
    expect(encryptField('')).toBe('');
    expect(encryptField('-')).toBe('-');
    expect(decryptField('')).toBe('');
    expect(decryptField('-')).toBe('-');
  });

  it('produces a different ciphertext each time for the same plaintext (random IV), both still decrypting correctly', () => {
    const a = encryptField('12345');
    const b = encryptField('12345');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('12345');
    expect(decryptField(b)).toBe('12345');
  });

  it('throws on a tampered ciphertext instead of silently returning garbage', () => {
    const encrypted = encryptField('12345');
    const raw = Buffer.from(encrypted, 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1]! ^ 0xff) & 0xff; // flip the last ciphertext byte
    const tampered = raw.toString('base64');
    expect(() => decryptField(tampered)).toThrow();
  });

  it('throws a clear error when FIELD_ENCRYPTION_KEY is unset', () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    expect(() => encryptField('12345')).toThrow('FIELD_ENCRYPTION_KEY is not set');
  });

  it('throws when the key does not decode to exactly 32 bytes', () => {
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(() => encryptField('12345')).toThrow('32 bytes');
  });
});
