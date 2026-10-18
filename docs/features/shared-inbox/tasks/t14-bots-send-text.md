---
id: T14
title: "Add sendMessage to the bots gateway as send text, classifying every answer into a typed outcome"
layer: "infra"
deps: ["T4"]
blocks: ["T15", "T18"]
acs: ["AC-10", "AC-11", "AC-12", "AC-17"]
files_hint: ["apps/api/src/modules/bots/infra/telegram-gateway.ts", "apps/api/src/modules/bots/infra/telegram-gateway.int.test.ts", "apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/fakes.ts", "apps/api/src/modules/bots/app/send-text.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T14 — Add sendMessage to the bots gateway as send text, classifying every answer into a typed outcome

## Place in the sequence

- **Blocked by:** T4 — Extend the fake Bot API with sendMessage, getFile and the file download, scriptable per call · **Blocks:** T15 — Add the media stream to the bots gateway: getFile, size check and a ranged byte stream with typed unavailability, T18 — Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler · **Wave:** 2 — after T4.
- **Lane:** shares `telegram-gateway.ts`, `bots/app/ports.ts`, `fakes.ts` with T13 and T15 — serialized.

## Why (user story)

> **As an** End customer
> **I want** the business's answer to arrive in my chat with its bot
> **So that** I keep talking to the business where I started, without knowing who is on shift
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It is the one place a reply leaves tg-inbox — through the workspace's own bot, as plain text, with a truthful outcome.

## Inlined context

> `inbox` → `bots`: […] *send text* (workspace id, chat id, text → classified outcome)
>
> — `sad.md §5, Cross-module app-layer calls, abridged` · full text: [sad.md](../sad.md)

> Every call through `telegramApi(token)` behind the `bots` gateway; `sendMessage` timeout 10 s […]; outcomes: accepted / refused permanently (blocked, account gone, chat not found) / bot unauthorised / not accepted (429 with `retry_after`, 5xx, connection refused) / unknown (timeout or broken connection after the request was written)
>
> — `sad.md §8, Telegram calls, abridged` · full text: [sad.md](../sad.md)

> **Telegram:** all Bot API calls go through `telegramApi(token, { apiRoot })` in `src/platform/telegram.ts` (via the `bots` gateway).
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> replies go to Telegram without `parse_mode`
>
> — `sad.md §8, Untrusted content, abridged` · full text: [sad.md](../sad.md)

> Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts`.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> pino via `platform/logger.ts`; existing redactions kept; reply text, message text and captions, file names, Telegram file paths and download URLs, the token and NOTIFY payloads are never logged — delivery and media logs carry ids, kinds, states and durations only; gateway errors are mapped to typed outcomes without copying Telegram's text
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (Reads the encrypted token of the workspace's bot, decrypted only in `bots` infra.)

## API contract

Internal — no API surface. `sendText({ workspaceId, chatId, text })` → `accepted { messageId, at } | refused { reason: blocked | account_gone | chat_not_found } | bot_unauthorized | not_accepted { retryAfterMs? } | unknown`.

## Acceptance criteria

### AC-10 — error

> **Given** an operator of "Acme Flowers" replying to an end customer who has blocked the bot (or deleted their Telegram account)
> **When** they send the reply
> **Then** the reply stays in the thread marked "not delivered — the customer blocked the bot" (or "the customer's Telegram account no longer exists"), the conversation keeps its "waiting for a reply" marker, and the operator understands the customer can be reached again only after they unblock the bot and write to it; the reply box stays usable, and each further reply fails the same way until the customer writes again
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** an operator of "Acme Flowers" sending a reply
> **When** they press send twice quickly, lose their connection right after sending, or tg-inbox cannot learn whether Telegram accepted the reply
> **Then** the customer receives the reply at most once: a double press of one send sends one reply (two replies a member deliberately sends, even with the same text, are both sent); when the outcome is unknown the reply is marked "not confirmed — it may or may not have reached the customer" and is never resent automatically; the operator can send it again only after a warning that the customer may receive it twice — a reply is never delivered twice without a member choosing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** an operator of "Acme Flowers" sending a reply while Telegram is temporarily unavailable or asks the bot to slow down
> **When** Telegram answers that it did not accept the reply (it is unavailable or asks the bot to slow down)
> **Then** the reply stays "sending" and tg-inbox keeps trying on its own for up to 5 minutes; within one conversation replies reach the customer in the order they were written, and a later reply waits while an earlier one of the same conversation is still sending — other conversations are not held up; if it is still not accepted, it is marked "not delivered — Telegram did not accept it, try again" with a "Try again" action that sends it once more (it then moves to the end of the thread, at the time it was sent again); a send whose answer never came back is never retried on its own — it follows AC-11 ("not confirmed")
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** an end customer who wrote to the bot of "Acme Flowers" and an operator who replied in their conversation
> **When** the reply is sent
> **Then** the customer receives the text as a message from the business's bot in their chat with it, with its line breaks, without any operator name or mark of tg-inbox; when the customer answers, the message continues the same conversation
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Gateway `sendMessage(token, chatId, text)` with a 10 s timeout, no `parse_mode`, classifying grammY errors: 403 blocked / deactivated, 400 chat not found, 401, 429 (`retry_after`), 5xx, connect-refused before write → not accepted, timeout / reset after write → unknown — `modules/bots/infra/telegram-gateway.ts`
- [ ] `sendText` app use case resolving the workspace's bot (only `connected` / `taken_over`), decrypting the token — `modules/bots/app/send-text.ts`, `ports.ts`, `fakes.ts`
- [ ] Integration tests against the fake for each answer; the fake records no `parse_mode` and the exact text with line breaks — `modules/bots/infra/telegram-gateway.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Text with `<b>` or `*` | sent literally (no `parse_mode`) |
| Fake hangs 11 s | `unknown` after 10 s; no second call |
| Connection refused before the request was written | `not_accepted` (safe to retry) |
| Workspace's bot `needs_token` / disconnected | not called; `bot_unauthorized`-equivalent refusal to the caller |
| Any error | logged by outcome code only — no token, text or Telegram message |

## Definition of Done

- [ ] integration tests prove every outcome class against the fake Bot API, plain-text sending with line breaks, and the 10 s timeout as `unknown`
- [ ] captured logs contain no token and no reply text
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
