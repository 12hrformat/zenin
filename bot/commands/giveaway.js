const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const giveawayService = require('../services/giveaway');
const { canManageServer, relativeTime } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run giveaways with a minimum level requirement')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Start a giveaway')
        .addStringOption(opt => opt.setName('prize').setDescription('What are you giving away?').setRequired(true).setMaxLength(200))
        .addIntegerOption(opt =>
          opt.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(10)
        )
        .addIntegerOption(opt =>
          opt.setName('minutes').setDescription('Duration in minutes (default 60)').setMinValue(1).setMaxValue(10080)
        )
        .addIntegerOption(opt =>
          opt
            .setName('minlevel')
            .setDescription('Minimum level to enter — 0 for anyone')
            .setMinValue(0)
            .setMaxValue(1000)
        )
    )
    .addSubcommand(sub => sub.setName('list').setDescription('Active giveaways here'))
    .addSubcommand(sub =>
      sub
        .setName('end')
        .setDescription('End one now')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID from /giveaway list').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction);
    if (sub === 'list') return list(interaction);
    if (sub === 'end') return end(interaction);
  },
};

async function create(interaction) {
  if (!canManageServer(interaction.member)) {
    return interaction.reply({ content: 'You need **Manage Server** to run a giveaway.', flags: 64 });
  }

  const prize = interaction.options.getString('prize');
  const winners = interaction.options.getInteger('winners') || 1;
  const minutes = interaction.options.getInteger('minutes') || 60;
  const minLevel = interaction.options.getInteger('minlevel') || 0;
  const endsAt = Date.now() + minutes * 60000;

  await interaction.deferReply();

  const id = giveawayService.createGiveaway({
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    prize,
    winnerCount: winners,
    levelRequirement: minLevel,
    endsAt,
    createdBy: interaction.user.id,
  });

  const message = await giveawayService.postGiveaway(interaction.client, interaction.guild.id, id);

  if (!message) {
    return interaction.editReply(`Created giveaway #${id} but couldn't post it in this channel.`);
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xffd60a)
        .setTitle('Giveaway live')
        .addFields(
          { name: 'ID', value: `\`${id}\``, inline: true },
          { name: 'Prize', value: prize, inline: true },
          { name: 'Winners', value: String(winners), inline: true },
          { name: 'Min level', value: minLevel > 0 ? `${minLevel}` : 'none', inline: true },
          { name: 'Ends', value: relativeTime(endsAt), inline: true }
        )
        .setDescription(
          `React with ${giveawayService.EMOJI} to enter. Accounts below level ${minLevel} are excluded at draw time.`
        ),
    ],
  });
}

async function list(interaction) {
  const active = giveawayService.listActive(interaction.guild.id);
  if (!active.length) return interaction.reply('Nothing running. Start one with `/giveaway create`.');

  const lines = active
    .slice(0, 10)
    .map(
      g =>
        `**#${g.id}** — ${g.prize}\n` +
        `${g.winner_count} winner(s) · min level ${g.level_requirement || 0} · ends ${relativeTime(g.ends_at)}`
    )
    .join('\n\n');

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xffd60a).setTitle('Active giveaways').setDescription(lines)],
  });
}

async function end(interaction) {
  if (!canManageServer(interaction.member)) {
    return interaction.reply({ content: 'You need **Manage Server** to end a giveaway.', flags: 64 });
  }

  const id = interaction.options.getInteger('id');
  const giveaway = giveawayService.getGiveaway(id);

  if (!giveaway || giveaway.guild_id !== interaction.guild.id) {
    return interaction.reply({ content: 'No giveaway with that ID here.', flags: 64 });
  }
  if (giveaway.status !== 'active') {
    return interaction.reply({ content: `Giveaway #${id} already ${giveaway.status}.`, flags: 64 });
  }

  await interaction.deferReply();
  const winners = await giveawayService.endGiveaway(interaction.client, giveaway);

  await interaction.editReply(
    winners.length
      ? `Giveaway #${id} ended. **Winners:** ${winners.map(w => `<@${w}>`).join(', ')}`
      : `Giveaway #${id} ended — nobody qualified.`
  );
}
