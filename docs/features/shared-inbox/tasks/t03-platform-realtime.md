---
id: T3
title: "Build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync"
layer: "infra"
deps: []
blocks: ["T7", "T8", "T13", "T20"]
acs: ["AC-09", "AC-15"]
files_hint: ["apps/api/src/platform/realtime.ts", "apps/api/src/platform/realtime.int.test.ts", "apps/api/src/platform/realtime.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T3 — Build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync

## Place in the sequence

- **Blocked by:** — · **Blocks:** T7 — Give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09, T8 — Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10, T13 — Expose the inbox bot status to every member and publish bot.changed on every bot state transition, T20 — Add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync · **Wave:** 1 — nothing upstream.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It is the fan-out every live update rides on: a signal exists exactly when the change it announces committed.

## Inlined context

> **Fan-out through Postgres `LISTEN/NOTIFY`, published inside the writing transaction** — the module that commits a change (capture, edit, reply state, bot state, deactivation) emits a small `pg_notify` in the same transaction, so a signal exists exactly when the change committed; every API instance listens on one dedicated connection and forwards signals to its sockets of that workspace.
>
> — `sad.md §4, choice 2, abridged` · full text: [sad.md](../sad.md)

> Shape: one channel; payload JSON ≤ 1 kB holding only the workspace id, the signal type and ids (never text, names or tokens — Postgres caps payloads at 8 000 bytes, and signals feed the refetch path of ADR-0002). Publishing goes through a `platform/realtime` publisher that takes the caller's transaction, so modules stay unaware of `inbox`; the listener reconnects with backoff and, after a gap, tells the hub to ask every client to resynchronise.
>
> — `adr/0003, Decision outcome, verbatim` · full text: [ADR-0003](../adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md)

> | `conversation.changed` v1 | `workspace_id`, `conversation_id`, `item` (`type`, `id`) or null, `change`, plus `account_id` when `change` is `read` | every socket of `workspace_id`. A `read` signal goes only to the sockets of `account_id` |
> | `bot.changed` v1 | `workspace_id` | every socket of `workspace_id` |
> | `membership.deactivated` v1 | `workspace_id`, `account_id` | not forwarded. The hub closes that account's sockets of that workspace with `4403` |
>
> — `contracts/events.md §Channel: realtime signals, signal table, abridged` · full text: [events.md](../contracts/events.md)

> - **Validation:** a zod schema in `platform/realtime.ts`. The listener drops a payload that fails it and logs its type only.
>
> — `contracts/events.md §Channel: realtime signals, verbatim` · full text: [events.md](../contracts/events.md)

> one extra database connection per instance for `LISTEN` (outside the Kysely pool and pg-boss's own pool)
>
> — `sad.md §7, Deployment view, verbatim` · full text: [sad.md](../sad.md)

> pino via `platform/logger.ts`; existing redactions kept; reply text, message text and captions, file names, Telegram file paths and download URLs, the token and NOTIFY payloads are never logged — delivery and media logs carry ids, kinds, states and durations only; gateway errors are mapped to typed outcomes without copying Telegram's text
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (`NOTIFY` carries no storage — `data-model.md` intro.)

## API contract

Internal — no API surface. Channel `realtime`, three signal types above; the listener exposes `onSignal(handler)` and `onGap(handler)` to the `inbox` hub (T20).

## Acceptance criteria

### AC-09 — authorization

> **Given** an operator of "Acme Flowers" with the inbox open
> **When** a business owner deactivates their membership, or the operator switches to another workspace in that browser tab
> **Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment; switching affects only that tab — another tab of the same account still showing "Acme Flowers" keeps working; after deactivation, the member's replies still waiting to be retried are not sent and end "not delivered — the author's access was removed"
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Signal zod schemas (`conversation.changed`, `bot.changed`, `membership.deactivated`, all `v: 1`) — `apps/api/src/platform/realtime.ts`
- [ ] `publish(trx, signal)`: validates, serialises, `select pg_notify('realtime', $1)` on the caller's Kysely executor — `apps/api/src/platform/realtime.ts`
- [ ] `startRealtimeListener(connectionString, logger)`: one dedicated `pg.Client`, `LISTEN realtime`, parse + dispatch, reconnect with backoff, emit a gap event after every reconnect, `stop()` for `destroy()` — `apps/api/src/platform/realtime.ts`
- [ ] Unit test: payload schema + size guard (< 1 kB) — `apps/api/src/platform/realtime.test.ts`
- [ ] Integration test: a signal published in a committed transaction is received; one in a rolled-back transaction is not; a killed listener connection reconnects and reports a gap; an invalid payload is dropped and logged by type only — `apps/api/src/platform/realtime.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Writing transaction rolls back | no signal is delivered |
| Listener connection drops | reconnect with backoff; a gap event is emitted so the hub can send `resync` |
| Payload fails the schema | dropped, logged by its `type` only (never the payload) |
| Payload would exceed 1 kB | `publish` refuses it (programming error) |

## Definition of Done

- [ ] integration test proves commit-only delivery, rollback suppression, reconnect + gap event and invalid-payload drop
- [ ] no signal payload or log line carries text, names or tokens
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
