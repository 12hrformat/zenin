const config = require('../../config.json');
const listings = require('../services/listings');
const giveaway = require('../services/giveaway');
const dashTokens = require('../services/dashTokens');
const { deployCommands } = require('../deploy');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    global.client = client;

    console.log(`\n[Bot] zenin online as ${client.user.tag}`);
    console.log(`[Bot] ${client.guilds.cache.size} server(s), ${client.users.cache.size} cached user(s)`);

    // Backfill permanent invites + rows for guilds joined before a restart.
    const results = await Promise.allSettled(
      [...client.guilds.cache.values()].map(async guild => {
        listings.ensureGuildRow(guild);
        return listings.ensurePermanentInvite(guild);
      })
    );
    const ok = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`[Bot] Invites ready for ${ok}/${client.guilds.cache.size} server(s)`);

    client.user.setPresence({
      status: 'online',
      activities: [{ name: `${client.guilds.cache.size} servers listed`, type: 3 }],
    });

    await deployCommands(client);

    giveaway.sweepExpired(client);
    setInterval(() => giveaway.sweepExpired(client), 15000).unref?.();
    setInterval(() => dashTokens.purgeExpired(), 3600000).unref?.();

    console.log(`[Bot] Model default: ${config.bot.defaultAiModel}`);
    console.log('[Bot] Ready.\n');
  },
};
