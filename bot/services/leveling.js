const { db } = require('../../database');
const config = require('../../config.json');

const BASE = config.levels.xpMultiplierBase;

/**
 * MEE6-style curve: total XP for level n = 50 * (n^2 - 1)
 * L2 = 150, L3 = 400, L5 = 1200, L10 = 4950, L25 = 31200
 */
function levelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / BASE + 1));
}

function xpForLevel(level) {
  return BASE * (level * level - 1);
}

function progressToNextLevel(xp) {
  const level = levelFromXp(xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const into = xp - floor;
  const needed = ceil - floor;
  return { level, into, needed, percent: needed > 0 ? Math.floor((into / needed) * 100) : 100 };
}

function getOrCreateUser(guildId, userId) {
  let row = db
    .prepare('SELECT * FROM user_levels WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
  if (!row) {
    db.prepare(
      'INSERT INTO user_levels (guild_id, user_id, xp, message_count, last_message_at) VALUES (?, ?, 0, 0, ?)'
    ).run(guildId, userId, Date.now());
    row = db.prepare('SELECT * FROM user_levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }
  return row;
}

function getStats(guildId, userId) {
  return getOrCreateUser(guildId, userId);
}

/**
 * Awards XP. Honours no-XP channels and the XP cooldown.
 * Returns null when no XP was granted, otherwise the result payload.
 */
function addXp(guildId, userId, amount) {
  const before = getOrCreateUser(guildId, userId);
  const beforeLevel = levelFromXp(before.xp);

  const now = Date.now();
  const xp = before.xp + amount;
  const afterLevel = levelFromXp(xp);

  db.prepare(
    'UPDATE user_levels SET xp = ?, message_count = message_count + 1, last_message_at = ? WHERE guild_id = ? AND user_id = ?'
  ).run(xp, now, guildId, userId);

  return {
    xp,
    gained: amount,
    leveledUp: afterLevel > beforeLevel,
    from: beforeLevel,
    level: afterLevel,
  };
}

function setXp(guildId, userId, xp) {
  getOrCreateUser(guildId, userId);
  db.prepare('UPDATE user_levels SET xp = ? WHERE guild_id = ? AND user_id = ?').run(xp, guildId, userId);
}

function leaderboard(guildId, limit = 10) {
  return db
    .prepare('SELECT * FROM user_levels WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC LIMIT ?')
    .all(guildId, limit);
}

function rankOf(guildId, userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) + 1 AS rank FROM user_levels
       WHERE guild_id = ? AND xp > (SELECT xp FROM user_levels WHERE guild_id = ? AND user_id = ?)`
    )
    .get(guildId, guildId, userId);
  return row?.rank ?? null;
}

function isNoXp(guildId, channelId) {
  return !!db
    .prepare('SELECT 1 FROM noxp_channels WHERE guild_id = ? AND channel_id = ?')
    .get(guildId, channelId);
}

// ---- no-XP channel management ----
function addNoXp(guildId, channelId) {
  db.prepare('INSERT OR IGNORE INTO noxp_channels (guild_id, channel_id) VALUES (?, ?)').run(guildId, channelId);
}
function removeNoXp(guildId, channelId) {
  db.prepare('DELETE FROM noxp_channels WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
}
function listNoXp(guildId) {
  return db.prepare('SELECT channel_id FROM noxp_channels WHERE guild_id = ?').all(guildId);
}

// ---- level roles ----
function setLevelRole(guildId, level, roleId) {
  db.prepare(
    `INSERT INTO level_roles (guild_id, level, role_id) VALUES (?, ?, ?)
     ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id`
  ).run(guildId, level, roleId);
}
function removeLevelRole(guildId, level) {
  db.prepare('DELETE FROM level_roles WHERE guild_id = ? AND level = ?').run(guildId, level);
}
function listLevelRoles(guildId) {
  return db.prepare('SELECT level, role_id FROM level_roles WHERE guild_id = ? ORDER BY level').all(guildId);
}
function roleForLevel(guildId, level) {
  return db.prepare('SELECT role_id FROM level_roles WHERE guild_id = ? AND level = ?').get(guildId, level)?.role_id || null;
}

/**
 * Grants/removes level roles for a user. Returns notes about what changed so
 * the caller can report it.
 */
async function syncLevelRoles(guild, userId, level) {
  const rows = listLevelRoles(guild.id);
  if (!rows.length) return null;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;

  const shouldHave = rows.filter(r => level >= r.level).map(r => r.role_id);
  const shouldDrop = rows.filter(r => level < r.level).map(r => r.role_id);

  const added = [];
  const removed = [];
  const skipped = [];

  for (const roleId of shouldHave) {
    if (member.roles.cache.has(roleId)) continue;
    try {
      await member.roles.add(roleId, 'zenin level up');
      added.push(roleId);
    } catch (err) {
      // Bot can't manage this role (hierarchy) - report it instead of crashing.
      skipped.push(roleId);
      console.error(`[Levels] Could not add role ${roleId} in ${guild.name}: ${err.message}`);
    }
  }

  for (const roleId of shouldDrop) {
    if (!member.roles.cache.has(roleId)) continue;
    try {
      await member.roles.remove(roleId, 'zenin level role no longer met');
      removed.push(roleId);
    } catch {
      /* hierarchy - ignore */
    }
  }

  return { added, removed, skipped, changed: added.length + removed.length > 0 };
}

module.exports = {
  levelFromXp,
  xpForLevel,
  progressToNextLevel,
  getOrCreateUser,
  getStats,
  addXp,
  setXp,
  leaderboard,
  rankOf,
  isNoXp,
  addNoXp,
  removeNoXp,
  listNoXp,
  setLevelRole,
  removeLevelRole,
  listLevelRoles,
  roleForLevel,
  syncLevelRoles,
};
