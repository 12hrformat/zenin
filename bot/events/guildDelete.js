const { db } = require('../../database');

module.exports = {
  name: 'guildDelete',
  async execute(guild) {
    // Soft-delete: keep the listing row but hide it, so stats survive a re-invite.
    db.prepare('UPDATE guilds SET is_active = 0 WHERE guild_id = ?').run(guild.id);
    db.prepare("UPDATE listings SET listing_status = 'paused' WHERE guild_id = ?").run(guild.id);

    console.log(`[guildDelete] ${guild.name} (${guild.id}) removed — listing paused`);
  },
};
