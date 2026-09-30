const { db } = require('../../database');
const crypto = require('crypto');

/**
 * Dashboard access. An admin runs /dashboard in their server, the bot issues a
 * random token in a DM, and that token signs them into the web dashboard.
 * Simpler than OAuth and requires no extra Discord configuration.
 */

const TTL_DAYS = 30;

// One live token per user per guild.
function issue(guildId, userId, days = TTL_DAYS) {
  db.prepare('DELETE FROM dashboard_tokens WHERE guild_id = ? AND user_id = ?').run(guildId, userId);

  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();

  db.prepare(
    'INSERT INTO dashboard_tokens (token, guild_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(token, guildId, userId, now, now + days * 86400000);

  return { token, expiresAt: now + days * 86400000 };
}

function verify(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM dashboard_tokens WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM dashboard_tokens WHERE token = ?').run(token);
    return null;
  }
  db.prepare('UPDATE dashboard_tokens SET last_used = ? WHERE token = ?').run(Date.now(), token);
  return row;
}

function revoke(guildId, userId) {
  return db.prepare('DELETE FROM dashboard_tokens WHERE guild_id = ? AND user_id = ?').run(guildId, userId)
    .changes;
}

function activeSessions(guildId) {
  return db
    .prepare(
      'SELECT user_id, created_at, expires_at, last_used FROM dashboard_tokens WHERE guild_id = ? AND expires_at > ?'
    )
    .all(guildId, Date.now());
}

function purgeExpired() {
  return db.prepare('DELETE FROM dashboard_tokens WHERE expires_at < ?').run(Date.now()).changes;
}

module.exports = { issue, verify, revoke, activeSessions, purgeExpired, TTL_DAYS };
