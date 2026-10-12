---
id: T4
title: "Define the bots zod contracts in packages/shared"
layer: "ports"
deps: ["T2"]
blocks: ["T16", "T23"]
acs: ["AC-01", "AC-05", "AC-06", "AC-15"]
files_hint: ["packages/shared/src/bots.ts", "packages/shared/src/bots.test.ts", "packages/shared/src/index.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T4 — Define the bots zod contracts in packages/shared

## Place in the sequence

- **Blocked by:** T2 — platform primitives (the new `ErrorCode` values) · **Blocks:** T16 — Expose the owner-only bot routes and wire the bots, conversations and contacts modules into buildDeps / buildApp, T23 — Lay the web bot foundation: bot API client, store, /w/:workspaceId/bot route and the owner-only Bot entry in AppShell (SCR-01) · **Wave:** 2.
- **Lane:** own lane (`packages/shared/src/index.ts` is touched only here in this epic).

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task fixes the one request/response shape the API validates and the web panel parses, so neither side can leak the token.

## Inlined context

> **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
>
> — `CLAUDE.md §Rules, Contracts, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Every owner route that succeeds, and every refusal that carries `details.settings`, returns the same `BotSettings` payload, so the panel replaces its store with it. The bot token never appears in a response, an error or a log.
>
> — `contracts/openapi.yaml, info.description, verbatim` · full text: [openapi.yaml](../contracts/openapi.yaml)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

| Schema | Shape |
|---|---|
| `BotIdentity` | `{ name: string, username: string }` strict, no length bounds |
| `BotState` | `connected \| needs_token \| taken_over` |
| `BotSettings` | discriminated on `state`: `{ state: 'not_connected' }` \| `{ state: BotState, bot, last_checked_at: datetime, last_message_received_at: datetime \| null, contacts_count: int ≥ 0 }`, both strict |
| `BotTokenPaste` | `{ token: string ≤ 512, confirm_takeover?: boolean = false }` strict |
| `BotReconnect` | `{ confirm_takeover?: boolean = false }` strict |
| `WorkspaceKeepsOneBotDetails` | `{ reason: 'connected' \| 'history' }` |
| `TakeoverConfirmationDetails` | `{ bot: BotIdentity }` |
| `SettingsRefusalDetails` | `{ settings: BotSettings }` (for `NOTHING_TO_RECONNECT`, `BOT_NEEDS_NEW_TOKEN`, `NO_BOT_CONNECTED`) |

Bot-token form `^[0-9]{1,20}:[A-Za-z0-9_-]{30,100}$` is checked **server-side after trimming** (bots domain, T5), not in `BotTokenPaste`.

— `contracts/openapi.yaml, components.schemas (BotIdentity…BotReconnect, *Error), abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

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

### AC-15 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
> **When** they open the bot settings
> **Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token; the state, name and username are checked with Telegram in the background and are never more than 5 minutes old, and a failed exchange with Telegram changes the state at once
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Write the schemas above with `z.strictObject` / `z.discriminatedUnion` and export their types — `packages/shared/src/bots.ts`; re-export from `index.ts`
- [ ] Tests: every `openapi.yaml` example for `getBotSettings`, `pasteBotToken`, `reconnectBot`, `disconnectBot` parses; an extra `token` / `webhook_secret` key on `BotSettings` is rejected; a 513-char token is rejected; `confirm_takeover` defaults to `false` — `packages/shared/src/bots.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `BotSettings` `not_connected` with a `bot` key | rejected (strict) |
| `last_message_received_at: null` on `connected` | accepted (no message yet, AC-07) |
| `confirm_takeover: "true"` (string) | rejected — `VALIDATION_ERROR` at the route |

## Definition of Done

- [ ] unit tests show every contract example parses and no schema can carry a token or secret field
- [ ] `pnpm --filter @tg/shared build` and `pnpm typecheck` pass
- [ ] lint + vet clean (`pnpm lint`)
