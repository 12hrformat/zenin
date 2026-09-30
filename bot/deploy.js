const { REST, Routes } = require('discord.js');

/** Pushes every command to Discord so they appear in the picker. Runs on boot. */
async function deployCommands(client) {
  const body = [...client.commands.values()].map(c => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log(`[Deploy] Registered ${body.length} slash commands`);
  } catch (err) {
    console.error('[Deploy] Failed to register commands:', err.message);
  }
}

module.exports = { deployCommands };
