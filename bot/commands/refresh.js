const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const listings = require('../services/listings');
const { canManageServer } = require('../services/helpers');

/**
 * Forces a re-sync of everything that can go stale: the permanent invite, the
 * guild row (name, icon, member count) and the listing's activity figure.
 * Member counts only change when the bot is running, so a manual refresh is
 * the only way to catch up after downtime.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Re-sync this server’s listing — name, icon, member count, invite'),

  async execute(interaction) {
    if (!canManageServer(interaction.member)) {
      return interaction.reply({
        content: 'You need **Manage Server** to refresh the listing.',
        flags: 64,
      });
    }

    const guild = interaction.guild;
    await interaction.deferReply();

    listings.ensureGuildRow(guild);
    listings.refreshCounts(guild.id, guild.memberCount || 0);

    const invite = await listings.ensurePermanentInvite(guild);
    const activity = listings.activityOf(guild.id);
    const listing = listings.getListing(guild.id);

    if (!invite) {
      return interaction.editReply(
        'Listing data refreshed, but the **permanent invite still failed**. ' +
          'Check that the zenin role has **Create Invite** (`0x00000008`) in Server Settings → Roles.'
      );
    }

    const embed = new EmbedBuilder()
      .setColor(listing?.listing_status === 'active' ? 0xffd60a : 0x666666)
      .setTitle('Refreshed')
      .setDescription('Everything the directory shows is now current.')
      .addFields(
        { name: 'Server', value: guild.name, inline: true },
        { name: 'Members', value: `${(guild.memberCount || 0).toLocaleString()}`, inline: true },
        { name: 'Active in chat', value: `${activity}`, inline: true },
        { name: 'Permanent invite', value: invite.invite_url, inline: false },
        {
          name: 'Listing',
          value: listing
            ? `${listing.listing_status === 'active' ? 'Live in the directory' : 'Paused (hidden)'} · ${listing.views} views · ${listing.clicks} joins`
            : '_Not listed — run `/sponsor add`_',
          inline: false,
        }
      )
      .setFooter({ text: 'Run /refresh again any time counts look off.' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
