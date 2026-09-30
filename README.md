# zenin

A Discord bot **and** a public server directory website, in one process.

Server owners advertise their community on the site, visitors discover and join them, and
sponsorship or partnership offers get delivered straight into the target server's Discord.
Alongside that, the bot gives each server MEE6-style leveling, level-gated giveaways, and an
AI that reads the chat and talks back in the room's own voice.

Built by **[12hrformat](https://github.com/12hrformat/zenin)** ([@mommy_said_im_special](https://instagram.com/mommy_said_im_special)).

---

## What it does

### The directory (the main event)

- `/sponsor add description:"…" tags:"gaming, anime"` mints a **permanent invite**
  (`max_age: 0`, `max_uses: 0` — the link never expires) and lists the server instantly.
- `/browse` on the website: search, filter by tag, sort by members / joins / newest,
  and a "seeking sponsors only" switch. Plus pagination.
- Each server gets a public page with description, tags, member count, live chat activity,
  listing views, and the pings it has received.
- Visitors fill in a sponsorship form and the message lands in the server's system channel
  as a formatted embed with their contact details attached.

### AI that learns your server

Mention the bot anywhere — `@zenin what do you think about the update?` — and it replies.

- Tracks tokens 2–6 characters used 3+ times that aren't ordinary English (`ngl`, `bruh`, `w`,
  `fr`) as learned abbreviations.
- Tracks 2–6 word spans repeated across the chat as running jokes / inside jokes.
- Keeps a rolling 200-message window per server and injects both into the system prompt,
  along with the room's recent chatter.
- `/learnstats` shows what it has picked up. `/forget confirm:true` wipes it.

**You supply the key.** There is no hardcoded API key anywhere. Each server attaches its own
OpenRouter key over a private DM, and it is encrypted with AES-256-GCM before it touches
SQLite. Nobody else — including the bot's author — can read it.

### Levels (MEE6-style)

`xpForLevel(n) = 50 × (n² − 1)`

| Level | 2 | 3 | 5 | 10 | 25 |
|---|---|---|---|---|---|
| **Total XP** | 150 | 400 | 1,200 | 4,950 | 31,200 |

- 15–25 XP per message, hard-capped at one gain per 20 seconds
- `/level` card with progress bar and rank, `/leaderboard` top 10
- `/levelrole add` grants a role at a level (and backfills for members who already qualify)
- `/noxp add` excludes channels, so staff channels don't farm XP
- Dashboard toggles level-up announcements and picks the channel they post in

### Giveaways with a level gate

`/giveaway create prize:"…" winners:2 minutes:120 minlevel:5`

Winners are drawn from the 🎉 reactors **intersected with** the level requirement — low-level
accounts can't enter the draw even if they react. Winners get DMed.

---

## Setup

**Requirements:** Node.js 22.5 or newer. Nothing else — SQLite comes from Node itself, so
there is no compiler or native build step.

```bash
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

Fill in `.env`:

```env
DISCORD_TOKEN=your_bot_token
ENCRYPTION_KEY=          # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
PORT=3000
PUBLIC_URL=https://your-domain.tld
BOT_INVITE_URL=https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot%20applications.commands&permissions=1101654787178
```

```bash
npm start
```

Slash commands register themselves on boot. The site serves from the same process.

### Bot setup

1. **Intents** — in the Developer Portal enable `MESSAGE CONTENT` and `SERVER MEMBERS`.
2. **Permissions** — when inviting, grant `Manage Channels` (needed to mint permanent
   invites), `Send Messages`, `Embed Links`, `Add Reactions`, `Read Message History`,
   `Use External Emoji`.
3. **Website** — when the bot joins a server it posts a greeting with quickstart steps.
4. Run `/sponsor add` to appear in the directory.
5. Run `/api setup`, then DM the bot `!setkey sk-or-v1-...` to switch the AI on.

---

## Commands

| Command | Purpose |
|---|---|
| `/sponsor add` | List your server for sponsorship |
| `/sponsor edit` | Change description, tags, visibility |
| `/sponsor view` | See how your listing looks, with views and joins |
| `/sponsor remove` | Delist |
| `/dashboard` | DM yourself a private link to the web dashboard |
| `/api setup` | Attach this server's OpenRouter key |
| `/api status` | Show the active key (masked) and model |
| `/api model` | Switch between 7 models |
| `/api remove` | Detach the key, turn the AI off |
| `/level` | XP, progress bar, rank |
| `/leaderboard` | Top 10 |
| `/levelrole` | Auto-grant roles at levels |
| `/noxp` | Channels that don't earn XP |
| `/giveaway create` | Giveaway with optional minimum level |
| `/giveaway list` / `end` | Manage running giveaways |
| `/learnstats` | Learned slang and running jokes |
| `/forget` | Wipe learned data |
| `/network` | Network-wide stats |
| `/help` | Everything |

In **DMs**: `!setkey sk-or-v1-...` (the only private key submission channel).

---

## Web dashboard

`/dashboard` in Discord DMs you a 30-day token. Paste it at `/dashboard` and you get:

- **Listing controls** — description, tags, language
- **Toggles** — visible in directory, seeking sponsorship, seeking partnerships, post level-up announcements
- **AI panel** — masked key status, model switcher, remove key
- **Levels** — top members, level roles, no-XP channels (removable inline)
- **Giveaways** — what's running now
- **Sponsorship inbox** — every ping your server has received
- **Access** — list and revoke dashboard tokens

---

## Public API

```
GET /api/servers?q=&tag=&sort=&sponsoring=1&page=&per_page=
GET /api/stats
```

Returns JSON listings with names, descriptions, member counts, live activity, tags and
invite links. Useful for building companion front-ends or bots on top of the directory.

---

## Project layout

```
zenin/
├── index.js                  # boots the Discord client, then the website
├── database.js               # schema + settings helpers (node:sqlite)
├── config.json               # tunables: XP rates, cooldowns, page size
├── bot/
│   ├── deploy.js             # auto-registers slash commands on boot
│   ├── events/
│   │   ├── ready.js          # presence, invite backfill, giveaway sweeper
│   │   ├── guildCreate.js    # greets the server, explains setup
│   │   ├── guildDelete.js    # pauses the listing
│   │   ├── messageCreate.js  # XP, learning, @mention AI, DM key intake
│   │   └── interactionCreate.js
│   ├── commands/             # one file per slash command
│   └── services/
│       ├── listings.js       # directory: invites, search, tags, stats
│       ├── leveling.js       # XP curve, ranks, level roles, no-XP
│       ├── learning.js       # abbreviation + phrase detection
│       ├── ai.js             # prompt building + OpenRouter call
│       ├── aiKeys.js         # per-server key storage
│       ├── crypto.js         # AES-256-GCM at rest
│       ├── giveaway.js       # create, level gate, winner draw
│       ├── dashTokens.js     # dashboard sessions
│       └── helpers.js
└── website/
    ├── server.js             # Express app, security headers, cookies
    ├── routes/
    │   ├── directory.js      # /, /browse, /servers/:id, /go/:id, /api/*
    │   └── dashboard.js      # token login + all management actions
    ├── views/                # EJS, with partials for card/head/footer
    └── public/css/style.css  # the design system
```

---

## Design notes

The site is a single hand-written stylesheet built on a small token set — one yellow accent
(`#FFD60A`) on a near-black canvas, an 8px spacing rhythm, one type scale, and borders instead
of shadows. Native cursors throughout, no animation beyond short transitions, and everything
degrades gracefully with JavaScript disabled.

Security: tokens live in `httpOnly` + `SameSite=Lax` cookies, the sponsorship form is rate
limited to 5 per hour per address, user text is stripped of `@everyone` / `@here` before it
reaches Discord, and a CSP blocks inline scripts and framing.

---

## Notes and limits

- **Online counts are chat-activity based** (members seen in the last 15 minutes), not
  presence. That avoids the privileged *Guild Presences* intent. Enable that intent in the
  portal if you want true online numbers.
- **Inside-joke detection is frequency-based.** It reliably catches repeated phrases; it does
  not understand *why* something is funny. The model does that inference at reply time from the
  phrase plus surrounding chat.
- Data is one SQLite file (`zenin.db`). Back it up by copying it.
- `.env` and `*.db` are gitignored — never commit your token or encryption key.
- Run it behind a process manager (`pm2`, `systemd`) and a reverse proxy in production.

## License

MIT. Not affiliated with Discord Inc.
