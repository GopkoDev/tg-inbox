---
id: T16
title: "Expose the owner-only bot routes and wire the bots, conversations and contacts modules into buildDeps / buildApp"
layer: "ports"
deps: ["T4", "T12", "T13"]
blocks: ["T17", "T18", "T19"]
acs: ["AC-01", "AC-02", "AC-03", "AC-04", "AC-05", "AC-06", "AC-15", "AC-18"]
files_hint: ["apps/api/src/modules/bots/http/routes.ts", "apps/api/src/modules/bots/http/owner-routes.int.test.ts", "apps/api/src/deps.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T16 — Expose the owner-only bot routes and wire the bots, conversations and contacts modules into buildDeps / buildApp

## Place in the sequence

- **Blocked by:** T4 — shared schemas, T12 — settings + paste, T13 — reconnect + disconnect · **Blocks:** T17 — Expose the Telegram webhook route with secret-before-parse, empty-body 401/200 and fail-closed 500, T18 — Register the health-check workers in buildApp and prove five-minute freshness over a simulated hour, T19 — Update CLAUDE.md, the architecture map, the workspace-operators SAD and the design system for the new modules, exceptions and config · **Wave:** 6.
- **Lane:** `modules/bots/http/routes.ts` → T17; `apps/api/src/app.ts` / `deps.ts` → T18 — serialized.

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

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task puts the owner actions on the wire behind the workspace guard and makes the three new modules part of the app.

## Inlined context

> **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildDeps()` constructs module dependencies (shared by `buildApp()` and the CLI) and only `buildApp()` registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules, Module wiring, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Authorization: Bot routes live under `/api/workspaces/:workspaceId/bot…` behind the `workspaces` guard (non-member → not found) and require the owner role (`OwnerOnlyError` for operators, AC-03); the webhook route is outside the workspace prefix and resolves the workspace only through the secret
>
> — `sad.md §8, Authorization, verbatim` · full text: [sad.md](../sad.md)

> The backend […] adds three modules with an acyclic, one-way dependency graph — `bots → conversations → contacts` and `bots → contacts` — wired in `buildDeps()` and registered in `buildApp()`. […] No HTTP routes are added to `conversations` or `contacts` in this step.
>
> — `sad.md §5, Building block view, abridged` · full text: [sad.md](../sad.md)

Guard: reuse `createWorkspaceGuard` + `ownerOnly('Only business owners manage the bot')` (T2) exactly as the team routes do.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

| Operation | Route | 200 | Errors |
|---|---|---|---|
| `getBotSettings` | `GET /api/workspaces/{workspaceId}/bot` | `BotSettings` | 400, 401, 403 `ACCESS_REMOVED`/`OWNER_ONLY`, 404 |
| `pasteBotToken` | `POST …/bot/token` body `BotTokenPaste` | `BotSettings` | 400 `BOT_TOKEN_INVALID`/`VALIDATION_ERROR`, 401, 403, 404, 409 ×3, 413, 415, 503 |
| `reconnectBot` | `POST …/bot/reconnect` body `BotReconnect` | `BotSettings` | 400, 401, 403, 404, 409 ×3, 413, 415, 503 |
| `disconnectBot` | `POST …/bot/disconnect` no body | `BotSettings` | 400, 401, 403, 404, 409 `NO_BOT_CONNECTED`, 413, 415, 503 |

Response schemas are the shared `BotSettings` (serializer strips nothing because the use cases never return a token).

— `contracts/openapi.yaml, paths /api/workspaces/{workspaceId}/bot*, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** a business owner of "Acme Flowers" connecting a bot or giving the connected bot a new token
> **When** the pasted text is not a bot token, or Telegram does not accept it (mistyped, revoked, or the bot was deleted)
> **Then** the system changes nothing — an existing connection keeps working as before — and tells the owner the token is not valid — copy it again from BotFather
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to connect, rotate or disconnect the bot, or open the bot settings
> **Then** the system refuses and tells them that only business owners manage the bot; a person with no active membership in "Acme Flowers" gets no hint that the workspace or its bot exists
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — domain invariant

> **Given** a business owner of "Bolt Bikes" and the token of a bot that is connected to another workspace, or through which another workspace has captured conversations
> **When** the owner pastes that token
> **Then** the system refuses and explains that the bot already belongs to another workspace, without revealing which one
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

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

### AC-18 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot
> **When** they disconnect it and confirm
> **Then** the bot settings show "not connected", the bot stops delivering its messages to tg-inbox, its token is no longer kept by tg-inbox, messages sent to the bot afterwards are never captured (not even if the bot is connected again later), and every contact and conversation captured so far stays in the workspace
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `registerBots(app, deps)` with the four owner routes (zod type provider, shared schemas) — `bots/http/routes.ts`
- [ ] `buildDeps()`: construct contacts → conversations → bots (repos, cipher from `BOT_TOKEN_ENCRYPTION_KEY`, gateway with `TELEGRAM_API_ROOT`, webhook base URL) and return the bots use cases — `apps/api/src/deps.ts`
- [ ] `buildApp()`: `registerBots` under `/api` with the guard deps — `apps/api/src/app.ts`; smoke test `app.int.test.ts` stays green
- [ ] `app.inject()` tests with the fake Bot API: each operation's 200 and every error code; operator → 403 "Only business owners manage the bot" on all four; never-member / unknown / malformed workspace id → 404; an owner of "Bolt Bikes" on "Acme Flowers" → 404 and the bot row unchanged; responses validate against the shared schemas and contain no token or secret — `owner-routes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `POST …/disconnect` with `content-type: application/json` and empty body | `400 VALIDATION_ERROR` (framework 4xx contract) |
| Non-JSON body on a POST | `415` (existing guard) |
| `GET …/bot` makes a Telegram call | must not — fake Bot API records zero calls |

## Definition of Done

- [ ] `app.inject()` tests pass for every status in the table, the operator refusal and the cross-workspace 404
- [ ] `buildApp()` smoke test green; modules wired only in `buildDeps()` / `buildApp()`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
