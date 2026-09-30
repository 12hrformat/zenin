const express = require('express');
const path = require('path');
const ejs = require('ejs');

const dashTokens = require('../bot/services/dashTokens');
const { networkStats } = require('../bot/services/listings');

const SITE = {
  name: process.env.APP_NAME || 'zenin',
  tagline: 'The Discord server directory where servers get discovered',
  description:
    'A public directory of Discord servers. List yours, get discovered, and receive sponsorship and partnership pings from other server owners.',
  author: process.env.AUTHOR_NAME || '12hrformat',
  authorNick: process.env.AUTHOR_NICK || 'dragon',
  repo: process.env.GITHUB_REPO_URL || 'https://github.com/12hrformat/zenin',
  instagram: process.env.INSTAGRAM_URL || 'https://instagram.com/mommy_said_im_special',
};

const COOKIE = 'zenin_token';

/** Tiny in-memory rate limiter for public POST endpoints. */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, reset: now + windowMs };

  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  hits.set(key, entry);

  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }
  return entry.count <= max;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** Discord markdown mentions are a phishing vector in user-supplied text. */
function clean(text, max = 400) {
  return String(text || '')
    .replace(/@everyone/gi, '@ everyone')
    .replace(/@here/gi, '@ here')
    .slice(0, max);
}

async function start(client) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

  // Minimal cookie parsing — must run before anything reads req.cookies.
  app.use((req, _res, next) => {
    req.cookies = {};
    const header = req.headers.cookie;
    if (header) {
      for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const key = part.slice(0, idx).trim();
        try {
          req.cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
          /* ignore malformed cookie */
        }
      }
    }
    next();
  });

  // ---- shared view locals ----------------------------------------------
  app.use((req, res, next) => {
    res.locals.site = SITE;
    res.locals.invite = process.env.BOT_INVITE_URL || '#';
    res.locals.path = req.path;
    res.locals.q = req.query;
    res.locals.esc = esc;
    res.locals.user = null;
    res.locals.token = null;
    res.locals.ok = req.query.ok || null;
    res.locals.err = req.query.err || null;
    res.locals.stats = networkStats();

    const raw = req.cookies?.[COOKIE];
    if (raw) {
      const session = dashTokens.verify(raw);
      if (session) {
        res.locals.token = raw;
        res.locals.user = session;
      }
    }
    next();
  });

  // Simple security headers.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    next();
  });

  app.use((req, res, next) => {
    res.locals.rateLimit = rateLimit;
    next();
  });

  const directory = require('./routes/directory');
  const dashboard = require('./routes/dashboard');

  app.use('/', directory(client));
  app.use('/dashboard', dashboard(client));

  app.use((req, res) => {
    res.status(404).render('404', { title: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error('[web] error:', err);
    res.status(500).render('error', { title: 'Something broke', message: err.message });
  });

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  await new Promise(resolve => {
    const server = app.listen(port, host, resolve);
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[web] port ${port} is already in use. Set PORT to something else in .env`);
      } else {
        console.error('[web] server error:', err.message);
      }
      process.exit(1);
    });
  });

  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`[web] ${SITE.name} running at http://${shown}:${port}`);

  return app;
}

module.exports = { start, clean, esc, SITE, rateLimit };
