---
id: T7
title: "Build the contacts module: repository with isolation tests, upsert-from-profile and count use cases"
layer: "infra"
deps: ["T1", "T6"]
blocks: ["T9", "T12"]
acs: ["AC-07", "AC-08", "AC-13", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/app/", "apps/api/src/modules/contacts/infra/", "apps/api/src/test/fixtures/contacts.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T7 — Build the contacts module: repository with isolation tests, upsert-from-profile and count use cases

## Place in the sequence

- **Blocked by:** T1 — migrations, T6 — profile refresh rule · **Blocks:** T9 — Implement the conversations app layer: capture inbound message, apply edit, last message time, has conversations, T12 — Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation) · **Wave:** 2.
- **Lane:** own lane (new module; own fixture file).

## Why (user story)

> **As a** Business owner
> **I want** every person who writes to the bot to become a contact from their Telegram profile
> **So that** our contact base grows without anyone typing it in
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

This task builds the contact store the capture transaction writes into and the count the settings page shows.

## Inlined context

> `conversations` → `contacts`: *upsert contact from profile* within the capture transaction (refreshes name, username and language only when the message is newer than the stored profile). `bots` → `contacts`: *count contacts* for the settings page.
>
> — `sad.md §5, Cross-module app-layer calls, abridged` · full text: [sad.md](../sad.md)

> The one atomic cross-module write (contact upsert inside the capture transaction) follows the workspace-operators precedent of passing a transaction into the other module's app layer (its ADR-0005).
>
> — `adr/0005, Decision outcome, abridged` · full text: [ADR-0005](../adr/0005-split-the-feature-into-bots-conversations-and-contacts-modules.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> `insertContact(db, { workspaceId, telegramUserId?, firstName?, username?, languageCode?, profileSeenAt? })` defaults to `firstName: 'Test User'`, `username: null` and `languageCode: 'en'`.
>
> — `data-model.md §Test fixtures, verbatim` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Change |
|---|---|---|---|
| `contacts.workspace_id`, `telegram_user_id` | uuid, bigint | UNIQUE (`workspace_id`, `telegram_user_id`) | read/write |
| `first_name` / `last_name` / `username` / `language_code` | text | `first_name` NOT NULL | written on insert; refreshed on newer message |
| `profile_seen_at` | timestamptz | NOT NULL | `ON CONFLICT … DO UPDATE … WHERE contacts.profile_seen_at < excluded.profile_seen_at` |
| `created_at` | timestamptz | NOT NULL | clock time on insert |

Count: same unique index, index-only by leading `workspace_id`.

— `data-model.md §Entities, contacts, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

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

### AC-13 — cross-context

> **Given** "Acme Flowers" and "Bolt Bikes" each have a connected bot, and one person writes to both bots
> **When** both messages are captured
> **Then** each workspace has its own contact and conversation for that person, holding only the messages sent to its own bot, and neither workspace can see that the other one knows the person
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
> **When** they open the bot settings
> **Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token; the state, name and username are checked with Telegram in the background and are never more than 5 minutes old, and a failed exchange with Telegram changes the state at once
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Port `ContactRepo { upsertFromProfile(workspaceId, profile, seenAt, now, tx?) → { contactId, created }, count(workspaceId) }` — `contacts/app/ports.ts`
- [ ] Kysely repo with `newId()`, one `INSERT … ON CONFLICT (workspace_id, telegram_user_id) DO UPDATE … WHERE profile_seen_at < excluded.profile_seen_at RETURNING id`, falling back to a select when the guarded update returns nothing — `contacts/infra/contact-repo.ts`
- [ ] App layer `createContacts({ repo, clock })` exporting `upsertFromProfile(…, tx)` and `countContacts(workspaceId)` — `contacts/app/contacts.ts` (+ unit test with an in-memory fake)
- [ ] Fixture `insertContact` — `apps/api/src/test/fixtures/contacts.ts`
- [ ] Integration tests on two workspaces: each method never returns or changes the other workspace's rows; one person (same `telegram_user_id`) in both gets two rows; concurrent first upserts produce one row — `contacts/infra/contact-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Upsert with an older `seenAt` than stored | row unchanged, existing id returned (AC-08 late redelivery) |
| Same person in "Acme" and "Bolt" | two rows; `count` is 1 in each (AC-13) |
| Two concurrent first messages | one row, both calls return the same id |

## Definition of Done

- [ ] every repository method has a passing two-workspace isolation test
- [ ] the profile-refresh and concurrency integration tests pass
- [ ] `contacts` never queries another module's tables
- [ ] lint + vet clean (`pnpm lint`)
