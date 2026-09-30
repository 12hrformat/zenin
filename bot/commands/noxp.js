const { SlashCommandBuilder } = require('discord.js');
const leveling = require('../services/leveling');
const { canManageServer } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('noxp')
    .setDescription('Channels where members don’t earn XP')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Stop XP in a channel')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to exclude')
            .setRequired(true)
            .addChannelTypes(0, 5)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Restore XP in a channel')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to re-enable')
            .setRequired(true)
            .addChannelTypes(0, 5)
        )
    )
    .addSubcommand(sub => sub.setName('list').setDescription('Show excluded channels')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = leveling.listNoXp(interaction.guild.id);
      if (!rows.length) return interaction.reply('XP is earned everywhere right now.');

      const lines = rows
        .map(r => interaction.guild.channels.cache.get(r.channel_id))
        .filter(Boolean)
        .map(c => `<#${c.id}>`)
        .join(' ');

      await interaction.reply(lines || 'Those channels no longer exist.');
      return;
    }

    if (!canManageServer(interaction.member)) {
      return interaction.reply({ content: 'You need **Manage Server** for that.', flags: 64 });
    }

    const channel = interaction.options.getChannel('channel');

    if (sub === 'add') {
      leveling.addNoXp(interaction.guild.id, channel.id);
      await interaction.reply(`No more XP in <#${channel.id}>.`);
    } else {
      leveling.removeNoXp(interaction.guild.id, channel.id);
      await interaction.reply(`<#${channel.id}> earns XP again.`);
    }
  },
};
