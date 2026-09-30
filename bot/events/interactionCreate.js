module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Unknown command.', flags: 64 }).catch(() => {});
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[Command] /${interaction.commandName} failed:`, err);
      const message = 'That command hit an error.';

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, flags: 64 }).catch(() => {});
      } else {
        await interaction.reply({ content: message, flags: 64 }).catch(() => {});
      }
    }
  },
};
