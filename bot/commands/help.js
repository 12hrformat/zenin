const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { networkStats } = require('../services/listings');
const aiKeys = require('../services/aiKeys');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('What zenin can do'),

  async execute(interaction) {
    const stats = networkStats();
    const keyState = aiKeys.getStatus(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setTitle('zenin')
      .setColor(0xffd60a)
      .setDescription(
        `A Discord server directory, plus an AI that learns how your chat talks.\n\n` +
          `**Mention me to talk to me:** \`@zenin <question>\` — that's the only step. I answer in your ` +
          `server's slang and reference its inside jokes.`
      )
      .addFields(
        {
          name: '📋 Directory',
          value:
            '`/sponsor add` — list your server for sponsorship (permanent invite gets created for you)\n' +
            '`/sponsor edit` — change description, tags or what you want\n' +
            '`/sponsor view` — see how your listing looks\n' +
            '`/sponsor remove` — delist',
        },
        {
          name: '🔑 AI setup (per server)',
          value:
            '`/api setup` — get a private DM link to attach your OpenRouter key\n' +
            '`/api status` — see which key and model are active\n' +
            '`/api model` — switch models\n' +
            '`/api remove` — detach the key\n\n' +
            `You supply your own key, so usage bills you directly. Keys are encrypted at rest.\n` +
            `Current state: ${keyState.configured ? `key \`${keyState.preview}\` · \`${keyState.model}\`` : '**no key set — AI is off**'}`,
        },
        {
          name: '📈 Levels',
          value:
            '`/level` — your level, XP and rank\n' +
            '`/leaderboard` — top 10\n' +
            '`/levelrole` — auto-grant a role at a level\n' +
            '`/noxp` — channels where nobody earns XP',
        },
        {
          name: '🎉 Giveaways',
          value:
            '`/giveaway create` — needs **Manage Server**; optional minimum level\n' +
            '`/giveaway list` — active ones\n' +
            '`/giveaway end` — force-end early',
        },
        {
          name: '⚙️ Dashboard',
          value:
            '`/dashboard` — get a private link to manage your listing, toggle features ' +
            'and watch your stats from the browser',
        },
        {
          name: '🧠 Learning',
          value: '`/learnstats` — the slang and running jokes I picked up here\n`/forget` — wipe them',
        }
      )
      .setFooter({
        text: `${stats.servers} servers in the network · ${stats.listed} listed for sponsorship`,
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
