require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { initDatabase } = require('./database');

// ---- config validation -------------------------------------------------
const problems = [];
if (!process.env.DISCORD_TOKEN) problems.push('DISCORD_TOKEN is missing');
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 16) {
  problems.push('ENCRYPTION_KEY is missing or under 16 chars');
}

if (problems.length) {
  console.error('\nConfiguration problems:\n' + problems.map(p => `  - ${p}`).join('\n'));
  console.error('\nCopy .env.example to .env and fill it in.\n');
  process.exit(1);
}

initDatabase();

// ---- discord client ----------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.commands = new Collection();

// Load slash commands
const commandsDir = path.join(__dirname, 'bot', 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`[load] command /${command.data.name}`);
  } else {
    console.warn(`[load] ${file} missing data/execute`);
  }
}

// Load events
const eventsDir = path.join(__dirname, 'bot', 'events');
for (const file of fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  // A throw inside an event handler must not take the whole process down. A
  // single malformed message was enough to kill the bot and every other server
  // it was in, so failures are logged with context and the loop continues.
  const handler = async (...args) => {
    try {
      await event.execute(...args);
    } catch (err) {
      const label = event.name;
      console.error(`[error] ${label}:`, err.message);
      if (process.env.NODE_ENV !== 'production') console.error(err.stack);
    }
  };
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
  console.log(`[load] event ${event.name}`);
}

process.on('unhandledRejection', err => console.error('[fatal] unhandled rejection:', err));
process.on('uncaughtException', err => console.error('[fatal] uncaught exception:', err));

// ---- boot --------------------------------------------------------------
(async () => {
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error('Failed to log in:', err.message);
    process.exit(1);
  }

  // Make sure the client is reachable from services without a circular import.
  global.client = client;

  // Start the website in the same process so dashboard actions can talk to Discord.
  try {
    const site = require('./website/server');
    await site.start(client);
  } catch (err) {
    console.error('[web] failed to start:', err.message);
  }
})();
