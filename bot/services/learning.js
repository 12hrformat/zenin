const { db } = require('../../database');
const config = require('../../config.json');

const MIN_FREQ = config.learning.minWordFrequency;
const PHRASE_MIN_FREQ = config.learning.minPhraseFrequency;
const HISTORY_WINDOW = config.bot.historyWindow;

/** Ordinary words the bot already knows - never worth "learning". */
const COMMON = new Set(
  ('the be to of and a in that have it for not on with he as you do at this but his by from they we say her she ' +
    'or an will my one all would there their what so up out if about who get which go me when make can like time no ' +
    'just him know take people into year your good some could them see other than then now look only come its over ' +
    'think also back after use two how our work first well way even new want because any these give day most us is ' +
    'are was were been has had did does said am ok yes lol lmao brb omg btw tbh idk smh ima ive dont cant wont ' +
    'thats youre theyre hes shes well gonna wanna kinda sorta hey hi hello yo sup please thanks thank')
    .split(/\s+/)
);

function tokenize(content) {
  return content
    .replace(/<@!?\d+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-zA-Z']+/)
    .filter(Boolean);
}

/** Short, frequent tokens => abbreviations ("ngl", "bruh", "w", "fr"). */
function detectAbbreviations(tokens) {
  const counts = new Map();
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    if (t.length < 2 || t.length > 6) continue;
    if (!/[a-z]/i.test(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([w, c]) => c >= MIN_FREQ && !COMMON.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
}

/** Repeated multi-word spans => running jokes / inside jokes. */
function detectPhrases(tokens) {
  const counts = new Map();
  for (let i = 0; i + 1 < tokens.length; i++) {
    for (let len = 2; len <= 6 && i + len <= tokens.length; len++) {
      const phrase = tokens.slice(i, i + len).join(' ').toLowerCase();
      if (phrase.length > 60) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= PHRASE_MIN_FREQ)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
}

function recordMessage(guildId, userId, username, content) {
  db.prepare(
    'INSERT INTO message_history (guild_id, user_id, username, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(guildId, userId, username, content.slice(0, 500), Date.now());

  db.prepare(
    `DELETE FROM message_history WHERE guild_id = ? AND id NOT IN (
       SELECT id FROM message_history WHERE guild_id = ? ORDER BY created_at DESC LIMIT ${HISTORY_WINDOW})`
  ).run(guildId, guildId);

  const tokens = tokenize(content);
  if (tokens.length < 2) return;

  const now = Date.now();
  const wStmt = db.prepare(
    `INSERT INTO learned_words (guild_id, word, frequency, first_seen, last_seen) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(guild_id, word) DO UPDATE SET frequency = frequency + 1, last_seen = excluded.last_seen`
  );
  for (const word of detectAbbreviations(tokens)) wStmt.run(guildId, word, now, now);

  const pStmt = db.prepare(
    `INSERT INTO learned_phrases (guild_id, phrase, frequency, first_seen, last_seen) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(guild_id, phrase) DO UPDATE SET frequency = frequency + 1, last_seen = excluded.last_seen`
  );
  for (const phrase of detectPhrases(tokens)) pStmt.run(guildId, phrase, now, now);
}

function getVocabulary(guildId, limit = config.learning.maxWords) {
  const words = db
    .prepare('SELECT word, frequency FROM learned_words WHERE guild_id = ? ORDER BY frequency DESC LIMIT ?')
    .all(guildId, limit);
  const phrases = db
    .prepare('SELECT phrase, frequency FROM learned_phrases WHERE guild_id = ? ORDER BY frequency DESC LIMIT ?')
    .all(guildId, config.learning.maxPhrases);
  return { words, phrases };
}

function recentMessages(guildId, limit = 25) {
  return db
    .prepare('SELECT username, content, user_id FROM message_history WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(guildId, limit)
    .reverse();
}

function resetGuildLearning(guildId) {
  db.prepare('DELETE FROM learned_words WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM learned_phrases WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM message_history WHERE guild_id = ?').run(guildId);
}

module.exports = { recordMessage, getVocabulary, recentMessages, resetGuildLearning, tokenize };
