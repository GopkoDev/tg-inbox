---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0008 — Delete a published post through the bot within 48 hours and keep the post as a deleted record

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

Published posts are read-only in this step, and a wrong post in a public chat is the costliest mistake (spec devil's-advocate). Telegram lets a bot delete its own message in a group or channel for 48 hours.

## Decision drivers

- Spec AC-15, US-06: an owner deletes a published post within 48 hours; the panel keeps it as deleted with who and when.
- Spec AC-18: published, failed, missed posts stay as records.

## Considered options

1. **Delete through the bot, keep the row** — `bots.deletePost` calls `deleteMessage` with the stored message id; on success the post becomes `deleted` (by, at), text kept; past 48 h the server refuses before calling Telegram; Telegram's refusal is shown as "the bot can no longer delete it".
2. **Delete through a job with retries** — the owner's request marks the post `deleting` and a job calls Telegram, retrying on errors, then marks it deleted.

## Decision outcome

**Chosen:** Option 1. It is the only brake for a post that went out wrong, and the kept row preserves who posted what. Option 2 hides Telegram's answer from the owner who asked (a refusal past 48 hours or for missing rights would arrive later, after the dialog closed); a synchronous call answers in the dialog and a deletion needs no at-least-once retry.

## Consequences

**Positive**
- A safety brake mirroring broadcasts' stop.

**Negative**
- `deleteMessage` is a new gateway method and fake-Telegram method.

**Neutral**
- A deleted post still counts toward the daily limit (it was sent).

## Links

- Spec: [[../spec.md]] US-06, AC-15
- SAD: [[../sad.md]] §4
