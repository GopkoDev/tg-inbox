---
id: T10
title: "Add the contacts read use cases: the list page (normalised search, resolved and missing tag ids, the none-with-tags refusal), the profile with adders' names and the tag-history page with actors' names, through a contacts → workspaces display-name port"
layer: "app"
deps: ["T4", "T5", "T7", "T9"]
blocks: ["T16"]
acs: ["AC-01", "AC-02", "AC-04", "AC-13"]
files_hint: ["apps/api/src/modules/contacts/app/contacts.ts", "apps/api/src/modules/contacts/app/contacts.test.ts", "apps/api/src/modules/contacts/app/ports.ts", "apps/api/src/modules/contacts/app/fakes.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T10 — Add the contacts read use cases: the list page (normalised search, resolved and missing tag ids, the none-with-tags refusal), the profile with adders' names and the tag-history page with actors' names, through a contacts → workspaces display-name port

## Place in the sequence

- **Blocked by:** T4 — Add the contacts zod contracts, the eight tag error codes, and the contact.changed / tags.changed frames and signals with their hub mapping, T5 — Add the tags domain: the limits (100 per workspace, 20 per contact, 60 per 60 s, 50 per page), the history kinds and sources, the merge link rule and the rate-limit retry time, T7 — Build the contact-tag and tag-history repositories for member changes: the contact row lock, a contact's tags in tag-list order, link insert and delete, history entries, the history keyset page and the member-kind rate count, with isolation tests, T9 — Build the contacts list query (search, any / all / none with the all-of grouped semi-join, keyset with the NULL tail, tags per row, matching and total counts) and the profile read · **Blocks:** T16 — Register the contacts routes (registerContacts): the eight operations with their zod schemas, the ownerOnly guard on rename and delete, and the wiring in buildDeps and buildApp · **Wave:** 4 — after T4, T5, T7, T9.
- **Lane:** Shares `apps/api/src/modules/contacts/app/ports.ts` with T2; shares `apps/api/src/modules/contacts/app/ports.ts` with T6; shares `apps/api/src/modules/contacts/app/ports.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts` with T8; shares `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/app/fakes.ts` with T11; shares `apps/api/src/modules/contacts/app/ports.ts` with T13; shares `apps/api/src/deps.ts` with T16 — serialized.

## Why (user story)

> **As an** Operator
> **I want** a contact's profile with what Telegram tells us, their tags, where their conversation stands and its history
> **So that** I understand the customer before I answer and can jump into the conversation
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It composes what the list and the profile show, with every member named — deactivated ones included.

## Inlined context

> - `contacts` → `workspaces`: display names by account ids (existing read), for adders and history actors.
>
> — `sad.md §5, Cross-module app-layer calls, verbatim` · full text: [sad.md](../sad.md)

> - **Display names.** Adders and actors are stored as account ids and resolved at read time through `workspaces` display names (including deactivated members, AC-13).
>
> — `sad.md §4, Supporting choices, Display names, verbatim` · full text: [sad.md](../sad.md)

> Dependency graph after the change: `inbox → {conversations, contacts, bots, workspaces, notifications}`, `notifications → {conversations, workspaces, bots}`, `bots → conversations → contacts`, `bots → contacts`, **`contacts → workspaces`** (new, app layer, display names). Acyclic: `workspaces` imports no feature module.
>
> — `sad.md §5, dependency graph, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. Tags are a property of the contact, so the module that owns contacts owns their tags and can lock the contact row and enforce the limits locally. Keeping the conversation part in `inbox` reads avoids a cycle and reuses the exact reads the inbox screen already trusts (ADR-0006).
>
> — `adr/0001-own-tags-in-the-contacts-module-with-its-own-routes-and-compose-the-profile-conversation-from-inbox-reads.md §Decision outcome, ADR-0001, verbatim` · full text: [ADR-0001](../adr/0001-own-tags-in-the-contacts-module-with-its-own-routes-and-compose-the-profile-conversation-from-inbox-reads.md)

> 3. **The list filter is `mode` + repeated `tag`** (`?mode=all&tag=<id>&tag=<id>`), at most 100 ids (the workspace limit). `mode` defaults to `any`. `mode=none` with a `tag` is `400 VALIDATION_ERROR` with `details.field = tag` (sad.md §6 flag: "a plain validation error is enough"; the repo code is `VALIDATION_ERROR`, not the SAD's `VALIDATION_FAILED`).
> 5. **One cursor type** — the shared-inbox opaque `Cursor`. The list cursor encodes (`last_wrote_at` or none, `id`), the history cursor (`created_at`, `id`). `has_prev` is true when `after` was given, as in the inbox.
> 6. **`ContactPage.filter` echoes what the page answers** (the normalised `q`, `mode`, the resolved `tag_ids`), so the panel can check that a late answer still matches the address, like `ConversationPage.lens`. `matching_count` equals `total_count` when no search or filter is given.
>
> — `contracts/api-sync-report.md §Assumptions, 3, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> **Hard rule:** **Cross-module:** call the other module's **app layer** (passed in via the composition root). Never query another module's tables. Async work → pg-boss queue `<module>.<job>`; live updates → `platform/realtime` signals published inside the writing transaction (ids only), fanned out by the `inbox` hub.
>
> — `CLAUDE.md §Rules, Cross-module, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads T7 / T9 repositories).

## API contract

- `GET …/contacts?q&mode&tag&after` → `200 ContactPage { workspace_id, filter { q, mode, tag_ids }, items, has_prev, has_next, next_cursor, matching_count, total_count, missing_tag_ids }`.
- `GET …/contacts/{contactId}` → `200 ContactProfile` (tags as `ContactTag` with `added_by: MemberRef`) · `404 NOT_FOUND`.
- `GET …/contacts/{contactId}/tag-history?after` → `200 TagHistoryPage` (entries with `actor: MemberRef`) · `404 NOT_FOUND`.

— `contracts/openapi.yaml, operationIds listContacts, getContact, listContactTagHistory, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose bot has captured 120 contacts, some of them tagged
> **When** they open Contacts
> **Then** the list shows the contacts of "Acme Flowers" and nothing else, with no sample data and no "Sample data" label: each row shows the contact's name and username, their tags in tag-list order, language, when they first wrote and when they last wrote (by the send time of their own messages; the team's replies do not count), ordered by when they last wrote, newest first, 50 at a time with the next ones on request, continuing from the last contact shown so that none is shown twice or skipped, and the page says how many contacts there are in total; a contact with no username or no known language shows that it has none instead of an empty value; choosing a contact opens their profile; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — happy path

> **Given** an operator on the Contacts list of "Acme Flowers"
> **When** they type part of a name or username into the search, and choose tags in the filter with "any of", "all of", or "no tags"
> **Then** the list shows only the contacts that match both: the search follows the inbox search rules (anywhere in the full name or username, ignoring letter case in any alphabet, surrounding spaces and a leading "@"), "any of" keeps contacts carrying at least one chosen tag, "all of" keeps contacts carrying every chosen tag, and "no tags" keeps contacts with no tag at all ("no tags" is a mode of its own: it cannot be combined with chosen tags, and "any of" or "all of" with no tag chosen filters nothing); the page says how many contacts match; the search and filter are part of the page's address, so a reload, the back button or a saved link opens the same view, and switching to another workspace starts with no search and no filter; a saved link still filters by a tag that was renamed since, under its new name, and when a tag in the address no longer exists in this workspace (deleted, merged away, or never one of its tags) it is left out of the filter and the page says that one of the chosen tags no longer exists
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — happy path

> **Given** a contact of "Acme Flowers" whose conversation is open, assigned to a teammate and waiting for a reply
> **When** an operator opens the contact's profile (from the list, from the contact's name in the inbox conversation header, or by a saved link)
> **Then** the profile shows the contact's name, username, language, when they first wrote and when they last wrote, their tags with who added each one and when, the contact's tag history (each tag added, removed, merged or removed by a delete, by whom and when, under the name the tag had then, newest first, older entries loaded on scrolling), and their conversation: its status, its assignee (or "unassigned"), the "waiting for a reply" marker when it applies, and a way to open it in the inbox; a history section shows the conversation's messages, the team's replies with their authors and its activity entries in the same order as in the inbox, latest first part loaded and older ones on scrolling, with media opened through the panel as in the inbox; the profile can be reopened by reload, the back button or a saved link, and a link to a contact that does not exist shows the not-found card inside the frame
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** a contact of "Acme Flowers" carrying the tags "VIP" and "Kyiv", added by an operator who has since been deactivated
> **When** the customer changes their Telegram name and writes again, or the bot of "Acme Flowers" stops working or is disconnected, or the same person writes to the bot of another workspace
> **Then** the contact shows the new name with the same tags; the tags and the tag history still show the deactivated member as the one who added them; tagging, the Contacts list and profiles work in every state of the bot, since nothing about tags goes to Telegram; the same person in another workspace is a separate contact with none of the tags of "Acme Flowers"
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `listContacts(ws, query)`: `normalizeSearchQuery`, dedupe tag ids, refuse `mode=none` + ids (`ValidationError`, `field: tag`), `resolveIds` → `missing_tag_ids`, page + counts, filter echo — `apps/api/src/modules/contacts/app/contacts.ts`
- [ ] `getContact(ws, id)` → facts + tags with adder names; `NotFoundError` for an unknown or foreign id — same file
- [ ] `listTagHistory(ws, id, after)` → entries with actor names — same file
- [ ] `DisplayNames` port satisfied by `workspaces.displayNames` in `buildDeps()` (new edge `contacts → workspaces`) — `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/deps.ts`
- [ ] Unit tests with in-memory fakes — `apps/api/src/modules/contacts/app/contacts.test.ts`, `fakes.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a saved link with a deleted, merged or foreign tag id | left out of the filter and returned in `missing_tag_ids` (AC-02) |
| a renamed tag in the address | still resolves by id and filters (AC-02) |
| `any` with no ids and no `q` | `matching_count = total_count` |
| an adder or actor who was deactivated | named by their display name (AC-13) |
| a contact id of another workspace | `NotFoundError`, no hint (AC-12) |

## Definition of Done

- [ ] Unit tests prove the list use case normalises the search, refuses none-with-tags, reports missing tag ids and echoes the filter, and that the profile and the tag-history page name adders and actors through the workspaces port, deactivated members included, with not-found for foreign ids; buildDeps wires the contacts → workspaces edge.
- [ ] Unit tests also prove any of / all of with no tag chosen filter nothing (matching_count equals total_count) and a tag renamed since the link was saved still resolves and filters (test plan AC-02).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
