---
id: T33
title: "Build the broadcast group on SCR-25 and SCR-26: BroadcastGroupList with tags, blocked markers and Remove, and GroupPicker over the Contacts read with membership marks, Add, and the two-step Add all matching"
layer: "ui"
deps: ["T32"]
blocks: ["T39", "T40"]
acs: ["AC-04", "AC-05"]
files_hint: ["apps/web/src/features/broadcasts/BroadcastGroupList.tsx", "apps/web/src/features/broadcasts/BroadcastGroupList.test.tsx", "apps/web/src/features/broadcasts/GroupPicker.tsx", "apps/web/src/features/broadcasts/GroupPicker.test.tsx", "apps/web/src/features/broadcasts/BroadcastEditor.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T33 — Build the broadcast group on SCR-25 and SCR-26: BroadcastGroupList with tags, blocked markers and Remove, and GroupPicker over the Contacts read with membership marks, Add, and the two-step Add all matching

## Place in the sequence

- **Blocked by:** T32 — Build the tag audience on SCR-25: TagFilter's controlled mode for Send to, the Leave out popover, the chosen and left-out badges, the dropped-tag notice and the over-10 000 warning, and SCR-32 SwitchAudienceDialog · **Blocks:** T39 — Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate "did not reach", the broadcast item in the thread, the blocked marker, and the operator's missing launch, T40 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components · **Wave:** 7 — after T32.
- **Lane:** shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T31; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T32; shares `apps/web/src/features/broadcasts/BroadcastEditor.tsx` with T36 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to build a draft's audience from specific contacts — one at a time from the contacts search, or all contacts matching a search and filter at once — and remove the ones that should not get it
> **So that** I can reach exactly the customers I mean, even when no tag describes them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It lets a member hand-pick a draft's audience from the Contacts search and filter — one contact at a time or all matching at once — and trim it.

## Inlined context

> 8. **The group picker is a large `Dialog`** (`max-w-3xl`, full screen below `sm`), not a page: a `DataTableToolbar` with the Contacts search `Input`, the TagFilter (controlled) and the count «14 of 120 contacts match», then rows with **Add** (ghost) or «In group ✓» (muted), **Show more**, and the footer **Add all matching (13)**. The second step replaces the footer in place: «Add 13 contacts to this group?» **Back** / **Add 13**.
> 9. **The group in the editor** is a compact table (NEW: BroadcastGroupList): contact (Avatar initials, name, @username), tags (`Badge`s, «+N» after 3, as ContactsTable), a «Blocked the bot» `Badge` (`outline`, destructive text), and a **Remove** icon button («Remove <name> from this group»); 50 rows with **Show more**; the header reads «14 contacts» with **Add contacts**.
>
> — `screens.md §Decisions taken at this stage, 8, 9, verbatim` · full text: [screens.md](../screens.md)

> | default: group | «14 contacts», **Add contacts** (→ SCR-26), rows with name, @username, tags, the «Blocked the bot» marker and **Remove**, **Show more** after 50; then the AudienceBreakdown |
> | empty: group | «No contacts in this group yet.» + **Add contacts**; the breakdown shows «Audience 0» |
> | remove from group | **Remove** — `removeBroadcastGroupContact`; the row goes, the size and breakdown re-read; `unchanged` (a teammate removed it) also drops it |
> | phone | below `sm` the group table becomes stacked rows |
>
> — `screens.md §SCR-25, group states, abridged` · full text: [screens.md](../screens.md)

> | loading | `listContacts` then `getBroadcastGroupMembership` for the page's ids; 8 `Skeleton` rows |
> | default | rows of the Contacts list read with the same search (300 ms debounce) and tag filter; each row: Avatar, name, @username, tags, «Blocked the bot» marker, and **Add** or «In group ✓»; the count «14 of 120 contacts match»; **Show more**; footer **Add all matching (N)** with N from `countBroadcastGroupMatching` and **Done** |
> | adding one / already in the group | spinner, then «In group ✓»; `outcome: unchanged` → «In group ✓» and «Already in this group» for 3 s |
> | add all matching | confirm «Add 13 contacts to this group?» **Back** / **Add 13** (when `to_add_count` > `can_add` the refusal instead); adding sends the search, the filter and `expected_count`; added «13 contacts added.» or «The matching contacts changed — 12 were added.» |
> | too large | `409 BROADCAST_AUDIENCE_TOO_LARGE` — «A broadcast's audience can hold at most 10 000 contacts — 10 more can be added.» (`can_add`; «— no more can be added.» at 0); nothing added |
> | empty | nothing matches → `EmptyFilterState` + **Clear search and filter**; no contacts → «No contacts yet. …» · | notice | `missing_tag_ids` → as SCR-18 |
> | draft changed | `409 BROADCAST_DRAFT_CHANGED` or `BROADCAST_NOT_A_DRAFT` — the picker closes; SCR-25 shows the current draft or SCR-28 · | contact gone | `404` → re-read + «This contact is no longer available.» |
> | error | «Couldn't load contacts» + **Retry**; a failed add «Couldn't add — Retry» · | closed | **Done** / Esc / ✕ — the editor re-reads `listBroadcastGroup` and `getBroadcast` · | phone | full-screen dialog |
>
> — `screens.md §SCR-26, states, abridged` · full text: [screens.md](../screens.md)

> **Reuse:** the group picker (SCR-26) composes the Contacts list's search box, tag filter and row components from `features/contacts` and `features/tags`, against the same `GET …/contacts` read, so matching and counts are the Contacts list's by construction (AC-04).
>
> — `sad.md §4, UI architecture, Reuse, abridged` · full text: [sad.md](../sad.md)

> | BroadcastGroupList | … ContactsTable cannot be reused (address-bound, no remove, no added order); composes Table, Avatar, Badge, Button, Skeleton |
> | GroupPicker | SCR-26: the Contacts list read inside a Dialog with membership marks, per-row Add, and the two-step Add all matching with the changed-matches and too-large outcomes; composes Dialog, DataTableToolbar, Input, TagFilter (controlled), ScrollArea, Avatar, Badge, Button, Alert, Skeleton, EmptyFilterState |
>
> — `screens.md §New components, abridged` · full text: [screens.md](../screens.md)

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

- `GET …/contacts` (`q`, `mode`, `tag`, `after`) → `ContactPage` (rows now with `blocked_since`), unchanged matching and counts; the group picker's `q` is masked in logs server-side.
- `GET …/broadcasts/{id}/group` (`after`) → `BroadcastGroupPage { size, items: [{ contact: GroupContactCard, added_by, added_at }], has_next, next_cursor }`, newest added first; `GET …/group/membership` (`contact_id` × ≤ 50) → `{ contact_ids }`.
- `POST …/group/contacts { contact_id }` / `POST …/group/contacts/{contactId}/remove` → `BroadcastGroupChange { outcome: added | removed | unchanged, group_size }`; `GET …/group/matching` → `{ matching_count, already_in_group_count, to_add_count, can_add, missing_tag_ids }`; `POST …/group/add-matching { q?, mode, tag_ids, expected_count }` → `{ expected_count, added_count, group_size }`.
- Errors rendered: `404` (contact), `409 BROADCAST_AUDIENCE_TOO_LARGE` (`details.can_add`), `409 BROADCAST_DRAFT_CHANGED`, `409 BROADCAST_NOT_A_DRAFT`.

— `contracts/openapi.yaml, operationIds listContacts, listBroadcastGroup, getBroadcastGroupMembership, addBroadcastGroupContact, removeBroadcastGroupContact, countBroadcastGroupMatching, addBroadcastGroupMatching, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

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

## Checklist

- [ ] `BroadcastGroupList` composing `Table`, `Avatar`, `Badge` (tags «+N» after 3, «Blocked the bot» `outline` destructive), `Button` (Remove, Show more, Add contacts), `Skeleton`; stacked rows below `sm` — `apps/web/src/features/broadcasts/BroadcastGroupList.tsx`
- [ ] `GroupPicker` on `Dialog` (`max-w-3xl`, full screen below `sm`) with `DataTableToolbar`, the Contacts search `Input` (300 ms debounce, cleaned like the Contacts address), the controlled `TagFilter` (T32), `ScrollArea` rows with membership marks, per-row Add, Show more, the two-step footer, `EmptyFilterState`, `Alert`s — `apps/web/src/features/broadcasts/GroupPicker.tsx`
- [ ] Mount both in the Audience card for `kind: group`; re-read the group and the draft on close — `apps/web/src/features/broadcasts/BroadcastEditor.tsx`
- [ ] Testing Library tests per SCR-25 group state and SCR-26 state — `BroadcastGroupList.test.tsx`, `GroupPicker.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Add on a contact already added by a teammate | «In group ✓» + «Already in this group» for 3 s |
| `to_add_count` > `can_add` | the refusal shows instead of the confirm; nothing sent |
| matches changed between count and confirm | the current ones are added; «The matching contacts changed — N were added.» |
| a teammate switched the draft to tags | `BROADCAST_DRAFT_CHANGED` → the picker closes, SCR-25 shows the current draft |
| Remove of a row a teammate removed | `unchanged` → the row still goes |
| contacts that match later | not added (nothing re-runs) |

## Definition of Done

- [ ] Testing Library tests cover every group state of SCR-25 and every SCR-26 state in screens.md: the group page with name, username, tags and the blocked marker, Show more, Remove, the picker's search and controlled TagFilter with the Contacts list's counts, In group ✓ marks, Add with already-there, Add all matching (13) then Add 13 with the added count when the matches changed, and the too-large refusal with the room left.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T33): `BroadcastGroupList({ workspaceId, broadcastId })` reads the group through the draft store (`loadGroup` on mount, `showMoreGroup`, `removeContact`): the size line («14 contacts» / «1 contact», from the held draft's `audience.size`, which follows every group answer) with **Add contacts**, a `Table` («Hand-picked group») of Avatar initials, name, @username (or «no username»), tags (`TagBadges`, «+N» after 3; on a phone stacked under the name, the Tags column hidden below `sm`), the «Blocked the bot» `Badge` (outline, destructive text, «since <day>» title) and an icon **Remove** («Remove <name> from this group»); 5 skeleton rows while loading; «No contacts in this group yet.»; «Couldn't load the group» + Retry; Show more / «Couldn't load more contacts» + Retry; «Couldn't remove <name>» on a failed remove. A remove's answer (`removed` or `unchanged`) drops the row and the breakdown is read again.
- `implement` (T33): `GroupPicker({ workspaceId, broadcastId, open, onClose })` on `Dialog` (`sm:max-w-3xl`, full screen below `sm`): `DataTableToolbar` with the Contacts search `Input` (300 ms, `searchText` like the Contacts address) and the `TagFilter` driven by local state, the count («120 contacts» / «14 of 120 contacts match»), rows in a `ScrollArea` (Avatar, name, blocked marker, @username, tags, then **Add** / spinner / «In group ✓» / «In group ✓ · Already in this group» for 3 s / «Couldn't add» + Retry), 8 skeleton rows, `EmptyFilterState` with «Clear search and filter», «No contacts yet. …», the missing-tag notice as SCR-18, «This contact is no longer available.» on a 404 add (the page is read again), Show more with the next page's membership. The footer **Add all matching (N)** uses `to_add_count` from `countBroadcastGroupMatching` (read again after each add); it asks «Add N contacts to this group?» **Back** / **Add N**, or shows the too-large refusal when `to_add_count` > `can_add` (nothing sent); the add sends `q` (null when empty), `mode`, `tag_ids` and `expected_count` and says «N contacts added.» or «The matching contacts changed — N were added.»; a 409 too-large shows the refusal with `details.can_add` («— no more can be added.» at 0). `BROADCAST_DRAFT_CHANGED` / `BROADCAST_NOT_A_DRAFT` close the picker. Writes go through the draft store (`addContact`, `addMatching`), so the size follows and the group calls stay serialised.
- `implement` (T33): `BroadcastEditor` renders `BroadcastGroupList` for `kind: group` (`audienceControls` stays as an override); closing the picker re-reads the group (`loadGroup`) and the draft (`reread`).
- `implement` (T33): **deviation** — outside files_hint: `draft-store.ts` gained `reread(guard)` (background `getBroadcast`; a draft replaces the held one unless a save is in flight, queued or unsent; a launched one switches to `launched`; 404 → `not_found`) for the breakdown after group changes, and a small `tag-badges.tsx` (`TagBadges`, the Contacts list's «+N» rule) shared by the list and the picker — ContactsTable keeps its own copy (not touched).
- `implement` (T33): the «10 000» in the too-large copy is written literally (as `BroadcastsTable`'s «Over the 10 000 limit»), not through `Intl` (which gives «10,000» in `en`).
- `implement` (T33): RED — `Failed to resolve import "./BroadcastGroupList"` (list test) and `Failed to resolve import "./tag-badges" from GroupPicker.tsx` (picker test), GOOD red. Candidly: the picker component had been drafted before that first run (its missing `tag-badges` import is what failed), so the picker test's RED is the module-resolution failure, not per-assertion. During GREEN four test-side mistakes were fixed without loosening what they prove: the add-call assertion now waits for the store's group chain, the empty-state test waits for the `zzz` read before clearing, the editor test scopes «14 contacts» to the group and the breakdown (two lines by design), and the `ContactRow` fixture gained `workspace_id` (tsc).
- `implement` (T33): the new components `BroadcastGroupList` and `GroupPicker` are not yet registered in `docs/design-system.md` — T40.
- `implement` (T33): gate — `pnpm lint` clean; full `pnpm test` green (319 files, 4374 tests), run with `--exclude '**/broadcasts/http/routes.int.test.ts'` because T26's RED route test was already in the tree (uncommitted) at that moment.
