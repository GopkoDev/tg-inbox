---
id: T16
title: "Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner"
layer: "app"
deps: ["T4", "T5", "T14"]
blocks: ["T17", "T18", "T19", "T21", "T23"]
acs: ["AC-01", "AC-02", "AC-03", "AC-07", "AC-09", "AC-10"]
files_hint: ["apps/api/src/modules/broadcasts/app/ports.ts", "apps/api/src/modules/broadcasts/app/fakes.ts", "apps/api/src/modules/broadcasts/app/drafts.ts", "apps/api/src/modules/broadcasts/app/drafts.test.ts", "apps/api/src/modules/broadcasts/app/drafts.int.test.ts", "apps/api/src/modules/broadcasts/infra/signals.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner

## Place in the sequence

- **Blocked by:** T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet, T5 — Add the broadcasts domain for drafts and launches: the status machine, the version rule, who may delete, launch and stop, the tag audience shape with the dropped-tag notice, the 10 000 limit and the audience fingerprint, T14 — Build the broadcasts draft-side repositories: the broadcast row (insert, lock FOR NO KEY UPDATE, versioned field save, list order, launch-cap count and 10th newest launch, sending broadcasts, delete), the audience tag rows and the group rows (add, remove, membership, count, page), with isolation tests · **Blocks:** T17 — Add the broadcasts reads: the list with each draft's audience size, one broadcast as a draft with its breakdown for the current bot or as a launched broadcast with its frozen audience and totals, the recipients page, and itemDetails for the inbox thread, T18 — Add the broadcast group use cases: add one contact, count the matching contacts not yet in the group, add all matching as a whole or not at all, remove one, the group page with cards and breakdown, and the membership of a picker page, T19 — Add the launch confirmation read, which is also the pre-check: owner only, a working bot, a non-empty text, at most 10 000, at least one reachable contact and the 10-per-24-hours cap, answering the trimmed text, version, breakdown and fingerprint, T21 — Add stop and the settling transaction: a business owner stops a sending broadcast (waiting → stopped), an abort fails the waiting recipients with text_refused or bot_stopped, a finish marks sent, and every ending queues the 48-hour blocked-share measure, T23 — Add duplicate: any member copies any broadcast into a new draft named "Copy of …" within 80, a draft with its audience, a launched one as the same tags, all recipients or only the recipients it did not reach once ended · **Wave:** 4 — after T4, T5, T14.
- **Lane:** shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T17; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T18; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T19; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T20; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T21; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts`, `apps/api/src/modules/broadcasts/infra/signals.ts` with T22; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T23 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It gives every member the draft itself — created, its name, text and audience saved against the version they saw, and deleted by its author or an owner — with nothing sent and no bot needed.

## Inlined context

> The server checks the same rule again, so an invalid name or text is refused and the draft keeps its last valid content. The draft starts at version 1, with the member as its author and last changer, and is listed for every member (flow 5). Each later save of the name or the text carries the version the member saw. Under the broadcast row lock, a launched broadcast refuses the save as not a draft (AC-09), and another version refuses it as changed with the current draft, which the editor shows next to the member's own edit (AC-03). Otherwise the field is written, the version goes up and the list signal fires. Nothing here needs a bot (AC-10) or sends anything.
>
> — `sad.md §6, flow 6, abridged` · full text: [sad.md](../sad.md)

> The save carries the version shown and is checked as in flow 6. The tag ids are resolved among the workspace's own tags, so a foreign id is refused. Each chosen tag is stored by id with "include" or "leave out" and its name at that moment, with no foreign key to tags (ADR-0004). […] An audience over 10 000 is saved but cannot be launched (AC-05). […] Switching from a non-empty group asks first with its size. The switch carries that size, and a different size is refused with the current one (AC-03). Switching to a group simply drops the tag rows.
>
> — `sad.md §6, flow 7, abridged` · full text: [sad.md](../sad.md)

> The server takes a business owner's membership with a share lock first (§8 lock order), then the broadcast row. A foreign id is not found (AC-08). A launched broadcast is refused as not a draft and stays read-only (AC-09). A member who is neither its author nor an active business owner is refused, whatever the browser showed (AC-07). Otherwise the draft's tag and group rows go with it, and every open list drops it on the `deleted` signal.
>
> — `sad.md §6, flow 9, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. Field edits get the stale-save protection AC-03 asks for; group edits are commutative set operations (insert on conflict do nothing, delete by key), so concurrent adds and removes by two members both stand. One counter is enough at draft scale (per-field counters buy little for a short form), and a lease would let an absent member block the team. The broadcast row lock is the one point that serialises "still a draft" and the 10 000 limit against a launch (ADR-0006) and a delete.
>
> — `adr/0005-version-draft-fields-and-keep-the-group-as-per-contact-rows-outside-the-version.md §Decision outcome, ADR-0005, verbatim` · full text: [ADR-0005](../adr/0005-version-draft-fields-and-keep-the-group-as-per-contact-rows-outside-the-version.md)

> **Stop / delete by an owner:** memberships `FOR SHARE` → broadcast row. **Draft and group writes, abort, finish:** broadcast row `FOR NO KEY UPDATE` → its tag / group / recipient rows. […] none takes a membership after a broadcast row
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> ├── app/      drafts.ts (create, save fields against a version, switch kind, delete)
> │             ports.ts (repos, ContactsApi, ConversationsApi, BotsApi, WorkspacesApi, signals, clock, jobs)
> ├── infra/    … signals.ts (broadcast.changed, coalescing)
>
> — `sad.md §5, Internal decomposition, abridged` · full text: [sad.md](../sad.md)

> 2. **One `change` value per transaction**, chosen by what the transaction did: `draft` (create, field or audience save, a duplicate's new draft), `group` (a group add or remove that wrote a row), `status` (launch, stop, finish, abort), `report` (an outcome, coalesced), `deleted` (a draft delete). A transaction that wrote nothing publishes nothing (an `unchanged` add, remove or stop, a refused request).
>
> — `contracts/events.md §Assumptions, 2, verbatim` · full text: [events.md](../contracts/events.md)

> **Hard rule (Authorization):** Roles: any active member lists, reads, creates, edits, duplicates, adds to / removes from groups; the draft author or a business owner deletes a draft; only a business owner launches and stops, re-checked under `workspaces.lockActiveMembers` (`FOR SHARE`) inside the action's transaction. Foreign ids answer 404 (`NotFoundError`) with no hint
>
> — `sad.md §8, Authentication / authorization, abridged` · full text: [sad.md](../sad.md)

> **Hard rule (Logging):** pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only.
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. The use cases write, through T14's repositories:

| Table | Columns written | Rule |
|---|---|---|
| `broadcasts` | `name`, `text`, `version`, `audience_kind`, `tag_mode`, `author_account_id`, `last_changed_by_account_id`, `last_changed_at`, `created_at` | `name <> ''` and trimmed; `text` trimmed, may be empty while `draft`; `version >= 1`, raised by name, text, kind and tag saves only; `tag_mode` set ⇔ `audience_kind = 'tags'` |
| `broadcast_audience_tags` | `tag_id`, `kind` (`include` / `exclude`), `tag_name` | replaced on a tag save; no FK to `tags` |
| `broadcast_group_contacts` | (deleted) | dropped on a switch to tags and with a deleted draft |

— `data-model.md §Entities, broadcasts / broadcast_audience_tags, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `POST …/broadcasts` `BroadcastCreate { name, text? }` → `201` `BroadcastDraft` (version 1, `tags` + `any`, no tag) · `400 BROADCAST_NAME_INVALID` (`details.field, min_length, max_length: 80`), `400 BROADCAST_TEXT_INVALID` (`details.length`, `max_length: 4096`).
- `POST …/broadcasts/{broadcastId}/save` `BroadcastFieldsSave { expected_version, name?, text? }` → `200` `BroadcastDraft` · `400` the two codes · `404` · `409 BROADCAST_NOT_A_DRAFT` (`details.broadcast_id, status`) · `409 BROADCAST_DRAFT_CHANGED` (`details.draft`, the current draft).
- `POST …/broadcasts/{broadcastId}/audience` `{ expected_version, kind: tags, mode, tag_ids, exclude_tag_ids, expected_group_size? }` or `{ expected_version, kind: group }` → `200` `BroadcastDraft` · `400 VALIDATION_ERROR` (a tag both chosen and left out, `mode: none` with tags) · `404 TAG_NOT_FOUND` naming the id · `409 BROADCAST_NOT_A_DRAFT` / `BROADCAST_DRAFT_CHANGED` / `BROADCAST_GROUP_CHANGED` (`details.group_size`). `kind: group` on a group answers the draft unchanged with no version raise.
- `POST …/broadcasts/{broadcastId}/delete` → `200` `BroadcastDeleted { workspace_id, broadcast_id }` · `403 FORBIDDEN` (not author, not an active owner) · `404` · `409 BROADCAST_NOT_A_DRAFT`.
- Signals: `broadcast.changed { change: draft }` on create and on each recorded save; `{ change: deleted }` on delete; nothing on a refusal or an unchanged answer.

— `contracts/openapi.yaml, operationId createBroadcast / saveBroadcastFields / saveBroadcastAudience / deleteBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
> **When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
> **Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** an operator editing a draft broadcast of "Acme Flowers"
> **When** they leave the name empty or make it longer than 80 characters, leave the text empty or only spaces, or make it longer than Telegram allows for one message
> **Then** the draft keeps its last valid content, nothing is sent, and the editor says next to the field that a name must be 1 to 80 characters, or that the text must be 1 to 4096 characters as Telegram counts them; the remaining length is shown while typing, counted the way Telegram counts it, so an emoji-heavy text is never accepted by the editor and then refused by Telegram for its length
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — error

> **Given** two members of "Acme Flowers" with the same draft open
> **When** one changes the text or the audience and saves, and then the other saves a change made on the older version; or both add and remove contacts in the draft's group at the same moment
> **Then** the second text or audience change is not saved over the first: that member is told that a teammate changed the draft and is shown the current version to apply their change again; group additions and removals by both members are each kept (a contact added by one and not removed by the other stays in the group), so no one's additions silently disappear, and adding or removing group contacts never makes a teammate's text or name save count as stale
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they open a draft they could launch if they were an owner, or try to launch it in any other way (for example from a saved link to the confirmation), or try to delete a draft that a teammate created
> **Then** the draft shows no launch action and says that only a business owner launches broadcasts; the attempt sends nothing and changes nothing; the delete is refused with the explanation that a draft is deleted by its author or a business owner; the operator can still edit, duplicate and delete their own drafts
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** "Acme Flowers" with the broadcast "Spring prices" launched to 36 recipients, a draft whose audience reaches nobody, and 10 broadcasts launched in the last 24 hours
> **When** a member tries to change the text, name or audience of "Spring prices", add or remove a recipient, or delete it; or teammates retag contacts, new customers write in, or a recipient unblocks the bot after the launch; or an owner tries to launch the empty draft or an 11th broadcast within 24 hours
> **Then** a launched broadcast cannot be changed or deleted — the page says it is read-only and offers to duplicate it — and its recipient list stays the 36 contacts fixed at launch whatever happens to tags and contacts afterwards; a draft that would reach nobody cannot be launched and says that its audience has no reachable contact; the 11th launch is refused and the owner is told that a workspace can launch at most 10 broadcasts in 24 hours and when the next launch is possible; every confirmed launch counts toward the 10, including one that was stopped or ended early, and a refused launch does not; drafts can still be created and edited
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** a business owner of "Acme Flowers" about to launch a draft
> **When** the workspace has no bot connected, or its bot is not working (the token was revoked), or the workspace connected a different bot since some of the audience last wrote
> **Then** with no bot or a bot that is not working, launch is refused, the draft stays a draft, and the owner is told why and offered the way to the bot settings; contacts who have never written to the bot connected now cannot be reached by it, so they are left out at launch and counted apart in the draft and the confirmation ("never wrote to the current bot"), and blocked marks learned with the old bot do not apply to the new one; reconnecting the same Telegram bot is not a change of bot, so its blocked marks and who wrote to it stay; drafts can be created, edited and duplicated while the bot is missing or not working
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] Declare the module's ports — repositories (T14, T15), `ContactsApi` (tag resolution, breakdown, reachable set, cards), `ConversationsApi`, `BotsApi` (`launchReadiness`, `sendBroadcastMessage`), `WorkspacesApi` (`lockActiveMembers`, display names), signals, clock, jobs — `apps/api/src/modules/broadcasts/app/ports.ts`
- [x] In-memory fakes for every port — `apps/api/src/modules/broadcasts/app/fakes.ts`
- [x] `publishBroadcastChanged(tx, { workspace_id, broadcast_id, change })` through `platform/realtime` (the coalescing for `report` lands in T22) — `apps/api/src/modules/broadcasts/infra/signals.ts`
- [x] RED: unit tests per branch (create, stale save, not a draft, invalid name / text, tag resolution, switch with and without the group size, delete by author / owner / other) — `apps/api/src/modules/broadcasts/app/drafts.test.ts`
- [x] `createDraft`, `saveFields`, `saveAudience`, `deleteDraft` using T5's rules (version, `mayDelete`) and T1's tidy / measure, each in one transaction with the §8 lock order — `apps/api/src/modules/broadcasts/app/drafts.ts`
- [x] Integration tests: two members saving at one version (the second gets `BROADCAST_DRAFT_CHANGED` with the first's text), a group add between them keeps the version, delete by a deactivated owner refused, one signal per recorded write — `apps/api/src/modules/broadcasts/app/drafts.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a save at an older version | `409 BROADCAST_DRAFT_CHANGED` with the current draft; nothing written (AC-03) |
| a group add or remove between two field saves | the version is unchanged, so the second field save is not stale (AC-03) |
| a save or delete on a launched broadcast | `409 BROADCAST_NOT_A_DRAFT`; the broadcast stays read-only (AC-09) |
| a text of 4097 UTF-16 units or only spaces | `400 BROADCAST_TEXT_INVALID`; the last valid text stays (AC-02) |
| a tag deleted or of another workspace in the save | `404 TAG_NOT_FOUND`; nothing saved |
| switch from a group whose size moved since the confirmation | `409 BROADCAST_GROUP_CHANGED` with the current size (AC-03) |
| delete by an operator who is not the author | `403 FORBIDDEN`, nothing deleted (AC-07) |
| no bot connected | create, save and delete work (AC-10) |
| a broadcast id of another workspace | `404` with no hint (AC-08) |

## Definition of Done

- [x] Unit and integration tests prove create starts a draft at version 1 with the member as author and last changer and needs no bot, a save at the shown version writes and raises the version, a stale save answers BROADCAST_DRAFT_CHANGED with the current draft, a save on a launched broadcast answers BROADCAST_NOT_A_DRAFT, an invalid name or text answers its code and keeps the last valid content, foreign tag ids answer TAG_NOT_FOUND, a switch from a group carries its confirmed size and a different size answers BROADCAST_GROUP_CHANGED, a delete by a non-author operator is FORBIDDEN and by the author or an active owner removes the draft, and each recorded write publishes one broadcast.changed (draft or deleted) in its transaction.
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes
- `implement` (T16): `createDrafts` (`broadcasts/app/drafts.ts`): `createDraft`, `saveFields`, `saveAudience`, `deleteDraft(workspaceId, { accountId, role }, id)`. The role comes from the route's membership guard; inside the delete transaction the actor's membership is locked `FOR SHARE` first (`WorkspacesApi.lockActiveMembers`), then the broadcast row, so a deactivated owner is `FORBIDDEN`.
- `implement` (T16): every use case answers the contract's `BroadcastDraft` through a new port `DraftView.draftView(workspaceId, id)`, read after the writing transaction; a stale save throws `BroadcastDraftChangedError(<that view>)`. **Hand-off → T17/T26:** `reads.getBroadcast` (draft branch) implements `DraftView`, `buildDeps()` binds it. The unit fake (`fakeDraftView`) and the int test use stand-ins with `reach: null`.
- `implement` (T16): ports declared now are only what drafts use — `Transaction`, `BroadcastChange`, `BroadcastSignals`, `ContactsApi.resolveTags(workspaceId, ids) → {id, name}[]` (tag names at that moment), `WorkspacesApi.lockActiveMembers`, `DraftView`. The other module ports in the checklist (`BotsApi`, `ConversationsApi`, the audience reads, jobs) are left to T17–T22, which use them, rather than declared unused here. **Hand-off → T26:** `contacts` has no app-layer "tags by ids with names" read; the int test binds `resolveTags` through `tagAdmin.listTags` (≤ 100 tags per workspace), which T26 can reuse or replace with a dedicated contacts read.
- `implement` (T16): `GroupRepo.removeAll(workspaceId, broadcastId, tx)` was added to T14's repository (`infra/group-repo.ts`, outside files_hint) for the switch from a group to a tag audience, with an isolation test in `group-repo.int.test.ts`.
- `implement` (T16): order of checks — name / text / tag-shape validation (400) before any lock; tag ids resolved before the transaction (`TAG_NOT_FOUND` names the first missing id); then under the row lock: not found → not a draft → stale version → (switch from a non-empty group) `BROADCAST_GROUP_CHANGED` when `expected_group_size` (absent = 0) differs. `kind: group` on a group is checked for staleness first and then answers unchanged with no signal. A create with an explicit empty or blank `text` is refused like a save (`BROADCAST_TEXT_INVALID`); an absent `text` starts the draft with `''`.
- `implement` (T16): RED was observed on the unit suite (`Cannot find module './drafts.js'`, then the 23 tests green); the integration tests were written right after GREEN and passed on their first run.
- `implement` (T16): gate — full `pnpm test`: one failure, `inbox/infra/hub.test.ts` "runs a socket's presence calls in order" (a 30 ms wall-clock wait under load; not touched here), which passed 3/3 re-run alone; everything else green (285 files). `pnpm lint` clean.
