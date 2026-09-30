const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { leaderboard, rankOf, getStats } = require('../services/leveling');
const { ordinal, truncate } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members in this server'),

  async execute(interaction) {
    const rows = leaderboard(interaction.guild.id, 10);
    if (!rows.length) {
      return interaction.reply('Nobody has earned XP here yet — send a message!');
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => {
      const prefix = medals[i] || `${i + 1}.`;
      return `${prefix} <@${r.user_id}> — **${r.xp.toLocaleString()}** XP`;
    });

    // Show where you actually sit, even if you're outside the top 10.
    const me = rankOf(interaction.guild.id, interaction.user.id);
    const mine = getStats(interaction.guild.id, interaction.user.id);
    const footer = me
      ? `You: ${ordinal(me)} · ${mine.xp.toLocaleString()} XP`
      : 'Send messages to earn XP';

    const embed = new EmbedBuilder()
      .setColor(0xffd60a)
      .setTitle(`${interaction.guild.name} — top members`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: truncate(footer, 200) })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
