---
id: T28
title: "Build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation"
layer: "ui"
deps: ["T26", "T27"]
blocks: ["T22", "T29"]
acs: ["AC-09", "AC-10", "AC-11", "AC-12", "AC-14"]
files_hint: ["apps/web/src/features/inbox/ReplyDeliveryState.tsx", "apps/web/src/features/inbox/ReplyDeliveryState.test.tsx", "apps/web/src/features/inbox/SendAgainDialog.tsx", "apps/web/src/features/inbox/SendAgainDialog.test.tsx", "apps/web/src/features/inbox/MessageBubble.tsx", "apps/web/src/features/inbox/store.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T28 — Build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation

## Place in the sequence

- **Blocked by:** T26 — Build MessageContent for every message kind with media fetched through the API client, and SCR-03, the media viewer, T27 — Build the real reply composer and SCR-04: client key and drafts, sending lock, validation, rate limit, bot-unavailable states and the teammate confirmation · **Blocks:** T22 — Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components, T29 — Add browser end-to-end inbox flows against the real API and the fake Bot API · **Wave:** 5 — after T26, T27.
- **Lane:** shares `MessageBubble.tsx` with T25/T26 and `store.ts` with T23/T27 — serialized last of the UI lane.

## Why (user story)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It tells the operator, under every reply, whether it reached the customer — and offers the one safe next step.

## Inlined context

> | reply: sending | `state: sending` — «Sending» with a clock icon; also while Telegram is retried for up to 5 minutes, and while an earlier reply of this conversation is still sending (AC-06, AC-12; flow 1, flow 9) |
> | reply: sent | `state: sent` — «Sent» with a check icon; the list row moves to the top and its «Waiting for a reply» marker goes (AC-06) |
> | reply: not delivered — customer | `failure_reason` `customer_blocked` → «Not delivered — the customer blocked the bot»; `customer_account_gone` / `chat_not_found` → «Not delivered — the customer's Telegram account no longer exists»; then the hint «They can be reached again only after they unblock the bot and write to it» (blocked) — no button; the waiting marker stays; the composer stays usable (AC-10) |
> | reply: not delivered — bot | `bot_not_working` → «Not delivered — the bot is not working» — no button (AC-13; flow 9) |
> | reply: not delivered — author removed | `author_access_removed` → «Not delivered — the author's access was removed» — no button (AC-09; flow 9) |
> | reply: not delivered — try again | `telegram_not_accepted` → «Not delivered — Telegram did not accept it» + **Try again**; `delivery_interrupted` → «Not delivered — sending was interrupted» + **Try again** (Decision 1) (AC-12; flow 7, flow 9) |
> | reply: not confirmed | `state: not_confirmed` — «Not confirmed — it may or may not have reached the customer» + **Send again** → SCR-05; never resent on its own (AC-11; flow 1, flow 9) |
> | reply: bot taken over | while the bot is `taken_over`, every reply's state line also shows «New customer messages are not arriving» (with a warning icon) next to its delivery state (AC-14; flow 8) |
>
> — `screens.md §SCR-02, reply rows, verbatim` · full text: [screens.md](../screens.md)

> | reply: resending | **Try again** pressed — the button is disabled with a spinner while `resendReply` is in flight; on `200` the reply moves to the end of the thread at its new time as «Sending» (AC-12; flow 7) |
> | reply: resend refused | `resendReply` `409 REPLY_NOT_RESENDABLE` → the reply is redrawn from `details.reply` (someone already resent it), no message; `429 REPLY_LIMIT_REACHED` → under that reply «Replies are limited to 30 per minute — you can send again in N seconds», the reply keeps its state; `409 BOT_CANNOT_REPLY` → the reply keeps its state and the composer turns `unavailable` from `details.bot`; network / `500` → «Something went wrong — try again» under the reply (AC-11, AC-12b, AC-13; flow 7) |
>
> — `screens.md §SCR-02, reply rows, verbatim` · full text: [screens.md](../screens.md)

> SCR-05 — default: `AlertDialog` «Send this reply again?»; «tg-inbox could not confirm that it reached the customer. If it did, the customer will receive it twice.»; **Cancel** / **Send again** · cancelled (stays «Not confirmed», nothing sent) · pending (`resendReply` with `confirm_duplicate_risk: true`) · success (moves to the end as «Sending») · error: confirmation required (stays open) · error: already resent (`409 REPLY_NOT_RESENDABLE` — closes, redrawn from `details.reply`) · error: refused (`429` / `409 BOT_CANNOT_REPLY`) · error (network / `500` — «Something went wrong — try again»).
>
> — `screens.md §SCR-05, abridged` · full text: [screens.md](../screens.md)

> **Try again is offered only for** `telegram_not_accepted` (AC-12) and `delivery_interrupted` (flow 9, pending api-sync-report OQ-2). The other `not_delivered` reasons show the reason without a button
>
> — `screens.md §Source, Decision 1, abridged` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`POST …/replies/{replyId}/resend` (`resendReply`, `ReplyResend { confirm_duplicate_risk? }`) → `200 ThreadReply` (`sending`, new `position_at`), `409 REPLY_NOT_RESENDABLE` (`details.reply`), `409 DUPLICATE_RISK_CONFIRMATION_REQUIRED`, `409 BOT_CANNOT_REPLY`, `429 REPLY_LIMIT_REACHED`. — `contracts/openapi.yaml, resendReply, abridged`

## Acceptance criteria

### AC-09 — authorization

> **Given** an operator of "Acme Flowers" with the inbox open
> **When** a business owner deactivates their membership, or the operator switches to another workspace in that browser tab
> **Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment; switching affects only that tab — another tab of the same account still showing "Acme Flowers" keeps working; after deactivation, the member's replies still waiting to be retried are not sent and end "not delivered — the author's access was removed"
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

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

### AC-14 — cross-context

> **Given** the bot of "Acme Flowers" is in the state "not receiving messages — another service took them over"
> **When** any member opens the inbox
> **Then** the inbox shows every member a notice that customers' new messages are not arriving in tg-inbox until a business owner reconnects the bot (with the way to the bot settings for owners); replies can still be sent, and each one shows the same notice next to its delivery state
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `ReplyDeliveryState` for every state and reason above, the taken-over note, Try again with pending/refused feedback — `features/inbox/ReplyDeliveryState.tsx`
- [ ] Plug it into the outbound `MessageBubble` slot; a resent reply moves to the end by its new `position_at` — `features/inbox/MessageBubble.tsx`, `store.ts`
- [ ] SCR-05 `AlertDialog` (Send again flow) — `features/inbox/SendAgainDialog.tsx`
- [ ] Testing Library tests for every reply state, both buttons' visibility rules, resend refusals and every SCR-05 state — `features/inbox/ReplyDeliveryState.test.tsx`, `SendAgainDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| `customer_blocked` | reason + hint, no button |
| `chat_not_found` | same text as `customer_account_gone` |
| Two members press Try again | the loser redraws from `details.reply`, no error shown |
| Cancel on SCR-05 | nothing sent, still «Not confirmed» |
| Bot `taken_over` | every reply line also shows «New customer messages are not arriving» |

## Definition of Done

- [ ] Testing Library tests cover every reply row of SCR-02 and every SCR-05 state, incl. which reasons offer Try again
- [ ] web lint + typecheck clean
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
