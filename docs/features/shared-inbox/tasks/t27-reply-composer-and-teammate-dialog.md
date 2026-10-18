---
id: T27
title: "Build the real reply composer and SCR-04: client key and drafts, sending lock, validation, rate limit, bot-unavailable states and the teammate confirmation"
layer: "ui"
deps: ["T25"]
blocks: ["T22", "T28"]
acs: ["AC-06", "AC-07", "AC-12b", "AC-13", "AC-16"]
files_hint: ["apps/web/src/features/inbox/ReplyComposer.tsx", "apps/web/src/features/inbox/ReplyComposer.test.tsx", "apps/web/src/features/inbox/reply.ts", "apps/web/src/features/inbox/TeammateRepliedDialog.tsx", "apps/web/src/features/inbox/TeammateRepliedDialog.test.tsx", "apps/web/src/features/inbox/store.ts", "apps/web/src/features/inbox/Thread.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T27 — Build the real reply composer and SCR-04: client key and drafts, sending lock, validation, rate limit, bot-unavailable states and the teammate confirmation

## Place in the sequence

- **Blocked by:** T25 — Build SCR-02's reading side: thread header, paged history, mark read when visible, live items, edits, late redeliveries and phone layout · **Blocks:** T22 — Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components, T28 — Build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation · **Wave:** 4 — after T25.
- **Lane:** shares `features/inbox/store.ts` and `Thread.tsx` with T23/T25/T28 — serialized after T25.

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

> **As a** Business owner
> **I want** the inbox to tell the whole team when the bot is not working or not receiving messages, and to point me to the bot settings
> **So that** nobody writes replies that cannot be delivered and I fix the connection quickly
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It is where a member writes and sends — and where tg-inbox stops a reply that cannot or should not go yet.

## Inlined context

> **The composer is not optimistic.** On Enter the composer locks (Send shows a spinner) while `sendReply` is in flight; on `201`/`200` the reply is appended as «Sending» and the box clears; on any refusal the text simply stays. The `201` comes back before Telegram is called (flow 1), so the reply still «appears at once» (AC-06), and no refused text ever has to be restored (AC-07, AC-12b, AC-16).
>
> — `screens.md §Source, Decision 2, verbatim` · full text: [screens.md](../screens.md)

> Composer states: empty (**Send** disabled; Enter does nothing) · ready (Enter sends, Shift+Enter new line) · validation (over 4096 UTF-16 units — `aria-invalid`, «Replies are limited to 4096 characters», text kept; a server `400` on `body` in the same slot) · sending (read-only, spinner, a second Enter ignored, retry reuses the same `client_key`) · success: reply stored (`201`/`200` — appended as «Sending» with the member's name, box clears, new `client_key`, `last_seen_reply_id` reset to the newest reply shown) · teammate replied (`409 TEAMMATE_REPLIED` → SCR-04, text kept) · rate-limited (`429` — «Replies are limited to 30 per minute — you can send again in N seconds», countdown to `details.retry_at`) · unavailable, owner (`can_reply: false` or `409 BOT_CANNOT_REPLY` — `not_connected` «Replies can't be sent — the bot is disconnected.» / `needs_token` «Replies can't be sent — the bot is not working and needs a new token.» + «They can be sent again once the bot works.» + **Open bot settings**) · unavailable, operator («Ask a business owner to fix the bot.») · available again (`bot.changed`, draft kept, no reload) · send failed («Your reply was not sent — check your connection and send again», key kept) · draft kept (per conversation, per tab).
>
> — `screens.md §SCR-02, composer rows, abridged` · full text: [screens.md](../screens.md)

> SCR-04 — default: `AlertDialog` «A teammate just replied»; «<details.reply.author.display_name> replied to this customer <how long ago from details.reply.position_at>. Send your reply anyway?»; **Keep editing** / **Send anyway** · keep editing (draft + key stay, `last_seen_reply_id` = `details.reply.id`) · pending (same request, same `client_key`, `confirm_teammate_reply: true`) · success · error: refused (`429` → rate-limited; `409 BOT_CANNOT_REPLY` → unavailable) · error (network / `500` — «Your reply was not sent — try again» in the dialog).
>
> — `screens.md §SCR-04, abridged` · full text: [screens.md](../screens.md)

> The reply composer keeps a per-conversation draft, its client reply key (§4 choice 3) and the newest teammate reply it had seen when typing began (for the AC-16 check).
>
> — `sad.md §4, UI architecture, verbatim` · full text: [sad.md](../sad.md)

> Removed by this feature: […] the composer note «Preview — nothing is sent to customers» (AC-06).
>
> — `screens.md §Source, abridged` · full text: [screens.md](../screens.md)

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

`POST …/replies` (`sendReply`, `ReplySend { client_key, body, last_seen_reply_id, confirm_teammate_reply? }`) → `201`/`200 ThreadReply`, `400 VALIDATION_ERROR`, `409 BOT_CANNOT_REPLY` (`details.bot`), `409 TEAMMATE_REPLIED` (`details.reply`), `429 REPLY_LIMIT_REACHED` (`details.retry_at`); `getInboxBotStatus` for availability. — `contracts/openapi.yaml, sendReply, abridged`

## Acceptance criteria

### AC-06 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected, in a conversation with an end customer who has not blocked the bot
> **When** they type a reply and press Enter (Shift+Enter starts a new line)
> **Then** the reply appears at once at the end of the thread marked "sending" with the operator's name, then "sent" once Telegram accepts it (within the reply-latency target of §6); the conversation moves to the top of the list for the whole team, its "waiting for a reply" marker disappears, and the reply box is empty and ready for the next reply; the preview's note that nothing is sent to customers is no longer shown
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — error

> **Given** an operator in a conversation of "Acme Flowers"
> **When** they try to send with an empty reply box, one holding only spaces or new lines, or one longer than 4096 characters
> **Then** nothing is sent and sending stays unavailable; for an over-long reply the box says replies are limited to 4096 characters and keeps the text so it can be shortened
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] Per-conversation draft `{ text, clientKey, lastSeenReplyId }` in the store; new `crypto.randomUUID()` key after a stored reply — `features/inbox/store.ts`, `reply.ts`
- [ ] Composer states above; UTF-16 length check shared with the 4096 rule; remove the preview note — `features/inbox/ReplyComposer.tsx`
- [ ] Map each `sendReply` answer to its state; bot status → unavailable / available again (role split) — `features/inbox/ReplyComposer.tsx`, `Thread.tsx`
- [ ] SCR-04 `AlertDialog` with keep editing / send anyway / pending / error — `features/inbox/TeammateRepliedDialog.tsx`
- [ ] Testing Library tests for every composer and SCR-04 state, incl. double Enter → one request, retry after network failure reusing the key — `features/inbox/ReplyComposer.test.tsx`, `TeammateRepliedDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Double Enter | one `sendReply` request |
| Network failure then retry | same `client_key` → `200` replay, never a second reply |
| Text of 4096 code points but 4097 UTF-16 units | validation state, Send disabled |
| Bot becomes unavailable while typing | draft kept, box disabled with the role's message |
| Countdown reaches `retry_at` | Send enabled again, text still there |

## Definition of Done

- [ ] Testing Library tests cover every composer state of SCR-02 and every SCR-04 state
- [ ] the preview note «Preview — nothing is sent to customers» is gone
- [ ] web lint + typecheck clean
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
