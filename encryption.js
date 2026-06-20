/**
 * AES-256-GCM envelope encryption for OAuth tokens.
 * The ENCRYPTION_KEY env var is the data encryption key (DEK).
 * In production, rotate to envelope encryption via GCP KMS:
 *   - KMS holds the key encryption key (KEK)
 *   - DEK is encrypted by KEK and stored alongside the token
 *   - Decrypt DEK lazily (at use time, not startup) to limit KMS outage blast radius
 */

const crypto = require('crypto');
const config  = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY       = Buffer.from(config.encryption.key, 'hex'); // 32 bytes

if (KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
}

/**
 * Encrypt a plaintext string.
 * Returns: base64(iv + authTag + ciphertext)
 */
const encrypt = (plaintext) => {
  const iv         = crypto.randomBytes(IV_LENGTH);
  const cipher     = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

/**
 * Decrypt a base64 string produced by encrypt().
 */
const decrypt = (ciphertext) => {
  const buf      = Buffer.from(ciphertext, 'base64');
  const iv       = buf.slice(0, IV_LENGTH);
  const authTag  = buf.slice(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = buf.slice(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

module.exports = { encrypt, decrypt };
