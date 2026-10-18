---
id: T21
title: "Add the token-secrecy suite: no token, secret or message text in any log line or response across every bot flow"
layer: "tests"
deps: ["T17", "T18"]
blocks: []
acs: ["AC-01", "AC-14", "AC-15"]
files_hint: ["apps/api/src/modules/bots/http/secrecy.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T21 — Add the token-secrecy suite: no token, secret or message text in any log line or response across every bot flow

## Place in the sequence

- **Blocked by:** T17, T18 — every flow wired · **Blocks:** — · **Wave:** 8.
- **Lane:** own lane (new test file).

## Why (user story)

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task is the automated half of the spec's "0 occurrences of a bot token" NFR, which the security review relies on.

## Inlined context

> | Token secrecy | 0 occurrences of a bot token in logs, error messages or anything the web panel receives | automated test over logs and responses + security review |
>
> — `spec.md §6, Token secrecy row, verbatim` · full text: [spec.md](../spec.md)

> one integration suite captures all log output and every response body while running connect, rotate, reconnect, disconnect, health check, the webhook route and every Telegram failure branch (unauthorized, transient, `setWebhook` failure), and asserts that neither the bot token, the webhook secret, nor any message text or caption appears in any of them; the shared response schemas are asserted to have no token or secret field; error bodies from Telegram failures carry no Bot API URL.
>
> — `test-plan.md §Token secrecy, verbatim` · full text: [test-plan.md](../test-plan.md)

`buildApp(config, { logStream })` already accepts a log stream override — capture into memory.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

All four owner operations and `receiveTelegramUpdate` ([openapi.yaml](../contracts/openapi.yaml)); every error body must match the envelope with no token / secret / `api.telegram.org` substring.

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — authorization

> **Given** a connected bot of "Acme Flowers"
> **When** someone who is not Telegram sends the system a message pretending to come from that bot
> **Then** the system ignores it — nothing is captured and no contact or conversation is created
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
> **When** they open the bot settings
> **Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token; the state, name and username are checked with Telegram in the background and are never more than 5 minutes old, and a failed exchange with Telegram changes the state at once
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] One suite: build the app with an in-memory `logStream`, run every flow and Telegram failure branch against the fake Bot API, collect all log lines + response bodies + error bodies, assert none contains the token, the token's secret part, the webhook secret, a sent message text/caption, or `/bot<token>` — `secrecy.int.test.ts`
- [ ] Assert the request log for a webhook delivery shows the secret header redacted

## Edge cases

| Case | Behaviour |
|---|---|
| grammY error with the URL in its message | gateway mapped it — no URL in logs (fails the suite otherwise) |
| 500 on a forced DB failure in capture | log has update id only, no text |

## Definition of Done

- [ ] the suite passes and fails if any one redaction is removed (verified once by temporarily logging the header)
- [ ] lint + vet clean (`pnpm lint`)
