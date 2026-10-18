---
id: T17
title: "Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook"
layer: "ports"
deps: ["T6", "T10", "T16"]
blocks: ["T18", "T21"]
acs: ["AC-07", "AC-11", "AC-12b", "AC-13", "AC-16", "AC-18"]
files_hint: ["apps/api/src/modules/inbox/app/send-reply.ts", "apps/api/src/modules/inbox/app/send-reply.test.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/replies.int.test.ts", "apps/api/src/modules/inbox/infra/jobs.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T17 — Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook

## Place in the sequence

- **Blocked by:** T6 — Add the inbox domain rules: reply text check, delivery outcome to reply state, retry window, per-member limit window, T10 — Build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction, T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp · **Blocks:** T18 — Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler, T21 — Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs · **Wave:** 6 — after T6, T10, T16.
- **Lane:** shares `modules/inbox/http/routes.ts` with T16, T19, T20 and `infra/jobs.ts` with T18 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a text reply in a conversation and send it
> **So that** the customer gets an answer from the business without me touching Telegram
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It accepts a member's reply (or a resend) only when it may be sent, and hands it to the drain atomically.

## Inlined context

> The checks run in flow 1's order. The first refusal wins, and nothing is stored on a refusal:
> 1. The body is a schema-valid text of 1–4096 characters that is not only spaces or new lines, counted in UTF-16 units as Telegram counts them → otherwise `400 VALIDATION_ERROR` (AC-07).
> 2. The bot can carry replies (`connected` or `taken_over`) → otherwise `409 BOT_CANNOT_REPLY` (AC-13).
> 3. In one transaction: same `client_key` → `200` with that reply […]; 30 member-initiated sends […] → `429 REPLY_LIMIT_REACHED` […]; a teammate's reply was added after `last_seen_reply_id`, and `confirm_teammate_reply` is not `true` → `409 TEAMMATE_REPLIED` […]; otherwise → `201`.
>
> — `contracts/openapi.yaml, sendReply, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> The checks run in this order. […] 1. […] → `409 REPLY_NOT_RESENDABLE`. 2. 30 member-initiated sends in the last 60 s → `429 REPLY_LIMIT_REACHED` (AC-12b). 3. `not_confirmed` without `confirm_duplicate_risk: true` → `409 DUPLICATE_RISK_CONFIRMATION_REQUIRED` (AC-11). 4. The bot cannot carry replies → `409 BOT_CANNOT_REPLY` (AC-13).
>
> — `contracts/openapi.yaml, resendReply, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> `inbox.deliver-replies` (pg-boss, `stately`, singleton key = conversation id, `retryLimit` 3, job expiry 60 s): sent through pg-boss inside the reply's own transaction (pg-boss `send` with the caller's database executor), so a committed reply always has a job
>
> — `sad.md §8, Jobs, abridged` · full text: [sad.md](../sad.md)

> a reply can go only to the conversation's own end customer through the workspace's own bot.
>
> — `spec.md §6.1, AuthZ/AuthN impact, abridged` · full text: [spec.md](../spec.md)

> new refusals: reply invalid (`ValidationError`), teammate replied (`ConflictError` with who / when), duplicate-risk confirmation required (`ConflictError`), reply limit (`TooManyRequestsError` with the time sending resumes), bot cannot carry replies (`ConflictError`); delivery outcomes are reply states, not HTTP errors; media unavailability is a typed answer the thread renders
>
> — `sad.md §8, Error handling, abridged` · full text: [sad.md](../sad.md)

> Everything under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard — another workspace's account → not found with no hint, deactivated → `ACCESS_REMOVED`, signed out → sign in (AC-08); both roles have the same inbox rights
>
> — `sad.md §8, Authorization, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (writes through `conversations.createReply` / `requeueReply` from T10).

## API contract

- `POST …/conversations/{conversationId}/replies` (`sendReply`, body `ReplySend { client_key, body, last_seen_reply_id, confirm_teammate_reply? }`) → `201 ThreadReply` (`state: sending`) · `200 ThreadReply` (same `client_key`) · `400 VALIDATION_ERROR` (`details.field: body`, `max_length: 4096`) · `409 BOT_CANNOT_REPLY` (`details.bot: InboxBotStatus`) · `409 TEAMMATE_REPLIED` (`details.reply {id, author, position_at}`) · `429 REPLY_LIMIT_REACHED` (`details {limit, window_seconds, retry_at}`, `Retry-After`) · `401`/`403`/`404`/`413`/`415`.
- `POST …/replies/{replyId}/resend` (`resendReply`, body `ReplyResend { confirm_duplicate_risk? }`) → `200 ThreadReply` (`sending`, new `position_at`) · `409 REPLY_NOT_RESENDABLE` (`details.reply`) · `409 DUPLICATE_RISK_CONFIRMATION_REQUIRED` · `409 BOT_CANNOT_REPLY` · `429 REPLY_LIMIT_REACHED`.

— `contracts/openapi.yaml, sendReply + resendReply, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-07 — error

> **Given** an operator in a conversation of "Acme Flowers"
> **When** they try to send with an empty reply box, one holding only spaces or new lines, or one longer than 4096 characters
> **Then** nothing is sent and sending stays unavailable; for an over-long reply the box says replies are limited to 4096 characters and keeps the text so it can be shortened
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** an operator of "Acme Flowers" sending a reply
> **When** they press send twice quickly, lose their connection right after sending, or tg-inbox cannot learn whether Telegram accepted the reply
> **Then** the customer receives the reply at most once: a double press of one send sends one reply (two replies a member deliberately sends, even with the same text, are both sent); when the outcome is unknown the reply is marked "not confirmed — it may or may not have reached the customer" and is never resent automatically; the operator can send it again only after a warning that the customer may receive it twice — a reply is never delivered twice without a member choosing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12b — error

> **Given** an operator of "Acme Flowers" who has sent 30 replies in this workspace within the last 60 seconds (automatic retries do not count; "Try again" and "send again" do)
> **When** they try to send another one
> **Then** the reply is not sent, the text stays in the reply box, and the inbox says that replies are limited to 30 per minute per member and when sending is available again; the limit is per workspace, so replies in another workspace of the same account are not affected
>
> — `spec.md §5, AC-12b, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** the bot of "Acme Flowers" is not connected, or is in the state "not working — needs a new token"
> **When** an operator or business owner opens the inbox or a conversation
> **Then** every conversation stays readable, the reply box is unavailable and explains that replies cannot be sent until the bot works again — a business owner gets the way to the bot settings, an operator is told to ask a business owner; a reply still "sending" when the bot stops working ends up "not delivered — the bot is not working"; once a business owner fixes the bot — the same bot, since a workspace keeps one business bot once customers have written to it (bot-connection AC-05) — replying works again without reloading
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** an operator of "Acme Flowers" writing a reply in a conversation
> **When** a teammate's reply to the same customer appears in the thread after the operator started typing, and the operator sends
> **Then** before anything is sent the inbox shows that the teammate replied and how long ago, and asks whether to send anyway or keep editing; the reply is sent only if the operator confirms — two members do not answer one customer by accident
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — cross-context

> **Given** one person writes to the bots of both "Acme Flowers" and "Bolt Bikes", and an account is a member of both workspaces
> **When** that account opens the inbox of each workspace in turn
> **Then** each inbox shows only its own workspace's conversation with that person — only the messages sent to its own bot and the replies sent by its own team — and a reply sent from one workspace goes only through that workspace's bot, to that person's conversation with it; each inbox holds at most one conversation per end customer
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `sendReply` use case: domain text check (T6) → `bots.canCarryReplies` → `conversations.createReply` with `REPLY_LIMIT`/window and an `enqueueDrain` that calls pg-boss `send('inbox.deliver-replies', { workspace_id, conversation_id }, { singletonKey: conversation_id, db: trx })` — `modules/inbox/app/send-reply.ts`, `infra/jobs.ts`
- [ ] `resendReply` use case in the contract's order — `modules/inbox/app/send-reply.ts`
- [ ] Routes mapping results to `201`/`200` and the typed refusals — `modules/inbox/http/routes.ts`
- [ ] Unit tests with fakes for the check order; `app.inject` tests for every status above, a double submit returning one reply, a reply refused leaving nothing stored, and a reply only ever addressed to its own conversation's chat — `modules/inbox/app/send-reply.test.ts`, `http/replies.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Body valid by code points but > 4096 UTF-16 units | `400 VALIDATION_ERROR` |
| Bot `needs_token` + over limit | `409 BOT_CANNOT_REPLY` (bot check comes first) |
| Double submit, first already `sent` | `200` with the `sent` reply, nothing enqueued |
| `last_seen_reply_id` of another conversation | treated as null |
| Resend of a `not_confirmed` reply without confirmation | `409 DUPLICATE_RISK_CONFIRMATION_REQUIRED`, nothing changes |
| Resend while over the limit | `429` with `retry_at`, reply keeps its state |

## Definition of Done

- [ ] unit tests prove the check order of both use cases; route tests prove every status and error body in the contract
- [ ] a stored reply always has its attempt row and its drain job (asserted in the same test); a refusal stores nothing
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
