---
id: T9
title: "Build the contacts list query (search, any / all / none with the all-of grouped semi-join, keyset with the NULL tail, tags per row, matching and total counts) and the profile read"
layer: "infra"
deps: ["T2", "T3"]
blocks: ["T10"]
acs: ["AC-01", "AC-02", "AC-12"]
files_hint: ["apps/api/src/modules/contacts/infra/contact-list-query.ts", "apps/api/src/modules/contacts/infra/contact-list-query.int.test.ts", "apps/api/src/modules/contacts/infra/contact-repo.ts", "apps/api/src/modules/contacts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T9 — Build the contacts list query (search, any / all / none with the all-of grouped semi-join, keyset with the NULL tail, tags per row, matching and total counts) and the profile read

## Place in the sequence

- **Blocked by:** T2 — Promote migrations 01–03 (first and last wrote, their backfill, the list indexes) and make capture widen first and last wrote unconditionally, T3 — Promote migrations 04–06 (tags, contact_tags, contact_tag_history), regenerate DB types and add the tag fixtures · **Blocks:** T10 — Add the contacts read use cases: the list page (normalised search, resolved and missing tag ids, the none-with-tags refusal), the profile with adders' names and the tag-history page with actors' names, through a contacts → workspaces display-name port · **Wave:** 3 — after T2, T3.
- **Lane:** Shares `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T2; shares `apps/api/src/modules/contacts/app/ports.ts` with T6; shares `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts` with T8; shares `apps/api/src/modules/contacts/app/ports.ts` with T10; shares `apps/api/src/modules/contacts/app/ports.ts` with T11; shares `apps/api/src/modules/contacts/app/ports.ts` with T13 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the Contacts list to show the workspace's real contacts, with search and a tag filter
> **So that** I find a customer, or a group of customers, without scrolling the inbox
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It answers the list, its filter and its counts — the segment size — with one-module queries on the contact's own columns.

## Inlined context

> - **Contacts list query (AC-01, AC-02, AC-03).** Predicates: the search reuses `normalizeSearchQuery` and the `searchContactIds` matching rule (inlined in the list query, not a separate id list); `any` = `EXISTS (contact_tags … tag_id = ANY($ids))`; `all` = number of matching `contact_tags` rows = `cardinality($ids)`; `none` = `NOT EXISTS`. Requested tag ids are first resolved against the workspace's tags; ids that do not resolve are dropped and returned as `missing_tag_ids` so the page can say one of the chosen tags no longer exists. A page returns 50 rows, the cursor `(last_wrote_at, id)`, each row's tags in tag-list order, the matching count and the workspace total. Indexes (indicative, `data-model` verifies): `contacts (workspace_id, last_wrote_at DESC, id DESC)`; `contact_tags` primary key `(contact_id, tag_id)` + `(workspace_id, tag_id, contact_id)`; `tags` unique `(workspace_id, name_key)`. At 10 000 contacts per workspace the search and count are bounded scans of one workspace's range; a trigram index is the scaling step (§7).
>
> — `sad.md §4, Supporting choices, Contacts list query, verbatim` · full text: [sad.md](../sad.md)

> 10. **All-of uses a grouped semi-join.** The `all of` predicate is written as `c.id IN (SELECT contact_id FROM contact_tags WHERE workspace_id = $w AND tag_id = ANY($ids) GROUP BY contact_id HAVING count(*) = cardinality($ids))`. A correlated count per contact took 466 ms at 10 000 contacts, and the grouped form took 4 ms (audit report). `tasks` should carry this into the list query.
>
> — `data-model.md §Assumptions, 10, verbatim` · full text: [data-model.md](../data-model.md)

> 5. **The `all of` predicate must be a grouped semi-join** (assumption 10). The SAD §4 wording "number of matching `contact_tags` rows = `cardinality($ids)`" is the same rule; the correlated form measured 466 ms, close to the 500 ms target, while the grouped form measured 4 ms.
>
> — `_audit/data-model-2026-10-19.md §Deviations from the SAD, 5, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - Contacts list first page and next page after a `(last_wrote_at, id)` cursor, with or without search and tag filter, and the matching and total counts (flows 4, 5) → `contacts_workspace_id_last_wrote_at_id_idx`. The cursor predicate is `(last_wrote_at < $t OR (last_wrote_at = $t AND id < $id) OR last_wrote_at IS NULL)` for a cursor in the dated part, and `(last_wrote_at IS NULL AND id < $id)` in the NULL tail.
>
> — `data-model.md §Entities, contacts, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> - **Loading the next 50 continues from the last contact shown.** No contact appears twice and none that was in the list is skipped. A contact who writes while the list is open moves to the top only when the list is opened again or its search or filter changes (AC-01).
>
> — `spec.md §1, Clarifications, next 50, verbatim` · full text: [spec.md](../spec.md)

> - **"No tags" is a third mode of the filter, not an extra tag.** Choosing it clears the chosen tags, and choosing a tag leaves it. "Any of" or "all of" with no tag chosen means no tag filter (AC-02).
>
> — `spec.md §1, Clarifications, no tags mode, verbatim` · full text: [spec.md](../spec.md)

> **Hard rule:** **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Six reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007) and one in `notifications` (_workspaces with a live Telegram link_, workspace ids only, used only by the `schedule-pings` backstop — operator-notifications ADR-0005); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Index | Columns | Query it serves |
|---|---|---|
| `contacts_workspace_id_last_wrote_at_id_idx` | `contacts (workspace_id, last_wrote_at DESC NULLS LAST, id DESC)` | The Contacts list's first and next pages, newest last wrote first, with search and filter, and its counts (flows 4, 5, AC-01, AC-02; SAD §10 QG-3 "the list uses the keyset index") |
| `contacts_workspace_id_id_key` (unique) | `contacts (workspace_id, id)` | Target of the composite FKs from `contact_tags` and `contact_tag_history` (AC-12). The profile read and the contact row lock by workspace and id (flows 6, 8, 10) |
| `contact_tags_pkey` | `contact_tags (workspace_id, contact_id, tag_id)` | One link per contact and tag (AC-06, AC-09). The contact's tags, the carried / count check, the `any` / `none` existence checks (flows 4, 5, 6, 8, 10). FK index for `workspace_id` and the contact composite FK |
| `contact_tags_workspace_id_tag_id_contact_id_idx` | `contact_tags (workspace_id, tag_id, contact_id)` | Count per tag (flow 12, AC-10). `any of` / `all of` with the matching count (flow 5, AC-02). Owner merge and delete (flow 13, seeded flow 2). FK index for the tag composite FK |

— `data-model.md §Indexes, verbatim` · full text: [data-model.md](../data-model.md)

| Query | Plan | Time |
|---|---|---|
  | List first page | index-only scan `contacts_workspace_id_last_wrote_at_id_idx`, 50 rows | 0.1 ms |
  | `all of` 2 tags, count — correlated count per contact | `contact_tags_pkey` probed 10 003 times | **466 ms** |
  | `all of` 2 tags, count — grouped semi-join (assumption 10) | bitmap on `…_tag_id_contact_id_idx`, group, `contacts_pkey` | **3.8 ms** |
  | `no tags` count | hash anti-join | 11 ms |

— `_audit/data-model-2026-10-19.md §Verification, EXPLAIN (ANALYZE), verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

## API contract

Internal — no API surface. Backs `listContacts` rows (`ContactRow`: facts, `first_wrote_at`, `last_wrote_at`, `tags: TagRef[]` in tag-list order), `next_cursor` (`last_wrote_at` or none, `id`), `matching_count`, `total_count`; and `getContact`'s facts.

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

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `listPage(ws, { q, mode, tagIds, after })`: search predicate inlined from the `searchContactIds` rule; `any` = `EXISTS … tag_id = ANY($ids)`; `all` = `c.id IN (SELECT contact_id … GROUP BY contact_id HAVING count(*) = cardinality($ids))`; `none` = `NOT EXISTS`; keyset `(last_wrote_at DESC NULLS LAST, id DESC)` with both cursor shapes; 50 + 1 rows for `has_next` — `apps/api/src/modules/contacts/infra/contact-list-query.ts`
- [ ] `matchingCount` with the same predicates, `totalCount` of the workspace; each page's tags through T7's `tagsOfMany` — same file
- [ ] `profile(ws, contactId)` → facts with first / last wrote — `apps/api/src/modules/contacts/infra/contact-repo.ts`
- [ ] Port additions — `apps/api/src/modules/contacts/app/ports.ts`
- [ ] Integration tests per mode, the NULL tail, ties by id, a cross-workspace case, and an `EXPLAIN` check that the first page uses `contacts_workspace_id_last_wrote_at_id_idx` and the all-of count is the grouped form — `apps/api/src/modules/contacts/infra/contact-list-query.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| two contacts with the same `last_wrote_at` across a page boundary | ordered by id; neither repeated nor skipped |
| the cursor reaches the NULL-`last_wrote_at` tail | the second cursor shape `(last_wrote_at IS NULL AND id < $id)` |
| `any` / `all` with an empty id list | no tag predicate (AC-02) |
| a search `"@Test "` | matches `test` in name or username, any case |
| a tag id of another workspace | never matches: links are scoped by workspace (AC-12) |

## Definition of Done

- [ ] Integration tests prove ordering by last wrote with id ties and the NULL tail, strict keyset continuation, the search rule, any / all / none and their matching and total counts, cross-workspace isolation, and an EXPLAIN check that the list uses its keyset index and that all-of runs as the grouped semi-join.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
