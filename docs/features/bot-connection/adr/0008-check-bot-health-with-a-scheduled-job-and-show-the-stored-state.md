---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0008 — Check bot health with a scheduled job and show the stored state

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

AC-15 says the bot's state, name and username are checked with Telegram in the background, are never more than 5 minutes old, and that a failed exchange with Telegram changes the state at once. AC-16 and AC-16b define the "not working — needs a new token" and "not receiving messages — another service took them over" states. `ux-flows.md` left open how an already open Bot settings page receives state changes, and whether reconnecting with the stored token re-checks it with Telegram first.

## Decision drivers

- Spec §6: Bot settings load p95 ≤ 300 ms; connect / rotate / disconnect p95 ≤ 3 s.
- AC-15 freshness (≤ 5 min) and "a failed exchange changes the state at once"; AC-16, AC-16b.
- Architecture map: pg-boss for scheduled work; one process in v1.
- workspace-operators precedent: changes are noticed on the next action, no push to idle screens.

## Considered options

1. **Scheduled pg-boss health checks; the page shows the stored state** — a cron job every minute enqueues a check for each connected or taken-over bot whose last check is at least 3 minutes old (with 10 s Bot API timeouts this keeps every bot's state under 5 minutes old — sad.md §8 freshness budget); the check calls `getMe` (identity, revoked or deleted → "needs a new token") and `getWebhookInfo` (registered URL not ours → "taken over"); settings load reads only the database; the page refreshes on load and after each action, with no push.
2. **Live check on every settings load** — the request calls Telegram before answering.
3. **Scheduled checks plus a live push to open pages** over the existing WebSocket.

## Decision outcome

**Chosen:** Option 1. A Telegram round-trip on every load would break the 300 ms load target and make the page as slow and flaky as Telegram; option 1 bounds staleness at about 5 minutes and keeps the load a database read. Every Bot API exchange (health check, connect, rotate, reconnect) writes its outcome back at once: an authorisation failure on the stored token moves the bot to "needs a new token", a foreign webhook URL to "taken over", a success to "connected" — transient failures (network, Telegram 5xx or 429) leave the state unchanged and retry on the next tick — Telegram being unreachable is not a failure of the bot (sad.md §1 ¶4 override of AC-15's wording). Push (option 3) is deferred: a stale open page is corrected by the next load or action, and an action on a stale page re-checks with Telegram anyway. Reconnect with the stored token always re-validates it with `getMe` first; a rejected token moves the bot to "needs a new token" and the owner is told to paste a new one.

## Consequences

**Positive**
- Settings load is one read per module; Telegram outages cannot slow the panel.
- One code path (the check outcome) owns every state transition caused by Telegram.

**Negative**
- An open page can show a state up to 5 minutes old plus the time it has been open; mitigated by re-checking on every action.
- During a Telegram outage checks fail transiently and the state can grow older than 5 minutes; the page shows when it was last checked (sad.md §11).

**Neutral**
- Proactive alerts to owners (spec §8 open question) can subscribe to the same state transitions later.

## Links

- Spec: [[../spec.md]] AC-15, AC-16, AC-16b; §6; §8
- UX flows: [[../ux-flows.md]] design inputs
- SAD: [[../sad.md]] §4, §6, §7
- Related ADR: [[0001-build-bot-connection-as-an-api-with-a-telegram-webhook-ingress-and-an-owner-only-panel-page]], [[0007-bind-a-bot-to-one-workspace-with-unique-constraints-and-two-controlled-tenancy-exceptions]]
