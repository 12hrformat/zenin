const { db } = require('../../database');
const config = require('../../config.json');
const { levelFromXp } = require('./leveling');

const EMOJI = config.giveaway.emoji;

function createGiveaway({ guildId, channelId, prize, winnerCount, levelRequirement, endsAt, createdBy }) {
  const info = db
    .prepare(
      `INSERT INTO giveaways (guild_id, channel_id, prize, winner_count, level_requirement, ends_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(guildId, channelId, prize, winnerCount, levelRequirement, endsAt, createdBy, Date.now());
  return info.lastInsertRowid;
}

async function postGiveaway(client, guildId, giveawayId) {
  const g = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(giveawayId);
  if (!g) return null;

  const channel = client.channels.cache.get(g.channel_id);
  if (!channel) return null;

  const requirement =
    g.level_requirement > 0
      ? `**Minimum level:** ${g.level_requirement} (check yours with \`/level\`)`
      : '**Minimum level:** none — anyone can enter';

  const msg = await channel.send(
    `🎉 **GIVEAWAY** 🎉\n` +
      `**Prize:** ${g.prize}\n` +
      `**Winners:** ${g.winner_count}\n` +
      `${requirement}\n` +
      `**Ends:** <t:${Math.floor(g.ends_at / 1000)}:R>\n\n` +
      `React with ${EMOJI} to enter. Only accounts that meet the level requirement can win.`
  );

  try {
    await msg.react(EMOJI);
  } catch {
    /* custom emoji not available in guild - skip */
  }

  db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(msg.id, giveawayId);
  return msg;
}

/** Users whose XP clears the level gate. */
function eligibleEntrants(giveaway) {
  const required = giveaway.level_requirement || 0;
  return db
    .prepare('SELECT user_id, xp FROM user_levels WHERE guild_id = ? AND xp > 0')
    .all(giveaway.guild_id)
    .filter(u => levelFromXp(u.xp) >= required);
}

/**
 * Winners come from reactors, intersected with the level gate.
 * Falls back to level-qualified members if the reactions were wiped.
 */
async function pickWinners(client, giveaway) {
  const eligible = new Set(eligibleEntrants(giveaway).map(u => u.user_id));

  let entrants = [];
  try {
    const channel = await client.channels.fetch(giveaway.channel_id);
    const message = giveaway.message_id ? await channel.messages.fetch(giveaway.message_id) : null;
    const reaction = message?.reactions?.cache.find(r => (r.emoji.name || r.emoji.id) === EMOJI);

    if (reaction) {
      for await (const user of reaction.users.fetch()) {
        if (eligible.has(user.id)) entrants.push(user.id);
      }
    }
  } catch (err) {
    console.error(`[Giveaway] Could not read reactions for #${giveaway.id}:`, err.message);
  }

  if (entrants.length === 0) entrants = [...eligible];

  const winners = [];
  const pool = [...new Set(entrants)];
  for (let i = 0; i < giveaway.winner_count && pool.length > 0; i++) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return winners;
}

async function endGiveaway(client, giveaway) {
  const winners = await pickWinners(client, giveaway);

  const channel = client.channels.cache.get(giveaway.channel_id);
  if (channel) {
    const mention = winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'nobody entered';
    await channel
      .send(`🎉 **GIVEAWAY ENDED**\n**Prize:** ${giveaway.prize}\n**Winner(s):** ${mention}\n\nGreat game!`)
      .catch(() => {});
  }

  // Try to DM winners so they actually claim the prize.
  for (const id of winners) {
    try {
      const user = await client.users.fetch(id);
      await user.send(
        `🎉 You won **${giveaway.prize}** in **${channel?.guild?.name || 'a server'}**!\nUse \`/giveaway create\` to run one yourself.`
      );
    } catch {
      /* DMs closed - ignore */
    }
  }

  db.prepare("UPDATE giveaways SET status = 'ended', winners = ? WHERE id = ?").run(
    JSON.stringify(winners),
    giveaway.id
  );

  return winners;
}

async function sweepExpired(client) {
  const due = db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ?").all(Date.now());
  for (const g of due) {
    try {
      const w = await endGiveaway(client, g);
      console.log(`[Giveaway] #${g.id} ended (${w.length} winner(s))`);
    } catch (err) {
      console.error(`[Giveaway] Failed to end #${g.id}:`, err.message);
    }
  }
  return due.length;
}

const listActive = guildId =>
  db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active'").all(guildId);

const getGiveaway = id => db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);

module.exports = { EMOJI, createGiveaway, postGiveaway, sweepExpired, listActive, getGiveaway, endGiveaway };
