---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0007 — Record the waiting period start on the conversation in the writing transactions

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

Pings count from the start of a **waiting period** (AC-07, AC-08):
- it starts with the customer message that makes a conversation waiting, or with a reopen while the customer is still waiting;
- it ends when a reply is marked sent or the conversation is closed;
- a reassignment does not restart it;
- a member is pinged at most once per conversation per period;
- having read the messages holds a ping back only when the period began with a message.

Today "waiting for a reply" is derived at read time (the customer's last arrival after the last sent reply), and no period start or start kind is stored. `notifications` must read this through the `conversations` app layer.

## Decision drivers

- AC-07 / AC-08 period rules (reopen clock, read does not hold back after a reopen, reassignment keeps the clock)
- Spec §6 "≤ 1 per conversation per waiting period", so the period needs a stable identity for the ledger's unique key
- Spec §7 KPI "share of waiting periods ended by a sent reply within 15 min"
- assignment-statuses ADR-0004: state transitions happen inside the transactions that record their cause

## Considered options

1. **Store `waiting_since` and `waiting_started_by` (`message` / `reopen`) on `conversations`**, maintained in the transactions that cause the transitions: capture, reply marked sent, close, member reopen, failed-reply reopen. Backfilled from the current derived marker. `notifications` reads them through `conversations.waitingForPings`.
2. **Derive the period start at query time** from messages, replies and activity entries: the first customer arrival after the later of the last sent reply and the last close, or the reopen entry. No new column. But it is a three-table window query run every 20 s per workspace, it must reproduce the reopen rules exactly, and the ledger key would depend on a derived value that could shift if rows are corrected.
3. **Let `notifications` keep its own period table**, fed by events from `conversations`. That is decoupled, but it duplicates state that `conversations` already decides, and it can drift whenever an event is missed. It is also asynchronous, while the spec's reopen and close semantics are transactional.

## Decision outcome

**Chosen:** Option 1. The owner of the transitions records them where they happen, under the conversation row lock capture already takes. The period gets a stable identity (`waiting_since`) for the ledger's unique key, and the KPI becomes a simple query. The read stays a single-table, indexed scan.

## Consequences

**Positive**
- Due computation is cheap and exact. Read-holds-back is one comparison against the arrival of the message that began the wait.
- No new event plumbing between modules.

**Negative**
- Five write paths in `conversations` must keep the columns right. Each gets a unit test on the domain transition and an integration test.
- A migration with a backfill (expand, backfill, then use).

**Neutral**
- The derived "waiting" marker of shared-inbox can later be read from these columns. This feature does not change it.

## Links

- Spec: [[../spec.md]] AC-07, AC-08, AC-09, §7
- SAD: [[../sad.md]] §4 supporting choices, §5 table ownership, §8 Time
- Related ADR: [[0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send]], assignment-statuses ADR-0004
