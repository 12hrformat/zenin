const config = require('../../config.json');

/** Discord-native relative time, e.g. <t:1234567890:R>. */
const relativeTime = ms => `<t:${Math.floor(ms / 1000)}:R>`;

const truncate = (text, max = 180) => {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

const shortId = (id, len = 6) => String(id).slice(0, len);

/** Block progress bar used in level cards. */
function bar(percent, size = 10) {
  const filled = Math.max(0, Math.min(size, Math.round((percent / 100) * size)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)}`;
}

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const siteUrl = () => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

const botInvite = () =>
  process.env.BOT_INVITE_URL ||
  'https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=1101654787178';

const isAdmin = member => !!member?.permissions?.has('Administrator');
const canManageServer = member => !!member?.permissions?.has('ManageGuild');

/** Titles a person could plausibly give their server. */
function severityFromMembers(members) {
  if (members >= 100000) return { label: 'Mega', tone: 'high' };
  if (members >= 10000) return { label: 'Large', tone: 'mid' };
  if (members >= 1000) return { label: 'Established', tone: 'mid' };
  if (members >= 250) return { label: 'Growing', tone: 'low' };
  return { label: 'New', tone: 'low' };
}

module.exports = {
  relativeTime,
  truncate,
  shortId,
  bar,
  ordinal,
  randInt,
  siteUrl,
  botInvite,
  isAdmin,
  canManageServer,
  severityFromMembers,
  config,
};
