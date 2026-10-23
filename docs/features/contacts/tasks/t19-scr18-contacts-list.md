---
id: T19
title: "Build SCR-18, the Contacts list: ContactsTable and TagFilter with the address state, Show more, the counts, the missing-tag notice and the empty and error states, replacing ContactsPreview"
layer: "ui"
deps: ["T18"]
blocks: ["T20", "T25", "T26"]
acs: ["AC-01", "AC-02", "AC-03", "AC-10"]
files_hint: ["apps/web/src/features/contacts/ContactsTable.tsx", "apps/web/src/features/contacts/ContactsTable.test.tsx", "apps/web/src/features/contacts/TagFilter.tsx", "apps/web/src/features/contacts/TagFilter.test.tsx", "apps/web/src/features/contacts/address.ts", "apps/web/src/features/contacts/address.test.ts", "apps/web/src/pages/ContactsPage.tsx", "apps/web/src/features/contacts/ContactsPreview.tsx", "apps/web/src/features/contacts/ContactsPreview.test.tsx", "apps/web/src/app/routes.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T19 — Build SCR-18, the Contacts list: ContactsTable and TagFilter with the address state, Show more, the counts, the missing-tag notice and the empty and error states, replacing ContactsPreview

## Place in the sequence

- **Blocked by:** T18 — Add the web contacts and tags API sources and stores, with the live subscriptions to contact.changed, tags.changed, conversation.changed (never mark read) and resync · **Blocks:** T20 — Build SCR-19, the contact profile: the header card with facts and tags, the conversation card, the Conversation / Tag history tabs with TagHistoryList and ContactCrumb, and remove the contacts sample source and SampleDataBadge, T25 — Add browser end-to-end contacts flows against the real API: list and filter, profile reading without marking read, tagging live between two members, owner rename / merge / delete, the operator refusal, T26 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the contacts routes and tables, the contacts → workspaces edge, the new signals and the new components · **Wave:** 4 — after T18.
- **Lane:** Shares `apps/web/src/app/routes.tsx` with T20; shares `apps/web/src/app/routes.tsx` with T23 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the Contacts list to show the workspace's real contacts, with search and a tag filter
> **So that** I find a customer, or a group of customers, without scrolling the inbox
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It turns the Contacts preview into the workspace's real, searchable, filterable contact base with its segment size.

## Inlined context

> 1. **The Contacts address is `?q=<text>&mode=any|all|none&tag=<id>&tag=<id>`** (the contract's query names). `mode` is written only when it is not `any`. The page parses the address like the inbox lens (`features/inbox/lens.ts`): a malformed tag id, a duplicate, an unknown `mode`, or tags together with `mode=none` are dropped from the address before the request (`replace`, no history entry), so the panel never sends the `400` combination. Each change of search (debounced 300 ms, as the inbox search), mode or tags pushes a history entry, so the back button walks the views (AC-02).
> 2. **The tag filter is one `Popover`** behind a **Tags** toolbar button: a `RadioGroup` «Any of these tags» / «All of these tags» / «No tags» on top, then one `Checkbox` per workspace tag in tag-list order with its contact count. Choosing «No tags» clears and disables the checkboxes; checking a tag while «No tags» is chosen switches to «Any of». The button reads «Tags», «Tags · 2», «All of 2 tags» or «No tags». The filter's tag names come from `listTags` (so a renamed tag shows its new name); the list rows' tags come from the page answer.
> 4. **Tags are shown as `Badge variant="secondary"`** in tag-list order everywhere (list rows, SCR-02 header, SCR-19), with no colour meaning. On a list row more than 3 tags collapse into «+N» (`Badge variant="outline"`, the full list in its `title`); the header and the profile wrap all of them.
> 10. **Missing values are words, not blanks** (AC-01): no username → «no username» (muted); no language → «Unknown»; no first / last wrote (data-model assumption 7) → «Never». A missing last name is simply left out of the name.
> 11. **Counts above the list:** «120 contacts» with no search or filter; «14 of 120 contacts match» with one (the segment size, AC-02). They show above the table, right-aligned in the toolbar row at desktop and on their own line below it at phone width.
>
> — `screens.md §Decisions, 1, verbatim` · full text: [screens.md](../screens.md)

> | State | Trigger / condition | Components (from the inventory) | Source-ref |
> | --- | --- | --- | --- |
> | loading | the page opens, or the search / filter changes — `listContacts` in flight; 8 `Skeleton` rows in the table, the toolbar stays usable, the count shows a short `Skeleton` (flow 4) | NEW: ContactsTable (Card, Table, Skeleton), DataTableToolbar | — |
> | default | `200` with items — columns **Contact** (`Avatar` initials, name as a link to SCR-19, `@username` or «no username» below it), **Tags** (Decision 4), **Language** (`language_code` shown as the language's English name via `Intl.DisplayNames`, else the code; «Unknown» when null), **First wrote** (`formatBotDay`, «Never» when null), **Last wrote** (`relativeTime`, full date-time in `title`; «Never» when null). Newest last wrote first. The count reads «120 contacts». No sample data, no «Sample data» label (AC-01; flow 4; `listContacts` example `firstPage`) | NEW: ContactsTable (Card, Table, Avatar, Badge), DataTableToolbar | wireframe «contacts desktop» |
> | show more | `has_next: true` — a **Show more** `Button` (`outline`) under the table; pressing it loads the next 50 after `next_cursor` and appends them (none shown twice or skipped); the button shows a spinner while loading and disappears when `has_next` is false (AC-01; flow 4) | NEW: ContactsTable, Button | wireframe «contacts desktop» |
> | error: more failed | the next page fails (network / `500`) — the rows stay; an `Alert` (destructive) under them «Couldn't load more contacts» + **Retry** (flow 4) | Alert, Button | — |
> | filtered | `q` and / or a tag filter in the address — the narrowed rows and «14 of 120 contacts match» (`matching_count` of `total_count`); the search `Input` and the Tags button show the current values (AC-02; flow 5; example `filtered`) | NEW: ContactsTable, NEW: TagFilter, DataTableToolbar, Input | wireframe «contacts filtered» |
> | filter open | the **Tags** button pressed — the `Popover` of Decision 2: mode `RadioGroup`, one `Checkbox` per tag with its count, in tag-list order; a workspace with no tags shows «No tags yet — tags are added on a contact» and only the mode «No tags» (AC-02, AC-10; flow 5) | NEW: TagFilter (Popover, RadioGroup, Checkbox, Label) | wireframe «tag filter open» |
> | filter: no tags mode | «No tags» chosen — the checkboxes clear and are disabled; the list shows contacts with no tag and their count (AC-02; flow 5) | NEW: TagFilter | — |
> | notice: tag no longer exists | `missing_tag_ids` is not empty (a saved link with a deleted, merged or foreign tag) — those ids are removed from the address (`replace`) and an `Alert` above the table says «One of the chosen tags no longer exists, so it was left out of the filter.» until the filter changes; a renamed tag filters on under its new name, with no notice (AC-02; flow 5) | Alert | — |
> | empty: nothing matches | `matching_count: 0` with `total_count > 0` — the table is replaced by «No contacts match your search and filter» + **Clear search and filter** (clears `q`, `mode` and `tag` from the address) (AC-03; flow 5) | EmptyFilterState (`actionLabel`) | — |
> | empty: no contacts, owner without a bot | `total_count: 0`, the caller is a business owner and the existing `getInboxBotStatus` answers `not_connected` — «No contacts yet. A contact appears when a customer writes to your business bot.» + **Connect bot** → SCR-08; no toolbar (AC-03; flow 4) | Card, Button | wireframe «contacts empty» |
> | empty: no contacts | `total_count: 0` in any other case (an operator, or a bot that is connected) — «No contacts yet. A contact appears when a customer writes to the business bot.»; no button, no toolbar (AC-03; flow 4) | Card | wireframe «contacts empty» |
> | error | the first `listContacts` fails (network / `500`) — destructive `Alert` «Couldn't load contacts» + **Retry** in place of the table (flow 4) | Alert, Button | — |
> | validation | N/A: the address is cleaned before the request (Decision 1), so the contract's `400` (none + tags, malformed id) cannot be sent by the panel; a `400` that still arrives is shown as `error` | — | — |
> | pick a contact | the name link → SCR-19 at `/w/<id>/contacts/<contactId>`; back returns to the same address and list (AC-01, AC-04; flow 4) | — | — |
> | live | N/A: not live (§Shared states) — a contact who writes while the list is open moves only on the next first page (flow 4 note) | — | — |
> | phone (< md) | the Language and First wrote columns are hidden (as the preview); the search takes the full width, the Tags button and the count go on the next line; the filter popover is the trigger's width, at least 280 px | NEW: ContactsTable, DataTableToolbar | wireframe «contacts phone» |
> | guard states | → §Shared states | — | §Shared states |
>
> — `screens.md §SCR-18, state table, verbatim` · full text: [screens.md](../screens.md)

> - **Address state:** the Contacts list's search, filter mode (`any` / `all` / `none`) and chosen **tag ids** are URL search parameters (AC-02). Tag ids, not names, so a saved link survives a rename. The workspace switcher navigates without them. Settings → Tags is a nested settings route `settings/tags`, declared `ownerOnly` in `SettingsLayout`; a direct visit by an operator shows the in-place owners-only refusal like `settings/bot`.
>
> — `sad.md §4, UI architecture, Address state, verbatim` · full text: [sad.md](../sad.md)

> **Hard rule:** **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `listContacts` with `q`, `mode` (written only when not `any`), repeated `tag`, `after` → `ContactPage`; `listTags` for the filter labels and counts; the existing `getInboxBotStatus` for the owner's empty state.

— `contracts/openapi.yaml, operationId listContacts, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-03 — error

> **Given** an operator on the Contacts list of "Acme Flowers"
> **When** the search and filter match no contact, or the workspace has no contacts yet
> **Then** in the first case the list is replaced by one sentence saying no contact matches, with a button that clears the search and filter; in the second it explains that a contact appears when a customer writes to the business bot, and a business owner whose workspace has no connected bot is offered the way to the bot settings
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — happy path

> **Given** a business owner of "Acme Flowers" whose workspace has the tags "VIP" (14 contacts), "Kyiv" (30) and "Wholesale" (0)
> **When** they open Settings → Tags and choose the count next to "Kyiv"
> **Then** the section lists every tag of the workspace with the number of contacts carrying it, in dictionary order ignoring letter case, including tags no contact carries, with rename and delete on each tag and no way to create one there; choosing a count opens the Contacts list filtered by that tag, which shows the same number of matching contacts
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Address parse / write like `features/inbox/lens.ts`: drop malformed or duplicate ids, unknown `mode`, tags with `none` (`replace`); push on each change; search debounced 300 ms — `apps/web/src/features/contacts/address.ts` (+ test)
- [ ] `TagFilter` (Popover, RadioGroup, Checkbox, Label, Button) per Decision 2 — `apps/web/src/features/contacts/TagFilter.tsx` (+ test)
- [ ] `ContactsTable` (DataTableToolbar, Input, Card, Table, Avatar, Badge, Button, Alert, Skeleton, EmptyFilterState) with every SCR-18 state — `apps/web/src/features/contacts/ContactsTable.tsx` (+ test)
- [ ] `ContactsPage` renders `ContactsTable`; delete `ContactsPreview` and its test; the route uses the real page — `apps/web/src/pages/ContactsPage.tsx`, `apps/web/src/app/routes.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| `missing_tag_ids` not empty | ids removed from the address (`replace`) and the notice shown (AC-02) |
| `matching_count: 0`, `total_count > 0` | «No contacts match your search and filter» + Clear (AC-03) |
| `total_count: 0`, owner, bot not connected | the empty card with **Connect bot** (AC-03) |
| workspace switched | no search, no filter (AC-02) |
| a count link from SCR-21 `?tag=<id>` | the same number as the count (AC-10) |

## Definition of Done

- [ ] Testing Library tests cover every SCR-18 state in screens.md (loading, default with «Never» / «Unknown» / «no username», show more without repeats, more failed, filtered with «N of M contacts match», filter open with the three modes and the no-tags rule, missing-tag notice, both empty states, error, phone), the address round-trips search, mode and tag ids through reload and back, and ContactsPreview is gone.
- [ ] Component tests also prove a row's contact name opens the profile at its address (AC-04), a workspace switch starts with no search and no filter (AC-02), and that a 401 on listContacts returns to the same address (search and filter included) after sign-in while 403 ACCESS_REMOVED shows the access-removed landing (AC-12) (test plan).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
