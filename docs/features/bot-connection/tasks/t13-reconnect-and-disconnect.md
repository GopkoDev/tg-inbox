---
id: T13
title: "Implement the bots use cases reconnect-with-stored-token and disconnect"
layer: "app"
deps: ["T12"]
blocks: ["T16"]
acs: ["AC-05", "AC-06", "AC-16b", "AC-18"]
files_hint: ["apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/reconnect.ts", "apps/api/src/modules/bots/app/disconnect.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T13 — Implement the bots use cases reconnect-with-stored-token and disconnect

## Place in the sequence

- **Blocked by:** T12 — settings builder, fakes, paste use case · **Blocks:** T16 — Expose the owner-only bot routes and wire the bots, conversations and contacts modules into buildDeps / buildApp · **Wave:** 5.
- **Lane:** shares `modules/bots/app/ports.ts` with T10–T12, T14, T15 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task lets an owner win the bot back from another service without a paste, and disconnect without losing what was captured.

## Inlined context

> alt no bot or state is not taken over → nothing to reconnect · else getMe with the stored token: Telegram rejects → state needs a new token, checked now → token not valid, paste a new one · transient → Telegram unavailable, nothing changed · bot info → getWebhookInfo: another service's and no confirmation → confirmation required · already ours, or confirmed → setWebhook with our URL, the stored secret, allowed updates, keeping pending updates; fails → Telegram unavailable, state stays taken over; registered → state connected, refresh name and username, checked now (capture epoch kept)
> Unlike flow 5, the row is written only after `setWebhook` succeeds, because the token and secret do not change — there is nothing to restore.
>
> — `sad.md §6, Flow 6, abridged` · full text: [sad.md](../sad.md)

> read the bot row and decrypt its token · no bot connected → refusal with the current settings · getWebhookInfo with the stored token: transient → Telegram unavailable, nothing changed · rejects the token → the token is dead, disconnect proceeds · ours → deleteWebhook dropping pending updates · another service's or empty → never remove another service's webhook, disconnect proceeds · has conversations → clear the token and the secret hash, state not connected (row kept so the bot stays bound) · nothing captured → delete the bot row
>
> — `sad.md §6, Flow 7, abridged` · full text: [sad.md](../sad.md)

> Reconnect with the stored token always re-validates it with `getMe` first; a rejected token moves the bot to "needs a new token" and the owner is told to paste a new one.
>
> — `adr/0008, Decision outcome, abridged` · full text: [ADR-0008](../adr/0008-check-bot-health-with-a-scheduled-job-and-show-the-stored-state.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Branch | `bots` write |
|---|---|
| reconnect rejected | `state=needs_token`, `last_checked_at=now` |
| reconnect registered | `state=connected`, name/username, `last_checked_at=now`; token, secret, `connected_at` kept |
| disconnect, conversations exist | `state=disconnected`, `token_encrypted=null`, `webhook_secret_hash=null`, `connected_at=null` |
| disconnect, nothing captured | row deleted |

— `data-model.md §Entities, bots (Lifecycle), abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `reconnectBot({ confirm_takeover })` → `BotSettings` · `409 NOTHING_TO_RECONNECT {settings}` · `409 BOT_NEEDS_NEW_TOKEN {settings}` · `409 TAKEOVER_CONFIRMATION_REQUIRED {bot}` · `503 TELEGRAM_UNAVAILABLE`.
- `disconnectBot` → `BotSettings {state: not_connected}` · `409 NO_BOT_CONNECTED {settings}` · `503 TELEGRAM_UNAVAILABLE`.

— `contracts/openapi.yaml, operationIds reconnectBot + disconnectBot, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-05 — domain invariant

> **Given** "Acme Flowers" has a connected bot, or has captured conversations through a bot it later disconnected
> **When** a business owner pastes the token of a different bot
> **Then** the system refuses and explains that a workspace keeps one business bot — while connected, disconnect it first; once customers have written to it, the workspace stays with that bot (its customers know only that bot)
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — cross-context

> **Given** a business owner of "Acme Flowers" pasting a valid token of a bot that, according to Telegram, currently delivers its messages to another address (another service); a service that instead fetches the bot's messages itself is not visible to tg-inbox and gets no warning
> **When** the system checks the token
> **Then** before connecting, it warns the owner that connecting will stop that bot delivering messages to the other service, and connects only after the owner confirms
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-16b — cross-context

> **Given** a connected bot of "Acme Flowers" whose messages another service has since taken over
> **When** a business owner opens the bot settings and then chooses to reconnect the bot (with the token already stored — no paste needed; pasting that same token again does the same)
> **Then** the settings show the state "not receiving messages — another service took them over"; on reconnecting, the system gives the warning of AC-06, and after the owner confirms the bot is connected again and new messages are captured into their existing conversations; messages the other service received meanwhile are not recovered
>
> — `spec.md §5, AC-16b, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot
> **When** they disconnect it and confirm
> **Then** the bot settings show "not connected", the bot stops delivering its messages to tg-inbox, its token is no longer kept by tg-inbox, messages sent to the bot afterwards are never captured (not even if the bot is connected again later), and every contact and conversation captured so far stays in the workspace
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `reconnect(workspaceId, confirmTakeover)` per flow 6 — `bots/app/reconnect.ts`
- [ ] `disconnect(workspaceId)` per flow 7, calling `conversations.hasConversations` — `bots/app/disconnect.ts`
- [ ] Unit tests with T12's fakes for every branch; Postgres + fake Bot API integration tests: disconnect with captures keeps the row bound and a later different-bot paste gets reason `history`; disconnect with none deletes the row

## Edge cases

| Case | Behaviour |
|---|---|
| Reconnect while `connected` / `needs_token` | `NOTHING_TO_RECONNECT` with current settings |
| Disconnect when the row is already `disconnected` | `NO_BOT_CONNECTED` with `{state: not_connected}` |
| Disconnect, `getWebhookInfo` foreign or empty | no `deleteWebhook`; disconnect proceeds |
| Disconnect, `getWebhookInfo` unauthorized | proceeds (token dead) |
| Crash between `deleteWebhook` and row update | accepted; next health check reports taken over (sad §6 flagged) |

## Definition of Done

- [ ] unit tests cover every branch of flows 6 and 7; integration tests prove the kept-vs-deleted row and that `deleteWebhook` is never sent for a foreign URL
- [ ] a reconnect whose `getMe` is unauthorized changes the state in the same request (AC-15 "at once")
- [ ] lint + vet clean (`pnpm lint`)
