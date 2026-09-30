const express = require('express');
const { db, getSetting, setSetting } = require('../../database');
const listings = require('../../bot/services/listings');
const aiKeys = require('../../bot/services/aiKeys');
const dashTokens = require('../../bot/services/dashTokens');
const leveling = require('../../bot/services/leveling');
const giveawayService = require('../../bot/services/giveaway');
const { clean } = require('../server');

const COOKIE = 'zenin_token';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 864e5 };

module.exports = function dashboardRoutes(client) {
  const router = express.Router();

  /** Loads the guild + its data, or redirects to login. */
  function load(req, res, next) {
    const session = res.locals.user;
    if (!session) return res.redirect('/dashboard?err=' + encodeURIComponent('Sign in with your token first.'));

    const guild = client.guilds.cache.get(session.guild_id);
    if (!guild) {
      return res.redirect(
        '/dashboard?err=' + encodeURIComponent('I am not in that server anymore. Re-invite me and run /dashboard again.')
      );
    }

    req.guild = guild;
    req.session = session;
    next();
  }

  const flash = (res, base, key, message) =>
    res.redirect(`${base}?${key}=${encodeURIComponent(message)}`);

  // ---- login ------------------------------------------------------------
  router.get('/', (req, res) => {
    if (!res.locals.user) {
      return res.render('dashboard/login', { title: 'Dashboard sign in', next: req.query.next || '' });
    }

    const session = res.locals.user;
    const guild = client.guilds.cache.get(session.guild_id);
    if (!guild) {
      res.clearCookie(COOKIE, { path: '/' });
      return res.render('dashboard/login', {
        title: 'Dashboard sign in',
        next: '',
        gone: 'I am not in that server anymore. Re-invite me and run /dashboard again.',
      });
    }

    listings.ensureGuildRow(guild);
    listings.refreshCounts(guild.id, guild.memberCount || 0);

    const listing = listings.getListing(guild.id);
    const keyState = aiKeys.getStatus(guild.id);
    const levelRoles = leveling.listLevelRoles(guild.id).map(r => ({
      ...r,
      mention: guild.roles?.cache?.has(r.role_id) ? `<@&${r.role_id}>` : r.role_id,
    }));
    const noXp = leveling.listNoXp(guild.id).map(r => ({
      id: r.channel_id,
      mention: guild.channels?.cache?.has(r.channel_id) ? `<#${r.channel_id}>` : r.channel_id,
    }));
    const activeGiveaways = giveawayService.listActive(guild.id).map(g => ({
      ...g,
      endsLabel: new Date(g.ends_at).toISOString().slice(0, 16).replace('T', ' '),
    }));

    const topLevels = leveling.leaderboard(guild.id, 5).map(r => ({
      userId: r.user_id,
      xp: r.xp,
      level: leveling.levelFromXp(r.xp),
      mention: guild.members?.cache?.has(r.user_id) ? `<@${r.user_id}>` : r.user_id,
    }));

    const pings = db
      .prepare('SELECT message, contact, source, created_at FROM sponsorships WHERE to_guild_id = ? ORDER BY created_at DESC LIMIT 8')
      .all(guild.id)
      .map(p => ({ ...p, when: new Date(p.created_at).toISOString().slice(0, 10) }));

    res.render('dashboard/index', {
      title: `${guild.name} dashboard`,
      guild: {
        id: guild.id,
        name: guild.name,
        members: guild.memberCount || 0,
        activity: listings.activityOf(guild.id),
        icon: guild.iconURL({ extension: 'png', size: 128 }),
        publicUrl: `${BASE_URL}/servers/${guild.id}`,
      },
      channels: [...(guild.channels?.cache?.values() || [])]
        .filter(c => c.isTextBased() && !c.isThread())
        .slice(0, 80)
        .map(c => ({ id: c.id, name: c.name })),
      listing,
      keyState,
      modelChoices: aiKeys.MODEL_CHOICES,
      levelRoles,
      noXp,
      activeGiveaways,
      topLevels,
      pings,
      sessions: dashTokens.activeSessions(guild.id),
      settings: {
        levelupChannel: getSetting(guild.id, 'levelup_channel', ''),
        announceLevelups: getSetting(guild.id, 'announce_levelups', '1') !== '0',
      },
      levelsAvailable: guild.roles.cache.size,
    });
  });

  router.post('/login', (req, res) => {
    const token = String(req.body?.token || '').trim();
    const session = dashTokens.verify(token);

    if (!session) {
      return res.redirect('/dashboard?err=' + encodeURIComponent('That token is invalid or expired. Run /dashboard in your server to get a new one.'));
    }

    res.cookie(COOKIE, token, COOKIE_OPTS);
    res.redirect('/dashboard?ok=' + encodeURIComponent('Signed in.'));
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/');
  });

  // ---- listing controls -------------------------------------------------
  router.post('/listing', load, (req, res) => {
    const guildId = req.guild.id;
    const existing = listings.getListing(guildId);

    if (!existing && req.body.action === 'remove') {
      return flash(res, '/dashboard', 'err', 'This server is not listed.');
    }

    if (req.body.action === 'remove') {
      listings.removeListing(guildId);
      return flash(res, '/dashboard', 'ok', 'Server removed from the directory. Your levels and AI key are untouched.');
    }

    const description = clean(req.body.description, 280);
    const tags = clean(req.body.tags, 120);
    const language = clean(req.body.language, 30);
    const visible = req.body.visible === 'on' || req.body.visible === 'true';
    const seekingSponsor = req.body.seeking_sponsor === 'on' || req.body.seeking_sponsor === 'true';
    const seekingPartners = req.body.seeking_partners === 'on' || req.body.seeking_partners === 'true';

    // Creating a listing requires an invite, so only mint it if we're in the guild.
    if (!existing) {
      listings.ensureGuildRow(req.guild);
      req.guild.invites
        .create({ max_age: 0, max_uses: 0, unique: true, reason: 'zenin directory listing' })
        .then(invite =>
          db.prepare('UPDATE guilds SET invite_code = ?, invite_url = ? WHERE guild_id = ?').run(invite.code, invite.url, guildId)
        )
        .catch(err => console.error('[dash] could not mint invite:', err.message));
    }

    listings.upsertListing(guildId, {
      description,
      tags,
      language,
      seekingSponsor,
      seekingPartners,
    });

    if (visible) listings.resumeListing(guildId);
    else listings.pauseListing(guildId);

    listings.refreshCounts(guildId, req.guild.memberCount || 0);
    flash(res, '/dashboard', 'ok', 'Listing saved.');
  });

  // ---- AI controls ------------------------------------------------------
  router.post('/ai/model', load, (req, res) => {
    const model = String(req.body.model || '');
    if (!aiKeys.MODEL_CHOICES.some(m => m.value === model)) {
      return flash(res, '/dashboard', 'err', 'Unknown model.');
    }
    if (!aiKeys.hasKey(req.guild.id)) {
      return flash(res, '/dashboard', 'err', 'No key configured. Use /api setup in Discord.');
    }
    db.prepare('UPDATE api_keys SET model = ?, updated_at = ? WHERE guild_id = ?').run(model, Date.now(), req.guild.id);
    flash(res, '/dashboard', 'ok', `Model set to ${model}.`);
  });

  router.post('/ai/remove', load, (req, res) => {
    aiKeys.removeKey(req.guild.id);
    flash(res, '/dashboard', 'ok', 'API key removed. The AI is off in this server.');
  });

  // ---- level / XP controls ----------------------------------------------
  router.post('/levels/settings', load, (req, res) => {
    const channelId = String(req.body.levelup_channel || '').trim();
    const announce = req.body.announce_levelups === 'on' || req.body.announce_levelups === 'true';

    if (channelId) {
      const channel = req.guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        return flash(res, '/dashboard', 'err', 'That channel no longer exists.');
      }
      setSetting(req.guild.id, 'levelup_channel', channelId);
    } else {
      setSetting(req.guild.id, 'levelup_channel', '');
    }

    setSetting(req.guild.id, 'announce_levelups', announce ? '1' : '0');
    flash(res, '/dashboard', 'ok', 'Level settings saved.');
  });

  router.post('/levels/role/remove', load, (req, res) => {
    const level = parseInt(req.body.level);
    if (!level) return flash(res, '/dashboard', 'err', 'Invalid level.');
    leveling.removeLevelRole(req.guild.id, level);
    flash(res, '/dashboard', 'ok', `Removed the level ${level} role.`);
  });

  router.post('/levels/noxp/remove', load, (req, res) => {
    const channelId = String(req.body.channel_id || '');
    if (!channelId) return flash(res, '/dashboard', 'err', 'Invalid channel.');
    leveling.removeNoXp(req.guild.id, channelId);
    flash(res, '/dashboard', 'ok', 'Channel earns XP again.');
  });

  // ---- security ---------------------------------------------------------
  router.post('/session/revoke', load, (req, res) => {
    dashTokens.revoke(req.guild.id, req.session.user_id);
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/dashboard?ok=' + encodeURIComponent('All dashboard tokens for you were revoked.'));
  });

  router.post('/session/revoke-all', load, (req, res) => {
    db.prepare('DELETE FROM dashboard_tokens WHERE guild_id = ?').run(req.guild.id);
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/dashboard?ok=' + encodeURIComponent('All dashboard sessions revoked.'));
  });

  return router;
};

const BASE_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
