const config = require('../../config.json');
const { addXp, isNoXp, syncLevelRoles, progressToNextLevel } = require('../services/leveling');
const { recordMessage, getVocabulary, recentMessages } = require('../services/learning');
const { generateReply, cooldownRemaining, markUsed } = require('../services/ai');
const { getListing, ensureGuildRow, refreshCounts } = require('../services/listings');
const aiKeys = require('../services/aiKeys');
const dashTokens = require('../services/dashTokens');
const { getSetting } = require('../../database');
const { randInt, bar, siteUrl } = require('../services/helpers');

const lastXp = new Map();

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (!message || message.author.bot || message.webhookId) return;
    if (!message.content || !message.content.trim()) return;
    if (message.author.id === message.client.user.id) return;

    // Direct messages: the only supported command there is submitting an API key.
    if (message.channel.isDMs()) return handleDirectMessage(message);

    // Mentioning the bot always talks to the AI - no command needed.
    if (message.mentions.has(message.client.user.id)) {
      await handleMention(message);
      return;
    }

    if (message.guild) {
      ensureGuildRow(message.guild);

      const now = Date.now();
      const last = lastXp.get(message.author.id) || 0;

      if (now - last >= config.bot.xpCooldownMs && !isNoXp(message.guild.id, message.channel.id)) {
        lastXp.set(message.author.id, now);
        refreshCounts(message.guild.id, message.guild.memberCount || 0);

        const [min, max] = config.bot.xpPerMessage;
        const result = addXp(message.guild.id, message.author.id, randInt(min, max));

        if (result.leveledUp) {
          await announceLevelUp(message, result);
          await syncLevelRoles(message.guild, message.author.id, result.level).catch(() => {});
        }
      }

      recordMessage(message.guild.id, message.author.id, message.author.username, message.content);
    }
  },
};

async function announceLevelUp(message, result) {
  const milestone = result.level % 5 === 0;
  const { percent } = progressToNextLevel(result.xp);

  const noticeChannelId = getSetting(message.guild.id, 'levelup_channel');
  const target =
    (noticeChannelId && message.guild.channels.cache.get(noticeChannelId)) || message.channel;

  try {
    const sent = await target.send({
      content:
        `${milestone ? '🏆' : '🎉'} **${message.author.username}** reached **level ${result.level}** — ` +
        `${result.xp.toLocaleString()} XP total. ${milestone ? 'Milestone unlocked.' : ''}`,
      embeds: milestone
          ? [
              {
                title: `Level ${result.level}`,
                description: `${bar(percent)}\n${result.xp.toLocaleString()} XP`,
                color: 0xffd60a,
              },
            ]
          : [],
    });
    if (milestone) await sent.react('🔥').catch(() => {});
  } catch (err) {
    console.error('[Levels] Could not announce level up:', err.message);
  }
}

async function handleMention(message) {
  const client = message.client;
  const guildId = message.guild?.id;

  const prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), ' ')
    .trim();

  if (!prompt) {
    await message
      .reply(`hey ${message.author.username} 👋 I'm around — mention me with a question and I'll answer.`)
      .catch(() => {});
    return;
  }

  const remaining = cooldownRemaining(message.author.id);
  if (remaining > 0) {
    await message
      .reply(`give me a second (${Math.ceil(remaining / 1000)}s) — I'm still on the last one.`)
      .catch(() => {});
    return;
  }

  // DMs and unconfigured servers need a clear next step, not a raw API error.
  if (!guildId || !aiKeys.hasKey(guildId)) {
    await message
      .reply(
        `I need this server to supply an OpenRouter key before I can think. An admin can set one up with \`/api setup\`.` +
          (guildId ? '' : ' (DM setup is not available — run `/api setup` inside your server.)')
      )
      .catch(() => {});
    return;
  }

  const vocab = getVocabulary(guildId);
  const history = recentMessages(guildId, 25);
  const listing = getListing(guildId);

  await message.channel.sendTyping().catch(() => {});

  const { reply, error } = await generateReply({
    guildId,
    guildName: message.guild.name,
    botName: client.user.username,
    userName: message.author.username,
    userId: message.author.id,
    messageContent: prompt,
    words: vocab.words,
    phrases: vocab.phrases,
    history,
    serverDesc: listing?.description || '',
  });

  if (error) {
    console.error('[AI] Reply failed:', error);
    await message.reply(`brain glitch — ${error}`).catch(() => {});
    return;
  }

  markUsed(message.author.id);
  await message.reply(reply).catch(err => console.error('[AI] Send failed:', err.message));
}

/**
 * API keys are submitted by DM so they never appear in a public channel.
 */
async function handleDirectMessage(message) {
  const prefix = process.env.DM_PREFIX || '!';
  const [cmd, ...rest] = message.content.trim().split(/\s+/);
  if (cmd !== `${prefix}setkey`) {
    await message
      .reply(`Send me \`${prefix}setkey sk-or-...\` to attach an OpenRouter key to your server.`)
      .catch(() => {});
    return;
  }

  const key = rest.join('').trim();
  const { looksValid } = require('../services/crypto');

  if (!looksValid(key)) {
    await message
      .reply("That doesn't look like an OpenRouter key. They look like `sk-or-v1-...` — grab one at https://openrouter.ai/keys")
      .catch(() => {});
    return;
  }

  // Find the first guild where this DM sender is the owner.
  const owned = [...message.client.guilds.cache.values()].find(g => g.ownerId === message.author.id);

  if (!owned) {
    await message
      .reply("I couldn't find a server where you're the owner. Add me to your server first, then run `/api setup` inside it.")
      .catch(() => {});
    return;
  }

  try {
    aiKeys.setKey(owned.id, key, aiKeys.getModel(owned.id), message.author.id);
    const { token } = dashTokens.issue(owned.id, message.author.id);

    await message
      .reply(
        `Key stored (encrypted) for **${owned.name}**. I can think now — mention me in chat any time.\n\n` +
          `Here's your dashboard login: ${siteUrl()}/dashboard\n` +
          `Paste this token: \`${token}\`\n\n` +
          `Run \`/api setup\` again any time to rotate it.`
      )
      .catch(() => {});
  } catch (err) {
    console.error('[DM] Failed to store key:', err.message);
    await message.reply(`Couldn't store that: ${err.message}`).catch(() => {});
  }
}
