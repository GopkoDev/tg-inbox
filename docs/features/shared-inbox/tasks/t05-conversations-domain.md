---
id: T5
title: "Add the conversations domain rules: reply states and transitions, thread position order and cursors, the arrival-watermark rule"
layer: "domain"
deps: []
blocks: ["T9", "T10"]
acs: ["AC-03", "AC-11", "AC-12", "AC-15"]
files_hint: ["apps/api/src/modules/conversations/domain/reply.ts", "apps/api/src/modules/conversations/domain/reply.test.ts", "apps/api/src/modules/conversations/domain/thread.ts", "apps/api/src/modules/conversations/domain/thread.test.ts", "apps/api/src/modules/conversations/domain/read-state.ts", "apps/api/src/modules/conversations/domain/read-state.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T5 — Add the conversations domain rules: reply states and transitions, thread position order and cursors, the arrival-watermark rule

## Place in the sequence

- **Blocked by:** — · **Blocks:** T9 — Build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read, T10 — Build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction · **Wave:** 1 — nothing upstream.
- **Lane:** own lane (new files only).

## Why (user story)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every reply I send to show whether it reached Telegram, and if not, why
> **So that** no customer is left believing they were answered when they were not
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It encodes, without I/O, which state a reply may move to, where each item sits in the thread and which messages count as unread.

## Inlined context

> Rules: the thread cursor is (position time, kind, id); customer messages position by their Telegram send time (second precision — a reply and a message within the same second keep message-before-reply), replies by their (re)send time; edits never move a message; a late redelivery positions by its original send time.
>
> — `adr/0008, Decision outcome, verbatim` · full text: [ADR-0008](../adr/0008-store-replies-in-their-own-table-and-page-the-thread-by-position-time.md)

> Rules: the watermark is advanced only (never moved back) to the arrival cursor of the newest message the client has actually displayed — the server issues the cursor, so a message that arrives between the thread read and the mark is not marked read unseen; […] `memberships` gains an active-since time (set at join and on reactivation) that `workspaces` exposes with the guard result, so reactivation also resets the floor.
>
> — `adr/0005, Decision outcome, abridged` · full text: [ADR-0005](../adr/0005-track-read-state-as-a-per-member-arrival-watermark-per-conversation.md)

> **Rule:** unread = customer messages with `received_at > GREATEST(read_through_at, memberships.active_since)`. A member with no mark uses `active_since` alone. Replies never count.
>
> — `data-model.md §read_marks, Rule, verbatim` · full text: [data-model.md](../data-model.md)

> Re-queueing is allowed only from "not delivered" or "not confirmed"; the reply moves to a new position time.
>
> — `sad.md §6, Flagged by sequences, abridged` · full text: [sad.md](../sad.md)

> **Layers:** `domain` (pure, no I/O) → `app` (use cases, ports) → `infra` (Kysely repos, Telegram adapters) → `http` (routes, zod schemas). Imports flow inward only.
>
> — `CLAUDE.md §Rules, Layers, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (Mirrors `replies.state` / `failure_reason` CHECK lists and the `(sent_at, telegram_message_id)` / `(position_at, id)` index orders — `data-model.md §replies`.)

## API contract

Internal — no API surface. (The opaque `Cursor` string format — `^[A-Za-z0-9_-]+$`, ≤ 200 chars — is encoded/decoded here; `openapi.yaml components.schemas.Cursor`.)

## Acceptance criteria

### AC-03 — happy path

> **Given** an operator of "Acme Flowers" and a conversation with 600 messages and replies
> **When** they open it
> **Then** the thread shows the latest part of the history with the contact's name in its header, the customer's messages and the team's replies in the order they happened, each reply marked with the name of the member who wrote it; scrolling up loads older history until the first message; opening the conversation marks every message that has arrived in tg-inbox so far as read for this operator only — teammates' unread counts do not change (unread is counted by arrival in tg-inbox, not by place in the history); the conversation can be reopened by reload, the browser's back button or a saved link, and a link to a conversation that does not exist shows the not-found card; on a phone-width screen the list fills the screen, picking a conversation replaces it with the thread, and a back control returns to the list
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

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

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `ReplyState`, `FailureReason`, `canTransition(from, to)`: `sending → sent | not_delivered | not_confirmed`; `not_delivered | not_confirmed → sending` (re-queue, new position time); `sent` is final — `modules/conversations/domain/reply.ts`
- [ ] Thread order + cursor: compare (position time, kind with message < reply, tie-break `telegram_message_id` / id); `encodeCursor` / `decodeCursor` as base64url, reject malformed — `modules/conversations/domain/thread.ts`
- [ ] List cursor (`last_activity_at`, id) encode/decode — `modules/conversations/domain/thread.ts`
- [ ] Watermark: `raise(current, proposed, newestArrival)` = `min(max(current, proposed), newestArrival)`, never lower; `unreadFloor(mark, activeSince)` — `modules/conversations/domain/read-state.ts`
- [ ] Unit tests for every rule and the edge cases below

## Edge cases

| Case | Behaviour |
|---|---|
| Message and reply in the same second | message first |
| Late redelivery (`sent_at` earlier than shown items) | sorts at its original place; its arrival is now |
| Re-queue a `sent` or `sending` reply | `canTransition` false (→ `REPLY_NOT_RESENDABLE` upstream) |
| Watermark proposal older than the stored one | stored value kept |
| Watermark proposal in the future | clamped to the conversation's newest arrival |
| Malformed / tampered cursor | decode fails → `ValidationError` upstream |

## Definition of Done

- [ ] domain unit tests cover every transition, the same-second tie rule, cursor round-trips and malformed cursors, watermark raise/clamp
- [ ] domain files import nothing outside `domain/` and `packages/shared`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
