---
id: T9
title: "Implement the conversations app layer: capture inbound message, apply edit, last message time, has conversations"
layer: "app"
deps: ["T7", "T8"]
blocks: ["T12", "T14"]
acs: ["AC-07", "AC-08", "AC-09", "AC-10", "AC-11", "AC-19"]
files_hint: ["apps/api/src/modules/conversations/app/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T9 — Implement the conversations app layer: capture inbound message, apply edit, last message time, has conversations

## Place in the sequence

- **Blocked by:** T7 — contacts module, T8 — conversation and message repositories · **Blocks:** T12 — Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation), T14 — Implement the bots use case accept-webhook-update: secret check, inbound filter, capture epoch, hand-off to conversations · **Wave:** 3.
- **Lane:** shares `modules/conversations/app/ports.ts` with T8 — serialized after it.

## Why (user story)

> **As an** End customer
> **I want** what I write to the business's bot to reach the business's team
> **So that** I get an answer without leaving Telegram or knowing who is on shift
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every message from one customer kept in a single conversation, in the order it was sent and up to date with the customer's edits
> **So that** I see the whole history when I answer
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task is the capture itself: one short transaction that creates or refreshes the contact, finds or creates the conversation, and stores the message exactly once.

## Inlined context

> `bots` → `conversations`: *capture inbound message* (workspace id, normalised message — `bots` has already applied the inbound filter and the capture epoch), *last message received time*, *has conversations* (decides whether a disconnect deletes the bot row and whether AC-05 applies).
>
> — `sad.md §5, Cross-module app-layer calls, verbatim` · full text: [sad.md](../sad.md)

> Conv->>Db: begin · Conv->>Contacts: upsert contact from profile within the transaction · Contacts->>Db: insert, or refresh when this message is newer than the stored profile · Conv->>Db: upsert the conversation of the contact · Conv->>Db: insert the message keyed by Telegram message id, ignore if present, commit · Conv-->>Bots: captured or already present · Note: a database failure answers a server error and Telegram redelivers later
>
> — `sad.md §6, Critical flow 2, steps after "captured kind", abridged` · full text: [sad.md](../sad.md)

> Cv->>D: find the message by conversation and Telegram message id · alt message not captured → nothing to edit, the edit is not kept · else stored edit time and update id are the same or later → already applied · else this edit is later → update text or caption, mark edited, store edit time and update id, only if still later
>
> — `sad.md §6, Flow 8, abridged` · full text: [sad.md](../sad.md)

> A capture transaction is a few small indexed writes — well inside the 300 ms acknowledgement budget — so the acknowledgement itself proves the message is stored, and Telegram's own redelivery replaces a home-grown retry queue.
>
> — `adr/0003, Decision outcome, abridged` · full text: [ADR-0003](../adr/0003-capture-each-update-inside-the-webhook-request-with-idempotent-writes.md)

> **Hard rule (cross-module):** call the other module's **app layer** (passed in via the composition root). Never query another module's tables.
>
> — `CLAUDE.md §Rules, Cross-module, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No schema change; writes `contacts` (through the contacts app layer), `conversations`, `messages` in one transaction — see T7/T8. `received_at` = clock now; `sent_at` = Telegram `date`.

## API contract

Internal — no API surface. Exported app-layer API: `captureInbound(workspaceId, InboundMessage) → 'captured' | 'already_present'`, `applyEdit(workspaceId, InboundEdit) → 'applied' | 'not_later' | 'not_found'`, `lastMessageReceivedAt(workspaceId) → Date | null`, `hasConversations(workspaceId) → boolean`; `InboundMessage` / `InboundEdit` types exported here for `bots` to map into.

## Acceptance criteria

### AC-07 — happy path

> **Given** "Acme Flowers" has a connected bot and an end customer who has never written to it
> **When** the end customer starts the bot or sends it a first message in a private chat (starting the bot is captured as a message like any other text)
> **Then** within the capture-latency target of §6 (2 seconds at p95) "Acme Flowers" holds a new contact built from the customer's Telegram profile (name, username, language) and a new conversation with that contact containing the message, and the bot settings show the time of that message as the last message received
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — happy path

> **Given** an end customer who already has a contact and a conversation in "Acme Flowers" and has since changed their Telegram name or username
> **When** they send the bot another message
> **Then** the message is added to their existing conversation, no second contact is created, and the contact now holds the customer's current name, username and language
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a connected bot and an end customer with a conversation in "Acme Flowers"
> **When** the customer sends a photo with a caption, a voice note, a sticker, a file, a location, or any other kind of message
> **Then** each one appears in their conversation in the order sent (each item of an album as its own message), marked with its kind — a kind tg-inbox does not recognise is marked "other" — and carrying its caption when it has one, so the workspace holds a record that something arrived; viewing its content arrives with the inbox step; later updates of a shared live location do not change the captured location
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — happy path

> **Given** a captured message in an end customer's conversation — text, or a non-text message with a caption
> **When** the customer edits its text or caption in Telegram
> **Then** the conversation holds the edited text in place of the old one, marked as edited, and no new message is added; when edits arrive out of order, the one the customer made last (by Telegram's edit time) wins; an edit of a message that has not been captured adds nothing and is not kept for later
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a message from an end customer that has already been captured
> **When** Telegram delivers the same message again (for example after a delivery retry)
> **Then** the conversation still holds it exactly once, and messages keep the order in which the customer sent them (Telegram's order for that chat), not the order in which they reached tg-inbox — a late redelivered message takes its original place
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-19 — cross-context

> **Given** "Acme Flowers" disconnected its bot earlier and its contacts and conversations remain
> **When** a business owner connects the same bot again by pasting its token and an existing end customer writes to it
> **Then** the message continues that customer's existing conversation and no duplicate contact is created
>
> — `spec.md §5, AC-19, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `createConversations({ db/transaction runner, conversations, messages, contacts: ContactsAppApi, clock })` — `conversations/app/conversations.ts`
- [ ] `captureInbound`: `transaction(tx => contacts.upsertFromProfile(…, tx) → conversations.upsertByChat(…, tx) → messages.insertIfAbsent(…, tx))`; any DB error propagates (route answers 500)
- [ ] `applyEdit`: find conversation by chat; none → `not_found`; else conditional update (rule of T6)
- [ ] `lastMessageReceivedAt`, `hasConversations` delegate to repos
- [ ] Unit tests with in-memory fakes; integration tests against Postgres: first message creates contact + conversation + message; redelivery once; concurrent first messages → one contact, one conversation, two messages; concurrent duplicate → one message; a forced failure mid-transaction leaves nothing half-written — `conversations/app/*.test.ts`, `*.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Lower message id arrives after a higher one | both stored; read back in message-id order (AC-11) |
| Edit before its original arrives | `not_found`, nothing kept; original later stored with its original text (AC-10) |
| Album (3 items, same `media_group_id`) | three messages |
| Failure after the contact upsert | whole transaction rolled back |

## Definition of Done

- [ ] unit tests with fakes and Postgres integration tests (incl. both concurrency cases and the forced-failure case) pass
- [ ] `conversations` reaches contacts only through the contacts app layer
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
