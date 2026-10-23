---
id: T9
title: "Show \"blocked the bot\" on Contacts reads: list rows and the profile gain blocked_since for the current Telegram bot through a late-bound currentBot port"
layer: "app"
deps: ["T7", "T8"]
blocks: ["T26"]
acs: ["AC-10", "AC-14"]
files_hint: ["apps/api/src/modules/contacts/app/contacts.ts", "apps/api/src/modules/contacts/app/contacts.test.ts", "apps/api/src/modules/contacts/app/ports.ts", "apps/api/src/modules/contacts/infra/contact-list-query.ts", "apps/api/src/modules/contacts/infra/contact-repo.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
step: ""
---

# T9 — Show "blocked the bot" on Contacts reads: list rows and the profile gain blocked_since for the current Telegram bot through a late-bound currentBot port

## Place in the sequence

- **Blocked by:** T7 — Record reachability in contacts: capture's upsertFromProfile takes the receiving bot's Telegram id and writes "wrote" (clearing an older block), recordBlockChange applies a block or unblock only when newer, and contact.changed reach fires only when a mark changed, T8 — Evaluate audiences in contacts with the Contacts filter rules: the breakdown for a tag audience or a list of ids against a Telegram bot, the reachable set sorted by id, existing tags, contacts matching a search and filter, contact cards and the blocked check at a recipient's turn · **Blocks:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Wave:** 4 — after T7, T8.
- **Lane:** shares `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/infra/contact-repo.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/infra/contact-list-query.ts` with T8 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to see on a contact that they have blocked the bot, and have such contacts left out of broadcasts
> **So that** the team does not count on reaching customers the bot cannot reach
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It puts the block mark on the Contacts list row and the profile, always for the Telegram bot the workspace has now, so the team sees who the bot cannot reach outside broadcasts too.

## Inlined context

> | contacts | list / profile rows gain `blocked_since` for the current bot (via the `currentBot` port) | web (SCR-18, SCR-19) | AC-14 |
>
> — `sad.md §5, App-layer additions, contacts row, verbatim` · full text: [sad.md](../sad.md)

> `contacts` gets its `currentBot` port from the `bots` core, late-bound like the existing ports (a runtime edge, no import).
>
> — `sad.md §5, Building block view intro, verbatim` · full text: [sad.md](../sad.md)

> Every read asks `bots` for the current Telegram bot id and shows "blocked the bot since …" for that bot only. Reconnecting the same Telegram bot keeps the marks, and connecting a different one finds no rows, so its contacts count as never wrote to the current bot and are left out at launch (AC-10).
>
> — `sad.md §6, Flow 16, prose, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. Keying by the Telegram bot id makes "same bot keeps, different bot resets" true by construction, with no reset job. […]
> - A new runtime port `currentBot` in `contacts`.
>
> — `adr/0002 §Decision outcome + §Consequences (Negative), ADR-0002, abridged` · full text: [ADR-0002](../adr/0002-keep-per-bot-reachability-of-contacts-in-contacts-keyed-by-the-telegram-bot-id.md)

> The bot id comes from the `currentBot` port; the marks are read by `contact_bot_reach_pkey` for the listed page only. With no bot row every row answers null.
>
> — `contracts/openapi.yaml, operationId listContacts, description, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> **Cross-module:** call the other module's **app layer** (passed in via the composition root). Never query another module's tables.
>
> — `CLAUDE.md §Rules, Cross-module, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Change |
|---|---|---|---|
| `contact_bot_reach.blocked_at` | timestamptz | NULL, `<= changed_at` | read-only (→ `blocked_since`) |
| `contact_bot_reach` PK | `(workspace_id, contact_id, telegram_bot_id)` | `contact_bot_reach_pkey` | read-only, page ids only |

— `data-model.md §Entities, contact_bot_reach, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `GET /api/workspaces/{workspaceId}/contacts` (`listContacts`) → `200 ContactPage`; each `ContactRow` gains `blocked_since: string(date-time) | null` — "`contact_bot_reach.blocked_at` for (workspace, contact, the current Telegram bot id); null when not blocked, when there is no reach row, or when the workspace has no bot".
- `GET /api/workspaces/{workspaceId}/contacts/{contactId}` (`getContact`) → `200 ContactProfile` gains `blocked_since`, as `ContactRow.blocked_since`. Errors unchanged.
- The zod schemas are T4's (`packages/shared/src/contacts.ts`); this task fills the field.

— `contracts/openapi.yaml, operationId listContacts / getContact, schema ContactRow, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-10 — cross-context

> **Given** a business owner of "Acme Flowers" about to launch a draft
> **When** the workspace has no bot connected, or its bot is not working (the token was revoked), or the workspace connected a different bot since some of the audience last wrote
> **Then** with no bot or a bot that is not working, launch is refused, the draft stays a draft, and the owner is told why and offered the way to the bot settings; contacts who have never written to the bot connected now cannot be reached by it, so they are left out at launch and counted apart in the draft and the confirmation ("never wrote to the current bot"), and blocked marks learned with the old bot do not apply to the new one; reconnecting the same Telegram bot is not a change of bot, so its blocked marks and who wrote to it stay; drafts can be created, edited and duplicated while the bot is missing or not working
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Declare `CurrentBot` (`currentBot(workspaceId): Promise<{ telegramBotId: bigint } | null>`) in the contacts ports, late-bound (filled in `buildDeps()` by T26) — `apps/api/src/modules/contacts/app/ports.ts`
- [ ] Failing unit tests first: the list and profile use cases pass the current bot id (or null) to the reads — `apps/api/src/modules/contacts/app/contacts.test.ts`
- [ ] List query: one `LEFT JOIN contact_bot_reach` on `(workspace_id, contact_id, telegram_bot_id = $bot)` for the page rows only; null bot → `blocked_since` null without the join — `apps/api/src/modules/contacts/infra/contact-list-query.ts`
- [ ] Profile read: the same lookup by the reach PK — `apps/api/src/modules/contacts/infra/contact-repo.ts`
- [ ] Use cases map `blocked_at` → `blocked_since` — `apps/api/src/modules/contacts/app/contacts.ts`
- [ ] Integration tests: blocked for the current bot, unblocked, blocked only for an older bot id, no bot row, and a foreign workspace's reach row never shows (isolation) — `apps/api/src/modules/contacts/infra/` int tests

## Edge cases

| Case | Behaviour |
|---|---|
| workspace has no bot row | every `blocked_since` is null (AC-10) |
| contact blocked an older Telegram bot only | null — marks of another bot do not apply (AC-10) |
| same Telegram bot reconnected | the mark stays (same `telegram_bot_id`) (AC-10) |
| contact unblocked or wrote again | null after T7 cleared `blocked_at` (AC-14) |
| reach row of another workspace | never read (composite key + `workspace_id` filter) |

## Definition of Done

- [ ] Unit and integration tests prove a list row and a profile carry blocked_since when the contact is blocked for the current Telegram bot and null when unblocked, when blocked only for an older bot, or when the workspace has no bot, and that the list query keeps its contacts §6 plan (no extra query per row).
- [ ] An `EXPLAIN` in the integration test (or the existing contacts plan check) shows the reach lookup as an index access on `contact_bot_reach_pkey`, not a per-row query.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)

## Implementation notes

- From T4: `apps/api/src/modules/contacts/app/contacts.ts` answers `blocked_since: null` in `listContacts` and `getContact` as a placeholder — replace it with the current bot's mark here.
