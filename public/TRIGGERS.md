# Triggers

Custom commands and message watchers for your server, written in YAML on the dashboard and switched on or off in Discord with `/triggers`.

## Contents

- [Overview](#overview)
- [Quick start](#quick-start)
- [Field reference](#field-reference)
- [Variables](#variables)
- [How `/triggers` works](#how-triggers-works)
- [Regex tips and limits](#regex-tips-and-limits)
- [The Errors section](#the-errors-section)
- [Examples](#examples)
- [FAQ](#faq)

## Overview

A **trigger** is a rule in your server's YAML. There are two kinds:

| Kind | `match.type` | Runs when |
| --- | --- | --- |
| Command | `command` (default) | Someone types `!name`, for example `!hire @user` |
| Watcher | `regex` | A normal message (one that does not start with `!`) matches one of your patterns |

A trigger can **do something** (give or remove a role, kick, ban or mute) and/or **answer** (react with an emoji or send a message).

Good to know:

- The YAML saved in the dashboard is the only source of truth. `/triggers` changes just the `enabled:` line in that same text.
- Triggers are a beta feature: your server needs beta access, and the dashboard's Triggers tab only appears when it has it.
- The Triggers on/off switch in `/function` is separate. It turns every trigger of the server off or on at once and does not change your YAML.
- A server can have up to **20 triggers** and **20 KB** of YAML.

## Quick start

1. Open the dashboard, pick your server and open the **Triggers** tab. New servers start with three switched-off examples.
2. Edit one, or add your own under `triggers:`. The only required thing is the trigger name.
3. Press **Save**. Problems are listed under the editor with their line numbers. Saving is never blocked: a trigger with an error is skipped, the rest keep working.
4. Turn it on by setting `enabled: true` and saving, or in Discord with `/triggers trigger:hire action:Enable`.
5. Try it: `!hire @someone`.

The smallest possible trigger, `!ping` reacts with a check mark:

```yaml
triggers:
  ping:
```

To copy an ID, turn on **Developer Mode** in Discord (User Settings, Advanced), then right-click a role, channel, category or member and choose **Copy ID**.

## Field reference

Every field is optional except the trigger name. Unknown keys are reported as warnings and ignored.

### Trigger

| Field | Type | Default | Limits and notes |
| --- | --- | --- | --- |
| *(name)* | key | required | 1-32 lowercase letters a-z. No duplicates. Cannot be a built-in command (`!help`, `!q`, `!gc` ...). |
| `enabled` | true / false | `true` | The only field `/triggers` changes. |
| `action` | text | `none` | `none`, `role_add`, `role_remove`, `kick`, `ban`, `mute`. |
| `apply_to` | text | `target` | `target` = the first @mention in the message. `author` = whoever wrote it. |
| `role` | Discord ID | none | Required for `role_add` and `role_remove`. Also feeds `${rolename}` and `${rolemention}`. |
| `duration` | text | `10m` | Only with `action: mute`. `1m` to `28d`, like `10m`, `2h`, `1d`. |
| `delete_prompt` | true / false | `false` | Also delete the message that ran the trigger. Needs the Manage Messages permission. |
| `delete_prompt_after` | whole number (seconds) | `0` | 0-60. `0` = right away. Needs `delete_prompt: true`. |

### `match`

| Field | Type | Default | Limits and notes |
| --- | --- | --- | --- |
| `type` | text | `command` | `command` or `regex`. |
| `patterns` | list of text | none | Regex only, **required** for regex. Up to 10 patterns, 200 characters each. One match is enough. |
| `flags` | text | `i` | Regex only. Letters `i` `m` `s` `u`, each once. `g` and `y` are not allowed. |

### `response`

| Field | Type | Default | Limits and notes |
| --- | --- | --- | --- |
| `type` | text | guessed | `reaction` or `message`. If left out, plain text means message and a single emoji means reaction. |
| `text` | text | `✅` / `✅ Done.` | Reaction: one emoji, standard or custom like `<:name:123456789012345678>`. Message: up to 1000 characters, may use [variables](#variables). |
| `in_reply` | true / false | `true` | Message only: reply to the message that ran the trigger. `false` sends a plain message. |
| `chance` | number | `100` | 0-100 (percent). The chance that the **response** is sent. The action itself always happens. |
| `delete_after` | whole number (seconds) | `0` | 0-60. Removes the response (or the reaction) after that long. `0` keeps it. |

### `cooldown`

| Field | Type | Default | Limits and notes |
| --- | --- | --- | --- |
| `seconds` | whole number | `3` | 0-86400. `0` = no cooldown. |
| `scope` | text | `user` | `user` (each member has their own), `channel` or `server` (shared by everyone). |

A cooldown only starts when the trigger really runs, not when someone is refused.

### `who_can_use`

| Field | Type | Default | Limits and notes |
| --- | --- | --- | --- |
| `roles_allow` | list of IDs | empty | Up to 50 per list. |
| `roles_deny` | list of IDs | empty | |
| `users_allow` | list of IDs | empty | |
| `users_deny` | list of IDs | empty | |
| `permissions` | list of names | empty | Discord permission names without spaces, like `ManageRoles`, `ModerateMembers`, `KickMembers`. |

How the lists combine, in this order:

1. Anyone in `users_deny`, or with a role in `roles_deny`, is refused. **Deny always wins.**
2. If `roles_allow` or `users_allow` has entries, the member must have one of those roles **or** be one of those users.
3. If `permissions` has entries, the member must have **all** of them.

There is no exception for admins or the server owner: what you write is what applies. For command triggers a refused member gets a short reply; watchers stay silent.

### `where_can_use`

| Field | Type | Default | Limits and notes |
| --- | --- | --- | --- |
| `channels_allow` | list of IDs | empty | Empty lists mean "everywhere". |
| `channels_deny` | list of IDs | empty | |
| `categories_allow` | list of IDs | empty | |
| `categories_deny` | list of IDs | empty | |

Deny wins. If either allow list has entries, the message must be in one of those channels **or** in a channel inside one of those categories. Threads follow their parent channel. A trigger used in the wrong place stays silent.

Action rules (unchanged from before): acting on someone else needs the matching Discord permission, you cannot act on someone whose highest role is equal to or above yours, and the bot needs the permission and a role above the member and the role.

## Variables

Usable in `response.text` of a message response. They are replaced when the trigger runs. A variable that has no value becomes empty.

| Variable | Becomes |
| --- | --- |
| `${authormention}` | Mention of whoever ran the trigger |
| `${authername}` | Their display name |
| `${targetmention}` | Mention of the first @mention in the message |
| `${targetname}` | Their display name |
| `${rolename}` | Name of `role` |
| `${rolemention}` | Mention of `role` (shown as a role, never pings) |

If a trigger needs a target (the action is on the target, or the text uses a target variable), a command trigger without an @mention answers "Mention someone". A watcher without an @mention does nothing.

## How `/triggers` works

`/triggers` is for Administrators in a server. It has two required options:

- **trigger**: starts typing and you get a list of the triggers in your YAML (with on/off), including ones that have errors.
- **action**: **Enable** or **Disable**.

It rewrites only the `enabled:` value of that trigger in the stored YAML. Comments, spacing and everything else stay exactly as written. If the trigger had no `enabled:` line, one is added as its first line. Replies are visible only to you.

It tells you clearly when the trigger does not exist, when the YAML has a syntax error (fix it on the dashboard first), or when a trigger you enabled has errors or the server-wide switch is off.

Editing happens only on the dashboard. There is no `/trigger` or `/untrigger` any more.

## Regex tips and limits

Patterns use JavaScript regular expressions and match against the first **1000 characters** of a message that does not start with `!`.

- Use single quotes in YAML so you do not have to double your backslashes: `'\bgood\s+bot\b'` means the words "good bot".
- `\b` marks a word edge. Without it `bot` also matches "robot".
- Matching ignores case by default (`flags: i`).
- Up to 10 patterns per trigger, 200 characters each; at most 3 watchers fire on one message.
- Patterns that can take very long are **rejected when you save**: a repeated group that itself repeats or has alternatives (`(a+)+`, `(a|b)*`), back-references (`\1`), and repeat counts above 100. Write `(hello|hi) there` instead of `(hello|hi)+`.
- Patterns that can match empty text (like `.*`) get a warning because they would fire on every message.
- As a safety net, a pattern that still takes more than 50 ms is stopped, logged as a runtime error, and the trigger pauses for 10 minutes.
- Add a `where_can_use` limit and a longer `cooldown` so a watcher does not get noisy.
- A watcher with an action on the `target` needs an @mention in the message; use `apply_to: author` to act on the person who wrote it.

## The Errors section

Under the editor, every problem is listed with:

- **Error** or **Warning**. An *error* means that trigger is skipped. A *warning* means it still works but something is probably not what you meant (an unknown key, a setting that is ignored).
- **line N** and the **exact text of that line** from your YAML, so you can see what the bot saw.
- The **trigger** name and what is wrong.
- **Save** or **Runtime**: *Save* problems are found when you press Save; *Runtime* problems happen while a trigger runs (a deleted role, a missing bot permission, a regex that was too slow, an emoji the bot cannot use).
- When it last happened, and **x3** style counters when the same problem repeated.

Click an entry to jump to and highlight that line in the editor. If you have edited the text since, the bot-side line is matched by its text so you land on the right line. Use the filter to show only *Save* or *Runtime* problems, **Refresh** to reload, and **Clear** to remove the ones shown.

A red number on the **Triggers** tab shows how many errors there are. Warnings are not counted.

Good to know:

- The newest 50 problems are kept per server, and entries disappear after 30 days.
- Saving again removes Save problems you fixed.
- If the whole document cannot be read (for example wrong indentation or a tab used as indentation), nothing in it can be understood. The bot **keeps running the last version that could be read** and logs a Runtime entry saying so.

## Examples

New servers start with all three, switched off. Turn one on with `enabled: true`.

### 1. A command that gives a role

```yaml
triggers:
  hire:                          # the command name: members type "!hire @someone" (letters a-z only, up to 32)
    enabled: false               # the examples are switched off. Set true (or use /triggers in Discord) to turn one on
    match:
      type: command              # command = "!hire ..." | regex = watches normal messages (see example 3)
    action: role_add             # none | role_add | role_remove | kick | ban | mute
    apply_to: target             # target = the first @mention | author = whoever typed the command
    role: "111111111111111111"   # role to give or take. Developer Mode on, then right-click a role > Copy Role ID
    response:
      type: message              # reaction | message
      text: "${authormention} hired ${targetmention} as ${rolemention}"   # variables: ${authormention} ${authername} ${targetmention} ${targetname} ${rolename} ${rolemention}
      in_reply: true             # reply to the message that ran the command
      chance: 100                # percent chance that I answer (the action itself always happens)
      delete_after: 15           # remove my answer after this many seconds (0 = keep it, max 60)
    delete_prompt: true          # also delete the "!hire @someone" message
    delete_prompt_after: 5       # ...after 5 seconds (0 = right away, max 60)
```

`!hire @someone` gives them the role, replies with the message (deleted after 15 seconds) and deletes the command message 5 seconds later.

### 2. A mute command with limits

```yaml
triggers:
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
      categories_deny: ["666666666666666666"]   # never in these categories
```

Only members with the allowed role **and** the Moderate Members permission can use it, never in the denied channel or category, once a minute per channel.

### 3. A regex watcher

```yaml
triggers:
  thanks:                        # no "!" needed: it reacts to messages that match, so the name is only a label
    enabled: false
    match:
      type: regex                # looks at messages that do not start with "!"
      patterns:                  # up to 10, each up to 200 characters. Any one matching is enough
        - '\bgood\s+bot\b'
        - '\bthank(s| you),? bot\b'
      flags: i                   # i = ignore case (default), plus m, s or u
    response:
      type: reaction
      text: "❤️"
      chance: 25                 # react to roughly 1 in 4 matches
    cooldown: { seconds: 120, scope: server }
    where_can_use:
      channels_allow: ["777777777777777777"]    # only in this channel...
      categories_allow: ["888888888888888888"]  # ...or anywhere in this category
```

Reacts with a heart to about a quarter of the "good bot" or "thanks, bot" messages, only in the chosen channel or category, at most once every two minutes in the whole server.

## FAQ

**Why is my trigger not running?**
Check that `enabled` is `true`, that Triggers are on in `/function`, that it has no error in the list, and that you are in a channel it is allowed in. Also check the cooldown: the default is 3 seconds per member.

**Do I have to quote IDs?**
Quoting is safest (`"123456789012345678"`), but unquoted IDs work too.

**Can I use the same name as a built-in command?**
No. Names like `help`, `q`, `gc` or `snipe` are taken and reported as errors.

**What happens to a trigger with an error?**
Only that trigger is skipped. The others keep working.

**What if I save broken YAML?**
It is saved anyway so you do not lose your work. The bot keeps using the last version it could read. After a bot restart that older version is gone from memory, so fix the YAML soon: until then no triggers run.

**Does `/triggers` change my comments?**
No. Only the `enabled:` value changes.

**Can I change a trigger from Discord?**
Only turn it on or off. Everything else is edited on the dashboard.

**What happened to my old triggers?**
They were converted to YAML automatically, with their on/off state kept, and the three examples (switched off) were added after them. The old data is kept untouched in the database.

**Why does `chance` not stop the role from being given?**
Because `chance` belongs to `response`. It only decides whether the bot answers.

**Does the `!command` need a space and a mention?**
Only if the trigger needs a target: write `!hire @user`.
