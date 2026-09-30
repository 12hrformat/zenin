const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVocabulary } = require('../services/learning');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('learnstats')
    .setDescription('The slang and running jokes I’ve picked up in this server'),

  async execute(interaction) {
    const { words, phrases } = getVocabulary(interaction.guild.id);
    const jokes = phrases.filter(p => p.frequency >= 2);

    const embed = new EmbedBuilder().setColor(0xffd60a).setTimestamp();

    embed.addFields({
      name: 'Abbreviations & slang',
      value: words.length
        ? words.slice(0, 30).map(w => `\`${w.word}\``).join(' ') || '_none yet_'
        : '_Nothing yet — keep chatting and I’ll pick things up._',
    });

    embed.addFields({
      name: 'Recurring phrases',
      value: jokes.length
        ? jokes.slice(0, 12).map(p => `\`${p.phrase}\` ×${p.frequency}`).join('\n')
        : '_No repeated phrases detected yet._',
    });

    embed.setFooter({
      text: `${words.length} terms · ${jokes.length} running phrases · wipe with /forget`,
    });

    await interaction.reply({ embeds: [embed] });
  },
};
