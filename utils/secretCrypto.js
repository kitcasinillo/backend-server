const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

const getEncryptionKey = () => {
  const rawKey =
    process.env.SETTINGS_ENCRYPTION_KEY ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.STRIPE_SECRET_KEY ||
    'ultrahealers-local-dev-encryption-key';

  if (!process.env.SETTINGS_ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
    console.warn('⚠️ SETTINGS_ENCRYPTION_KEY is not set; deriving encryption key from fallback env secret.');
  }

  return crypto.createHash('sha256').update(String(rawKey)).digest();
};

const encryptSecret = (plainText) => {
  if (!plainText || typeof plainText !== 'string') return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decryptSecret = (payload) => {
  if (!payload || typeof payload !== 'string') return null;
  if (!payload.startsWith('enc:v1:')) {
    return payload;
  }
  const parts = payload.split(':');
  if (parts.length !== 5) return null;
  const [, , ivB64, tagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};

const maskSecret = (plainText) => {
  if (!plainText || typeof plainText !== 'string') return null;
  const trimmed = plainText.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefixMatch = trimmed.match(/^(sk_live_|sk_test_|pk_live_|pk_test_|whsec_)/);
  const prefix = prefixMatch ? prefixMatch[1] : trimmed.slice(0, 4);
  const tail = trimmed.slice(-4);
  return `${prefix}••••••••${tail}`;
};

module.exports = {
  encryptSecret,
  decryptSecret,
  maskSecret,
};
