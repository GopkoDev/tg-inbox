---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0003 — Learn blocks from my_chat_member updates and refused sends in bots, and re-register outdated webhooks in the health check

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

AC-14 marks a contact as blocked when they block the bot in Telegram, or when a broadcast or reply to them is refused for that reason, and unmarks them when they unblock or write again. Blocking must never create a message, open a conversation, move unread or trigger a ping. Telegram tells a bot about a private block or unblock only through `my_chat_member` updates, and only if the webhook's `allowed_updates` names that type. Today `bots` registers `message` and `edited_message` only, and calls `setWebhook` only at connect, rotation and reconnect. Every live bot is health-checked every 3 minutes (`getMe` + `getWebhookInfo`).

## Decision drivers

- AC-14; spec §6 blocked state freshness p95 ≤ 5 s
- `bots` is the only module that talks to Telegram and the one that classifies updates
- Already-connected pilot bots must start receiving block notices without owner action

## Considered options

1. **`my_chat_member` + refused sends, with the health check fixing allowed updates.** `allowed_updates` becomes `message`, `edited_message`, `my_chat_member`. `classifyUpdate` returns a new decision `reach` for a private-chat `my_chat_member` from a human user (`kicked` → blocked, `member` → unblocked, at the update's `date`), which `accept` hands to `contacts.recordBlockChange`; it never goes to the interceptor or to capture. `sendText` and `sendBroadcastMessage` record a block when Telegram refuses a customer chat as blocked. The health check compares the webhook's reported `allowed_updates` with the expected set and, when the URL is ours but the set is outdated, calls `setWebhook` again with the same URL and secret, keeping pending updates.
2. **Refused sends only.** No webhook change. But a block is then learned only when someone sends to that contact, so drafts and Contacts would show stale reachability and a launch would include contacts known to Telegram as blocked.
3. **A one-off re-registration at deploy** (a migration script or a CLI command) instead of the health check. It needs an operational step outside the code path and misses bots that reconnect from an old token flow.

## Decision outcome

**Chosen:** Option 1. The block notice arrives through the authenticated webhook within the same request handling as a message, which meets the 5 s target. Refused sends cover blocks that happened before the webhook knew. The health check already holds the token and the derived secret, and it reaches every live bot within 3 minutes, so the rollout needs no manual step.

## Consequences

**Positive**
- Blocked state is fresh without sends, and a refused reply also marks the contact.
- No owner action after the deploy.

**Negative**
- One more update type through the webhook (rare: one per block or unblock).
- The health check gains a write path (`setWebhook`) that runs once per bot after the deploy.

**Neutral**
- A linked member's own block of the bot is recorded only if that person is also a contact; otherwise it finds no contact and is dropped.

## Links

- Spec: [[../spec.md]] AC-14, §6 blocked state freshness
- SAD: [[../sad.md]] §4 choice 3, §6 flow 3
- Related ADR: [[0002-keep-per-bot-reachability-of-contacts-in-contacts-keyed-by-the-telegram-bot-id]], bot-connection ADRs on the webhook secret
