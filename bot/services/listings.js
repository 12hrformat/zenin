const { db } = require('../../database');
const config = require('../../config.json');

/**
 * The directory. Any server admin can advertise their server here; the
 * website reads straight from these rows so listings are live instantly.
 */

/**
 * Creates or refreshes the permanent invite for a guild.
 * max_age 0 + max_uses 0 => the link never expires.
 */
/**
 * Picks a channel we can hang an invite off. An invite always belongs to a
 * channel, and discord.js throws "Could not resolve channel to a guild channel"
 * when the system channel is missing or not yet cached, so we look explicitly.
 */
function pickInviteChannel(guild) {
  const usable = c => c && !c.isThread?.() && c.isTextBased?.();

  // Prefer the system channel so invites land somewhere sensible.
  if (usable(guild.systemChannel)) return guild.systemChannel;

  // Otherwise the first channel the bot can actually see.
  const fallback = guild.channels?.cache
    ?.filter(c => usable(c) && c.viewable !== false)
    ?.sort((a, b) => (a.position || 0) - (b.position || 0))
    ?.first();

  if (fallback) return fallback;

  // Nothing cached yet: fetch and try once more.
  return null;
}

async function ensurePermanentInvite(guild) {
  const existing = db.prepare('SELECT invite_code, invite_url FROM guilds WHERE guild_id = ?').get(guild.id);
  if (existing && existing.invite_code) return existing;

  let channel = pickInviteChannel(guild);

  // Channel cache can be empty right after login, so resolve it on demand.
  if (!channel && guild.channels?.fetch) {
    try {
      const fetched = await guild.channels.fetch();
      channel = fetched
        ? [...fetched.values()].find(c => !c.isThread?.() && c.isTextBased?.())
        : null;
    } catch {
      /* fall through to the error below */
    }
  }

  if (!channel) {
    console.error(
      `[Listings] ${guild.name} (${guild.id}) has no text channel to attach an invite to. ` +
        'Create a text channel or mention the bot, then run /sponsor add again.'
    );
    return null;
  }

  try {
    const invite = await guild.invites.create(channel, {
      max_age: 0,
      max_uses: 0,
      unique: true,
      reason: 'zenin permanent directory invite',
    });
    db.prepare('UPDATE guilds SET invite_code = ?, invite_url = ? WHERE guild_id = ?').run(
      invite.code,
      invite.url,
      guild.id
    );
    return { invite_code: invite.code, invite_url: invite.url };
  } catch (err) {
    // Name the actual missing permission instead of guessing, so the fix in
    // Server Settings is obvious.
    const missing = guild.members?.me?.permissions?.has('CreateInstantInvite')
      ? ''
      : ' (missing **Create Invite** / 0x00000008)';

    console.error(
      `[Listings] Could not create invite for ${guild.name} (${guild.id}): ${err.message}${missing}`
    );
    return null;
  }
}

function ensureGuildRow(guild) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO guilds (guild_id, guild_name, owner_id, icon, member_count, joined_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       guild_name   = excluded.guild_name,
       owner_id     = excluded.owner_id,
       icon         = excluded.icon,
       member_count = excluded.member_count,
       is_active    = 1`
  ).run(
    guild.id,
    guild.name,
    guild.ownerId,
    // node:sqlite rejects undefined outright, and iconURL() returns undefined
    // (not null) for a guild with no icon, so normalise to null.
    guild.iconURL ? (guild.iconURL({ extension: 'png', size: 128 }) ?? null) : null,
    guild.memberCount || 0,
    now
  );
}

function refreshCounts(guildId, memberCount) {
  if (typeof memberCount !== 'number') return;
  db.prepare('UPDATE guilds SET member_count = ? WHERE guild_id = ?').run(memberCount, guildId);
}

function upsertListing(guildId, { description, tags, language, seekingSponsor, seekingPartners }) {
  const now = Date.now();
  const current = db.prepare('SELECT * FROM listings WHERE guild_id = ?').get(guildId);

  if (current) {
    db.prepare(
      `UPDATE listings SET description = ?, tags = ?, language = ?,
        seeking_sponsor = ?, seeking_partners = ?, listing_status = 'active', updated_at = ?
       WHERE guild_id = ?`
    ).run(
      description ?? current.description,
      tags ?? current.tags,
      language ?? current.language,
      seekingSponsor === undefined ? current.seeking_sponsor : seekingSponsor ? 1 : 0,
      seekingPartners === undefined ? current.seeking_partners : seekingPartners ? 1 : 0,
      now,
      guildId
    );
    return db.prepare('SELECT * FROM listings WHERE guild_id = ?').get(guildId);
  }

  db.prepare(
    `INSERT INTO listings (guild_id, description, tags, language, seeking_sponsor,
      seeking_partners, listing_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    guildId,
    description || '',
    tags || '',
    language || '',
    seekingSponsor === false ? 0 : 1,
    seekingPartners ? 1 : 0,
    now,
    now
  );
  return db.prepare('SELECT * FROM listings WHERE guild_id = ?').get(guildId);
}

function removeListing(guildId) {
  db.prepare('DELETE FROM listings WHERE guild_id = ?').run(guildId);
}

function getListing(guildId) {
  return db.prepare('SELECT * FROM listings WHERE guild_id = ?').get(guildId);
}

function pauseListing(guildId) {
  db.prepare("UPDATE listings SET listing_status = 'paused', updated_at = ? WHERE guild_id = ?").run(
    Date.now(),
    guildId
  );
}

function resumeListing(guildId) {
  db.prepare("UPDATE listings SET listing_status = 'active', updated_at = ? WHERE guild_id = ?").run(
    Date.now(),
    guildId
  );
}

function bumpViews(guildId) {
  db.prepare('UPDATE listings SET views = views + 1 WHERE guild_id = ?').run(guildId);
}

function bumpClicks(guildId) {
  db.prepare('UPDATE listings SET clicks = clicks + 1 WHERE guild_id = ?').run(guildId);
}

function parseTags(tags) {
  return String(tags || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Browse the directory. Supports search, tag filter, sorting and paging.
 */
function browse({
  q = '',
  tag = '',
  sort = 'recent',
  seekingOnly = false,
  minMembers = 0,
  page = 1,
  perPage = config.site.perPage,
} = {}) {
  const where = ["g.is_active = 1", "l.listing_status = 'active'", "g.invite_url != ''"];
  const params = {};

  if (seekingOnly) where.push('l.seeking_sponsor = 1');
  if (minMembers > 0) {
    where.push('g.member_count >= @minMembers');
    params.minMembers = minMembers;
  }
  if (q) {
    where.push('(g.guild_name LIKE @q OR l.description LIKE @q OR l.tags LIKE @q)');
    params.q = `%${q}%`;
  }
  if (tag) {
    where.push('l.tags LIKE @tag');
    params.tag = `%${tag}%`;
  }

  const orderBy =
    {
      members: 'g.member_count DESC',
      recent: 'l.updated_at DESC',
      oldest: 'l.created_at ASC',
      clicks: 'l.clicks DESC',
      views: 'l.views DESC',
    }[sort] || 'l.updated_at DESC';

  const limit = perPage;
  const offset = (page - 1) * limit;

  const base = `FROM listings l JOIN guilds g ON g.guild_id = l.guild_id WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS c ${base}`).get(params).c;

  const items = db
    .prepare(
      `SELECT g.guild_id, g.guild_name, g.icon, g.member_count, g.invite_url, g.invite_code,
              l.description, l.tags, l.language, l.seeking_sponsor, l.seeking_partners,
              l.views, l.clicks, l.created_at, l.updated_at
       ${base} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset })
    .map(row => ({
      ...row,
      tagList: parseTags(row.tags),
      activity: activityOf(row.guild_id),
    }));

  return {
    items,
    total,
    page,
    perPage: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// "Active now" = members who chatted in the activity window. Cheap, and it
// needs no privileged presence intent.
function activityOf(guildId) {
  const since = Date.now() - config.bot.activityWindowMs;
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM user_levels WHERE guild_id = ? AND last_message_at >= ?')
    .get(guildId, since);
  return row.c;
}

function allTags() {
  const rows = db.prepare("SELECT tags FROM listings WHERE listing_status = 'active' AND tags != ''").all();
  const counts = new Map();
  for (const r of rows) {
    for (const t of parseTags(r.tags)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

function networkStats() {
  const servers = db.prepare("SELECT COUNT(*) AS c FROM guilds WHERE is_active = 1").get().c;
  const listed = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE listing_status = 'active'").get().c;
  const members = db
    .prepare('SELECT COALESCE(SUM(member_count), 0) AS c FROM guilds WHERE is_active = 1')
    .get().c;
  const since = Date.now() - config.bot.activityWindowMs;
  const active = db
    .prepare('SELECT COUNT(DISTINCT guild_id) AS c FROM user_levels WHERE last_message_at >= ?')
    .get(since).c;
  const messages = db.prepare('SELECT COALESCE(SUM(message_count), 0) AS c FROM user_levels').get().c;
  const terms = db.prepare('SELECT COUNT(*) AS c FROM learned_words').get().c;
  const phrases = db.prepare('SELECT COUNT(*) AS c FROM learned_phrases').get().c;

  return { servers, listed, members, activeRecently: active, messages, terms, phrases };
}

// Unused-by-default roster of guilds the bot is in.
function allGuilds() {
  return db.prepare('SELECT * FROM guilds WHERE is_active = 1 ORDER BY member_count DESC').all();
}

module.exports = {
  ensurePermanentInvite,
  ensureGuildRow,
  refreshCounts,
  upsertListing,
  removeListing,
  getListing,
  pauseListing,
  resumeListing,
  bumpViews,
  bumpClicks,
  browse,
  allTags,
  networkStats,
  allGuilds,
  activityOf,
  parseTags,
};
