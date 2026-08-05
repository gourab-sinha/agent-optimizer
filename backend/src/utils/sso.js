import crypto from 'crypto';

/**
 * Decrypts SSO data from HighLevel iframe postMessage
 * When users launch the app from HighLevel, they send encrypted data
 *
 * @param {string} encryptedKey - Base64 encoded encrypted data from postMessage
 * @returns {Object} Decrypted user data {userId, companyId, activeLocation, etc.}
 */
export function decryptSSOData(encryptedKey) {
  try {
    const blockSize = 16;
    const keySize = 32;
    const ivSize = 16;
    const saltSize = 8;

    const rawEncryptedData = Buffer.from(encryptedKey, 'base64');
    const salt = rawEncryptedData.subarray(saltSize, blockSize);
    const cipherText = rawEncryptedData.subarray(blockSize);

    let result = Buffer.alloc(0, 0);
    while (result.length < (keySize + ivSize)) {
      const hasher = crypto.createHash('md5');
      result = Buffer.concat([
        result,
        hasher.update(Buffer.concat([
          result.subarray(-ivSize),
          Buffer.from(process.env.GHL_SHARED_SECRET, 'utf-8'),
          salt
        ])).digest()
      ]);
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      result.subarray(0, keySize),
      result.subarray(keySize, keySize + ivSize)
    );

    const decrypted = decipher.update(cipherText);
    const finalDecrypted = Buffer.concat([decrypted, decipher.final()]);

    const userData = JSON.parse(finalDecrypted.toString());

    console.log('✓ SSO data decrypted:', {
      userId: userData.userId,
      companyId: userData.companyId,
      activeLocation: userData.activeLocation
    });

    return userData;

  } catch (error) {
    console.error('Error decrypting SSO data:', error);
    throw new Error('Failed to decrypt SSO data');
  }
}
