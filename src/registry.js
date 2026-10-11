// SHARED FILE: keep identical in bot/src and dashboard/src.
// Every command an admin can switch with /function (and move between beta and public with !config).
// key       the one name used everywhere (database, !config, the website)
// name      how messages and the website call it
// forms     what !config and /function show for it
// channel   true = members type it, so it can be switched per channel. false = it has one channel of its own (server-wide only)
// announce  true = when it is disabled, the bot says so in its own channel (games and feeds only)
const FEATURES = [
  { key: 'summary', name: 'Summary', forms: ['!summary'], group: 'general', channel: true, prefix: ['summary'], desc: 'Summarize a message or a stretch of chat.' },
  { key: 'quote', name: 'Quotes', forms: ['!quote', '!q', '/quote'], group: 'general', channel: true, prefix: ['quote', 'q'], slash: ['quote'], desc: 'Turn messages into a quote image posted in a quotes channel.' },
  { key: 'define', name: 'Define', forms: ['!define', '!def'], group: 'general', channel: true, prefix: ['define', 'def'], desc: 'Look a word up in the dictionary.' },
  { key: 'wiki', name: 'Wiki', forms: ['!wiki', '!w'], group: 'general', channel: true, prefix: ['wiki', 'w'], desc: 'Short Wikipedia summaries.' },
  { key: 'afk', name: 'AFK', forms: ['!afk', '/afk'], group: 'general', channel: true, prefix: ['afk'], slash: ['afk'], desc: 'Let members mark themselves away.' },
  { key: 'emoji', name: 'Emoji', forms: ['!emoji', '/emoji'], group: 'general', channel: true, prefix: ['emoji'], slash: ['emoji'], desc: 'Choose who can add emoji to the server with !emoji.' },
  { key: 'help', name: 'Help', forms: ['!help'], group: 'general', channel: true, prefix: ['help'], desc: 'The command list.' },
  { key: 'trigger', name: 'Triggers', forms: ['/trigger', '/untrigger'], group: 'general', channel: true, slash: ['trigger', 'untrigger'], desc: 'Your own !commands (role, kick, ban, mute).' },
  { key: 'countryguess', name: 'Country Guess', forms: ['!countryguess', '!cg', '/countryguess'], group: 'games', channel: false, announce: true, prefix: ['countryguess', 'cg'], slash: ['countryguess'], desc: 'Members guess countries in one channel.' },
  { key: 'wordstory', name: 'Word Story', forms: ['/wordstory'], group: 'games', channel: false, announce: true, slash: ['wordstory'], desc: 'Members write a story one word at a time.' },
  { key: 'wordchain', name: 'Word Chain', forms: ['/wordchain'], group: 'games', channel: false, announce: true, slash: ['wordchain'], desc: 'Each word starts with the last letter of the previous one.' },
  { key: 'wotd', name: 'Word of the Day', forms: ['/wotd'], group: 'feeds', channel: false, announce: true, slash: ['wotd'], desc: 'Posts a new word in a channel on a schedule.' },
  { key: 'dailyfact', name: 'Daily Fact', forms: ['/dailyfact'], group: 'feeds', channel: false, announce: true, slash: ['dailyfact'], desc: 'Posts an interesting fact in a channel on a schedule.' },
  { key: 'bump', name: 'Bump Reminder', forms: ['/bump'], group: 'other', channel: false, slash: ['bump'], desc: 'Reminds everyone when DISBOARD can be bumped again.' },
  { key: 'log', name: 'Error Logs', forms: ['/log'], group: 'other', channel: false, slash: ['log'], desc: 'Sends bot errors to a channel.' },
];

const BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));
const PREFIX_KEY = {}; // "q" -> "quote", "cg" -> "countryguess" ...
const SLASH_KEY = {}; // "untrigger" -> "trigger"
for (const f of FEATURES) {
  (f.prefix ?? []).forEach((n) => { PREFIX_KEY[n] = f.key; });
  (f.slash ?? []).forEach((n) => { SLASH_KEY[n] = f.key; });
}

/** "!summary", "/quote", "q", "</bump remind:123>" or "summary" -> the key ("summary", "quote", "quote", "bump", "summary"). null if it is not a switchable command. */
function resolveKey(text) {
  const t = String(text ?? '').trim().toLowerCase();
  const mention = /^<\/([\w-]+)(?:\s[\w-]+)*:\d+>$/.exec(t);
  const name = mention ? mention[1] : (/^[/!]?([\w-]+)$/.exec(t)?.[1] ?? null);
  if (!name) return null;
  return BY_KEY[name] ? name : (PREFIX_KEY[name] ?? SLASH_KEY[name] ?? null);
}

module.exports = { FEATURES, BY_KEY, PREFIX_KEY, SLASH_KEY, resolveKey };
