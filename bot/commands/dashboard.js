const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dashTokens = require('../services/dashTokens');
const { siteUrl } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Get a private link to manage your server from the website'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const { token, expiresAt } = dashTokens.issue(interaction.guild.id, interaction.user.id);

    const sent = await interaction.user
      .send(
        `**Your zenin dashboard for ${interaction.guild.name}**\n\n` +
          `Open: ${siteUrl()}/dashboard\n` +
          `Paste this token to sign in:\n\n` +
          '```\n' +
          token +
          '\n```\n\n' +
          `Valid until <t:${Math.floor(expiresAt / 1000)}:F>. ` +
          'Running `/dashboard` again replaces the old token. ' +
          'From there you can edit the listing, toggle visibility and sponsorship, change the AI model and watch your stats.',
      )
      .catch(() => null);

    if (!sent) {
      return interaction.editReply(
        'I couldn’t DM you. Enable DMs from server members (right-click me → Apps) and run `/dashboard` again.',
      );
    }

    await interaction.editReply('Sent you a DM with your dashboard link and token.');
  },
};
