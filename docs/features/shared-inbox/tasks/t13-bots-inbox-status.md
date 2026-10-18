---
id: T13
title: "Expose the inbox bot status to every member and publish bot.changed on every bot state transition"
layer: "app"
deps: ["T3"]
blocks: ["T16"]
acs: ["AC-13", "AC-14"]
files_hint: ["apps/api/src/modules/bots/app/inbox-status.ts", "apps/api/src/modules/bots/app/inbox-status.test.ts", "apps/api/src/modules/bots/app/paste-token.ts", "apps/api/src/modules/bots/app/reconnect.ts", "apps/api/src/modules/bots/app/disconnect.ts", "apps/api/src/modules/bots/app/health-check.ts", "apps/api/src/modules/bots/app/accept-update.ts", "apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T13 — Expose the inbox bot status to every member and publish bot.changed on every bot state transition

## Place in the sequence

- **Blocked by:** T3 — Build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync · **Blocks:** T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp · **Wave:** 2 — after T3.
- **Lane:** shares `modules/bots/app/ports.ts` / `fakes.ts` with T14, T15 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** the inbox to tell the whole team when the bot is not working or not receiving messages, and to point me to the bot settings
> **So that** nobody writes replies that cannot be delivered and I fix the connection quickly
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It lets the whole team see whether the bot can carry replies or is receiving, and tells every open inbox the moment that changes.

## Inlined context

> `bots` exposes a read-only "can the bot carry replies / is it receiving" view to any member (closes bot-connection §8 "should operators see the bot's state"); the bot settings stay owner-only. State changes are pushed as signals (choice 2), so a fixed bot re-enables replying without reload (AC-13).
>
> — `sad.md §4, Bot state for every member, verbatim` · full text: [sad.md](../sad.md)

> state: `bots.state`. No row and `disconnected` are both `not_connected`, as in bot-connection's `BotSettings`
> can_reply: True for `connected` and `taken_over`. It is the reply box's availability (AC-13, AC-14)
> receiving: True only for `connected`. False with `can_reply` true is the "not receiving messages" notice (AC-14)
>
> — `contracts/openapi.yaml, InboxBotStatus, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> It never carries the bot's name, the token or the secret.
>
> — `contracts/openapi.yaml, getInboxBotStatus, verbatim` · full text: [openapi.yaml](../contracts/openapi.yaml)

> Publishing goes through a `platform/realtime` publisher that takes the caller's transaction, so modules stay unaware of `inbox`
>
> — `adr/0003, Decision outcome, abridged` · full text: [ADR-0003](../adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md)

> Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts`.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (Reads `bots.state` by `workspace_id`.)

## API contract

Internal — no API surface here; `inboxBotStatus(workspaceId)` → `{ workspace_id, state, can_reply, receiving }` is served by `getInboxBotStatus` in T16. Signal `bot.changed { workspace_id }` (`events.md`).

## Acceptance criteria

### AC-13 — cross-context

> **Given** the bot of "Acme Flowers" is not connected, or is in the state "not working — needs a new token"
> **When** an operator or business owner opens the inbox or a conversation
> **Then** every conversation stays readable, the reply box is unavailable and explains that replies cannot be sent until the bot works again — a business owner gets the way to the bot settings, an operator is told to ask a business owner; a reply still "sending" when the bot stops working ends up "not delivered — the bot is not working"; once a business owner fixes the bot — the same bot, since a workspace keeps one business bot once customers have written to it (bot-connection AC-05) — replying works again without reloading
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** the bot of "Acme Flowers" is in the state "not receiving messages — another service took them over"
> **When** any member opens the inbox
> **Then** the inbox shows every member a notice that customers' new messages are not arriving in tg-inbox until a business owner reconnects the bot (with the way to the bot settings for owners); replies can still be sent, and each one shows the same notice next to its delivery state
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `inboxBotStatus(workspaceId)` mapping `connected → (true, true)`, `taken_over → (true, false)`, `needs_token`/`disconnected`/no row → `can_reply: false, receiving: false` with `needs_token` / `not_connected` — `modules/bots/app/inbox-status.ts`
- [ ] `canCarryReplies(workspaceId)` for the send pre-checks — same file
- [ ] Publish `bot.changed` in the transaction of every state write: paste, reconnect, disconnect, takeover, health-check transitions, 401 found by a send — `modules/bots/app/*.ts`
- [ ] Unit tests for the mapping; integration test that each transition publishes once on commit — `modules/bots/app/inbox-status.test.ts`, `*.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| No bot row | `not_connected`, `can_reply: false` |
| `taken_over` | `can_reply: true`, `receiving: false` (AC-14) |
| Health check finds no change | no signal |

## Definition of Done

- [ ] unit tests prove the four-state mapping; integration tests prove each bot state transition publishes `bot.changed` exactly once on commit
- [ ] the status never contains the bot name, token or secret (asserted)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
