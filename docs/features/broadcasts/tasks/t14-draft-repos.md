---
id: T14
title: "Build the broadcasts draft-side repositories: the broadcast row (insert, lock FOR NO KEY UPDATE, versioned field save, list order, launch-cap count and 10th newest launch, sending broadcasts, delete), the audience tag rows and the group rows (add, remove, membership, count, page), with isolation tests"
layer: "infra"
deps: ["T3"]
blocks: ["T16"]
acs: ["AC-03", "AC-04", "AC-05", "AC-08", "AC-09"]
files_hint: ["apps/api/src/modules/broadcasts/infra/broadcast-repo.ts", "apps/api/src/modules/broadcasts/infra/broadcast-repo.int.test.ts", "apps/api/src/modules/broadcasts/infra/audience-tag-repo.ts", "apps/api/src/modules/broadcasts/infra/group-repo.ts", "apps/api/src/modules/broadcasts/infra/group-repo.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T14 — Build the broadcasts draft-side repositories: the broadcast row (insert, lock FOR NO KEY UPDATE, versioned field save, list order, launch-cap count and 10th newest launch, sending broadcasts, delete), the audience tag rows and the group rows (add, remove, membership, count, page), with isolation tests

## Place in the sequence

- **Blocked by:** T3 — Promote migrations 03–08 (the conversations (workspace_id, id) key, broadcasts, broadcast_audience_tags, broadcast_group_contacts, broadcast_recipients, broadcast_items), regenerate DB types and add the broadcast fixtures · **Blocks:** T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner · **Wave:** 3 — after T3.
- **Lane:** own lane.

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

It gives the draft, its tags and its group a tenant-scoped home where field saves are versioned and group edits by two members never overwrite each other.

## Inlined context

> **Chosen:** Option 1. Field edits get the stale-save protection AC-03 asks for; group edits are commutative set operations (insert on conflict do nothing, delete by key), so concurrent adds and removes by two members both stand. One counter is enough at draft scale […]. The broadcast row lock is the one point that serialises "still a draft" and the 10 000 limit against a launch (ADR-0006) and a delete.
>
> — `adr/0005 §Decision outcome, ADR-0005, abridged` · full text: [ADR-0005](../adr/0005-version-draft-fields-and-keep-the-group-as-per-contact-rows-outside-the-version.md)

> - Read and lock `FOR NO KEY UPDATE` by `(workspace, id)` in every draft, group, delete, launch, stop, abort and finish transaction (flows 6–15, seeded flows 1, 4) […] → `broadcasts_workspace_id_id_key`.
> - The Broadcasts list, most recently changed first (flow 5) → `broadcasts_workspace_id_last_changed_at_idx`.
> - The launch cap and `next_launch_at` = the 10th newest `launched_at` + 24 h (flow 10, seeded flow 1) → `broadcasts_workspace_id_launched_at_idx`.
> - The send link's sending broadcasts, oldest launch first (flow 14) → `broadcasts_sending_idx`.
>
> — `data-model.md §Entities, broadcasts, Access patterns, abridged` · full text: [data-model.md](../data-model.md)

> - Add (`ON CONFLICT DO NOTHING`), remove by key, "which of these 50 ids are in the group", the size count under the row lock, the group's ids for the breakdown, the launch and the duplicate (flows 7, 8, 10, 15) → `broadcast_group_contacts_pkey`.
> - The group page, 50 newest added first (flow 8) → `broadcast_group_contacts_added_at_idx`.
>
> — `data-model.md §Entities, broadcast_group_contacts, Access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> **Access patterns:** the audience of a broadcast for every draft read, the launch and the report (flows 7, 10, 11); replace on save (flow 7); copy on duplicate (flow 15); delete with the draft (flow 9) → `broadcast_audience_tags_pkey`.
>
> — `data-model.md §Entities, broadcast_audience_tags, verbatim` · full text: [data-model.md](../data-model.md)

> - **Launch cap counting.** The cap counts broadcasts of the workspace whose `launched_at` is within the last 24 h, under the advisory lock `broadcast-launches:<ws>`. A stopped or aborted broadcast keeps its `launched_at`, so it counts. A refused launch writes nothing, so it does not count. The refusal carries `next_launch_at` = the 10th newest `launched_at` + 24 h (AC-09).
>
> — `sad.md §4, Supporting choices, verbatim` · full text: [sad.md](../sad.md)

> 10. **`last_changed_at` / `last_changed_by_account_id`** replace the SAD's "last changed by / at". Draft, group, launch and stop writes set both. Finish and abort set only the time, so the list still names the last member.
>
> — `data-model.md §Assumptions, 10, verbatim` · full text: [data-model.md](../data-model.md)

> **Draft and group writes, abort, finish:** broadcast row `FOR NO KEY UPDATE` → its tag / group / recipient rows.
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Columns this task reads / writes | Constraints relied on |
|---|---|---|
| `broadcasts` | `id`, `workspace_id`, `name`, `text`, `status`, `version`, `audience_kind`, `tag_mode`, `author_account_id`, `last_changed_by_account_id`, `last_changed_at`, `created_at`, `launched_at` (read for the cap) | `broadcasts_workspace_id_id_key`, `_last_changed_at_idx`, `_launched_at_idx`, `broadcasts_sending_idx`; `version >= 1`; `tag_mode` ⇔ `audience_kind = 'tags'` |
| `broadcast_audience_tags` | `workspace_id`, `broadcast_id`, `tag_id` (no FK), `kind` (`include` / `exclude`), `tag_name` | PK `(workspace_id, broadcast_id, tag_id)` |
| `broadcast_group_contacts` | `workspace_id`, `broadcast_id`, `contact_id`, `added_by_account_id`, `added_at` | PK `(workspace_id, broadcast_id, contact_id)`; composite FK to `contacts`; `_added_at_idx` |

No schema change here (tables promoted by T3). No `ON DELETE CASCADE`: the draft delete removes tag and group rows itself.

— `data-model.md §Entities + §Indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface (repositories behind `broadcasts/app/ports.ts`).

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

### AC-09 — domain invariant

> **Given** "Acme Flowers" with the broadcast "Spring prices" launched to 36 recipients, a draft whose audience reaches nobody, and 10 broadcasts launched in the last 24 hours
> **When** a member tries to change the text, name or audience of "Spring prices", add or remove a recipient, or delete it; or teammates retag contacts, new customers write in, or a recipient unblocks the bot after the launch; or an owner tries to launch the empty draft or an 11th broadcast within 24 hours
> **Then** a launched broadcast cannot be changed or deleted — the page says it is read-only and offers to duplicate it — and its recipient list stays the 36 contacts fixed at launch whatever happens to tags and contacts afterwards; a draft that would reach nobody cannot be launched and says that its audience has no reachable contact; the 11th launch is refused and the owner is told that a workspace can launch at most 10 broadcasts in 24 hours and when the next launch is possible; every confirmed launch counts toward the 10, including one that was stopped or ended early, and a refused launch does not; drafts can still be created and edited
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Failing integration tests first over `twoWorkspacesWithBroadcasts` (every method with a foreign id returns nothing / changes nothing) — `apps/api/src/modules/broadcasts/infra/broadcast-repo.int.test.ts`, `apps/api/src/modules/broadcasts/infra/group-repo.int.test.ts`
- [ ] Broadcast repo: `insertDraft`, `lockForUpdate(ws, id, tx)` (`FOR NO KEY UPDATE`), `saveFields(ws, id, expectedVersion, fields, actor, at, tx)` → written or not, `list(ws)` by `last_changed_at DESC, id DESC`, `launchesSince(ws, since, tx)` + `tenthNewestLaunchedAt(ws, tx)`, `sendingBroadcasts(ws)` oldest launch first, `deleteDraft(ws, id, tx)` (tags + group + row) — `apps/api/src/modules/broadcasts/infra/broadcast-repo.ts`
- [ ] Audience-tag repo: `list(ws, broadcastId)`, `replace(ws, broadcastId, rows, tx)`, `copy(…)` — `apps/api/src/modules/broadcasts/infra/audience-tag-repo.ts`
- [ ] Group repo: `add` (`ON CONFLICT DO NOTHING`, returns written), `addMany` (one statement), `remove` (returns written), `membership(ws, broadcastId, contactIds)`, `count`, `ids`, `page(ws, broadcastId, after?, 50)` newest added first — `apps/api/src/modules/broadcasts/infra/group-repo.ts`
- [ ] Tests: stale-version save writes nothing; cap count and 10th newest include `stopped` and aborted; two concurrent adds of the same contact → one row; a foreign contact id refused by the composite FK

## Edge cases

| Case | Behaviour |
|---|---|
| save with an old version | nothing written; the caller answers `BROADCAST_DRAFT_CHANGED` (AC-03) |
| add a contact already in the group | no row written, reported as unchanged (AC-05) |
| remove an absent row | nothing deleted, reported as unchanged |
| group row naming another workspace's contact | refused by `broadcast_group_contacts_contact_fkey` (AC-08) |
| fewer than 10 launches in 24 h | no 10th newest → no `next_launch_at` |
| stopped / aborted broadcast | still counted by the cap (AC-09) |

## Definition of Done

- [ ] Integration tests prove each repository method filters by workspace (isolation over twoWorkspacesWithBroadcasts), a field save applies only at the expected version and raises it, the list orders by last change then id, the cap count and the 10th newest launched_at include stopped and aborted broadcasts, a group add is ON CONFLICT DO NOTHING and reports whether a row was written, a remove deletes one row by key, membership answers only the asked ids, the group page is newest added first with a keyset, and a delete removes the draft with its tag and group rows.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
