---
id: T7
title: "Give bots sendMemberMessage (paced, behind the send pause, with a blocked outcome) and pingReadiness, and store the send pause on any 429"
layer: "app"
deps: ["T1"]
blocks: ["T15", "T16"]
acs: ["AC-10"]
files_hint: ["apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/modules/bots/app/send-member-message.ts", "apps/api/src/modules/bots/app/send-member-message.test.ts", "apps/api/src/modules/bots/app/ping-readiness.ts", "apps/api/src/modules/bots/app/send-text.ts", "apps/api/src/modules/bots/infra/bot-repo.ts", "apps/api/src/test/fake-telegram.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T7 — Give bots sendMemberMessage (paced, behind the send pause, with a blocked outcome) and pingReadiness, and store the send pause on any 429

## Place in the sequence

- **Blocked by:** T1 — Promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures · **Blocks:** T15 — Add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id, T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction · **Wave:** 2 — after T1.
- **Lane:** shares `apps/api/src/deps.ts` with T12; shares `apps/api/src/deps.ts` with T14; shares `apps/api/src/deps.ts` with T18; shares `apps/api/src/deps.ts` with T19; shares `apps/api/src/deps.ts` with T20 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It lets pings and answers reach a member's chat without ever crowding out a customer reply.

## Inlined context

> **Chosen:** Option 1. With pings capped at 10 per second, 50 due pings take 5 s and use a third of the budget. Replies keep their ~20 per second headroom and their p95, which the load test in SAD §10 verifies. The `429` pause gives AC-10's "replies go first" without touching the reply path. Telegram's own answer is the signal, so no estimate of the true limit is needed. A ping Telegram did not accept is not counted, so nothing is lost. It is combined into the next one.
>
> — `adr/0006-pace-pings-below-a-per-bot-share-of-the-telegram-limit-and-pause-them-on-any-rate-limit-answer.md §Decision outcome, ADR-0006, verbatim` · full text: [ADR-0006](../adr/0006-pace-pings-below-a-per-bot-share-of-the-telegram-limit-and-pause-them-on-any-rate-limit-answer.md)

> Pings and bot answers go out through a new `bots.sendMemberMessage`, never through `sendText`. A workspace's sends are serialised by its singleton job and paced at 10 per second at most, a third of Telegram's roughly 30 per second per bot. Any `429` on this bot, from a reply or from a ping, stores `send_paused_until` on the bot row. `sendMemberMessage` refuses while that time is in the future, and the reply path never consults it.
> `403` (the member blocked the bot) maps to `blocked` […] `transient` (a timeout or network failure after the request may have reached Telegram) is recorded as `failed` and counts
>
> — `sad.md §4, Supporting choices, pacing, abridged` · full text: [sad.md](../sad.md)

> - `pingReadiness(workspaceId)`, which returns state, Telegram bot id, username and `send_paused_until`;
> - `sendMemberMessage({ workspaceId, telegramUserId, text })`, which returns `accepted` | `blocked` | `rate_limited(retryAfter)` | `bot_unavailable` | `transient`.
>
> — `sad.md §5, notifications → bots, verbatim` · full text: [sad.md](../sad.md)

> | `telegram-gateway` does not yet map `403` "blocked by the user" or store a `429` pause. | Low | New mappings in `bots/infra`, with fake Bot API scripts for both. | Tech Lead |
>
> — `sad.md §11, gateway mappings, verbatim` · full text: [sad.md](../sad.md)

> - **Telegram:** all Bot API calls go through `telegramApi(token, { apiRoot })` in `src/platform/telegram.ts` (via the `bots` gateway). Each bot's webhook is `POST /api/telegram/webhook/:botId`, authenticated by `X-Telegram-Bot-Api-Secret-Token` (a per-bot derived secret, only its hash stored, checked before the body is parsed; the header is redacted from logs). Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts` (scriptable `sendMessage`, `getFile`, file download). Replies go out only via `deps.bots.sendText`, customer media streams via `deps.bots.openMedia` — the token never leaves `bots`.
>
> — `CLAUDE.md §Rules, Telegram, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Change |
|---|---|---|---|
| `bots.send_paused_until` | timestamptz | NULL | written on any `429` (`now + retry_after`, later value kept); read by `pingReadiness` |

— `data-model.md §Entities bots, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. Bot tokens stay inside `bots`; `sendMemberMessage` takes a workspace id, a Telegram user id and text.

## Acceptance criteria

### AC-10 — cross-context

> **Given** a conversation of "Acme Flowers" whose ping is due
> **When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
> **Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, no ping is sent and none is queued for later, and the member's panel shows "Pings paused — the bot is not working". Once the bot works again, conversations whose customers are still waiting and that were not pinged to a member in their current waiting period become due for that member again. They go out combined, under the one-per-10-minutes limit (AC-08), and the 30-minute team reach continues from the start of each wait. When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. Pings to that member are still attempted when due. A failed attempt counts as that conversation's ping for this member in the waiting period and is not retried. A deactivated member's link is removed. A link made with the workspace's previous bot is removed when a different bot is connected, and its member sees "Not connected". A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Gateway: map `403` «bot was blocked by the user» to `blocked`; return `retry_after` on `429` — `apps/api/src/modules/bots/infra/telegram-gateway.ts`
- [ ] `sendMemberMessage({ workspaceId, telegramUserId, text })` → `accepted | blocked | rate_limited(retryAfter) | bot_unavailable | transient`; refuses while paused; link preview off, no parse mode; 401 → `markNeedsToken` and `bot_unavailable` — `apps/api/src/modules/bots/app/send-member-message.ts`
- [ ] Per-bot pacer ≤ 10 sends per second (in-process, keyed by bot) — same file
- [ ] `pingReadiness(workspaceId)` → `{ state, telegramBotId, username, sendPausedUntil }` — `apps/api/src/modules/bots/app/ping-readiness.ts`
- [ ] Reply path (`sendText`) stores the pause on `429` but never reads it — `apps/api/src/modules/bots/app/send-text.ts`, `apps/api/src/modules/bots/infra/bot-repo.ts`
- [ ] Fake Bot API scripts for `403` blocked and `429` with `retry_after` — `apps/api/src/test/fake-telegram.ts`
- [ ] Wire into the bots object in `buildDeps()` — `apps/api/src/deps.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `429` while a pause is already later | keep the later `send_paused_until` |
| Bot `taken_over` | can still send (shared-inbox AC-14) |
| Bot `needs_token` or no row | `bot_unavailable`, no Telegram call |
| A reply during a stored pause | sent as today, pause not consulted |
| Timeout after the request left | `transient` |

## Definition of Done

- [ ] Unit and integration tests against the fake Bot API prove sendMemberMessage maps accepted, 403 blocked, 429 with the stored pause, 401 bot unavailable and timeouts, refuses while paused, paces at most 10 per second per bot, pingReadiness returns state, bot id, username and pause, and a reply's 429 stores the pause while replies never read it.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
