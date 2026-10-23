---
id: T7
title: "Build the contact-tag and tag-history repositories for member changes: the contact row lock, a contact's tags in tag-list order, link insert and delete, history entries, the history keyset page and the member-kind rate count, with isolation tests"
layer: "infra"
deps: ["T3"]
blocks: ["T8", "T10", "T11"]
acs: ["AC-04", "AC-06", "AC-12", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/infra/contact-tag-repo.ts", "apps/api/src/modules/contacts/infra/contact-tag-repo.int.test.ts", "apps/api/src/modules/contacts/infra/tag-history-repo.ts", "apps/api/src/modules/contacts/infra/tag-history-repo.int.test.ts", "apps/api/src/modules/contacts/infra/contact-repo.ts", "apps/api/src/modules/contacts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T7 — Build the contact-tag and tag-history repositories for member changes: the contact row lock, a contact's tags in tag-list order, link insert and delete, history entries, the history keyset page and the member-kind rate count, with isolation tests

## Place in the sequence

- **Blocked by:** T3 — Promote migrations 04–06 (tags, contact_tags, contact_tag_history), regenerate DB types and add the tag fixtures · **Blocks:** T8 — Add the owner set-based statements: merge (merged entries, keep the earlier link, re-point the rest) and delete (links with RETURNING, deleted entries), T10 — Add the contacts read use cases: the list page (normalised search, resolved and missing tag ids, the none-with-tags refusal), the profile with adders' names and the tag-history page with actors' names, through a contacts → workspaces display-name port, T11 — Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals · **Wave:** 3 — after T3.
- **Lane:** Shares `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T2; shares `apps/api/src/modules/contacts/app/ports.ts` with T6; shares `apps/api/src/modules/contacts/infra/contact-tag-repo.ts`, `apps/api/src/modules/contacts/infra/contact-tag-repo.int.test.ts`, `apps/api/src/modules/contacts/infra/tag-history-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T8; shares `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/contacts/app/ports.ts` with T10; shares `apps/api/src/modules/contacts/app/ports.ts` with T11; shares `apps/api/src/modules/contacts/app/ports.ts` with T13 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It stores what a contact carries now and the append-only record of every member change, scoped to one workspace.

## Inlined context

> - The profile's tags of a contact, the "already carried, how many" check under the contact lock, the list's tags of a page of contacts, and the `any` / `none` existence checks per contact (flows 4, 5, 6, 8, 10) → `contact_tags_pkey`.
>
> — `data-model.md §Entities, contact_tags, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> - The profile's tag history of a contact, newest first, keyset by `(created_at, id)` (flow 6) → `contact_tag_history_workspace_id_contact_id_created_at_idx`. Also the §7 integrity query "a link with no `added` or `merged` entry for its tag".
> - The member rate limit: this member's `added` / `removed` entries of the last 60 s and the oldest of them for the retry time, under the `tag-changes:<ws>:<account>` advisory lock (flows 8, 9, 10, AC-15) → `contact_tag_history_workspace_id_actor_kind_created_at_idx`.
>
> — `data-model.md §Entities, contact_tag_history, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> 9. **The rate-limit index has `kind` in its key**, `(workspace_id, actor_account_id, kind, created_at)`. An owner who has just merged a tag on 10 000 contacts has 10 000 `merged` entries inside the 60 s window. With `kind` in the key, the member-kind count skips them instead of filtering them row by row (verified, audit report).
>
> — `data-model.md §Assumptions, 9, verbatim` · full text: [data-model.md](../data-model.md)

> - Adding to a contact locks the contact row (`FOR NO KEY UPDATE`), checks no-op and the 20-per-contact limit under it, then takes the tag row `FOR KEY SHARE` explicitly **before** inserting the link (a missing row = the tag was deleted or merged away → `TAG_NOT_FOUND`). Owner ops lock the affected tag rows `FOR UPDATE` (in id order), so a member add waits at that explicit tag lock before it has written any `contact_tags` index entry the owner's re-point could wait on.
>
> — `sad.md §4, strategic choice 4, member add locks, verbatim` · full text: [sad.md](../sad.md)

> - **Tag history entries keep the name the tag had at that moment.** Older entries of a renamed or deleted tag still read under the old name, and a rename writes no entry. A merge writes one entry, "«Loyal» merged into «VIP»", with the owner and the time, on every contact that carried the merged tag, whether or not it also carried the target. Contacts that carried only the target get no entry. A delete writes "removed by the owner's delete" on every contact that carried the tag. Each entry also records whether a member made the change from the inbox or from the profile (AC-04, AC-09, §7).
>
> — `spec.md §1, Clarifications, tag history entries, verbatim` · full text: [spec.md](../spec.md)

> **Hard rule:** **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Six reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007) and one in `notifications` (_workspaces with a live Telegram link_, workspace ids only, used only by the `schedule-pings` backstop — operator-notifications ADR-0005); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `workspace_id` | uuid | NOT NULL, FK → `workspaces(id)`; PK part | Tenancy. Part of both composite FKs, so contact and tag are of the same workspace (AC-12) |
| `contact_id` | uuid | NOT NULL, FK `(workspace_id, contact_id) → contacts (workspace_id, id)`; PK part | |
| `tag_id` | uuid | NOT NULL, FK `(workspace_id, tag_id) → tags (workspace_id, id)`; PK part | A tag deleted or merged away under a member's add: the explicit `FOR KEY SHARE` finds no row and the add is refused as `TAG_NOT_FOUND` (AC-14). The FK refuses to delete a tag that still has links |
| `added_by_account_id` | uuid | NOT NULL, FK `(workspace_id, added_by_account_id) → memberships` | Who added it (AC-04, AC-06). A deactivated member stays a membership row and is still shown (AC-13). A merge keeps the original adder, or the earlier one on a contact that carried both (AC-09) |
| `added_at` | timestamptz | NOT NULL | When it was added. Kept across a merge, as above |

— `data-model.md §Entities, contact_tags, verbatim` · full text: [data-model.md](../data-model.md)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK | UUIDv7. The tiebreak of the profile's keyset |
| `tag_id` | uuid | NOT NULL, **no FK** | The tag the entry is about. Kept after the tag is deleted or merged away (AC-04). The §7 integrity query matches links to entries on it |
| `tag_name` | text | NOT NULL, `<> ''` | The tag's name at that moment, so entries read correctly after renames (AC-04) |
| `kind` | text | NOT NULL, `CHECK IN ('added','removed','merged','deleted')` | `added` / `removed` by a member, `merged` by an owner's merge (one per contact that carried the merged tag), `deleted` by an owner's delete (one per contact that lost it). A rename writes none (AC-09) |
| `actor_account_id` | uuid | NOT NULL, FK `(workspace_id, actor_account_id) → memberships` | The member, or the owner for owner kinds. Resolved to a display name at read time, deactivated members included (AC-13) |
| `source` | text | NOT NULL, `CHECK IN ('inbox','profile','settings')`; `inbox` / `profile` ⇔ member kinds, `settings` ⇔ owner kinds | Member routes accept only `inbox` / `profile` (SAD §4). Feeds the "tags added from the inbox" KPI only |
| `created_at` | timestamptz | NOT NULL | Server clock |

— `data-model.md §Entities, contact_tag_history, verbatim` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. Backs `ContactTag { id, name, added_by, added_at }` and `TagHistoryPage` (50 per page, newest first, cursor `(created_at, id)`).

## Acceptance criteria

### AC-04 — happy path

> **Given** a contact of "Acme Flowers" whose conversation is open, assigned to a teammate and waiting for a reply
> **When** an operator opens the contact's profile (from the list, from the contact's name in the inbox conversation header, or by a saved link)
> **Then** the profile shows the contact's name, username, language, when they first wrote and when they last wrote, their tags with who added each one and when, the contact's tag history (each tag added, removed, merged or removed by a delete, by whom and when, under the name the tag had then, newest first, older entries loaded on scrolling), and their conversation: its status, its assignee (or "unassigned"), the "waiting for a reply" marker when it applies, and a way to open it in the inbox; a history section shows the conversation's messages, the team's replies with their authors and its activity entries in the same order as in the inbox, latest first part loaded and older ones on scrolling, with media opened through the panel as in the inbox; the profile can be reopened by reload, the back button or a saved link, and a link to a contact that does not exist shows the not-found card inside the frame
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — happy path

> **Given** an operator answering a conversation of "Acme Flowers" in the inbox, or on its contact's profile, while "Acme Flowers" has the tags "VIP" and "Wholesale"
> **When** they open the tag control on the contact and type "vi", pick "VIP", then type "Kyiv" (which no tag matches) and confirm creating it, then remove "Wholesale"
> **Then** while typing, existing tags that contain the text are offered first (those that start with it before the others; tags the contact already carries are shown as carried, not offered) and creating a new tag is a separate, named choice ("Create tag "Kyiv"") that appears only when no existing tag has that name ignoring letter case and spacing; the contact now carries "VIP" and "Kyiv" and not "Wholesale", "Kyiv" exists in the workspace's tag list for everyone, each added tag records the member who added it and when, the contact's tag history shows the two additions and the removal with the member and time, the change shows for every member who has that conversation header or profile open without reloading, and the Contacts list filter finds the contact by the new tags; adding a tag the contact already carries, or removing one it no longer carries (for example when two members act at the same moment), changes nothing and writes no history entry; the tag control always shows one line saying that tags are visible to the whole team and should not record health, religion or other sensitive traits; no tag change is ever sent to the end customer
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `lockContact(ws, contactId, tx)` `FOR NO KEY UPDATE` by `(workspace_id, id)` → found or not — `apps/api/src/modules/contacts/infra/contact-repo.ts`
- [ ] `tagsOf(ws, contactId)` joined to `tags`, tag-list order; `tagsOfMany(ws, contactIds)` for a list page; `carries(ws, contactId, tagId)`; `countFor(ws, contactId)`; `insert(link)`; `delete(ws, contactId, tagId)` → deleted or not — `apps/api/src/modules/contacts/infra/contact-tag-repo.ts`
- [ ] `append(entry)` with `newId()`; `page(ws, contactId, after?)` keyset `(created_at DESC, id DESC)`, 50; `memberChangesSince(ws, accountId, since)` → count and oldest, `kind IN ('added','removed')` only — `apps/api/src/modules/contacts/infra/tag-history-repo.ts`
- [ ] `ContactTagRepo`, `TagHistoryRepo` ports and `lockContact` on `ContactRepo` — `apps/api/src/modules/contacts/app/ports.ts`
- [ ] Integration tests with an isolation case per method over `twoWorkspacesWithTags` — `*.int.test.ts` next to each repo

## Edge cases

| Case | Behaviour |
|---|---|
| `lockContact` with another workspace's contact id | not found (AC-12) |
| `insert` of a link to another workspace's tag | refused by the composite FK (AC-12) |
| `delete` of a link that is not there | returns «not deleted»; the caller answers `unchanged` (AC-06) |
| an owner's 10 000 `merged` entries inside the window | not counted by `memberChangesSince` (index with `kind`) |
| two history entries with the same `created_at` | ordered by `id DESC`; the keyset neither repeats nor skips |

## Definition of Done

- [ ] Integration tests prove the contact row lock, a contact's tags in tag-list order, link insert and delete, history append, the 50-per-page newest-first keyset with no repeat or skip, and the member-kind count that ignores merged and deleted entries, each with a cross-workspace isolation case.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
