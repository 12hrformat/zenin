const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const aiKeys = require('../services/aiKeys');
const { canManageServer, relativeTime } = require('../services/helpers');

/**
 * Each server supplies its OWN OpenRouter key — nothing is hardcoded.
 * The key is collected over DM so it never appears in a public channel.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('api')
    .setDescription('Manage this server’s OpenRouter key')
    .addSubcommand(sub =>
      sub.setName('setup').setDescription('Attach your OpenRouter key (sent privately in a DM)')
    )
    .addSubcommand(sub => sub.setName('status').setDescription('See the active key and model'))
    .addSubcommand(sub =>
      sub
        .setName('model')
        .setDescription('Change which model answers')
        .addStringOption(opt =>
          opt
            .setName('model')
            .setDescription('Pick a model')
            .setRequired(true)
            .addChoices(
              aiKeys.MODEL_CHOICES.map(m => ({ name: m.label, value: m.value }))
            )
        )
    )
    .addSubcommand(sub => sub.setName('remove').setDescription('Detach the key and turn the AI off')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (!canManageServer(interaction.member)) {
      return interaction.reply({
        content: 'You need **Manage Server** to manage the AI key.',
        flags: 64,
      });
    }

    if (sub === 'setup') return setup(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'model') return setModel(interaction);
    if (sub === 'remove') return remove(interaction);
  },
};

async function setup(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const prefix = process.env.DM_PREFIX || '!';

  const dm = await interaction.user
    .send(
      `**zenin — AI key setup for ${interaction.guild.name}**\n\n` +
        `1. Get an API key at https://openrouter.ai/keys\n` +
        `2. Reply to this DM with: \`${prefix}setkey sk-or-v1-...\`\n\n` +
        `Your key is encrypted before it is stored and is used only for this server. ` +
        `You can rotate it any time by running this again.`,
    )
    .catch(() => null);

  if (!dm) {
    return interaction.editReply(
      'I couldn’t DM you — your privacy settings are blocking DMs from server members. Open a channel, right-click me, or temporarily allow DMs, then run `/api setup` again.',
    );
  }

  await interaction.editReply('Sent you a DM with the steps. Check your inbox.');
}

async function status(interaction) {
  const state = aiKeys.getStatus(interaction.guild.id);

  if (!state.configured) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffd60a)
          .setTitle('AI status')
          .setDescription(
            'No key configured, so mentioning me will just point you here.\n\nRun `/api setup` to attach one.',
          ),
      ],
    });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xffd60a)
        .setTitle('AI status')
        .addFields(
          { name: 'Key', value: `\`${state.preview}\``, inline: true },
          { name: 'Model', value: `\`${state.model}\``, inline: true },
          { name: 'Added', value: relativeTime(state.createdAt), inline: true },
          { name: 'Updated', value: relativeTime(state.updatedAt), inline: true }
        )
        .setDescription('Mention me in chat to talk. Change the model with `/api model`.'),
    ],
  });
}

async function setModel(interaction) {
  const model = interaction.options.getString('model');
  const state = aiKeys.getStatus(interaction.guild.id);

  if (!state.configured) {
    return interaction.reply({
      content: 'Add a key with `/api setup` before picking a model.',
      flags: 64,
    });
  }

  const { db } = require('../../database');
  db.prepare('UPDATE api_keys SET model = ?, updated_at = ? WHERE guild_id = ?').run(
    model,
    Date.now(),
    interaction.guild.id,
  );

  await interaction.reply(`Model set to \`${model}\`.`);
}

async function remove(interaction) {
  const removed = aiKeys.removeKey(interaction.guild.id);

  await interaction.reply(
    removed
      ? 'Key removed. The AI is off in this server — mention me and I’ll say nothing again. Run `/api setup` to bring it back.'
      : 'There was no key configured for this server.'
  );
}
