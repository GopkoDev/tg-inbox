---
id: T6
title: "Implement the conversations and contacts domain rules: message kinds, edit rule, profile refresh"
layer: "domain"
deps: []
blocks: ["T7", "T8"]
acs: ["AC-08", "AC-09", "AC-10"]
files_hint: ["apps/api/src/modules/conversations/domain/", "apps/api/src/modules/contacts/domain/"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T6 — Implement the conversations and contacts domain rules: message kinds, edit rule, profile refresh

## Place in the sequence

- **Blocked by:** — · **Blocks:** T7 — Build the contacts module: repository with isolation tests, upsert-from-profile and count use cases, T8 — Build the conversation and message repositories with cross-workspace isolation tests · **Wave:** 1 — pure rules, no I/O.
- **Lane:** own lane (two new `domain/` folders).

## Why (user story)

> **As a** Business owner
> **I want** every person who writes to the bot to become a contact from their Telegram profile
> **So that** our contact base grows without anyone typing it in
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every message from one customer kept in a single conversation, in the order it was sent and up to date with the customer's edits
> **So that** I see the whole history when I answer
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task fixes the rules that keep a contact current and a conversation correct whatever order Telegram delivers in.

## Inlined context

> modules/conversations/domain/ — message kinds (incl. "other"), edit rule (later edit time wins, update id tie-break) · modules/contacts/domain/ — profile refresh rule (newer message wins)
>
> — `sad.md §5, Internal decomposition, verbatim` · full text: [sad.md](../sad.md)

> Order by Telegram message id; edits by edit time with update-id tie-break; profile refresh by message time
>
> — `sad.md §8, Idempotency and order, abridged` · full text: [sad.md](../sad.md)

> The edit rule is a conditional update, so concurrent or out-of-order edits converge on the last one; an edit whose message is not stored matches no row and is dropped, as AC-10 requires.
>
> — `adr/0004, Decision outcome, abridged` · full text: [ADR-0004](../adr/0004-order-messages-by-telegram-message-id-and-apply-edits-by-telegram-edit-time.md)

The SQL form of both rules lives in the repositories (T7, T8); these pure functions are the spec the repositories' conditions must match and what the app-layer fakes use.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Mirrors: `messages.kind` CHECK list (15 values); `messages.edited_at` / `edit_update_id`; `contacts.profile_seen_at`.

— `data-model.md §Entities (messages, contacts), abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

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

## Checklist

- [ ] `MESSAGE_KINDS` (15 values) + `MessageKind` type — `conversations/domain/message.ts`
- [ ] `isLaterEdit(stored: {editedAt, editUpdateId} | null, incoming: {editedAt, updateId})` — later `edit_date` wins, equal → higher `update_id` wins, equal both → not later — `conversations/domain/edit.ts`
- [ ] `shouldRefreshProfile(storedSeenAt, messageDate)` — strictly later only — `contacts/domain/profile.ts`
- [ ] Unit tests — `*.test.ts` next to each

## Edge cases

| Case | Behaviour |
|---|---|
| Two edits with the same `edit_date` | higher `update_id` wins |
| Redelivered edit (same date + update id) | not later → no change |
| First edit of an unedited message | later |
| Message dated same second as stored profile | no refresh |

## Definition of Done

- [ ] unit tests cover both tie-breaks and the redelivery case; no I/O in either `domain/`
- [ ] lint + vet clean (`pnpm lint`)
