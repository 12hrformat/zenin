const crypto = require('crypto');

/**
 * OpenRouter keys are supplied by each server's own admin, so they are
 * encrypted at rest with AES-256-GCM before hitting SQLite. The master key
 * comes from ENCRYPTION_KEY; without one we refuse to store anything.
 */

function masterKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      'ENCRYPTION_KEY is missing or too short (min 16 chars). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  // Fixed salt: the secret is already high-entropy random.
  return crypto.scryptSync(secret, 'zenin-openrouter-v1', 32);
}

function encrypt(plaintext) {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { ciphertext: ct.toString('hex'), iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

function decrypt({ ciphertext, iv, authTag }) {
  const key = masterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

function mask(plaintext) {
  const s = String(plaintext);
  if (s.length <= 12) return `${s.slice(0, 3)}…`;
  return `${s.slice(0, 7)}…${s.slice(-4)}`;
}

// Cheap sanity check so we don't bother OpenRouter with obvious garbage.
function looksValid(key) {
  const s = String(key || '').trim();
  return /^sk-or-v1-[A-Za-z0-9]{16,}$/.test(s);
}

module.exports = { encrypt, decrypt, mask, looksValid };
