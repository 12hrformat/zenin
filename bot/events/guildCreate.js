const listings = require('../services/listings');
const { siteUrl, botInvite } = require('../services/helpers');

module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    listings.ensureGuildRow(guild);
    const invite = await listings.ensurePermanentInvite(guild);

    const channel =
      guild.systemChannel ||
      guild.channels.cache.find(c => c.isTextBased() && c.viewable && !c.isThread());

    if (!channel) return;

    const owner = await guild.fetchOwner().catch(() => null);
    const howToList =
      '**Put your server on the directory**\n' +
      '`/sponsor add` — you set a description and tags, I mint a permanent invite and list you at\n' +
      `↳ ${siteUrl()}/browse`;

    await channel
      .send({
        content: `👋 Hey — I'm **zenin**. I just landed in **${guild.name}**.`,
        embeds: [
          {
            title: 'What I do here',
            description:
              '**AI that learns your chat** — mention me with `@zenin <question>` and I answer in your ' +
              'server\'s slang, using the inside jokes I\'ve picked up from the room.\n\n' +
              '**Levels** — everyone earns XP for chatting, with leaderboards and auto-roles.\n\n' +
              '**Giveaways** — require a minimum level to enter, so no drive-by entries.\n\n' +
              '**A directory for your server** — get discovered and receive sponsorship pings at ' +
              `${siteUrl()}/browse.`,
            color: 0xffd60a,
            fields: [
              { name: 'Get started', value: howToList, inline: false },
              {
                name: 'Enable the AI',
                value:
                  'AI is per-server and costs you nothing to host — **you** supply the OpenRouter key.\n' +
                  '`/api setup` — I DM you a private token, you send me the key in a DM.',
                inline: false,
              },
              {
                name: 'At a glance',
                value:
                  `Members: **${guild.memberCount || 0}**\n` +
                  `Your invite: ${invite ? invite.invite_url : '_(failed — I need the **Create Invite** permission)_'}\n` +
                  `Owner: ${owner ? owner.user.tag : guild.ownerId}`,
                inline: false,
              },
              {
                name: 'Links',
                // Discord markdown has no relative links, so commands are named as
                // slash commands rather than linked.
                value:
                  `[Directory](${siteUrl()}/browse) · [Add me elsewhere](${botInvite()}) · ` +
                  'Run `/help` in this server for the full command list',
                inline: false,
              },
            ],
            footer: { text: 'zenin — Discord server directory & AI bot' },
          },
        ],
      })
      .catch(err => console.error('[guildCreate] Could not post intro:', err.message));

    console.log(`[guildCreate] ${guild.name} (${guild.id}) registered`);
  },
};
