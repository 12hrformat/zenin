const aiKeys = require('./aiKeys');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const cooldowns = new Map();

function cooldownRemaining(userId) {
  const until = cooldowns.get(userId);
  if (!until) return 0;
  const left = until - Date.now();
  return left > 0 ? left : 0;
}

function markUsed(userId) {
  const ms = require('../../config.json').bot.aiCooldownMs;
  cooldowns.set(userId, Date.now() + ms);
}

/**
 * The prompt is where the "learning" lands: the server's real abbreviations
 * and running jokes are inlined so the model talks like an insider.
 */
function buildSystemPrompt({ guildName, botName, serverDesc, words, phrases, history }) {
  const slang = words.length
    ? words.map(w => `"${w.word}" (${w.frequency}x)`).join(', ')
    : 'none yet - stay natural';

  const jokes = phrases.filter(p => p.frequency >= 2).length
    ? phrases
        .filter(p => p.frequency >= 2)
        .slice(0, 12)
        .map(p => `"${p.phrase}" (${p.frequency}x)`)
        .join('; ')
    : 'none yet';

  const vibe = history.length
    ? history
        .slice(-12)
        .map(m => `${m.username}: ${m.content}`)
        .join('\n')
    : 'no recent chat';

  const context = serverDesc ? `This server is: ${serverDesc}` : '';

  return `You are "${botName}", a bot hanging out in the Discord server "${guildName}".
${context}

VOICE:
- Reply like a person in the chat, not an assistant. Usually 1-3 sentences.
- Match the room's energy and length. Lowercase is fine if they lowercase.
- Use the language people here ACTUALLY use. If they say "ngl", "bruh", "w", "fr" - you use those too.
- No corporate filler. Never say "I hope this helps" or "As an AI".
- Be sarcastic and funny when it fits. Do not lecture anyone.
- Emoji only if the chat uses emoji.

WHAT YOU HAVE PICKED UP IN THIS SERVER:
- Slang and abbreviations: ${slang}
- Running jokes / recurring phrases: ${jokes}

RULES:
- If a running joke shows up, play along naturally. Never explain it and never mention that you "learned" it or reference any list above.
- Never say "according to my records" or act like a database.
- If you don't know something, say so in one short line rather than inventing facts.
- Keep it tasteful. Do not produce slurs or targeted harassment.

RECENT CHAT:
${vibe}`;
}

/**
 * Calls OpenRouter with the SERVER's key. Returns { reply } or { error }.
 */
async function generateReply({
  guildId,
  guildName,
  botName,
  userName,
  userId,
  messageContent,
  words = [],
  phrases = [],
  history = [],
  serverDesc = '',
}) {
  if (!aiKeys.hasKey(guildId)) {
    return {
      error:
        'No OpenRouter key set for this server. An admin can add one with `/api setup`, then DM the bot to submit it.',
    };
  }

  let apiKey;
  let model;
  try {
    apiKey = aiKeys.decryptKey(aiKeys.getKeyRow(guildId));
    model = aiKeys.getModel(guildId);
    if (!apiKey) throw new Error('no key stored');
  } catch (err) {
    console.error('[AI] Could not decrypt server key:', err.message);
    return {
      error:
        'The stored API key could not be decrypted. If ENCRYPTION_KEY was changed, an admin needs to re-add the key with `/api setup`.',
    };
  }

  const system = buildSystemPrompt({ guildName, botName, serverDesc, words, phrases, history });

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_URL || 'https://github.com/12hrformat/zenin',
        'X-Title': 'zenin',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: messageContent.slice(0, 2000) },
        ],
        temperature: 1.0,
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[AI] OpenRouter ${res.status}:`, text.slice(0, 300));

      if (res.status === 401) return { error: 'OpenRouter rejected that key (401). An admin should re-add it.' };
      if (res.status === 402) return { error: 'That OpenRouter account has no credit left.' };
      if (res.status === 429) return { error: 'Rate limited by OpenRouter - try again in a moment.' };
      return { error: `OpenRouter returned ${res.status}.` };
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) return { error: 'The model returned nothing.' };

    return { reply: reply.slice(0, 1800), usage: data.usage, model: data.model || model };
  } catch (err) {
    console.error('[AI] Request failed:', err.message);
    return { error: err.message };
  }
}

module.exports = { generateReply, cooldownRemaining, markUsed, MODEL_CHOICES: aiKeys.MODEL_CHOICES };
