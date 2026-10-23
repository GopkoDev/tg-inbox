---
id: T8
title: "Evaluate audiences in contacts with the Contacts filter rules: the breakdown for a tag audience or a list of ids against a Telegram bot, the reachable set sorted by id, existing tags, contacts matching a search and filter, contact cards and the blocked check at a recipient's turn"
layer: "infra"
deps: ["T2"]
blocks: ["T9", "T17", "T18", "T19"]
acs: ["AC-01", "AC-04", "AC-05", "AC-10", "AC-14"]
files_hint: ["apps/api/src/modules/contacts/infra/audience-query.ts", "apps/api/src/modules/contacts/infra/audience-query.int.test.ts", "apps/api/src/modules/contacts/infra/contact-list-query.ts", "apps/api/src/modules/contacts/app/audiences.ts", "apps/api/src/modules/contacts/app/audiences.test.ts", "apps/api/src/modules/contacts/app/ports.ts", "apps/api/src/modules/contacts/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T8 — Evaluate audiences in contacts with the Contacts filter rules: the breakdown for a tag audience or a list of ids against a Telegram bot, the reachable set sorted by id, existing tags, contacts matching a search and filter, contact cards and the blocked check at a recipient's turn

## Place in the sequence

- **Blocked by:** T2 — Promote migrations 01–02 (contact_bot_reach and its backfill for the workspace's current Telegram bot), regenerate DB types and add the reach fixtures · **Blocks:** T9 — Show "blocked the bot" on Contacts reads: list rows and the profile gain blocked_since for the current Telegram bot through a late-bound currentBot port, T17 — Add the broadcasts reads: the list with each draft's audience size, one broadcast as a draft with its breakdown for the current bot or as a launched broadcast with its frozen audience and totals, the recipients page, and itemDetails for the inbox thread, T18 — Add the broadcast group use cases: add one contact, count the matching contacts not yet in the group, add all matching as a whole or not at all, remove one, the group page with cards and breakdown, and the membership of a picker page, T19 — Add the launch confirmation read, which is also the pre-check: owner only, a working bot, a non-empty text, at most 10 000, at least one reachable contact and the 10-per-24-hours cap, answering the trimmed text, version, breakdown and fingerprint · **Wave:** 2 — after T2.
- **Lane:** shares `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/app/fakes.ts` with T7; shares `apps/api/src/modules/contacts/infra/contact-list-query.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T9 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to build a draft's audience from specific contacts — one at a time from the contacts search, or all contacts matching a search and filter at once — and remove the ones that should not get it
> **So that** I can reach exactly the customers I mean, even when no tag describes them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It lets `contacts` answer, with the Contacts list's own matching, how many contacts an audience holds, how many of them the current bot cannot reach and exactly which ones it would send to.

## Inlined context

> 4. **Audiences are evaluated by `contacts`, with the Contacts filter's own matching, and return the breakdown and the reachable set.** A tag audience (mode, tags, tags to leave out) and a group (a list of contact ids) both go to `contacts` with the current Telegram bot id. `contacts` answers the audience size, blocked, never wrote to the current bot and reachable, or the reachable contacts themselves (id and Telegram user id).
>
> — `sad.md §4, choice 4, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The matching is the Contacts list's by construction. The breakdown is one aggregate query joined to the reachability rows of the current bot, and the reachable set is at most 10 001 rows (the extra one proves "over the limit"). Groups go to `contacts` as an id array (`= ANY($1)`), which stays inside the targets at 10 000 ids. Detecting a missing tag at read time needs no cross-module hook.
>
> — `adr/0004 §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set.md)

> | contacts | `audienceBreakdown`, `reachableContacts`, `existingTags`, `matchingContactIds`, `contactCards(ids)`, `isBlocked(contactId, botId)` | broadcasts | ADR-0004, AC-04, AC-11 |
>
> — `sad.md §5, App-layer additions, contacts row 3, verbatim` · full text: [sad.md](../sad.md)

> 5. … The breakdown partitions the audience in this order: blocked, then never wrote, then reachable. A contact whose reach row is blocked but who never wrote through that bot counts as blocked.
>
> — `data-model.md §Assumptions, 5, abridged` · full text: [data-model.md](../data-model.md)

> Every draft read asks `bots` for the current Telegram bot id, keeps only the stored tags that still exist, and runs one aggregate query with the Contacts filter's rules ("any of", "all of", "no tags", no tag = every contact, a left-out tag removes the contact) joined to the reach rows of that bot. … With no bot at all, only the audience size is shown.
>
> — `sad.md §6, flow 7, abridged` · full text: [sad.md](../sad.md)

> - **Recipient position** = rank of the contact id in the sorted reachable set, the same sort as the fingerprint (ADR-0006), so the fingerprint and the positions come from one ordered read.
>
> — `_audit/data-model-2026-10-23.md §Code-level findings, last, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> | Draft audience count p95 — tag audience or group, workspace with 10 000 contacts | ≤ 500 ms server time (as the Contacts list, contacts §6) | request timing log; seeded integration test |
>
> — `spec.md §6, draft audience count row, verbatim` · full text: [spec.md](../spec.md)

**Precedent (contacts task T9 / audit):** the "all of" filter uses the grouped semi-join (`… GROUP BY contact_id HAVING count(*) = cardinality($ids)`), not a correlated count — reuse `contacts/infra/contact-list-query.ts`'s filter builder rather than a second copy.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads `contacts`, `contact_tags`, `tags` and `contact_bot_reach` from T2). Indexes used: `contact_bot_reach_pkey`, `contact_tags_workspace_id_tag_id_contact_id_idx`, `contact_tags_pkey`, `contacts_workspace_id_id_key`.

— `data-model.md §Indexes, Reused, abridged` · full text: [data-model.md](../data-model.md)

## API contract

> - `DraftBreakdown { audience_size, reach: { blocked_count, never_wrote_count, reachable_count } | null }` — `reach` null when the workspace has no bot row.
> - `GroupContactCard` (name, username, tags, `blocked_since`) — the group page rows and the picker marks are built from `contactCards`.
>
> — `contracts/openapi.yaml, schemas DraftBreakdown / GroupContactCard, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
> **When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
> **Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — happy path

> **Given** an operator editing a draft "Wholesale catch-up" of "Acme Flowers" whose audience is a broadcast group already holding 1 contact
> **When** they search contacts by name or username and add "Olena K.", then filter contacts by the tag "Wholesale" with the search "kyiv" and choose "add all matching" (14 contacts, one of them already in the group), then remove one contact
> **Then** the search and filter work as on the Contacts list (the same matching, the same counts); "add all matching" first says how many contacts it will add and then adds the 13 not already in the group; the group shows its contacts with name, username and tags, marks the ones that blocked the bot, and says how many it holds (14) and how many it would reach; if the matching contacts changed between the count and the confirmation, the current ones are added and the editor says how many were; contacts who match the filter later are not added; removing a contact takes it out of this draft only and changes nothing on the contact; the group belongs to this draft and is not a list of its own anywhere else in the panel
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — domain invariant

> **Given** a draft of "Acme Flowers" whose group holds 9 990 contacts
> **When** an operator adds a contact who is already in the group, or chooses "add all matching" for a filter matching 50 contacts not in the group, or a tag audience would match more than 10 000 contacts
> **Then** a contact already in the group is not added twice and the group says it is already there; the bulk add is refused as a whole and the editor says that a broadcast's audience can hold at most 10 000 contacts (reachable or not) and how many can still be added; a tag audience matching more than 10 000 contacts, reachable or not, can be saved as a draft but not launched, and says so; a group only ever holds contacts of its own workspace
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] Red: on the AC-01 seed ("VIP" 40 / "Kyiv" 120 / "Staff" 3 with two also VIP, 2 VIP blocked for bot `9001n`) — `audienceBreakdown({ mode: any, include: [VIP], exclude: [Staff] }, 9001n)` = 38 / 2 / 0 / 36; `all`, `none`, no-tag modes equal the Contacts list's matching count; the same contacts as an id array give the same partition; `botId = null` → size only — `apps/api/src/modules/contacts/infra/audience-query.int.test.ts`
- [ ] Red: `reachableContacts` sorted by contact id with `telegram_user_id`, `LIMIT 10001`; a blocked-but-never-wrote contact counts as blocked; `existingTags(ids)` drops deleted / merged; `matchingContactIds(q, filter, excludeGroupOf?)` equals `listContacts`' set; `contactCards(ids, botId)`; `isBlocked(contactId, botId)`; isolation over two workspaces — same file
- [ ] Green: `audience-query.ts` reusing the filter builder of `contact-list-query.ts` (extract a shared predicate, keep the list's plan) — `apps/api/src/modules/contacts/infra/audience-query.ts`, `apps/api/src/modules/contacts/infra/contact-list-query.ts`
- [ ] App-layer API `audiences.ts` with fakes-based unit tests — `apps/api/src/modules/contacts/app/audiences.ts`, `audiences.test.ts`, `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/app/fakes.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| no tag chosen, mode `any` | every contact of the workspace (AC-01) |
| a contact carrying a left-out tag | never counted (AC-01) |
| a tag id deleted or merged | `existingTags` omits it; the caller drops it with a notice (AC-01) |
| more than 10 000 reachable | returns 10 001 rows so the caller can refuse (AC-05) |
| a group id of another workspace in the array | not counted (filtered by `workspace_id`) (AC-08) |
| no bot row | size only, `reach: null` (AC-10) |

## Definition of Done

- [ ] Integration tests on the AC-01 seed prove the breakdown of "any of VIP, leaving out Staff" is 38 / 2 blocked / 0 never wrote / 36, that all, none and no-tag modes match the Contacts list exactly, that a group's ids give the same partition, that with no bot only the audience size is returned, that the reachable set is sorted by contact id with Telegram user ids and stops at 10 001, that existingTags drops deleted and merged tags, that matchingContactIds equals the Contacts list's matching set, and that every method is scoped by workspace with an isolation test. A reach row of the current Telegram bot id still applies after the same bot is reconnected, and none of an older bot does (test plan).
- [ ] Every new query method takes `workspaceId` and is covered by the cross-workspace isolation test.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
