const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { networkStats } = require('../services/listings');
const { siteUrl, botInvite } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('network')
    .setDescription('How big the zenin network is, and where to list your server'),

  async execute(interaction) {
    const s = networkStats();

    const embed = new EmbedBuilder()
      .setColor(0xffd60a)
      .setTitle('zenin network')
      .setDescription(
        `Browse every server that's listed: ${siteUrl()}/browse\n` +
          `Your server's listing: ${siteUrl()}/servers/${interaction.guild.id}\n\n` +
          `Not listed yet? Run \`/sponsor add\`.`
      )
      .addFields(
        { name: 'Servers', value: `${s.servers}`, inline: true },
        { name: 'Listed for sponsorship', value: `${s.listed}`, inline: true },
        { name: 'Members', value: s.members.toLocaleString(), inline: true },
        { name: 'Active in last 15 min', value: `${s.activeRecently} servers`, inline: true },
        { name: 'Messages counted', value: s.messages.toLocaleString(), inline: true },
        { name: 'Terms learned', value: `${s.terms}`, inline: true }
      )
      .addFields({ name: 'Add zenin elsewhere', value: `[Invite me](${botInvite()})`, inline: false })
      .setFooter({ text: 'made by 12hrformat (dragon)' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
