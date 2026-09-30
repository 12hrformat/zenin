const { SlashCommandBuilder } = require('discord.js');
const leveling = require('../services/leveling');
const { canManageServer } = require('../services/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelrole')
    .setDescription('Auto-grant a role when someone hits a level')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Grant a role at a level')
        .addIntegerOption(opt =>
          opt.setName('level').setDescription('Level to trigger at').setRequired(true).setMinValue(1)
        )
        .addRoleOption(opt => opt.setName('role').setDescription('Role to grant').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Stop granting a role')
        .addIntegerOption(opt =>
          opt.setName('level').setDescription('Level to clear').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand(sub => sub.setName('list').setDescription('Show configured level roles')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = leveling.listLevelRoles(interaction.guild.id);
      if (!rows.length) return interaction.reply('No level roles configured yet. Use `/levelrole add`.');

      const lines = rows
        .map(r => {
          const role = interaction.guild.roles.cache.get(r.role_id);
          return `Level **${r.level}** → ${role ? `<@&${r.role_id}>` : `\`${r.role_id}\` *(deleted role)*`}`;
        })
        .join('\n');

      await interaction.reply(`Level roles:\n${lines}`);
      return;
    }

    if (!canManageServer(interaction.member)) {
      return interaction.reply({ content: 'You need **Manage Server** for that.', flags: 64 });
    }

    const level = interaction.options.getInteger('level');

    if (sub === 'add') {
      const role = interaction.options.getRole('role');

      if (role.managed) {
        return interaction.reply({
          content: 'That role is managed by an integration (like the booster role) and can’t be assigned.',
          flags: 64,
        });
      }
      if (role.position >= interaction.guild.members.me.roles.highest.position) {
        return interaction.reply({
          content: 'That role is above my highest role, so I can’t give it. Move it below me in Server Settings → Roles.',
          flags: 64,
        });
      }

      leveling.setLevelRole(interaction.guild.id, level, role.id);
      return interaction.reply(
        `Anyone at **level ${level}+** will get ${role}. I’ll also backfill it for members who already qualify.`
      );
    }

    leveling.removeLevelRole(interaction.guild.id, level);
    await interaction.reply(`Removed the role trigger for level ${level}.`);
  },
};
