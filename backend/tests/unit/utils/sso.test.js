import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { decryptSSOData } from '../../../src/utils/sso.js';

/**
 * Build OpenSSL EVP_BytesToKey-style ciphertext compatible with decryptSSOData
 * Matches the HighLevel SSO encryption approach used by the app.
 */
function encryptSSOData(payload, secret) {
  const blockSize = 16;
  const keySize = 32;
  const ivSize = 16;
  const saltSize = 8;

  const salt = crypto.randomBytes(saltSize);
  // raw format: "Salted__" (8) + salt (8) = 16 bytes header, then ciphertext
  const header = Buffer.concat([Buffer.from('Salted__'), salt]);

  let result = Buffer.alloc(0);
  while (result.length < keySize + ivSize) {
    const hasher = crypto.createHash('md5');
    result = Buffer.concat([
      result,
      hasher
        .update(
          Buffer.concat([
            result.subarray(-ivSize),
            Buffer.from(secret, 'utf-8'),
            salt,
          ])
        )
        .digest(),
    ]);
  }

  const key = result.subarray(0, keySize);
  const iv = result.subarray(keySize, keySize + ivSize);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);

  return Buffer.concat([header, encrypted]).toString('base64');
}

describe('utils/sso', () => {
  const secret = 'test-shared-secret';
  const original = process.env.GHL_SHARED_SECRET;

  beforeEach(() => {
    process.env.GHL_SHARED_SECRET = secret;
  });

  afterEach(() => {
    process.env.GHL_SHARED_SECRET = original;
  });

  it('decrypts valid SSO payload', () => {
    const userData = {
      userId: 'user-1',
      companyId: 'co-1',
      activeLocation: 'loc-1',
    };
    const encrypted = encryptSSOData(userData, secret);
    const result = decryptSSOData(encrypted);
    expect(result).toEqual(userData);
  });

  it('throws on invalid base64 / garbage data', () => {
    expect(() => decryptSSOData('not-valid-sso')).toThrow(
      'Failed to decrypt SSO data'
    );
  });

  it('throws when shared secret is wrong', () => {
    const encrypted = encryptSSOData({ userId: 'x' }, secret);
    process.env.GHL_SHARED_SECRET = 'wrong-secret';
    expect(() => decryptSSOData(encrypted)).toThrow('Failed to decrypt SSO data');
  });
});
