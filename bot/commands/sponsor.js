const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const listings = require('../services/listings');
const { canManageServer, siteUrl, ordinal, relativeTime } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sponsor')
    .setDescription('Advertise your server on the zenin directory')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('List your server so people can find, join and sponsor it')
        .addStringOption(opt =>
          opt
            .setName('description')
            .setDescription('What is your server about? (shown in the directory)')
            .setRequired(true)
            .setMaxLength(280)
        )
        .addStringOption(opt =>
          opt
            .setName('tags')
            .setDescription('Comma separated, e.g. gaming, anime, study')
            .setRequired(false)
            .setMaxLength(120)
        )
        .addStringOption(opt => opt.setName('language').setDescription('Primary language').setRequired(false).setMaxLength(30))
        .addBooleanOption(opt =>
          opt
            .setName('partners')
            .setDescription('Also open to partnership pings?')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('announce').setDescription('Also post an announcement in this channel?')
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Update your listing')
        .addStringOption(opt => opt.setName('description').setDescription('New description').setMaxLength(280))
        .addStringOption(opt => opt.setName('tags').setDescription('New tags').setMaxLength(120))
        .addBooleanOption(opt => opt.setName('visible').setDescription('Show your server in the directory?'))
        .addBooleanOption(opt => opt.setName('partners').setDescription('Open to partnerships?'))
    )
    .addSubcommand(sub => sub.setName('view').setDescription('See your current listing'))
    .addSubcommand(sub => sub.setName('remove').setDescription('Take your server off the directory')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addListing(interaction);
    if (sub === 'edit') return editListing(interaction);
    if (sub === 'view') return viewListing(interaction);
    if (sub === 'remove') return removeListing(interaction);
  },
};

async function addListing(interaction) {
  if (!canManageServer(interaction.member)) {
    return interaction.reply({ content: 'You need **Manage Server** to list this server.', flags: 64 });
  }

  const guild = interaction.guild;
  listings.ensureGuildRow(guild);
  refreshStats(guild);

  const invite = await listings.ensurePermanentInvite(guild);
  if (!invite) {
    return interaction.reply({
      content:
        "I couldn't create the permanent invite — give me the **Manage Channels** permission and try again. " +
        '(Discord Developer Portal → your app → Bot → Privileged Gateway Intents is not needed for this; ' +
        'just the Manage Channels permission.)',
      flags: 64,
    });
  }

  const description = interaction.options.getString('description');
  const tags = interaction.options.getString('tags') || '';
  const language = interaction.options.getString('language') || '';
  const partners = interaction.options.getBoolean('partners') || false;

  listings.upsertListing(guild.id, {
    description,
    tags,
    language,
    seekingSponsor: true,
    seekingPartners: partners,
  });

  const url = `${siteUrl()}/servers/${guild.id}`;

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xffd60a)
        .setTitle('Listed on the directory')
        .setDescription(
          `**${guild.name}** is now discoverable at ${url}\n\n` +
            `**Invite:** ${invite.invite_url} (permanent — never expires)\n` +
            `**Tags:** ${tags || '_none_'}\n\n` +
            'Manage everything from the dashboard with `/dashboard`.'
        )
        .setTimestamp(),
    ],
  });

  // Announce so members know the server is hiring sponsors.
  const announce = interaction.options.getBoolean('announce');
  if (announce && interaction.channel.permissionsFor(interaction.client.user)?.has('SendMessages')) {
    await interaction.channel
      .send(`📣 **${guild.name}** is looking for sponsors! Find us on the zenin directory: ${url}`)
      .catch(() => {});
  }
}

async function editListing(interaction) {
  if (!canManageServer(interaction.member)) {
    return interaction.reply({ content: 'You need **Manage Server** to edit this listing.', flags: 64 });
  }

  const existing = listings.getListing(interaction.guild.id);
  if (!existing) {
    return interaction.reply({
      content: 'This server isn’t listed yet — run `/sponsor add` first.',
      flags: 64,
    });
  }

  const description = interaction.options.getString('description');
  const tags = interaction.options.getString('tags');
  const visible = interaction.options.getBoolean('visible');
  const partners = interaction.options.getBoolean('partners');

  listings.upsertListing(interaction.guild.id, {
    description: description ?? existing.description,
    tags: tags ?? existing.tags,
    language: existing.language,
    seekingSponsor: visible === null || visible === undefined ? undefined : visible,
    seekingPartners: partners === null || partners === undefined ? undefined : partners,
  });

  if (visible === false) listings.pauseListing(interaction.guild.id);
  if (visible === true) listings.resumeListing(interaction.guild.id);

  const updated = listings.getListing(interaction.guild.id);
  const status = updated.listing_status === 'active' ? 'visible in the directory' : 'hidden (paused)';

  await interaction.reply(
    `Updated. Your listing is ${status}.\n${siteUrl()}/servers/${interaction.guild.id}`
  );
}

async function viewListing(interaction) {
  const listing = listings.getListing(interaction.guild.id);
  if (!listing) {
    return interaction.reply({
      content: 'Not listed yet. Run `/sponsor add description:<what your server is about>`.',
      flags: 64,
    });
  }

  const guild = interaction.guild;
  const invite = require('../../database')
    .db.prepare('SELECT invite_url, member_count FROM guilds WHERE guild_id = ?')
    .get(guild.id);

  const embed = new EmbedBuilder()
    .setColor(listing.listing_status === 'active' ? 0xffd60a : 0x666666)
    .setTitle(guild.name)
    .setDescription(listing.description || '_no description set_')
    .addFields(
      {
        name: 'Status',
        value: listing.listing_status === 'active' ? '✅ Live' : '⏸ Paused — hidden',
        inline: true,
      },
      { name: 'Members', value: `${invite?.member_count || 0}`, inline: true },
      { name: 'Active now', value: `${listings.activityOf(guild.id)}`, inline: true },
      { name: 'Tags', value: listings.parseTags(listing.tags).join(', ') || '_none_', inline: false },
      {
        name: 'Looking for',
        value: [
          listing.seeking_sponsor ? 'Sponsorship' : null,
          listing.seeking_partners ? 'Partnerships' : null,
        ]
          .filter(Boolean)
          .join(' · ') || '_nothing right now_',
        inline: false,
      },
      { name: 'Views', value: `${listing.views}`, inline: true },
      { name: 'Joins', value: `${listing.clicks}`, inline: true },
      { name: 'Listed', value: relativeTime(listing.created_at), inline: true },
      { name: 'Link', value: `${siteUrl()}/servers/${guild.id}`, inline: false }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function removeListing(interaction) {
  if (!canManageServer(interaction.member)) {
    return interaction.reply({ content: 'You need **Manage Server** to delist.', flags: 64 });
  }

  const existing = listings.getListing(interaction.guild.id);
  if (!existing) return interaction.reply({ content: 'This server was not listed.', flags: 64 });

  listings.removeListing(interaction.guild.id);
  await interaction.reply('Removed from the directory. Your XP, AI key and giveaway history are untouched.');
}

function refreshStats(guild) {
  listings.refreshCounts(guild.id, guild.memberCount || 0);
}
