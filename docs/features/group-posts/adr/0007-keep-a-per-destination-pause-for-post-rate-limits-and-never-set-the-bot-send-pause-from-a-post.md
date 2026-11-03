---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0007 — Keep a per-destination pause for post rate limits and never set the bot send pause from a post

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

Telegram limits a bot to about 20 messages per minute into one group, on top of ~30 per second overall, and answers both with `429` + `retry_after`. Today any `429` stores the bot's `send_paused_until`, which pings, broadcasts and bot answers wait for (CONTEXT "Send pause"). A post hitting one group's limit would stall all of them (spec devil's-advocate: rate-limit coupling).

## Decision drivers

- Spec AC-17 and Clarifications: a per-chat limit delays only posts to that chat and sets no send pause; posts still wait for a send pause set by any other send.
- Spec §6: ≤ 1 post per 3 s into one chat; replies unaffected.

## Considered options

1. **Destination pause in the database** — a `429` to a post stores `destinations.paused_until` and re-queues that post; `destinations.next_send_at` (last send + 3 s) spaces posts to one chat; a new keyed pacer `POST_MESSAGES_PER_SECOND = 1` spaces posts per bot; the bot's `send_paused_until` is checked before sending.
2. **Destination pause in memory** — the same rules kept in an in-process map keyed by chat (as the send-pause echo), nothing stored.
3. **One serial queue per destination** — a `stately` queue keyed by destination id sends that chat's posts one by one, sleeping through limits.

## Decision outcome

**Chosen:** Option 1. Option 2 forgets a pause on restart and cannot be seen by the job that runs next on another tick. Option 3 holds a job open through a pause that can last minutes, against the 60 s job expiry, and a stately queue cannot take an earlier post behind a queued later one (the ADR-0004 reason).

## Consequences

**Positive**
- A busy destination never slows pings or broadcasts.

**Negative**
- A genuine bot-wide flood seen first by a post is not shared with other senders (they learn it from their own `429`).

**Neutral**
- The pause wait counts against the post's 15-minute window; past it the post is missed with "Telegram limited posting to this chat".

## Links

- Spec: [[../spec.md]] AC-12, AC-17, §6
- SAD: [[../sad.md]] §4, §11
- Related ADR: [[0004-send-each-post-through-its-own-pg-boss-job-that-claims-the-post-before-the-send]]
