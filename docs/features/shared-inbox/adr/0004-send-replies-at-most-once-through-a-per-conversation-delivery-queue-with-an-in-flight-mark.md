---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0004 — Send replies at most once through a per-conversation delivery queue with an in-flight mark

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

A reply must reach the customer at most once (AC-11, spec §6 "0 replies delivered twice"), in the order written within its conversation, with later replies waiting while an earlier one is still sending and other conversations not held up (AC-12). Telegram refusals are retried automatically for up to 5 minutes; a send whose answer never came back is never retried on its own ("not confirmed"); blocked bots, gone accounts, a broken bot and a deactivated author each end in their own "not delivered" reason (AC-09, AC-10, AC-13). Telegram's `sendMessage` has no idempotency key, so a retried request after a lost answer can duplicate a message.

## Decision drivers

- Spec §6: duplicate replies = 0 without an explicit "send again"; reply latency p95 ≤ 2 s (Telegram healthy).
- AC-11 (double press, lost connection, unknown outcome), AC-12 (retry window, per-conversation order), AC-10, AC-13, AC-09.
- Spec §6.1: never send faster than Telegram allows per chat — the drain keeps ≥ 1 s between sends to one chat and honours `retry_after`.
- pg-boss is the decided job runner; `exclusive`/singleton keys are the repo's precedent for per-entity serialisation.

## Considered options

1. **Per-conversation delivery queue with an in-flight mark** — the reply, its member-initiated attempt row and the drain job are written in one transaction, the reply "sending" under a client reply key (unique per conversation); a pg-boss drain job keyed by the conversation id (`stately`: at most one running and one waiting per conversation) sends that conversation's pending replies oldest first; each attempt is committed as "in flight" before the Telegram call and resolved after it.
2. **Send inline in the reply request, queue only the retries** — the request calls Telegram and answers with the outcome; transient refusals go to a retry job.

## Decision outcome

**Chosen:** Option 1. It gives one code path for first sends and retries, keeps per-conversation order without blocking other conversations, and survives the author's tab closing or the request timing out — option 2 races its inline send against the retry job for ordering and turns an HTTP timeout into an ambiguous duplicate risk on the request path.

Outcome rules (the gateway classifies every `sendMessage` answer):
- accepted → "sent", with Telegram's message id and our clock (the time the answer came back — Telegram's `date` has whole seconds only and would sort a reply before the customer message it answers); the conversation's activity and "waiting" columns update in the same transaction;
- 403 blocked / account deactivated, 400 chat not found → "not delivered" with that reason, no retry; the drain continues with the next reply;
- the bot is not connected or needs a new token (checked before each attempt, or Telegram answers 401) → "not delivered — the bot is not working"; the author's membership is no longer active (checked before each attempt) → "not delivered — the author's access was removed";
- 429 (with `retry_after`), 5xx, or a connection refused before the request was sent → the attempt is recorded, the reply stays "sending" and the drain re-schedules itself after the back-off (honouring `retry_after`), stopping so later replies of the conversation wait; once 5 minutes have passed since the reply was (re)sent by a member → "not delivered — Telegram did not accept it";
- timeout (10 s), a reset connection after the request was written, or an "in flight" attempt older than the timeout found by a later drain (the process died mid-call; the drain queue keeps `retryLimit` 3 so pg-boss re-runs an expired job — retries exist for crashes only, Telegram back-off is a new delayed job) → "not confirmed"; never retried automatically; the drain continues.

A double press reuses the client reply key and gets the same reply back. "Try again" re-queues a not-delivered reply; "send again" re-queues a not-confirmed one only with the duplicate-risk confirmation; both move it to the end of the thread and restart its 5-minute window. Every attempt is a row in the reply attempts log (who initiated it — a member or the automatic retry — and its outcome), which also feeds the per-member limit (§4) and the duplicate reconciliation of spec §6.

## Consequences

**Positive**
- At most once by construction: no code path re-sends an attempt whose outcome is unknown.
- Order per conversation, isolation between conversations, and delivery independent of the browser.

**Negative**
- Job pickup adds latency to every send; the queue's polling interval must stay at its minimum (0.5 s) to keep p95 ≤ 2 s — §10 verifies it.
- A slow Telegram answer (up to the 10 s timeout) holds that conversation's later replies.

**Neutral**
- A "not confirmed" reply may in fact have arrived; the member decides (AC-11). If Telegram ever adds idempotent sends, the "unknown" branch could retry instead.

## Links

- Spec: [[../spec.md]] AC-06, AC-09, AC-10, AC-11, AC-12, AC-12b, AC-13; §6; §6.1
- UX flows: [[../ux-flows.md]] flow US-05
- SAD: [[../sad.md]] §4, §6, §8, §10, §11
- Related ADR: [[0008-store-replies-in-their-own-table-and-page-the-thread-by-position-time]], [[0001-build-the-inbox-as-api-routes-a-live-socket-and-in-process-delivery-jobs-behind-the-existing-spa]]
