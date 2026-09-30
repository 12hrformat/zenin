const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { progressToNextLevel, rankOf, getStats, leaderboard } = require('../services/leveling');
const { bar, ordinal } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Your level and XP — or someone else’s')
    .addUserOption(opt => opt.setName('user').setDescription('Check another member')),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const stats = getStats(interaction.guild.id, target.id);
    const { level, into, needed, percent } = progressToNextLevel(stats.xp);
    const rank = rankOf(interaction.guild.id, target.id);
    const total = leaderboard(interaction.guild.id, 10000).length;

    const embed = new EmbedBuilder()
      .setColor(0xffd60a)
      .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
      .setTitle(`Level ${level}`)
      .setDescription(`${bar(percent)}\n${into.toLocaleString()} / ${needed.toLocaleString()} XP to level ${level + 1}`)
      .addFields(
        { name: 'Total XP', value: stats.xp.toLocaleString(), inline: true },
        { name: 'Rank', value: rank ? `${ordinal(rank)} of ${total}` : 'unranked', inline: true },
        { name: 'Messages', value: stats.message_count.toLocaleString(), inline: true }
      )
      .setFooter({ text: 'Mention me any time for a chat — levels are separate from AI.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
