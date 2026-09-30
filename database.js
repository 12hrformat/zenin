const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'zenin.db');

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Node's built-in SQLite: no native build step, no node-gyp, no toolchain.
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function initDatabase() {
  db.exec(`
    -- Every server the bot is in. Holds the permanent invite minted on join.
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id     TEXT PRIMARY KEY,
      guild_name   TEXT NOT NULL,
      owner_id     TEXT NOT NULL,
      icon         TEXT,
      invite_code  TEXT DEFAULT '',
      invite_url   TEXT DEFAULT '',
      member_count INTEGER DEFAULT 0,
      is_active    INTEGER DEFAULT 1,
      joined_at    INTEGER NOT NULL
    );

    -- The public directory shown on the website. A row here == a server
    -- an admin has advertised for sponsorship / partnerships.
    CREATE TABLE IF NOT EXISTS listings (
      guild_id        TEXT PRIMARY KEY,
      description     TEXT NOT NULL DEFAULT '',
      tags            TEXT NOT NULL DEFAULT '',
      language        TEXT DEFAULT '',
      seeking_sponsor INTEGER DEFAULT 1,
      seeking_partners INTEGER DEFAULT 0,
      listing_status  TEXT NOT NULL DEFAULT 'active',
      views           INTEGER DEFAULT 0,
      clicks          INTEGER DEFAULT 0,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      FOREIGN KEY (guild_id) REFERENCES guilds(guild_id)
    );

    -- Per-server settings (notification channel, welcome toggle, ...)
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT NOT NULL,
      key      TEXT NOT NULL,
      value    TEXT,
      PRIMARY KEY (guild_id, key)
    );

    -- XP / levels per guild per user.
    CREATE TABLE IF NOT EXISTS user_levels (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id       TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      xp             INTEGER DEFAULT 0,
      message_count  INTEGER DEFAULT 0,
      last_message_at INTEGER,
      UNIQUE(guild_id, user_id)
    );

    -- MEE6-style auto roles granted when a user hits a level.
    CREATE TABLE IF NOT EXISTS level_roles (
      guild_id TEXT NOT NULL,
      level    INTEGER NOT NULL,
      role_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, level)
    );

    -- Channels where XP is not earned.
    CREATE TABLE IF NOT EXISTS noxp_channels (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );

    -- Per-server OpenRouter keys. NEVER stored in plaintext.
    CREATE TABLE IF NOT EXISTS api_keys (
      guild_id   TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      iv         TEXT NOT NULL,
      auth_tag   TEXT NOT NULL,
      model      TEXT NOT NULL,
      added_by   TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS giveaways (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id          TEXT NOT NULL,
      channel_id        TEXT NOT NULL,
      message_id        TEXT,
      prize             TEXT NOT NULL,
      winner_count      INTEGER DEFAULT 1,
      level_requirement INTEGER DEFAULT 0,
      ends_at           INTEGER NOT NULL,
      created_by        TEXT NOT NULL,
      status            TEXT DEFAULT 'active',
      winners           TEXT,
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learned_words (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      word       TEXT NOT NULL,
      frequency  INTEGER DEFAULT 1,
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      UNIQUE(guild_id, word)
    );

    CREATE TABLE IF NOT EXISTS learned_phrases (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      phrase     TEXT NOT NULL,
      frequency  INTEGER DEFAULT 1,
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      UNIQUE(guild_id, phrase)
    );

    CREATE TABLE IF NOT EXISTS message_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      username   TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sponsorships (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      from_guild_id TEXT,
      to_guild_id   TEXT NOT NULL,
      message       TEXT NOT NULL,
      contact       TEXT,
      source        TEXT DEFAULT 'discord',
      created_at    INTEGER NOT NULL
    );

    -- Private tokens that let a server admin sign into the web dashboard.
    -- Issued by the /dashboard command; never exposed publicly.
    CREATE TABLE IF NOT EXISTS dashboard_tokens (
      token      TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used  INTEGER
    );

    CREATE TABLE IF NOT EXISTS connections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      from_guild_id   TEXT NOT NULL,
      to_guild_id     TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      created_at      INTEGER NOT NULL,
      UNIQUE(from_guild_id, to_guild_id)
    );

    CREATE INDEX IF NOT EXISTS idx_listings_status  ON listings(listing_status);
    CREATE INDEX IF NOT EXISTS idx_guilds_members  ON guilds(member_count);
    CREATE INDEX IF NOT EXISTS idx_listings_sponsor ON listings(seeking_sponsor);
    CREATE INDEX IF NOT EXISTS idx_levels_guild      ON user_levels(guild_id);
    CREATE INDEX IF NOT EXISTS idx_levels_xp         ON user_levels(guild_id, xp DESC);
    CREATE INDEX IF NOT EXISTS idx_levels_recent     ON user_levels(guild_id, last_message_at);
    CREATE INDEX IF NOT EXISTS idx_history_guild     ON message_history(guild_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sponsorships_to   ON sponsorships(to_guild_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dash_tokens       ON dashboard_tokens(guild_id);
  `);

  console.log('[Database] Schema ready');
}

function getSetting(guildId, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
  return row ? row.value : fallback;
}

function setSetting(guildId, key, value) {
  db.prepare(
    `INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`
  ).run(guildId, key, value === null ? null : String(value));
}

function deleteSetting(guildId, key) {
  db.prepare('DELETE FROM settings WHERE guild_id = ? AND key = ?').run(guildId, key);
}

module.exports = { db, initDatabase, DB_PATH, getSetting, setSetting, deleteSetting };
