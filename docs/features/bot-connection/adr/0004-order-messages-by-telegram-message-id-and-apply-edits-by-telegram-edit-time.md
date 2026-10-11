---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0004 — Order messages by Telegram message id and apply edits by Telegram edit time

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

Telegram may deliver updates for one bot over several parallel connections and redeliver older ones after a failure, so arrival order is not the order the customer wrote in. AC-11 requires Telegram's order for that chat, with late redeliveries taking their original place; AC-10 requires the customer's last edit (by Telegram's edit time) to win, ignores edits of messages never captured, and AC-09 requires each album item to be its own message. The inbox (roadmap step 4) will read conversations in this order, so the sort key is a contract other modules depend on.

## Decision drivers

- AC-09, AC-10, AC-11; spec §6 capture completeness (0 duplicated).
- Synchronous, possibly concurrent capture (ADR-0003) — no single-writer ordering stage exists.
- Telegram message ids are unique and increasing within one private chat; Telegram dates have one-second resolution.

## Considered options

1. **Telegram's message id as the order key; edits applied by Telegram's edit time** — each message stores the Telegram message id (unique per conversation), the send time and the receive time; reads order by message id; an edit updates the text only when its `edit_date` is later than the stored one (ties broken by the larger `update_id`).
2. **Arrival order** — order by the time tg-inbox received the message; edits applied as they arrive.
3. **Telegram send time** — order by `date`, tie-broken by arrival.

## Decision outcome

**Chosen:** Option 1. It is the only key that is exact, stable under redelivery and parallel delivery, and identical to what the customer sees in Telegram. Option 2 breaks AC-11 by definition. Option 3 cannot order several messages sent within the same second (common for albums and quick bursts). The edit rule is a conditional update, so concurrent or out-of-order edits converge on the last one; an edit whose message is not stored matches no row and is dropped, as AC-10 requires. Shared live-location updates arrive as edits without text and change nothing (AC-09).

## Consequences

**Positive**
- Order and edits are correct regardless of delivery concurrency; no locking across messages.
- The inbox can paginate by (conversation, message id).

**Negative**
- Order is defined per chat only; ordering across conversations (an inbox list) uses the receive or send time — a separate key for step 4.

**Neutral**
- Operator replies (step 4) will also receive Telegram message ids from `sendMessage`, so they fit the same order key.

## Links

- Spec: [[../spec.md]] AC-09, AC-10, AC-11
- SAD: [[../sad.md]] §4, §8
- Related ADR: [[0003-capture-each-update-inside-the-webhook-request-with-idempotent-writes]]
