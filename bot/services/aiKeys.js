const { db } = require('../../database');
const { encrypt, decrypt, mask, looksValid } = require('./crypto');
const config = require('../../config.json');

/**
 * Each server supplies its OWN OpenRouter key. Nothing is hardcoded and the
 * bot's author never sees them - keys are AES-256-GCM encrypted at rest.
 */

const MODEL_CHOICES = [
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (cheap, fast)' },
  { value: 'openai/gpt-4o', label: 'GPT-4o (smarter, pricier)' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (free)' },
  { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (cheap)' },
  { value: 'mistralai/mistral-large', label: 'Mistral Large' },
];

function setKey(guildId, apiKey, model, addedBy) {
  const { ciphertext, iv, authTag } = encrypt(apiKey);
  const now = Date.now();

  db.prepare(
    `INSERT INTO api_keys (guild_id, ciphertext, iv, auth_tag, model, added_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       iv         = excluded.iv,
       auth_tag   = excluded.auth_tag,
       model      = excluded.model,
       added_by   = excluded.added_by,
       updated_at = excluded.updated_at`
  ).run(guildId, ciphertext, iv, authTag, model, addedBy, now, now);

  return getStatus(guildId);
}

function removeKey(guildId) {
  const info = db.prepare('DELETE FROM api_keys WHERE guild_id = ?').run(guildId);
  return info.changes > 0;
}

function hasKey(guildId) {
  return !!db.prepare('SELECT 1 FROM api_keys WHERE guild_id = ?').get(guildId);
}

// Maps a DB row (snake_case) to the field names the crypto module expects.
function payloadFromRow(row) {
  return { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag };
}

function getKeyRow(guildId) {
  return db.prepare('SELECT * FROM api_keys WHERE guild_id = ?').get(guildId);
}

function decryptKey(row) {
  if (!row) return null;
  return require('./crypto').decrypt(payloadFromRow(row));
}

function getModel(guildId) {
  return getKeyRow(guildId)?.model || config.bot.defaultAiModel || process.env.DEFAULT_AI_MODEL || 'openai/gpt-4o-mini';
}

// Never expose the raw key - only a masked preview and metadata.
function getStatus(guildId) {
  const row = getKeyRow(guildId);
  if (!row) return { configured: false };

  let preview = 'unavailable';
  try {
    preview = mask(decryptKey(row));
  } catch (err) {
    console.error('[AI] Could not decrypt stored key (ENCRYPTION_KEY changed?):', err.message);
  }

  return {
    configured: true,
    preview,
    model: row.model,
    addedBy: row.added_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { setKey, removeKey, hasKey, getModel, getStatus, getKeyRow, decryptKey, looksValid, MODEL_CHOICES };
