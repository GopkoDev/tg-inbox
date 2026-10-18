---
id: T21
title: "Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs"
layer: "tests"
deps: ["T17", "T18", "T19", "T20"]
blocks: ["T29"]
acs: ["AC-08", "AC-10", "AC-11", "AC-17", "AC-18"]
files_hint: ["apps/api/src/e2e/inbox-flows.int.test.ts", "apps/api/src/e2e/helpers.ts", "apps/api/src/modules/bots/http/secrecy.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T21 — Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs

## Place in the sequence

- **Blocked by:** T17 — Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook, T18 — Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler, T19 — Add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability, T20 — Add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync · **Blocks:** T29 — Add browser end-to-end inbox flows against the real API and the fake Bot API · **Wave:** 8 — after T17, T18, T19, T20.
- **Lane:** shares `apps/api/src/e2e/helpers.ts` with nothing else in this epic; `secrecy.int.test.ts` is extended only here.

## Why (user story)

> **As an** End customer
> **I want** the business's answer to arrive in my chat with its bot
> **So that** I keep talking to the business where I started, without knowing who is on shift
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to write a text reply in a conversation and send it
> **So that** the customer gets an answer from the business without me touching Telegram
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It proves the whole path — webhook capture → inbox → reply → Telegram → customer's answer — for a real pair of workspaces, with the token never leaking.

## Inlined context

> | Bot token exposure | 0 occurrences of a bot token in anything the web panel receives (pages, data, media addresses, redirects) or in logs | the bot-connection secrecy test extended to the inbox and media paths |
>
> — `spec.md §6, NFR table, verbatim` · full text: [spec.md](../spec.md)

> the bot-connection secrecy test extended to inbox responses, media responses, socket frames and captured logs; integration test: "the 31st reply within a minute is refused", including 31 concurrent sends
>
> — `sad.md §10, QG-2 How verify, abridged` · full text: [sad.md](../sad.md)

> Rel(bots, telegram, "sendMessage, getFile, download", "HTTPS Bot API")
>
> — `sad.md §5, C4 Container, verbatim` · full text: [sad.md](../sad.md)

> | AC-17 | Flow 1 — plain-text `sendMessage` through the workspace's bot; flow 2 — the customer's answer is captured into the same conversation. "No operator name" is a content rule, not a runtime step |
>
> — `sad.md §6, Coverage table, verbatim` · full text: [sad.md](../sad.md)

> Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts`.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Exercises every inbox operation end to end (`listConversations` … `openLiveSocket`) plus bot-connection's `receiveTelegramUpdate` for capture.

## Acceptance criteria

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member of "Acme Flowers", or someone not signed in
> **When** they try to open the inbox of "Acme Flowers", one of its conversations or one of its customers' media, or to send a reply in it (for example through a saved link)
> **Then** the system refuses and shows no conversation, message, media or customer of "Acme Flowers"; an account of another workspace gets no hint that the workspace or the conversation exists; a deactivated member gets the access-removed notice they already get elsewhere in the panel (they know the workspace, but see nothing of it); someone not signed in is asked to sign in first; nothing is sent to any end customer
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

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

### AC-17 — happy path

> **Given** an end customer who wrote to the bot of "Acme Flowers" and an operator who replied in their conversation
> **When** the reply is sent
> **Then** the customer receives the text as a message from the business's bot in their chat with it, with its line breaks, without any operator name or mark of tg-inbox; when the customer answers, the message continues the same conversation
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — cross-context

> **Given** one person writes to the bots of both "Acme Flowers" and "Bolt Bikes", and an account is a member of both workspaces
> **When** that account opens the inbox of each workspace in turn
> **Then** each inbox shows only its own workspace's conversation with that person — only the messages sent to its own bot and the replies sent by its own team — and a reply sent from one workspace goes only through that workspace's bot, to that person's conversation with it; each inbox holds at most one conversation per end customer
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Story: customer writes via webhook → list row + unread → reply → fake records one plain-text `sendMessage` to that chat with the exact text and line breaks and no author name → customer answers → same conversation — `apps/api/src/e2e/inbox-flows.int.test.ts`
- [ ] Story: one Telegram user writes to two workspaces' bots; each inbox shows only its own conversation; a reply from A goes only through A's bot (AC-18)
- [ ] Story: blocked customer → `not_delivered` / `customer_blocked`, waiting marker kept; next reply fails the same way until the customer writes (AC-10)
- [ ] Story: double submit and lost-response retry → one `sendMessage` (AC-11); the 31st concurrent send refused
- [ ] Story: guard trio over every inbox route, media and socket (AC-08)
- [ ] Secrecy: scan every inbox JSON body, media header/body, socket frame and captured log line for the token and `api.telegram.org/file` — `apps/api/src/modules/bots/http/secrecy.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Customer edits a message after a reply | edited text shown, no reorder, no unread |
| Reply text containing the token-like string of another bot | not flagged as leak unless it is this bot's token (test uses a distinct token) |

## Definition of Done

- [ ] the e2e stories pass against Postgres + the fake Bot API
- [ ] the extended secrecy suite finds 0 token / file-URL occurrences across responses, media, frames and logs
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
