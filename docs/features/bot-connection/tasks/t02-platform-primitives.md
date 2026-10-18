---
id: T2
title: "Add platform primitives: bot error codes incl. the first 5xx, owner-guard message, config keys, Bot API root, secret-header redaction"
layer: "infra"
deps: []
blocks: ["T4", "T10", "T11", "T12"]
acs: ["AC-02", "AC-03", "AC-04", "AC-05", "AC-06"]
files_hint: ["apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "packages/shared/src/errors.ts", "apps/api/src/platform/config.ts", ".env.example", "apps/api/src/platform/telegram.ts", "apps/api/src/platform/logger.ts", "apps/api/src/modules/workspaces/http/guard.ts", "apps/api/src/modules/workspaces/http/team-routes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T2 — Add platform primitives: bot error codes incl. the first 5xx, owner-guard message, config keys, Bot API root, secret-header redaction

## Place in the sequence

- **Blocked by:** — · **Blocks:** T4 — Define the bots zod contracts in packages/shared, T10 — Build the bot repository, the AES-GCM token cipher and webhook secrets, with isolation tests incl. the two controlled exceptions, T11 — Build the Telegram gateway: getMe, getWebhookInfo, setWebhook, deleteWebhook with typed outcomes and timeouts, T12 — Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation) · **Wave:** 1 — shared plumbing every later bots task uses.
- **Lane:** own lane. Touches the `workspaces` guard only to parameterise its message; the team routes keep their text.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

This task gives the feature its error codes, configuration and the platform hooks every bot route and Bot API call needs.

## Inlined context

> Error handling: the existing envelope; new specific codes fixed by the `api` stage: `BOT_TOKEN_INVALID` 400, `BOT_BELONGS_TO_ANOTHER_WORKSPACE` 409, `WORKSPACE_KEEPS_ONE_BOT` 409 (`details.reason` connected / history), `TAKEOVER_CONFIRMATION_REQUIRED` 409, `NOTHING_TO_RECONNECT` 409, `BOT_NEEDS_NEW_TOKEN` 409, `NO_BOT_CONNECTED` 409, `TELEGRAM_UNAVAILABLE` 503
>
> — `sad.md §8, Error handling, abridged` · full text: [sad.md](../sad.md)

> **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` / `UnauthenticatedError` / `TooManyRequestsError` (or a specific-code subclass […]) from `src/platform/errors.ts`. The one error handler returns `{ "error": { "code", "message", "details"? } }`; codes are declared in `packages/shared/src/errors.ts`.
>
> — `CLAUDE.md §Rules, Errors, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

`TELEGRAM_UNAVAILABLE` is the **first 5xx `AppError`**: today every `AppError` is 4xx and anything else becomes `500 INTERNAL_ERROR`. The handler must send 503 with the envelope, and log it at `warn` (not as an unhandled error) without Telegram's error text or URL.

> **Configuration added** (parsed in `apps/api/src/platform/config.ts`, documented in `.env.example`): `TELEGRAM_WEBHOOK_BASE_URL` — public HTTPS base for webhook URLs; defaults to `PUBLIC_WEB_URL` (same origin) · `BOT_TOKEN_ENCRYPTION_KEY` — 32-byte key (base64) for token encryption, with its key id (ADR-0006) · `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` — `max_connections` given to `setWebhook`; default 10, kept below the database pool size (`DATABASE_POOL_MAX`) · `TELEGRAM_API_ROOT` — optional Bot API base URL, used by tests to point grammY at a fake Bot API
>
> — `sad.md §7, Configuration added, abridged` · full text: [sad.md](../sad.md)

> Logging: request logs redact `X-Telegram-Bot-Api-Secret-Token` alongside the cookie headers; […] bot tokens, webhook secrets and message text/captions are never logged
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

> **Telegram:** all Bot API calls go through `telegramApi(token)` in `src/platform/telegram.ts` […] Bot tokens are secrets — never logged, never returned.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

Owner guard today: `ownerOnly` in `modules/workspaces/http/guard.ts` hard-codes `throw new OwnerOnlyError('Only business owners manage the team')`. Bot routes must answer `OWNER_ONLY` with **"Only business owners manage the bot"** (openapi `OwnerRouteForbidden`), so the message becomes a parameter.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- New `ErrorCode` values + `AppError` subclasses: `BOT_TOKEN_INVALID` 400, `BOT_BELONGS_TO_ANOTHER_WORKSPACE` 409, `WORKSPACE_KEEPS_ONE_BOT` 409, `TAKEOVER_CONFIRMATION_REQUIRED` 409, `NOTHING_TO_RECONNECT` 409, `BOT_NEEDS_NEW_TOKEN` 409, `NO_BOT_CONNECTED` 409, `TELEGRAM_UNAVAILABLE` 503 (message "Telegram is not responding — try again").
- `403 OWNER_ONLY` message is per route family: team "Only business owners manage the team" (unchanged), bot "Only business owners manage the bot".

— `contracts/openapi.yaml, components.schemas.ErrorCode + responses.TelegramUnavailable/OwnerRouteForbidden, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

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

## Checklist

- [ ] Add the eight codes to `ErrorCode` — `packages/shared/src/errors.ts`
- [ ] Add one `AppError` subclass per code (`details` carried for `WORKSPACE_KEEPS_ONE_BOT` `{reason}`, `TAKEOVER_CONFIRMATION_REQUIRED` `{bot}`, the three settings refusals `{settings}`); make the error handler send a 5xx `AppError` with its status and envelope and log it at `warn` with the code only — `apps/api/src/platform/errors.ts`, `errors.test.ts`
- [ ] Replace `ownerOnly` with `ownerOnly(message: string)` (a preHandler factory); team routes pass "Only business owners manage the team" — `modules/workspaces/http/guard.ts`, `team-routes.ts`; the existing team-routes test stays green
- [ ] Parse `TELEGRAM_WEBHOOK_BASE_URL` (url, default `PUBLIC_WEB_URL`), `BOT_TOKEN_ENCRYPTION_KEY` (base64 → exactly 32 bytes; a key id derived or given), `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` (int 1–100, default 10, refine `< DATABASE_POOL_MAX`), optional `TELEGRAM_API_ROOT` (url) — `platform/config.ts`; document all four in `.env.example`
- [ ] `telegramApi(token, { apiRoot? })` passes `apiRoot` to grammY's client options — `platform/telegram.ts`
- [ ] Add `x-telegram-bot-api-secret-token` to the request-log redaction paths — `platform/logger.ts` (+ a `logger.test.ts` case)

## Edge cases

| Case | Behaviour |
|---|---|
| `BOT_TOKEN_ENCRYPTION_KEY` missing, not base64, or not 32 bytes | `loadConfig` throws naming the key, never echoing its value |
| `TELEGRAM_WEBHOOK_MAX_CONNECTIONS` ≥ `DATABASE_POOL_MAX` | config error (one bot must not hold every DB connection) |
| `TelegramUnavailableError` thrown in a route | `503` envelope, logged at `warn` with code only |
| Operator on a team route after the change | still "Only business owners manage the team" |

## Definition of Done

- [ ] unit tests prove each new error class maps to its code, status and `details` in the envelope, and a 503 `AppError` is not reported as `INTERNAL_ERROR`
- [ ] config tests cover defaults, the key-length check and the pool-size refinement; `.env.example` lists every new key
- [ ] a logger test shows the secret header redacted; team-routes integration test unchanged and green
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
