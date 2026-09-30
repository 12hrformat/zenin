const { SlashCommandBuilder } = require('discord.js');
const { resetGuildLearning } = require('../services/learning');
const { canManageServer } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forget')
    .setDescription('Wipe everything I’ve learned in this server')
    .addBooleanOption(opt => opt.setName('confirm').setDescription('Set to true to confirm')),

  async execute(interaction) {
    if (!canManageServer(interaction.member)) {
      return interaction.reply({ content: 'You need **Manage Server** for that.', flags: 64 });
    }

    if (!interaction.options.getBoolean('confirm')) {
      return interaction.reply({
        content:
          'This deletes all learned slang, running jokes and chat history for this server, and resets chat-based learning. Run `/forget confirm:true`.',
        flags: 64,
      });
    }

    resetGuildLearning(interaction.guild.id);
    await interaction.reply('Wiped. I’ll learn how this room talks all over again.');
  },
};
