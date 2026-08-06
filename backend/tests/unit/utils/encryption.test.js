import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  hash,
  compareHash,
  generateToken,
  generateEncryptionKey,
  validateEncryptionKey,
} from '../../../src/utils/encryption.js';

describe('utils/encryption', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY =
      '1a08d39312d9f41435a91126a9bf9de53bd334d3404fe2394580a05120bc7aaa';
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  describe('encrypt / decrypt', () => {
    it('round-trips plaintext', () => {
      const plain = 'oauth-token-secret-value';
      const encrypted = encrypt(plain);
      expect(encrypted).toBeTypeOf('string');
      expect(encrypted).not.toBe(plain);
      expect(decrypt(encrypted)).toBe(plain);
    });

    it('produces different ciphertext for same plaintext (random salt/iv)', () => {
      const a = encrypt('same');
      const b = encrypt('same');
      expect(a).not.toBe(b);
      expect(decrypt(a)).toBe('same');
      expect(decrypt(b)).toBe('same');
    });

    it('throws on empty encrypt input', () => {
      expect(() => encrypt('')).toThrow('Cannot encrypt empty text');
      expect(() => encrypt(null)).toThrow('Cannot encrypt empty text');
    });

    it('throws on empty decrypt input', () => {
      expect(() => decrypt('')).toThrow('Cannot decrypt empty data');
      expect(() => decrypt(null)).toThrow('Cannot decrypt empty data');
    });

    it('throws when ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => encrypt('x')).toThrow('Failed to encrypt data');
    });

    it('throws when ENCRYPTION_KEY has wrong length', () => {
      process.env.ENCRYPTION_KEY = 'abcd';
      expect(() => encrypt('x')).toThrow('Failed to encrypt data');
    });

    it('throws on corrupted ciphertext', () => {
      const encrypted = encrypt('hello');
      const corrupted = Buffer.from(encrypted, 'base64');
      corrupted[80] ^= 0xff;
      expect(() => decrypt(corrupted.toString('base64'))).toThrow(
        'Failed to decrypt data'
      );
    });
  });

  describe('hash / compareHash', () => {
    it('hashes text to hex sha256', () => {
      const h = hash('password');
      expect(h).toMatch(/^[a-f0-9]{64}$/);
      expect(hash('password')).toBe(h);
    });

    it('throws on empty hash input', () => {
      expect(() => hash('')).toThrow('Cannot hash empty text');
    });

    it('compareHash returns true for matching values', () => {
      const h = hash('secret');
      expect(compareHash('secret', h)).toBe(true);
    });

    it('compareHash returns false for mismatch', () => {
      const h = hash('secret');
      expect(compareHash('other', h)).toBe(false);
    });
  });

  describe('generateToken / generateEncryptionKey / validateEncryptionKey', () => {
    it('generateToken returns hex of requested length', () => {
      expect(generateToken(16)).toHaveLength(32);
      expect(generateToken()).toHaveLength(64);
    });

    it('generateEncryptionKey returns 64 hex chars', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(validateEncryptionKey(key)).toBe(true);
    });

    it('validateEncryptionKey rejects invalid inputs', () => {
      expect(validateEncryptionKey(null)).toBe(false);
      expect(validateEncryptionKey(123)).toBe(false);
      expect(validateEncryptionKey('short')).toBe(false);
      expect(validateEncryptionKey('a'.repeat(64))).toBe(true);
    });
  });
});
