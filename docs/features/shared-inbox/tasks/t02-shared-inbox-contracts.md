---
id: T2
title: "Define the inbox zod contracts, the live-frame schemas and the six new error codes"
layer: "ports"
deps: []
blocks: ["T16", "T23"]
acs: ["AC-05", "AC-07", "AC-11", "AC-12b", "AC-13", "AC-16"]
files_hint: ["packages/shared/src/inbox.ts", "packages/shared/src/inbox.test.ts", "packages/shared/src/index.ts", "packages/shared/src/errors.ts", "packages/shared/src/errors.test.ts", "apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T2 — Define the inbox zod contracts, the live-frame schemas and the six new error codes

## Place in the sequence

- **Blocked by:** — · **Blocks:** T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp, T23 — Replace the inbox sample source with the API source, a workspace-keyed store and the realtime client · **Wave:** 1 — nothing upstream.
- **Lane:** own lane (the only task touching `packages/shared/src/errors.ts` and `platform/errors.ts`).

## Why (user story)

> **As an** Operator
> **I want** to write a text reply in a conversation and send it
> **So that** the customer gets an answer from the business without me touching Telegram
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It fixes the one shape both the API and the panel parse — every row, item, request, refusal and live frame of the inbox.

## Inlined context

> **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
>
> — `CLAUDE.md §Rules, Contracts, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` / `UnauthenticatedError` / `TooManyRequestsError` (or a specific-code subclass such as `InvalidCredentialsError`) from `src/platform/errors.ts`. […] codes are declared in `packages/shared/src/errors.ts`.
>
> — `CLAUDE.md §Rules, Errors, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> new refusals: reply invalid (`ValidationError`), teammate replied (`ConflictError` with who / when), duplicate-risk confirmation required (`ConflictError`), reply limit (`TooManyRequestsError` with the time sending resumes), bot cannot carry replies (`ConflictError`); delivery outcomes are reply states, not HTTP errors; media unavailability is a typed answer the thread renders
>
> — `sad.md §8, Error handling, abridged` · full text: [sad.md](../sad.md)

> Socket frames are zod schemas in `packages/shared/src/inbox.ts` (`LiveFrame`), shared by the hub and `shared/api/realtime.ts`.
>
> — `contracts/events.md §Schema registry, abridged` · full text: [events.md](../contracts/events.md)

> Each frame has a `type`, a version `v` and the `workspace_id`. The panel drops a frame whose `workspace_id` is not the tab's current workspace (AC-09, AC-18) and ignores unknown types and fields.
>
> — `contracts/events.md §Channel: live socket, Frame format, abridged` · full text: [events.md](../contracts/events.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Schemas to define in `packages/shared/src/inbox.ts` (field-for-field from `components.schemas`):

- Paging: `Cursor` (1–200, `^[A-Za-z0-9_-]+$`), `ConversationPage`, `ThreadPage` (+ `read_through_at` nullable).
- List: `Conversation`, `ContactSummary`, `LastItem` = `LastMessageItem | LastReplyItem` (discriminator `type`).
- Thread: `ThreadItem` = `ThreadMessage | ThreadReply`; `MessageKind` (15 kinds), `MessageAttachment`, `MessageLocation` (+ `venue`), `SharedContact`, `MessagePoll`, `MemberRef`.
- Replies: `ReplyBody` (`minLength 1`, `maxLength 4096`, `pattern \S`), `ReplyState` (`sending, sent, not_delivered, not_confirmed`), `ReplyFailureReason` (7 values incl. `delivery_interrupted`), `ReplySend` (`client_key`, `body`, `last_seen_reply_id` nullable, `confirm_teammate_reply` default false), `ReplyResend` (`confirm_duplicate_risk` default false).
- Other: `ReadMarkRequest`, `ReadState`, `InboxBotStatus` (`state: connected | needs_token | taken_over | not_connected`, `can_reply`, `receiving`).
- Error details: `BotCannotReplyError` (`details.bot`), `TeammateRepliedError` (`details.reply {id, author, position_at}`), `ReplyNotResendableError` (`details.reply: ThreadReply`), `ReplyLimitReachedError` (`limit 30`, `window_seconds 60`, `retry_at`), `MediaUnavailableError` (`reason: bot_not_connected | bot_not_working | file_too_large | file_gone`).
- Live frames (`events.md`): `conversation.changed` v1 (`conversation_id`, `item {type: message|reply, id}` or null for `read`, `change: created|edited|state|read`), `bot.changed` v1, `resync` v1 — each with `type`, `v`, `workspace_id`.

New codes in `ErrorCode`: `BOT_CANNOT_REPLY` 409, `TEAMMATE_REPLIED` 409, `DUPLICATE_RISK_CONFIRMATION_REQUIRED` 409, `REPLY_NOT_RESENDABLE` 409, `MEDIA_UNAVAILABLE` 409, `REPLY_LIMIT_REACHED` 429.

— `contracts/openapi.yaml, components.schemas + ErrorCode, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-05 — error

> **Given** a captured photo, voice note or file in a conversation of "Acme Flowers"
> **When** an operator tries to open it while the bot is not connected or not working, or the file is larger than Telegram lets a bot download (20 MB), or Telegram no longer has it
> **Then** the thread shows the message's kind and caption with "content unavailable" and the reason in plain language (the bot is disconnected / the bot is not working — needs a new token / the file is too large to open in tg-inbox / Telegram no longer keeps this file), and the rest of the conversation stays readable
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

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

## Checklist

- [ ] Add the six codes and their statuses — `packages/shared/src/errors.ts` (+ `errors.test.ts`)
- [ ] Add specific-code subclasses (`BotCannotReplyError`, `TeammateRepliedError`, `DuplicateRiskConfirmationRequiredError`, `ReplyNotResendableError`, `MediaUnavailableError` on `ConflictError`; `ReplyLimitReachedError` on `TooManyRequestsError` carrying `retry_at` and a `Retry-After` value) — `apps/api/src/platform/errors.ts` (+ test)
- [ ] Write every schema listed in *API contract* — `packages/shared/src/inbox.ts`; export from `packages/shared/src/index.ts`
- [ ] Unit tests: each example in `openapi.yaml` parses; a 4097-char or blank body, an unknown frame `type` (parsed as ignorable), a `failure_reason` with `state: sent` are rejected — `packages/shared/src/inbox.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `body` of only spaces / new lines | `ReplyBody` rejects it (pattern `\S`) |
| `last_seen_reply_id: null` | accepted (no reply shown yet) |
| Live frame with an extra unknown field | parses — unknown fields are ignored (events.md backwards-compat policy) |
| Live frame of an unknown `type` | the frame union reports it as unknown so the client can ignore it, never throws |
| `REPLY_LIMIT_REACHED` thrown | status 429 with `details { limit: 30, window_seconds: 60, retry_at }` |

## Definition of Done

- [ ] `packages/shared` unit tests pass, including every contract example and the rejections above
- [ ] `platform/errors` unit tests prove the six codes map to their statuses and details
- [ ] `pnpm -r build` compiles api and web against the new exports
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
