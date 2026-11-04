---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0002 — Connect a destination by a hashed single-use code received as a bot command or channel post

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

The sharpest failure found for this feature is a post landing in the wrong chat (spec §1, §6.1): anyone who knows the bot's username can add it to a group, and a lookalike chat can carry the business's name. The Bot API cannot list a bot's chats, and the "bot added" event (`my_chat_member`) is lost if the bot was added before it was connected or while the webhook was down.

## Decision drivers

- Spec AC-01, AC-02: a chat becomes a destination only through an owner's single-use 10-minute code; a chat the bot was merely added to never does.
- Spec §6 destination connect p95 ≤ 5 s.
- Existing pattern: notifications' connect link (hashed token, 10 minutes, single use, advisory lock).

## Considered options

1. **Code posted in the chat** — the owner creates a code (`tgp_` + random, only its hash stored, 10 minutes, single use); in a group it is a command addressed to the bot (`/connect@<bot> tgp_…`, delivered even with privacy mode on), in a channel any channel post containing it (only admins with the right to post can post). The bot deletes the code message when allowed.
2. **Add-to-chat deep link** — the panel shows Telegram's `t.me/<bot>?startgroup=tgp_…` / `?startchannel` link; adding the bot through it delivers `/start tgp_…` in a group, and the code is matched as in option 1.
3. **Code sent to the bot privately by the chat's admin** — the owner forwards a message from the chat to the bot together with the code, and tg-inbox reads the forward origin.

## Decision outcome

**Chosen:** Option 1. Posting the code proves both that the chat is the owner's and that someone who can post there acted, and works whenever the bot was added. Option 2 works only when the bot is added through the link (not for a bot already in the chat, which is the common case after bot-connection) and a channel add delivers no start payload. Option 3 depends on forward metadata that a channel or group can hide (forward restrictions) and mixes the private chat path, which is reserved for customers and member links.

## Consequences

**Positive**
- No wrong-chat connect without the owner's code; no dependency on a missed add event.
- Reuses the connect-link shape (hash, TTL, advisory lock, live result).

**Negative**
- One more step for the owner (post a message in Telegram); the dialog must explain the group vs channel form.
- `channel_post` must be added to `allowed_updates`; channels connect only after each bot's webhook is re-registered (≤ 3 minutes after the deploy).

**Neutral**
- A code posted in a chat already known to the workspace revives that destination (spec Clarifications).

## Links

- Spec: [[../spec.md]] US-01, AC-01, AC-02, §6.1
- SAD: [[../sad.md]] §4, §6 flow 1
- Related ADR: [[0003-classify-group-and-channel-updates-in-bots-and-hand-only-codes-membership-upgrades-and-renames-to-posts]]
