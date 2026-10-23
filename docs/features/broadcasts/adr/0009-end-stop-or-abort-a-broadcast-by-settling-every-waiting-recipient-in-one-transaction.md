---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0009 — End, stop or abort a broadcast by settling every waiting recipient in one transaction

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

A broadcast leaves `sending` in three ways. It is **sent** when every recipient has an outcome (AC-11). A business owner **stops** it: no new send starts after the confirmation, sends in flight finish and are recorded, every waiting recipient becomes "not sent — stopped", and a stop after the last outcome changes nothing (AC-18, spec §6 stop takes effect: 0 sends started more than 2 s after the stop). It is **aborted** when Telegram refuses the text itself or the bot stops working, is disconnected or replaced: every waiting recipient fails with that reason, the broadcast becomes "sent", and nothing of it is sent later (AC-12). Any other Telegram refusal fails only its recipient, without a retry (AC-11).

## Decision drivers

- AC-11, AC-12, AC-18; spec §6 stop takes effect, at most once
- Claims are single-row conditional updates (ADR-0007)
- A clear split between recipient-level and broadcast-level failures

## Considered options

1. **Settle in one transaction under the broadcast row lock.** Stop: membership `FOR SHARE` (an active owner) → broadcast row `FOR NO KEY UPDATE`; if it is `sending` and has waiting recipients, set every `waiting` recipient to `stopped` and the broadcast to `stopped` (who, when); otherwise no change (a later finish makes it `sent`). Abort (by the sender, on `text_refused`, `bot_unavailable` or `bot_changed`): the same update with outcome `failed` and reason `text_refused` ("Telegram refused the text") or `bot_stopped` ("the bot stopped working", for both `bot_unavailable` and `bot_changed`), broadcast `sent` with its finish time. Finish (by the sender, when nothing is waiting or in flight): broadcast `sent`. A claim is `UPDATE … SET state = 'sending' WHERE id = … AND state = 'waiting'`, so once a settling transaction commits, no recipient of it can be claimed. Telegram answers map to: `blocked` → outcome blocked; `account_gone` → failed "account no longer exists"; `chat_not_found` → failed "chat not found"; other error answers without `retry_after` → failed "Telegram error"; timeout or lost connection → not confirmed; `429` → back to `waiting` (nothing was sent); a `400` whose description is about the text (too long, empty, cannot be parsed) → `text_refused`, which aborts.
2. **A cancellation flag the sender polls.** The stop writes a flag and the sender settles the waiting ones later. A crash between the two leaves a "stopped" broadcast with waiting recipients and an unclear report, and "no send starts after the stop" depends on polling timing.
3. **Settle lazily at the end** (leave waiting rows and show them as stopped in reads). No bulk write, but the report and the duplicate's "did not reach" set would depend on derived states, and the integrity query could not tell a stuck recipient from a stopped one.

## Decision outcome

**Chosen:** Option 1. A row-level race decides each recipient exactly once: either the claim wins (the send was already decided and finishes) or the settle wins (it is never claimed). That gives "no new send after the stop" at the commit, far inside 2 s, with no polling. Telegram's answer decides whether a failure belongs to one recipient or to the text, so a bad chat never ends a broadcast and a refused text never fails thousands one by one.

## Consequences

**Positive**
- The report has a final state per recipient; "only recipients it did not reach" reads stored outcomes.
- Stop and abort are idempotent and safe to retry.

**Negative**
- Telling a text refusal from a chat refusal relies on Telegram's `400` description; an unknown `400` text is treated as a text refusal (the safe side: it stops instead of spamming refusals).
- Settling up to 10 000 rows is one bulk update under the broadcast row lock.

**Neutral**
- The stop confirmation's waiting count can be stale; the stop needs no second confirmation (ux-flows).

## Links

- Spec: [[../spec.md]] AC-11, AC-12, AC-18, §6 stop takes effect
- SAD: [[../sad.md]] §4 choice 9, §6 flow 4, §8
- Related ADR: [[0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send]], [[0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause]]
