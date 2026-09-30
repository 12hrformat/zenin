const express = require('express');
const { db } = require('../../database');
const listings = require('../../bot/services/listings');
const { clean } = require('../server');
const { severityFromMembers } = require('../../bot/services/helpers');

function format(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n || 0);
}

function date(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

module.exports = function directoryRoutes(client) {
  const router = express.Router();

  // ---- landing page ----------------------------------------------------
  router.get('/', (req, res) => {
    const featured = listings.browse({ sort: 'members', perPage: 6 }).items;
    const fresh = listings.browse({ sort: 'recent', perPage: 6 }).items;

    res.render('index', {
      title: `${SITE_TITLE} — Discord server directory`,
      featured: featured.map(shape),
      fresh: fresh.map(shape),
      tags: listings.allTags().slice(0, 12),
    });
  });

  // ---- directory -------------------------------------------------------
  router.get('/browse', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const sort = ['members', 'recent', 'clicks', 'views', 'oldest'].includes(req.query.sort)
      ? req.query.sort
      : 'recent';

    const result = listings.browse({
      q: req.query.q || '',
      tag: req.query.tag || '',
      sort,
      seekingOnly: req.query.sponsoring === '1',
      minMembers: parseInt(req.query.min) || 0,
      page,
    });

    // An empty directory and an over-filtered one need different copy, so we
    // check the unfiltered total rather than inferring it from zero results.
    const directoryIsEmpty = listings.browse({ page: 1, perPage: 1 }).total === 0;
    const filtersActive = Boolean(
      req.query.q || req.query.tag || req.query.sponsoring === '1' || parseInt(req.query.min)
    );

    res.render('browse', {
      title: 'Browse servers',
      servers: result.items.map(shape),
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
      directoryIsEmpty,
      filtersActive,
      tags: listings.allTags().slice(0, 24),
      filters: {
        q: req.query.q || '',
        tag: req.query.tag || '',
        sort,
        sponsoring: req.query.sponsoring === '1',
        min: parseInt(req.query.min) || 0,
      },
    });
  });

  // ---- single server ---------------------------------------------------
  router.get('/servers/:id', (req, res, next) => {
    const row = db
      .prepare(
        `SELECT g.*, l.description, l.tags, l.language, l.seeking_sponsor, l.seeking_partners,
                l.views, l.clicks, l.created_at, l.updated_at, l.listing_status
         FROM listings l JOIN guilds g ON g.guild_id = l.guild_id
         WHERE l.guild_id = ? AND g.is_active = 1`
      )
      .get(req.params.id);

    if (!row || row.listing_status !== 'active') return next();

    listings.bumpViews(row.guild_id);

    // Recent pings that server received, so visitors see it isn't a dead listing.
    const pings = db
      .prepare(
        'SELECT message, source, created_at FROM sponsorships WHERE to_guild_id = ? ORDER BY created_at DESC LIMIT 6'
      )
      .all(row.guild_id);

    res.render('server', {
      title: row.guild_name,
      server: {
        ...shape({ ...row, tagList: listings.parseTags(row.tags), activity: listings.activityOf(row.guild_id) }),
        joinedAt: date(row.created_at),
        severity: severityFromMembers(row.member_count),
        pings: pings.map(p => ({ ...p, when: date(p.created_at) })),
        invitesReceived: db
          .prepare('SELECT COUNT(*) AS c FROM sponsorships WHERE to_guild_id = ?')
          .get(row.guild_id).c,
      },
    });
  });

  // Track an outbound join click.
  router.get('/go/:id', (req, res) => {
    const row = db.prepare('SELECT invite_url FROM guilds WHERE guild_id = ?').get(req.params.id);
    if (row?.invite_url) {
      listings.bumpClicks(req.params.id);
      return res.redirect(row.invite_url);
    }
    res.redirect('/browse');
  });

  // ---- sponsorship ping form ------------------------------------------
  router.post('/servers/:id/ping', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!res.locals.rateLimit(`ping:${ip}`, 5, 60 * 60 * 1000)) {
      return res.redirect(`/servers/${req.params.id}?err=${encodeURIComponent('Too many pings from you. Try again later.')}`);
    }
    if (process.env.SITE_SECRET && req.body?.secret !== process.env.SITE_SECRET) {
      return res.redirect(`/servers/${req.params.id}?err=${encodeURIComponent('Invalid submission.')}`);
    }

    const contact = clean(req.body?.contact, 80);
    const message = clean(req.body?.message, 400);

    if (!message || message.length < 10) {
      return res.redirect(`/servers/${req.params.id}?err=${encodeURIComponent('Write a slightly longer message (10+ characters).')}`);
    }

    const row = db
      .prepare(
        `SELECT g.guild_id, g.guild_name FROM listings l JOIN guilds g ON g.guild_id = l.guild_id
         WHERE l.guild_id = ? AND g.is_active = 1 AND l.listing_status = 'active'`
      )
      .get(req.params.id);

    if (!row) {
      return res.redirect(`/servers/${req.params.id}?err=${encodeURIComponent('That listing is no longer available.')}`);
    }

    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
      return res.redirect(`/servers/${req.params.id}?err=${encodeURIComponent('I am no longer in that server, so I could not deliver your ping.')}`);
    }

    const channel =
      guild.systemChannel ||
      guild.channels.cache.find(c => c.isTextBased() && c.viewable && !c.isThread());

    if (!channel) {
      return res.redirect(`/servers/${req.params.id}?err=${encodeURIComponent('That server has no channel I can post in.')}`);
    }

    try {
      await channel.send({
        embeds: [
          {
            title: 'Partnership & sponsorship offer',
            description: message,
            color: 0xffd60a,
            fields: contact ? [{ name: 'Reply to', value: contact, inline: false }] : [],
            footer: { text: `Sent from the zenin directory${contact ? '' : ' — no contact given'}` },
            timestamp: new Date().toISOString(),
          },
        ],
      });

      db.prepare(
        'INSERT INTO sponsorships (to_guild_id, message, contact, source, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(row.guild_id, message, contact || null, 'web', Date.now());

      return res.redirect(
        `/servers/${req.params.id}?ok=${encodeURIComponent(`Delivered to ${row.guild_name}.`)}`
      );
    } catch (err) {
      console.error('[web] ping delivery failed:', err.message);
      return res.redirect(`/servers/${req.params.id}?err=${encodeURIComponent('Discord rejected the message — the server may have blocked me from posting.')}`);
    }
  });

  // ---- public JSON API ------------------------------------------------
  router.get('/api/servers', (req, res) => {
    const result = listings.browse({
      q: req.query.q || '',
      tag: req.query.tag || '',
      sort: req.query.sort,
      seekingOnly: req.query.sponsoring === '1',
      page: Math.max(1, parseInt(req.query.page) || 1),
      perPage: Math.min(50, parseInt(req.query.per_page) || 24),
    });

    res.json({
      total: result.total,
      page: result.page,
      total_pages: result.totalPages,
      servers: result.items.map(s => ({
        id: s.guild_id,
        name: s.guild_name,
        description: s.description,
        members: s.member_count,
        active_now: s.activity,
        tags: s.tagList,
        language: s.language,
        seeking_sponsor: !!s.seeking_sponsor,
        seeking_partners: !!s.seeking_partners,
        invite: s.invite_url,
        url: `${BASE_URL}/servers/${s.guild_id}`,
        listed_at: date(s.created_at),
      })),
    });
  });

  router.get('/api/stats', (_req, res) => {
    const s = listings.networkStats();
    res.json({
      servers: s.servers,
      listed: s.listed,
      members: s.members,
      active_servers: s.activeRecently,
      messages_counted: s.messages,
      terms_learned: s.terms,
      phrases_learned: s.phrases,
    });
  });

  return router;
};

const SITE_TITLE = 'zenin';
const BASE_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

/** Normalizes a row for templates. */
function shape(row) {
  return {
    id: row.guild_id,
    name: row.guild_name,
    icon: row.icon,
    members: row.member_count || 0,
    membersLabel: format(row.member_count || 0),
    active: row.activity || 0,
    description: row.description || '',
    tags: row.tagList || listings.parseTags(row.tags),
    language: row.language || '',
    seekingSponsor: !!row.seeking_sponsor,
    seekingPartners: !!row.seeking_partners,
    invite: row.invite_url,
    views: row.views || 0,
    clicks: row.clicks || 0,
    listedAt: row.created_at,
  };
}

module.exports.format = format;
