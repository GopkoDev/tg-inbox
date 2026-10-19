---
id: T15
title: "Add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id"
layer: "app"
deps: ["T4", "T7", "T8"]
blocks: ["T21"]
acs: ["AC-04", "AC-05", "AC-06", "AC-11"]
files_hint: ["apps/api/src/modules/notifications/infra/jobs.ts", "apps/api/src/modules/notifications/app/deliver-answer.ts", "apps/api/src/modules/notifications/app/deliver-answer.test.ts", "apps/api/src/modules/notifications/infra/jobs.int.test.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T15 — Add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id

## Place in the sequence

- **Blocked by:** T4 — Add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time, T7 — Give bots sendMemberMessage (paced, behind the send pause, with a blocked outcome) and pingReadiness, and store the send pause on any 429, T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link · **Blocks:** T21 — Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames · **Wave:** 3 — after T4, T7, T8.
- **Lane:** shares `apps/api/src/app.ts` with T14; shares `apps/api/src/app.ts`, `apps/api/src/modules/notifications/infra/jobs.ts` with T17; shares `apps/api/src/app.ts` with T19; shares `apps/api/src/app.ts` with T27 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** the business's conversation list to hold only real customers
> **So that** the team's attention and replies go to me, not to their own colleagues' notification chats
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It is how the bot answers in the member's chat without the webhook ever waiting on Telegram.

## Inlined context

> - **Options:** `retryLimit = 2` with backoff, `expireInSeconds = 30`, `deadLetter = notifications.send-bot-message-dlq` (sad.md §7, flow 10).
> - **Work** (flow 10): read the workspace name and `pingReadiness`. Bot not connected or not working → finish without sending. Send-paused → retry after the pause. Else build the text and call `sendMemberMessage` (paced with pings, behind the same pause). Outcomes: `accepted` → done; `blocked` → done, nothing to retry; `rate_limited` → store the pause, retry after it; `transient` → fail the attempt (pg-boss retries). For `notifications_off`, every finish — sent, blocked, bot not working, or the last failed attempt — clears the removed link's `telegram_user_id` (data-model assumption 3).
> - **Idempotency:** pg-boss job id; a completed job never runs again. A retry after a timeout may repeat the answer in the chat; answers carry no state, so this is accepted (sad.md §6 assumptions).
>
> — `contracts/events.md §Event: notifications.send-bot-message, options + work, verbatim` · full text: [events.md](../contracts/events.md)

> - **F-3 · Telegram user id in `notifications.send-bot-message` payloads** for `link_expired` / `cannot_connect`, and in the DLQ — carried over from data-model assumption 3 and sad.md §6 flags. **Accepted pending security review** (spec §6.1 marks review as required).
>
> — `contracts/api-sync-report.md §C. Flags, F-3, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> "link expired" and "cannot connect" go to a sender with no link of their own, so they must carry the Telegram user id. That id stays in pg-boss's job table until pg-boss deletes the completed job (its retention setting), which the security review must accept;
> a run-book integrity query catches a member-removed link that still holds an id an hour later (a dead-lettered job).
>
> — `data-model.md §Assumptions, 3, abridged` · full text: [data-model.md](../data-model.md)

> | Logging | pino via `platform/logger.ts`. Logs carry ids, kinds and outcome codes. Never logged: tokens, the connect token or its hash, Telegram display names, ping text, message text. Telegram failures are logged by code only (`TelegramUnavailableError` precedent). | `CLAUDE.md` + here |
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Change |
|---|---|
| `telegram_links.telegram_user_id` | read for the recipient (by link id); cleared for a `member`-removed link when its `notifications_off` job finishes |

— `data-model.md §Assumptions 3, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — the `notifications.send-bot-message` queue (+ `-dlq`) of events.md; payload `{ workspace_id, kind, telegram_link_id | telegram_user_id, reason? }` with a zod `superRefine` on the pairs. — `contracts/events.md §Event: notifications.send-bot-message, abridged` · full text: [events.md](../contracts/events.md)

## Acceptance criteria

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a member who opens a connect link
> **When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
> **Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
> **When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
> **Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently. A connected member who opens a new connect link from the Telegram account they are already connected with is told "you are already connected", and the link is used up. While a member is connected, the panel offers "Disconnect" and no connect link. Connecting another Telegram account means disconnecting first.
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — cross-context

> **Given** an operator of "Acme Flowers" whose Telegram account is linked to the "Acme Flowers" bot
> **When** they write anything in that chat, for example "ok" in answer to a ping
> **Then** the message is not captured, whatever it is: text, media, an edit or a start of the bot through any link, including a business's own campaign link. It creates no contact or conversation, does not reopen anything and counts toward no unread count or waiting marker. The bot answers that this chat only sends notifications and that replies to customers are written in the panel, with a link. It sends that answer at most once per hour. Messages the same person sent to the bot before they linked stay in their conversation as they were. Once they disconnect, their messages are captured as an end customer's again. For anyone without a Telegram link to that bot, starting the bot with a business's own campaign link is captured as before (bot-connection AC-07).
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `SendBotMessageJob` zod schema with the recipient pairs (Telegram user id as a decimal string `^[1-9][0-9]{0,19}$`) — `apps/api/src/modules/notifications/infra/jobs.ts`
- [ ] `deliverAnswer(job)`: readiness (not ready → finish), pause (→ retry after it), `answerText` (T4), `sendMemberMessage`, outcome handling; `notifications_off` clears the removed link's Telegram id on every finish incl. the last failed attempt — `apps/api/src/modules/notifications/app/deliver-answer.ts`
- [ ] Create the queue and its DLQ, register the worker (`retryLimit 2`, `expireInSeconds 30`) in `buildApp()` — `apps/api/src/app.ts`
- [ ] Logs carry workspace id, kind and outcome code only — never the text, the display name or the Telegram user id
- [ ] Unit tests per outcome and an integration test against the fake Bot API — `apps/api/src/modules/notifications/app/deliver-answer.test.ts`, `apps/api/src/modules/notifications/infra/jobs.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Payload with both recipient fields, or `cannot_connect` without `reason` | rejected by the schema |
| Bot `needs_token` | finish without sending, nothing queued |
| Member blocked the bot | finish, no retry |
| Three timeouts | dead letter; `notifications_off` still clears the id |

## Definition of Done

- [ ] Unit and integration tests prove every answer kind is sent with its TG-02 text through sendMemberMessage, a bot that does not work drops it, a pause postpones it, blocked finishes, timeouts retry twice then dead-letter, notifications_off clears the removed link's Telegram id on every finish, and no log line carries text, a name or a Telegram user id.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
