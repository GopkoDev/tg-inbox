---
id: T18
title: "Add the broadcast group use cases: add one contact, count the matching contacts not yet in the group, add all matching as a whole or not at all, remove one, the group page with cards and breakdown, and the membership of a picker page"
layer: "app"
deps: ["T8", "T16"]
blocks: ["T26"]
acs: ["AC-03", "AC-04", "AC-05", "AC-08", "AC-14"]
files_hint: ["apps/api/src/modules/broadcasts/app/group.ts", "apps/api/src/modules/broadcasts/app/group.test.ts", "apps/api/src/modules/broadcasts/app/group.int.test.ts", "apps/api/src/modules/broadcasts/app/ports.ts", "apps/api/src/modules/broadcasts/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T18 — Add the broadcast group use cases: add one contact, count the matching contacts not yet in the group, add all matching as a whole or not at all, remove one, the group page with cards and breakdown, and the membership of a picker page

## Place in the sequence

- **Blocked by:** T8 — Evaluate audiences in contacts with the Contacts filter rules: the breakdown for a tag audience or a list of ids against a Telegram bot, the reachable set sorted by id, existing tags, contacts matching a search and filter, contact cards and the blocked check at a recipient's turn, T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner · **Blocks:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Wave:** 5 — after T8, T16.
- **Lane:** shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T16; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T17; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T19; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T20; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T21; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T22; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T23 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to build a draft's audience from specific contacts — one at a time from the contacts search, or all contacts matching a search and filter at once — and remove the ones that should not get it
> **So that** I can reach exactly the customers I mean, even when no tag describes them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It lets a member build a broadcast group contact by contact or all matching at once, and trim it, without ever overwriting a teammate's changes.

## Inlined context

> The group picker is the Contacts list's own read with the same search and tag filter, so matching and counts are the same by construction (AC-04, ADR-0004). It marks the page's contacts that are already in the group. Adding one contact locks the broadcast row, checks that it is still a draft and that the group is under 10 000, and inserts one row keyed by workspace, broadcast and contact. A contact already there changes nothing and says so (AC-05). The composite foreign key makes a contact of another workspace unstorable, and the request answers not found (AC-08). "Add all matching" first counts the matching contacts not in the group, and on confirmation re-reads the matches under the row lock. It refuses the whole add if the group would pass 10 000, saying how many can still be added (AC-05). Otherwise it adds the current matches and says how many, which can differ from the count shown. An add after a teammate switched the draft to a tag audience is refused as a changed draft, with the current draft (amended at `api`). Removing deletes one row by its key and changes nothing on the contact. Group writes are set operations that never raise the version, so two members' adds and removes both stand and never make a teammate's name or text save stale (AC-03, ADR-0005). The group shows 50 contacts at a time with their tags and block marks for the current bot, its size and how many it would reach (AC-14).
>
> — `sad.md §6, flow 8, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. Field edits get the stale-save protection AC-03 asks for; group edits are commutative set operations (insert on conflict do nothing, delete by key), so concurrent adds and removes by two members both stand. One counter is enough at draft scale (per-field counters buy little for a short form), and a lease would let an absent member block the team. The broadcast row lock is the one point that serialises "still a draft" and the 10 000 limit against a launch (ADR-0006) and a delete.
>
> — `adr/0005-version-draft-fields-and-keep-the-group-as-per-contact-rows-outside-the-version.md §Decision outcome, ADR-0005, verbatim` · full text: [ADR-0005](../adr/0005-version-draft-fields-and-keep-the-group-as-per-contact-rows-outside-the-version.md)

> **Chosen:** Option 1. The matching is the Contacts list's by construction. The breakdown is one aggregate query joined to the reachability rows of the current bot, and the reachable set is at most 10 001 rows (the extra one proves "over the limit"). Groups go to `contacts` as an id array (`= ANY($1)`), which stays inside the targets at 10 000 ids. Detecting a missing tag at read time needs no cross-module hook.
>
> — `adr/0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set.md §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set.md)

> 5. **Group writes on a draft whose audience is a tag audience** (a teammate switched the kind meanwhile) answer `409 BROADCAST_DRAFT_CHANGED` with the current draft. sad.md flow 8 now draws this branch (flag F-3). A remove answers `200 unchanged` instead, like every absent row.
>
> — `contracts/api-sync-report.md §Assumptions, 5, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> **Draft and group writes, abort, finish:** broadcast row `FOR NO KEY UPDATE` → its tag / group / recipient rows.
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> The group picker's search text is masked in request logs, like the Contacts search
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Writes and reads `broadcast_group_contacts` through T14:

| Column | Constraints | Use |
|---|---|---|
| `(workspace_id, broadcast_id, contact_id)` | PK; composite FK `(workspace_id, contact_id) → contacts` | add `ON CONFLICT DO NOTHING`, remove by key, membership, count (AC-05, AC-08) |
| `added_by_account_id`, `added_at` | NOT NULL; FK → `memberships` | the group page, newest added first (`broadcast_group_contacts_added_at_idx`) |

— `data-model.md §Entities, broadcast_group_contacts, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `GET …/group?after` → `200 BroadcastGroupPage` (50, newest added first; rows with name, username, tags, `blocked_since` for the current bot, who added and when; `size`); a tag-audience draft answers an empty page, `size: 0`.
- `GET …/group/membership?contact_ids` (≤ 50) → `200 BroadcastGroupMembership` — only the ids in the group; foreign ids simply absent.
- `POST …/group/contacts` `{ contact_id }` → `200 BroadcastGroupChange { broadcast_id, outcome: added | unchanged, group_size }` · `404` (foreign contact, no hint) · `409 BROADCAST_NOT_A_DRAFT` / `BROADCAST_DRAFT_CHANGED` / `BROADCAST_AUDIENCE_TOO_LARGE` (`details.limit, audience_size, can_add: 0`).
- `POST …/group/contacts/{contactId}/remove` → `200 { outcome: removed | unchanged }` · `409 BROADCAST_NOT_A_DRAFT`.
- `GET …/group/matching?q&mode&tag` → `200 BroadcastGroupMatching { matching_count, already_in_group_count, to_add_count, can_add, missing_tag_ids }` · `400` for `mode=none` with a tag. Writes nothing.
- `POST …/group/add-matching` `{ q?, mode, tag_ids, expected_count }` → `200 BroadcastGroupMatchingAdded { expected_count, added_count, group_size }` · `409` as the single add.
- Signal `broadcast.changed { change: group }` only when a row was written; the version never changes.

— `contracts/openapi.yaml, operationId listBroadcastGroup / getBroadcastGroupMembership / addBroadcastGroupContact / removeBroadcastGroupContact / countBroadcastGroupMatching / addBroadcastGroupMatching, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-03 — error

> **Given** two members of "Acme Flowers" with the same draft open
> **When** one changes the text or the audience and saves, and then the other saves a change made on the older version; or both add and remove contacts in the draft's group at the same moment
> **Then** the second text or audience change is not saved over the first: that member is told that a teammate changed the draft and is shown the current version to apply their change again; group additions and removals by both members are each kept (a contact added by one and not removed by the other stays in the group), so no one's additions silently disappear, and adding or removing group contacts never makes a teammate's text or name save count as stale
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

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

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] Add `ContactsApi.matchingContactIds(ws, { q, mode, tagIds }, limit)` and `contactCards` with the current bot's `blocked_since` to the ports and fakes — `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts`
- [x] RED: unit tests per branch (added, already there, not a draft, switched to tags, full at 10 000, bulk refused whole with the room left, remove absent, matching count) — `apps/api/src/modules/broadcasts/app/group.test.ts`
- [x] `addContact`, `removeContact`, `countMatching`, `addMatching`, `groupPage`, `membership` — each write under the broadcast row lock, version untouched, `last_changed_*` set, one `group` signal when written — `apps/api/src/modules/broadcasts/app/group.ts`
- [x] Integration tests: the AC-04 seed (1 in the group, 14 matching, 13 added, size 14), the AC-05 seed (9 990 + 50 refused, `can_add` 10), two members adding and removing at once both stand, a foreign contact id → not found — `apps/api/src/modules/broadcasts/app/group.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| contact already in the group | `200 unchanged`, no signal (AC-05) |
| bulk add would pass 10 000 | refused whole, `409 BROADCAST_AUDIENCE_TOO_LARGE` with `can_add`; nothing added (AC-05) |
| matches changed between count and confirm | the current matches are added, `added_count` ≠ `expected_count` (AC-04) |
| teammate switched the draft to tags meanwhile | add → `409 BROADCAST_DRAFT_CHANGED` with the current draft; remove → `200 unchanged` |
| contact of another workspace | add → `404` with no hint; remove → `200 unchanged` (AC-08) |
| a member removes while another adds the same contact | both stand in commit order; nothing silently lost (AC-03) |
| the broadcast was launched meanwhile | `409 BROADCAST_NOT_A_DRAFT` (AC-09) |

## Definition of Done

- [x] Unit and integration tests on the AC-04 / AC-05 seeds prove adding a contact already there answers unchanged, a foreign contact is not found, a write on a launched broadcast answers BROADCAST_NOT_A_DRAFT and on a draft switched to tags BROADCAST_DRAFT_CHANGED, the matching count excludes group members and gives can_add, add-all-matching adds the current matches under the row lock and says how many (13 of 14), a bulk add past 10 000 is refused whole with BROADCAST_AUDIENCE_TOO_LARGE and the room left, a remove of an absent row answers unchanged, group writes never raise the version, and each written change publishes broadcast.changed group.
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T18): `createBroadcastGroup` (`broadcasts/app/group.ts`): `addContact`, `removeContact`, `countMatching(ws, id, { q, mode, tagIds })`, `addMatching`, `groupPage(ws, id, after?)`, `membership`. Every write runs under `lockForUpdate` (404 → not a draft → for adds, a tag audience → `BROADCAST_DRAFT_CHANGED` with `views.draftView` read after the rolled-back transaction), `touch`es the last change (version kept) and publishes one `group` signal only when a row was written.
- `implement` (T18): a foreign or unknown contact is detected before the transaction through `contactCards(ws, [id], null)` (empty → `NOT_FOUND`, the same 404 as an unknown broadcast), so the composite FK never surfaces as a 500. A remove of an absent row (never added, foreign, tag audience) answers `unchanged` with the current size.
- `implement` (T18): `BROADCAST_AUDIENCE_TOO_LARGE` carries the **current** group size as `audience_size` (so `can_add` = room left: 9 990 → 10; a full group → 0), matching the existing error class.
- `implement` (T18): `ContactsApi.matchingContactIds` has no `limit` (T8's contacts read takes none), so the confirmation loads the full matching set; with the 10 000 cap and pilot-scale workspaces this is bounded by the workspace's contacts. **Hand-off → T28** if the seeded timing shows it.
- `implement` (T18): the group cursor (`added_at`, `contact_id`) is in `domain/cursor.ts`; `countMatching` answers for a launched broadcast too (it writes nothing; the contract lists no 409).
- `implement` (T18): RED `Cannot find module './group.js'` (GOOD red; group.ts had been drafted early and was parked outside the tree until the RED was observed). Integration written after GREEN.
- `implement` (T18): gate — full `pnpm test`: `group.int` AC-05 failed on a test bug (random Telegram ids colliding in the bulk seed; fixed with a counter), and `state-changes.int` (known concurrency flake); both files passed re-run alone twice. Lint clean for the task's files (the only `tsc` error was T19's uncommitted RED test).
