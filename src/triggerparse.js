// SHARED FILE: keep identical in bot/src and dashboard/src.
// Custom triggers live in one YAML document per server. This turns that text into validated triggers plus a list of
// problems (each with the line it is on), and rewrites the `enabled:` key without touching comments or formatting.
// Pure code: no Discord, no database. Schema and limits are documented in docs/TRIGGERS.md (bot repo).
const { parseDocument, LineCounter, isMap, isSeq, isScalar } = require('yaml');

const MAX_TRIGGERS = 20; // per server, counted from the YAML
const MAX_YAML_BYTES = 20 * 1024;
const MAX_TEXT = 1000; // response text
const MAX_SECONDS = 60; // delete timers
const MAX_COOLDOWN = 86400; // seconds
const MAX_PATTERNS = 10; // per trigger
const MAX_PATTERN_LENGTH = 200;
const MAX_IDS = 50; // per allow/deny list
const MAX_MUTE_MS = 28 * 86400000; // Discord's timeout limit
const DEFAULT_REACTION = '✅';
const DEFAULT_MESSAGE = '✅ Done.';
const DEFAULT_MUTE_MS = 10 * 60000;
const DEFAULT_COOLDOWN = 3; // seconds

// Built-in "!" commands; a trigger can't take their name. Keep in sync with COMMANDS in prefix.js.
const RESERVED = ['afk', 'guesscountry', 'gc', 'guessstate', 'gs', 'guesscontinent', 'gcont', 'guessgeo', 'gg', 'g', 'snipe', 'auth', 'debate', 'summary', 'q', 'quote', 'define', 'def', 'wiki', 'w', 'leaveserver', 'blockserver', 'unblockserver', 'stealemoji', 'emoji', 'betaaccess', 'betaccess', 'servers', 'config', 'help'];
const ACTION_NAMES = ['none', 'role_add', 'role_remove', 'kick', 'ban', 'mute'];
// Discord permission names (the ones discord.js knows), for who_can_use.permissions.
const PERMISSIONS = ['CreateInstantInvite', 'KickMembers', 'BanMembers', 'Administrator', 'ManageChannels', 'ManageGuild', 'AddReactions', 'ViewAuditLog', 'PrioritySpeaker', 'Stream', 'ViewChannel', 'SendMessages', 'SendTTSMessages', 'ManageMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'MentionEveryone', 'UseExternalEmojis', 'ViewGuildInsights', 'Connect', 'Speak', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'UseVAD', 'ChangeNickname', 'ManageNicknames', 'ManageRoles', 'ManageWebhooks', 'ManageGuildExpressions', 'UseApplicationCommands', 'RequestToSpeak', 'ManageEvents', 'ManageThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'UseExternalStickers', 'SendMessagesInThreads', 'UseEmbeddedActivities', 'ModerateMembers', 'ViewCreatorMonetizationAnalytics', 'UseSoundboard', 'SendVoiceMessages', 'SendPolls', 'UseExternalApps'];

const SNOWFLAKE = /^\d{15,25}$/;
const EMOJI_RE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*|<a?:\w{2,32}:\d{15,25}>)$/u; // same as isValidEmoji in format.js
const TOP_KEYS = ['enabled', 'match', 'action', 'apply_to', 'role', 'duration', 'response', 'delete_prompt', 'delete_prompt_after', 'cooldown', 'who_can_use', 'where_can_use'];

/** "10m", "2h", "1d" -> { ms } (1 minute to 28 days), or { error }. */
function parseDuration(input = '10m') {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\s*$/i.exec(input);
  if (!m) return { error: 'Mute duration must look like `10m`, `2h` or `1d`.' };
  const unit = m[2][0].toLowerCase();
  const ms = Math.round(parseFloat(m[1]) * (unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000));
  if (ms < 60000 || ms > MAX_MUTE_MS) return { error: 'Mute duration must be between `1m` and `28d`.' };
  return { ms };
}

/**
 * Why a regex can't be used, or null if it is fine: too long, invalid, or likely to be slow (nested or repeated groups,
 * back-references, huge repeat counts). The check is deliberately cautious; matching is also time-limited at runtime.
 */
function regexProblem(src, flags = 'i') {
  if (typeof src !== 'string' || !src) return 'The pattern is empty.';
  if (src.length > MAX_PATTERN_LENGTH) return `The pattern is too long (max ${MAX_PATTERN_LENGTH} characters).`;
  try { new RegExp(src, flags); } catch (e) { return `Invalid regex: ${String(e.message).replace(/^Invalid regular expression: /, '')}`; }
  const slow = 'This pattern can be very slow: a repeated group that itself repeats or has alternatives, like `(a+)+` or `(a|b)*`. Simplify it.';
  const stack = [{ rep: false, alt: false }]; // per open group: does it contain a repeat / an alternative?
  const quantAfter = (j) => { // the quantifier right after position j: { unbounded } or null
    const c = src[j];
    if (c === '*' || c === '+') return { unbounded: true };
    const m = c === '{' ? /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(j)) : null;
    return m ? { unbounded: m[2] === '', upper: Number(m[2] === undefined || m[2] === '' ? m[1] : m[2]), len: m[0].length } : null;
  };
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      if (!inClass && (/[1-9]/.test(src[i + 1] ?? '') || (src[i + 1] === 'k' && src[i + 2] === '<'))) return 'Back-references (like `\\1`) are not allowed because they can be slow.';
      i++; continue;
    }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    const top = stack[stack.length - 1];
    if (c === '(') { stack.push({ rep: false, alt: false }); continue; }
    if (c === '|') { top.alt = true; continue; }
    if (c === ')') {
      const g = stack.length > 1 ? stack.pop() : { rep: false, alt: false };
      const q = quantAfter(i + 1);
      if (q?.unbounded && (g.rep || g.alt)) return slow;
      if (g.rep || q?.unbounded) stack[stack.length - 1].rep = true;
      continue;
    }
    if (c === '*' || c === '+') { top.rep = true; continue; }
    if (c === '{') {
      const q = quantAfter(i);
      if (!q) continue;
      if (q.unbounded) top.rep = true;
      else if (q.upper > 100) return 'Repeat counts above 100 are not allowed.';
      i += q.len - 1;
    }
  }
  return null;
}

const plain = (v) => (typeof v === 'bigint' ? (v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : String(v)) : v); // long IDs parse exactly, as text
const kindOf = (n) => (n == null || (isScalar(n) && n.value === null) ? 'null' : isScalar(n) ? 'scalar' : isSeq(n) ? 'seq' : isMap(n) ? 'map' : 'other');
const keyOf = (pair) => (isScalar(pair.key) && pair.key.value != null ? String(pair.key.value) : null);
const oneIn = (list) => list.join(', ').replace(/, ([^,]*)$/, ' or $1');

/**
 * Reads and checks the YAML text.
 * Returns { triggers, names, errors, failed }:
 *   triggers  the valid triggers, normalized (what the bot runs)
 *   names     every trigger declared in the YAML (valid or not): [{ name, line, enabled, valid }]
 *   errors    [{ line, column, lineText, trigger, message, severity }]  severity "error" = that trigger is skipped, "warning" = it still works
 *   failed    true when the whole document could not be read (syntax error, too large, wrong shape): there are no triggers then
 */
function parseTriggers(text) {
  const out = { triggers: [], names: [], errors: [], failed: false };
  const lines = typeof text === 'string' ? text.split(/\r?\n/) : [];
  const add = (line, column, trigger, message, severity = 'error') => out.errors.push({ line, column, lineText: lines[line - 1] ?? '', trigger: trigger ?? null, message, severity });
  const fail = (message, line = 1, column = 1) => { out.failed = true; add(line, column, null, message); return out; };
  if (typeof text !== 'string') return fail('The triggers must be text.');
  if (Buffer.byteLength(text) > MAX_YAML_BYTES) return fail(`The YAML is too large (max ${MAX_YAML_BYTES / 1024} KB).`);
  if (!text.trim()) return out;

  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, intAsBigInt: true, uniqueKeys: false });
  const pos = (node) => (node?.range ? lc.linePos(node.range[0]) : { line: 1, col: 1 });
  const clean = (m) => String(m).split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
  for (const e of doc.errors) add(e.linePos?.[0]?.line ?? 1, e.linePos?.[0]?.col ?? 1, null, clean(e.message));
  if (doc.errors.length) { out.failed = true; out.errors.sort((a, b) => a.line - b.line || a.column - b.column); return out; }
  for (const w of doc.warnings) add(w.linePos?.[0]?.line ?? 1, w.linePos?.[0]?.col ?? 1, null, clean(w.message), 'warning');

  const root = doc.contents;
  if (root == null) return out; // only comments
  if (!isMap(root)) { const p = pos(root); return fail('Start with `triggers:` and list your triggers under it.', p.line, p.col); }
  let section = null;
  for (const pair of root.items) {
    const key = keyOf(pair);
    if (key === 'triggers' && !section) { section = pair; continue; }
    const p = pos(pair.key);
    add(p.line, p.col, null, key === 'triggers' ? 'Duplicate `triggers` key; this one is ignored.' : `Unknown key "${key ?? '?'}". Only \`triggers:\` is used at the top.`, 'warning');
  }
  if (section && kindOf(section.value) !== 'null') {
    if (!isMap(section.value)) { const p = pos(section.key); return fail('`triggers:` must list names with their settings indented below, like `hire:`.', p.line, p.col); }
    const seen = new Set();
    for (const pair of section.value.items) {
      const name = keyOf(pair);
      const kp = pos(pair.key);
      if (name === null) { add(kp.line, kp.col, null, 'Trigger names must be plain words like `hire`.'); continue; }
      if (seen.has(name)) { add(kp.line, kp.col, name, `Duplicate trigger "${name}"; the first one is used.`); continue; }
      seen.add(name);
      if (out.names.length >= MAX_TRIGGERS) { add(kp.line, kp.col, name, `A server can have up to ${MAX_TRIGGERS} triggers; this one is ignored.`); continue; }
      const entry = { name, line: kp.line, enabled: !(isMap(pair.value) && pair.value.items.some((p) => keyOf(p) === 'enabled' && isScalar(p.value) && p.value.value === false)), valid: false };
      out.names.push(entry);
      if (!/^[a-z]{1,32}$/.test(name)) { add(kp.line, kp.col, name, 'Trigger names are 1-32 lowercase letters (a-z), like `hire`. No spaces, numbers or symbols.'); continue; }
      if (RESERVED.includes(name)) { add(kp.line, kp.col, name, `\`!${name}\` is a built-in command. Pick another name.`); continue; }
      const t = validate(name, pair, kp.line, pos, (line, column, msg, sev) => add(line, column, name, msg, sev));
      if (t) { out.triggers.push(t); entry.valid = true; }
    }
  }
  out.errors.sort((a, b) => a.line - b.line || a.column - b.column);
  return out;
}

/** One trigger. Returns the normalized trigger, or null if it has an error (warnings alone don't count). */
function validate(name, pair, line, pos, report) {
  let bad = false;
  const lines = {}; // "role", "response.text" ... -> line number, so runtime problems can point at the right line
  const issue = (node, message, severity = 'error') => { const p = pos(node ?? pair.key); report(p.line, p.col, message, severity); if (severity === 'error') bad = true; };

  const collect = (map, allowed, prefix) => { // key -> pair, reporting unknown and repeated keys
    const got = {};
    for (const p of map?.items ?? []) {
      const k = keyOf(p);
      if (k === null || !allowed.includes(k)) { issue(p.key, `Unknown key "${k ?? '?'}"${prefix ? ` in \`${prefix.slice(0, -1)}\`` : ''}. Allowed: ${allowed.join(', ')}.`, 'warning'); continue; }
      if (got[k]) issue(p.key, `Duplicate key "${k}"; the last one is used.`, 'warning');
      got[k] = p; lines[prefix + k] = pos(p.key).line;
    }
    return got;
  };
  const group = (p, label, allowed) => { // a nested group of settings
    if (!p || kindOf(p.value) === 'null') return {};
    if (!isMap(p.value)) { issue(p.key, `\`${label}\` must be a group of settings indented below it.`); return {}; }
    return collect(p.value, allowed, `${label}.`);
  };
  const scalar = (p) => (p && isScalar(p.value) && p.value.value !== null ? plain(p.value.value) : undefined);
  const unset = (p) => !p || kindOf(p.value) === 'null';
  const bool = (p, def, label) => {
    if (unset(p)) return def;
    const v = scalar(p);
    if (typeof v === 'boolean') return v;
    issue(p.value, `\`${label}\` must be true or false.`); return def;
  };
  const num = (p, def, label, min, max, whole = true) => {
    if (unset(p)) return def;
    const v = scalar(p);
    if (typeof v !== 'number' || !Number.isFinite(v) || (whole && !Number.isInteger(v)) || v < min || v > max) { issue(p.value, `\`${label}\` must be ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}.`); return def; }
    return v;
  };
  const str = (p, label) => { // undefined when not set
    if (unset(p)) return undefined;
    const v = scalar(p);
    if (v === undefined) { issue(p.value, `\`${label}\` must be a single value, not a list or group.`); return undefined; }
    return String(v);
  };
  const oneOf = (p, def, label, list) => {
    const v = str(p, label);
    if (v === undefined) return def;
    const hit = list.find((x) => x.toLowerCase() === v.toLowerCase());
    if (hit) return hit;
    issue(p.value, `\`${label}\` must be ${oneIn(list)}.`); return def;
  };
  const items = (p) => (isSeq(p.value) ? p.value.items : [p.value]); // a single value counts as a list of one
  const ids = (p, label) => {
    if (unset(p)) return [];
    const nodes = items(p);
    if (nodes.length > MAX_IDS) issue(p.key, `\`${label}\` can hold up to ${MAX_IDS} IDs.`);
    const found = [];
    for (const n of nodes.slice(0, MAX_IDS)) {
      const v = isScalar(n) ? plain(n.value) : undefined;
      if ((typeof v === 'string' || typeof v === 'number') && SNOWFLAKE.test(String(v))) { if (!found.includes(String(v))) found.push(String(v)); } else issue(n ?? p.key, `\`${label}\` needs Discord IDs (15-25 digits), like "123456789012345678".`);
    }
    return found;
  };
  const perms = (p) => {
    if (unset(p)) return [];
    const found = [];
    for (const n of items(p).slice(0, MAX_IDS)) {
      const v = isScalar(n) && n.value != null ? String(n.value) : '';
      const hit = PERMISSIONS.find((x) => x.toLowerCase() === v.toLowerCase());
      if (hit) { if (!found.includes(hit)) found.push(hit); } else issue(n ?? p.key, `Unknown permission "${v}". Use Discord's names without spaces, like ManageRoles or ModerateMembers.`);
    }
    return found;
  };

  let body = pair.value;
  if (kindOf(body) === 'null') body = null;
  else if (!isMap(body)) { issue(pair.key, `\`${name}:\` needs its settings indented below it (or nothing, to use the defaults).`); return null; }
  const top = collect(body, TOP_KEYS, '');

  // ---- what triggers it ----
  const enabled = bool(top.enabled, true, 'enabled');
  const match = group(top.match, 'match', ['type', 'patterns', 'flags']);
  const type = oneOf(match.type, 'command', 'match.type', ['command', 'regex']);
  let patterns = []; let flags = 'i';
  if (type === 'regex') {
    const f = str(match.flags, 'match.flags');
    if (f !== undefined) { if (/^[imsu]*$/.test(f) && new Set(f).size === f.length) flags = f; else issue(match.flags.value, '`match.flags` can only use the letters i, m, s and u (each once).'); }
    const nodes = unset(match.patterns) ? [] : items(match.patterns);
    if (!nodes.length) issue((match.patterns ?? top.match ?? pair).key, 'A regex trigger needs at least one pattern in `match.patterns`.');
    if (nodes.length > MAX_PATTERNS) issue(match.patterns.key, `A trigger can have up to ${MAX_PATTERNS} patterns.`);
    nodes.slice(0, MAX_PATTERNS).forEach((n, i) => {
      const v = isScalar(n) && n.value != null ? String(n.value) : '';
      const problem = regexProblem(v, flags);
      if (problem) return issue(n, `Pattern ${i + 1}: ${problem}`);
      if (new RegExp(v, flags).test('')) issue(n, `Pattern ${i + 1} matches empty text, so it would fire on every message.`, 'warning');
      patterns.push(v);
    });
  } else {
    if (match.patterns) issue(match.patterns.key, '`patterns` only works with `type: regex`, so it is ignored here.', 'warning');
    if (match.flags) issue(match.flags.key, '`flags` only works with `type: regex`, so it is ignored here.', 'warning');
  }

  // ---- what it does ----
  const actionName = oneOf(top.action, 'none', 'action', ACTION_NAMES);
  const action = actionName === 'none' ? null : actionName;
  const applyTo = oneOf(top.apply_to, 'target', 'apply_to', ['target', 'author']);
  const roleId = ids(top.role, 'role')[0] ?? null;
  if (top.role && !unset(top.role) && isSeq(top.role.value)) issue(top.role.key, '`role` takes a single role ID.');
  if ((action === 'role_add' || action === 'role_remove') && !roleId && !bad) issue((top.action ?? pair).key, `\`${action}\` needs a \`role\`.`);
  let durationMs = null;
  if (action === 'mute') {
    const raw = str(top.duration, 'duration');
    if (raw === undefined) durationMs = DEFAULT_MUTE_MS;
    else { const d = parseDuration(raw); if (d.error) issue(top.duration.value, d.error); else durationMs = d.ms; }
  } else if (top.duration) issue(top.duration.key, '`duration` only works with `action: mute`, so it is ignored.', 'warning');

  // ---- how it answers ----
  const resp = group(top.response, 'response', ['type', 'text', 'in_reply', 'chance', 'delete_after']);
  const textRaw = str(resp.text, 'response.text');
  const declared = oneOf(resp.type, null, 'response.type', ['reaction', 'message']);
  const respondType = declared ?? (textRaw && !EMOJI_RE.test(textRaw.trim()) ? 'message' : 'reaction'); // text alone: guess from what was typed
  let respond;
  if (respondType === 'reaction') {
    respond = (textRaw ?? '').trim() || DEFAULT_REACTION;
    if (!EMOJI_RE.test(respond)) issue((resp.text ?? top.response ?? pair).value ?? pair.key, 'A reaction must be one emoji: a standard one like ✅, or a custom one like <:name:123456789012345678>.');
  } else {
    respond = (textRaw ?? '').trim() || DEFAULT_MESSAGE;
    if (respond.length > MAX_TEXT) issue(resp.text.value, `\`response.text\` is too long (max ${MAX_TEXT} characters).`);
  }
  const inReply = bool(resp.in_reply, true, 'response.in_reply');
  const chance = num(resp.chance, 100, 'response.chance', 0, 100, false);
  const deleteAfter = num(resp.delete_after, 0, 'response.delete_after', 0, MAX_SECONDS);
  const deletePrompt = bool(top.delete_prompt, false, 'delete_prompt');
  const deletePromptAfter = num(top.delete_prompt_after, 0, 'delete_prompt_after', 0, MAX_SECONDS);

  // ---- limits ----
  const cd = group(top.cooldown, 'cooldown', ['seconds', 'scope']);
  const cooldown = { seconds: num(cd.seconds, DEFAULT_COOLDOWN, 'cooldown.seconds', 0, MAX_COOLDOWN), scope: oneOf(cd.scope, 'user', 'cooldown.scope', ['user', 'channel', 'server']) };
  const w = group(top.who_can_use, 'who_can_use', ['roles_allow', 'roles_deny', 'users_allow', 'users_deny', 'permissions']);
  const who = { rolesAllow: ids(w.roles_allow, 'who_can_use.roles_allow'), rolesDeny: ids(w.roles_deny, 'who_can_use.roles_deny'), usersAllow: ids(w.users_allow, 'who_can_use.users_allow'), usersDeny: ids(w.users_deny, 'who_can_use.users_deny'), permissions: perms(w.permissions) };
  const wh = group(top.where_can_use, 'where_can_use', ['channels_allow', 'channels_deny', 'categories_allow', 'categories_deny']);
  const where = { channelsAllow: ids(wh.channels_allow, 'where_can_use.channels_allow'), channelsDeny: ids(wh.channels_deny, 'where_can_use.channels_deny'), categoriesAllow: ids(wh.categories_allow, 'where_can_use.categories_allow'), categoriesDeny: ids(wh.categories_deny, 'where_can_use.categories_deny') };

  // ---- things that are allowed but probably not what was meant ----
  if (respondType === 'message' && /\$\{role(?:name|mention)\}/i.test(respond) && !roleId) issue((resp.text ?? pair).value, 'Your message uses a role variable but no `role` is set, so it will be empty.', 'warning');
  if (respondType === 'reaction' && deletePrompt) issue(top.delete_prompt.key, 'The reaction goes on the message that ran the command, which is being deleted, so nobody will see it. Use a message response instead.', 'warning');
  if (!deletePrompt && top.delete_prompt_after && deletePromptAfter) issue(top.delete_prompt_after.key, '`delete_prompt_after` is ignored unless `delete_prompt` is true.', 'warning');
  if (type === 'regex' && action && applyTo === 'target') issue(top.action.key, 'A regex trigger acts on the first @mention in the message; without one it does nothing. Use `apply_to: author` to act on whoever wrote it.', 'warning');

  if (bad) return null;
  return {
    name, line, lines, enabled,
    match: { type, patterns, flags },
    action, applyTo, roleId, durationMs,
    respondType, respond, inReply, chance, deleteAfter,
    deletePrompt, deletePromptAfter,
    cooldown, who, where,
  };
}

/**
 * Turns one trigger on or off by rewriting its `enabled:` key in the YAML text.
 * The Document API finds the exact spot and only that spot is edited, so every comment and all spacing stay as they were.
 * Returns { yaml } or { error: 'empty' | 'syntax' | 'missing' | 'shape', message, line? }.
 */
function setEnabled(text, name, enabled) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'empty', message: 'There are no triggers yet.' };
  const opts = { intAsBigInt: true, uniqueKeys: false }; // BigInt keeps long IDs exact if the text has to be written back
  const doc = parseDocument(text, opts);
  if (doc.errors.length) return { error: 'syntax', message: String(doc.errors[0].message).split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''), line: doc.errors[0].linePos?.[0]?.line ?? 1 };
  const list = isMap(doc.contents) ? doc.contents.items.find((p) => keyOf(p) === 'triggers')?.value : null;
  const pair = isMap(list) ? list.items.find((p) => keyOf(p) === name) : null;
  if (!pair) return { error: 'missing', message: `There is no trigger called \`!${name}\`.` };
  const body = pair.value;
  const own = isMap(body) ? body.items.find((p) => keyOf(p) === 'enabled') : null;
  if (own && !isScalar(own.value) && own.value != null) return { error: 'shape', message: `\`enabled\` of \`!${name}\` isn't true or false, so it can't be switched here. Edit it on the dashboard.` };
  if (body != null && !isMap(body) && !(isScalar(body) && body.value === null)) return { error: 'shape', message: `\`!${name}\` isn't written as a group of settings, so it can't be switched here. Edit it on the dashboard.` };

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lineStart = (at) => text.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = (at) => { const i = text.indexOf('\n', at); const end = i < 0 ? text.length : i; return text[end - 1] === '\r' ? end - 1 : end; };
  const splice = (from, to, insert) => text.slice(0, from) + insert + text.slice(to);
  let edited;
  if (own && isScalar(own.value) && own.value.range && own.value.range[1] > own.value.range[0]) edited = splice(own.value.range[0], own.value.range[1], String(enabled)); // enabled: true -> false, comment untouched
  else if (own) { const colon = text.indexOf(':', own.key.range[1]); edited = splice(colon + 1, colon + 1, ` ${enabled}`); } // "enabled:" with nothing after it
  else if (isMap(body) && body.flow) edited = splice(body.range[0] + 1, body.range[0] + 1, body.items.length ? ` enabled: ${enabled},` : ` enabled: ${enabled} `); // { action: kick }
  else if (isMap(body) && body.items.length) { // new first line under the name, indented like its neighbours
    const first = body.items[0].key.range[0];
    edited = splice(lineEnd(pair.key.range[0]), lineEnd(pair.key.range[0]), `${eol}${' '.repeat(first - lineStart(first))}enabled: ${enabled}`);
  } else edited = splice(lineEnd(pair.key.range[0]), lineEnd(pair.key.range[0]), `${eol}${' '.repeat(pair.key.range[0] - lineStart(pair.key.range[0]) + 2)}enabled: ${enabled}`); // "name:" with nothing under it

  const check = parseDocument(edited, opts);
  const now = check.getIn(['triggers', name, 'enabled']);
  if (!check.errors.length && now === enabled) return { yaml: edited };
  // The targeted edit didn't give the expected result (odd layout): fall back to letting the Document write the text out again.
  if (pair.value == null || kindOf(body) === 'null') pair.value = doc.createNode({ enabled });
  else if (own) own.value = doc.createNode(enabled);
  else body.items.unshift(doc.createPair('enabled', enabled));
  return { yaml: doc.toString({ lineWidth: 0 }) };
}

// ---------------- the examples new servers start with (all switched off, no warnings) ----------------
const EXAMPLE_TRIGGERS = [
  `  # ---------- Example 1: a !command that gives someone a role ----------
  hire:                          # the command name: members type "!hire @someone" (letters a-z only, up to 32)
    enabled: false               # the examples are switched off. Set true (or use /triggers in Discord) to turn one on
    match:
      type: command              # command = "!hire ..." | regex = watches normal messages (see example 3)
    action: role_add             # none | role_add | role_remove | kick | ban | mute
    apply_to: target             # target = the first @mention | author = whoever typed the command
    role: "111111111111111111"   # role to give or take. Developer Mode on, then right-click a role > Copy Role ID
    response:
      type: message              # reaction | message
      text: "\${authormention} hired \${targetmention} as \${rolemention}"   # variables: \${authormention} \${authername} \${targetmention} \${targetname} \${rolename} \${rolemention}
      in_reply: true             # reply to the message that ran the command
      chance: 100                # percent chance that I answer (the action itself always happens)
      delete_after: 15           # remove my answer after this many seconds (0 = keep it, max 60)
    delete_prompt: true          # also delete the "!hire @someone" message
    delete_prompt_after: 5       # ...after 5 seconds (0 = right away, max 60)`,
  `  # ---------- Example 2: a mute command with limits ----------
  quiet:                         # "!quiet @someone"
    enabled: false
    match:
      type: command
    action: mute
    apply_to: target
    duration: 30m                # mute only: 1m to 28d, like 10m, 2h or 1d (default 10m)
    response:
      type: reaction
      text: "🔇"                 # one emoji: a standard one, or a custom one like <:name:123456789012345678>
    cooldown: { seconds: 60, scope: channel }   # seconds between uses (default 3), counted per user | channel | server
    who_can_use:                 # leave a list empty, or delete it, for "no limit"
      roles_allow: ["222222222222222222"]       # members with one of these roles...
      users_allow: []                           # ...or these users can use it
      roles_deny: ["333333333333333333"]        # these roles never can
      users_deny: ["444444444444444444"]        # these users never can
      permissions: [ModerateMembers]            # and they must have ALL of these Discord permissions
    where_can_use:
      channels_allow: []         # empty = every channel
      channels_deny: ["555555555555555555"]     # never in these channels (threads follow their channel)
      categories_allow: []
      categories_deny: ["666666666666666666"]   # never in these categories`,
  `  # ---------- Example 3: a regex trigger that watches normal messages ----------
  thanks:                        # no "!" needed: it reacts to messages that match, so the name is only a label
    enabled: false
    match:
      type: regex                # looks at messages that do not start with "!"
      patterns:                  # up to 10, each up to 200 characters. Any one matching is enough
        - '\\bgood\\s+bot\\b'
        - '\\bthank(s| you),? bot\\b'
      flags: i                   # i = ignore case (default), plus m, s or u
    response:
      type: reaction
      text: "❤️"
      chance: 25                 # react to roughly 1 in 4 matches
    cooldown: { seconds: 120, scope: server }
    where_can_use:
      channels_allow: ["777777777777777777"]    # only in this channel...
      categories_allow: ["888888888888888888"]  # ...or anywhere in this category`,
];

const DEFAULT_YAML = `# Your custom !commands. Edit this text and press Save. Every setting is optional except the trigger name.
# Full guide: docs/TRIGGERS.md. The three examples below are switched off: edit, rename or delete them.
triggers:
${EXAMPLE_TRIGGERS.join('\n\n')}
`;

module.exports = {
  MAX_TRIGGERS, MAX_YAML_BYTES, MAX_TEXT, MAX_SECONDS, MAX_COOLDOWN, MAX_PATTERNS, MAX_PATTERN_LENGTH, MAX_IDS,
  DEFAULT_REACTION, DEFAULT_MESSAGE, DEFAULT_MUTE_MS, DEFAULT_COOLDOWN,
  RESERVED, ACTION_NAMES, PERMISSIONS, EXAMPLE_TRIGGERS, DEFAULT_YAML,
  parseDuration, regexProblem, parseTriggers, setEnabled,
};
