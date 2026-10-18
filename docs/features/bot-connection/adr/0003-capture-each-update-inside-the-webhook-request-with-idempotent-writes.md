---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0003 — Capture each update inside the webhook request with idempotent writes

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

When Telegram delivers an update, the message must end up in its conversation exactly once (AC-11), with a contact created or refreshed (AC-07, AC-08), within 2 s at p95, while Telegram expects a quick acknowledgement and redelivers anything not acknowledged with `2xx` for up to 24 h. The question is whether the webhook request does the capture itself or only hands the update to background processing.

## Decision drivers

- Spec §6: capture latency p95 ≤ 2 s; inbound acknowledgement p95 ≤ 300 ms; ≥ 50 inbound messages/s per instance; capture completeness 0 lost / 0 duplicated; flood isolation (one bot at 20 messages/s for 5 min keeps others ≤ 2 s p95).
- AC-11: redelivered messages are held once and take their original place.
- Architecture map: pg-boss is the async mechanism; no triggers or stored procedures.

## Considered options

1. **Synchronous idempotent capture in the webhook request** — one database transaction upserts the contact, upserts the conversation and inserts the message keyed by (conversation, Telegram message id) with `ON CONFLICT DO NOTHING`, then the request answers `200`; on any failure it answers `5xx` and Telegram redelivers.
2. **Durable raw-update inbox + background processor** — the request only inserts the raw update keyed by (bot, `update_id`) and answers `200`; a worker turns stored updates into contacts, conversations and messages.
3. **One pg-boss job per update** — the request enqueues a job and answers `200`; a worker captures it.

## Decision outcome

**Chosen:** Option 1. A capture transaction is a few small indexed writes — well inside the 300 ms acknowledgement budget — so the acknowledgement itself proves the message is stored, and Telegram's own redelivery replaces a home-grown retry queue. Capture latency is then bounded by delivery plus one transaction, far below 2 s. Options 2 and 3 add a second hop that must be ordered per chat, monitored for lag and drained fairly across bots to meet flood isolation; pg-boss jobs give no per-chat ordering. Flood isolation in option 1 comes from Telegram's per-bot `max_connections` (each bot has at most that many requests in flight, so one bot can hold at most that many database connections) and from the small transaction size; the flood load test verifies it.

Idempotency and order do not depend on arrival order: the unique key absorbs redeliveries and concurrent duplicates, and reads order messages by Telegram's message id (ADR-0004). Concurrent first messages from one person resolve through unique keys on (workspace, Telegram user id) for contacts and (workspace, contact) for conversations.

## Consequences

**Positive**
- `200` means captured: no lag metric, no dead-letter queue, no replay tooling.
- The 24 h redelivery window covers database outages shorter than a day (spec §6 completeness).

**Negative**
- Database latency adds directly to the acknowledgement time; a slow database delays Telegram's queue for that bot (Telegram retries, nothing is lost).
- Work that later grows per message (media download, notifications, live inbox push) must be queued from the capture transaction's outcome rather than added inline — a constraint on steps 4 and 6.

**Neutral**
- Moving to option 2 later means adding a raw-update table and a worker; the capture use case stays the same.

## Links

- Spec: [[../spec.md]] AC-07, AC-08, AC-11; §6
- SAD: [[../sad.md]] §4, §6, §10
- Related ADR: [[0002-receive-updates-through-one-webhook-per-bot-authenticated-by-a-per-bot-secret]], [[0004-order-messages-by-telegram-message-id-and-apply-edits-by-telegram-edit-time]], [[0005-split-the-feature-into-bots-conversations-and-contacts-modules]]
