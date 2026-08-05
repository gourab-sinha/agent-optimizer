import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Get encryption key from environment
 * Validates key format and length
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  if (key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }

  try {
    return Buffer.from(key, 'hex');
  } catch (error) {
    throw new Error('ENCRYPTION_KEY must be a valid hex string');
  }
}

/**
 * Derive encryption key from password using PBKDF2
 * @param {Buffer} key - Master key
 * @param {Buffer} salt - Salt for key derivation
 * @returns {Buffer} Derived key
 */
function deriveKey(key, salt) {
  return crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha512');
}

/**
 * Encrypt sensitive data (OAuth tokens, etc.)
 * @param {string} text - Plain text to encrypt
 * @returns {string} Encrypted text in format: salt:iv:tag:encrypted (base64)
 */
export function encrypt(text) {
  if (!text) {
    throw new Error('Cannot encrypt empty text');
  }

  try {
    const masterKey = getEncryptionKey();

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive encryption key from master key and salt
    const key = deriveKey(masterKey, salt);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt the text
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ]);

    // Get authentication tag
    const tag = cipher.getAuthTag();

    // Combine salt + iv + tag + encrypted data
    const result = Buffer.concat([salt, iv, tag, encrypted]);

    // Return as base64 string
    return result.toString('base64');

  } catch (error) {
    console.error('Encryption error:', error.message);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt sensitive data
 * @param {string} encryptedData - Encrypted text in format: salt:iv:tag:encrypted (base64)
 * @returns {string} Decrypted plain text
 */
export function decrypt(encryptedData) {
  if (!encryptedData) {
    throw new Error('Cannot decrypt empty data');
  }

  try {
    const masterKey = getEncryptionKey();

    // Convert from base64 to buffer
    const buffer = Buffer.from(encryptedData, 'base64');

    // Extract components
    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, TAG_POSITION);
    const tag = buffer.subarray(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = buffer.subarray(ENCRYPTED_POSITION);

    // Derive decryption key from master key and salt
    const key = deriveKey(masterKey, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // Decrypt the data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString('utf8');

  } catch (error) {
    console.error('Decryption error:', error.message);
    throw new Error('Failed to decrypt data - data may be corrupted or key is incorrect');
  }
}

/**
 * Hash sensitive data for comparison (one-way)
 * @param {string} text - Text to hash
 * @returns {string} Hash in hex format
 */
export function hash(text) {
  if (!text) {
    throw new Error('Cannot hash empty text');
  }

  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex');
}

/**
 * Compare hash with plain text
 * @param {string} text - Plain text
 * @param {string} hashedText - Hashed text
 * @returns {boolean} True if match
 */
export function compareHash(text, hashedText) {
  const textHash = hash(text);
  return crypto.timingSafeEqual(
    Buffer.from(textHash),
    Buffer.from(hashedText)
  );
}

/**
 * Generate a random token
 * @param {number} bytes - Number of random bytes (default: 32)
 * @returns {string} Random token in hex format
 */
export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generate encryption key (for setup)
 * @returns {string} New encryption key in hex format
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate encryption key format
 * @param {string} key - Key to validate
 * @returns {boolean} True if valid
 */
export function validateEncryptionKey(key) {
  if (!key || typeof key !== 'string') {
    return false;
  }

  if (key.length !== 64) {
    return false;
  }

  try {
    Buffer.from(key, 'hex');
    return true;
  } catch {
    return false;
  }
}

// Self-test on module load (only in development)
if (process.env.NODE_ENV !== 'production') {
  try {
    if (process.env.ENCRYPTION_KEY) {
      const testData = 'test-encryption-' + Date.now();
      const encrypted = encrypt(testData);
      const decrypted = decrypt(encrypted);

      if (testData !== decrypted) {
        console.error('Encryption self-test failed: decrypted data does not match');
      }
    }
  } catch (error) {
    console.warn('Encryption self-test skipped:', error.message);
  }
}

export default {
  encrypt,
  decrypt,
  hash,
  compareHash,
  generateToken,
  generateEncryptionKey,
  validateEncryptionKey
};
