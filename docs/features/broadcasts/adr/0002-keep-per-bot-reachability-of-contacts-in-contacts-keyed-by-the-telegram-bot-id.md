---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0002 — Keep per-bot reachability of contacts in contacts, keyed by the Telegram bot id

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

A launch leaves out contacts who blocked the bot and contacts who never wrote to the **current bot** (AC-10, AC-14). Clarify fixed what "the bot" is: the Telegram bot itself, not its connection. Reconnecting the same Telegram bot keeps blocked marks and who wrote to it; connecting a different Telegram bot resets both. The blocked mark shows on the contact profile and the Contacts list (spec §1), so it is a fact about the contact. Today nothing records which bot a contact wrote through: `messages` and `contacts` carry no bot id. Telegram can deliver a block notice and a message out of order.

## Decision drivers

- AC-10, AC-14; spec §6 blocked state freshness ≤ 5 s
- One owner per table; the mark is shown by `contacts` reads
- No reset job and no cross-module hook on bot changes
- Out-of-order Telegram updates must not leave a wrong mark

## Considered options

1. **A `contacts` table keyed by (workspace, contact, Telegram bot id)** with `wrote_at`, `blocked_at` (null = not blocked) and `changed_at` (the Telegram time of the newest fact applied). Capture upserts "wrote" through `upsertFromProfile` (now given the bot's Telegram id) and clears a block when the message is newer. `bots` records block and unblock (ADR-0003). Every read is for the current Telegram bot, which `contacts` gets from a `currentBot` port that `buildDeps()` fills from `bots` (a runtime edge; `bots → contacts` stays the static one), or from the caller (`broadcasts` passes the bot it launched with).
2. **Columns on `contacts`** (`blocked_at`, `wrote_to_current_bot`), reset by the `bots` bot-connected hook when a different Telegram bot is connected. Simpler reads, but the reset is a bulk write inside the connect transaction, and history is lost: switching back to the earlier bot cannot know who wrote to it.
3. **Own the marks in `broadcasts`.** Broadcasts is their main reader, but capture (`conversations`) and `bots` would then write into `broadcasts`, and the Contacts list would need to read them back across a module that depends on `contacts`.

## Decision outcome

**Chosen:** Option 1. Keying by the Telegram bot id makes "same bot keeps, different bot resets" true by construction, with no reset job. A fact is applied only when its Telegram time is not older than `changed_at`, so an out-of-order block or message cannot flip the mark back. Migration backfills a "wrote" row for every contact that has written, for the workspace's current Telegram bot (an approximation for workspaces that changed bots, SAD §11).

## Consequences

**Positive**
- The breakdown "blocked / never wrote to the current bot / reachable" is one indexed join in `contacts` (ADR-0004).
- Blocked marks are visible on Contacts, in drafts and at each recipient's turn from one source.

**Negative**
- Capture writes one more row per new contact-and-bot pair (an upsert that is a no-op for later messages unless a block is cleared).
- A new runtime port `currentBot` in `contacts`.

**Neutral**
- Rows for an old bot stay. They are harmless and could be pruned later.

## Links

- Spec: [[../spec.md]] AC-10, AC-14, §1 clarifications ("The bot is the Telegram bot")
- SAD: [[../sad.md]] §4 choice 2, §5, §8
- Related ADR: [[0003-learn-blocks-from-my-chat-member-updates-and-refused-sends-in-bots-and-re-register-outdated-webhooks-in-the-health-check]]
