---
id: T17
title: "Add the broadcasts reads: the list with each draft's audience size, one broadcast as a draft with its breakdown for the current bot or as a launched broadcast with its frozen audience and totals, the recipients page, and itemDetails for the inbox thread"
layer: "app"
deps: ["T8", "T15", "T16"]
blocks: ["T25"]
acs: ["AC-01", "AC-08", "AC-11", "AC-16"]
files_hint: ["apps/api/src/modules/broadcasts/app/reads.ts", "apps/api/src/modules/broadcasts/app/reads.test.ts", "apps/api/src/modules/broadcasts/app/reads.int.test.ts", "apps/api/src/modules/broadcasts/app/ports.ts", "apps/api/src/modules/broadcasts/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T17 — Add the broadcasts reads: the list with each draft's audience size, one broadcast as a draft with its breakdown for the current bot or as a launched broadcast with its frozen audience and totals, the recipients page, and itemDetails for the inbox thread

## Place in the sequence

- **Blocked by:** T8 — Evaluate audiences in contacts with the Contacts filter rules: the breakdown for a tag audience or a list of ids against a Telegram bot, the reachable set sorted by id, existing tags, contacts matching a search and filter, contact cards and the blocked check at a recipient's turn, T15 — Build the broadcasts recipient repository: the launch insert by unnest with positions, the conditional claim, outcome writes, back to waiting, stale in-flight resolution, settling waiting recipients, totals, the report page, the next waiting recipient and the duplicate sets, with isolation tests, T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner · **Blocks:** T25 — Enrich the inbox thread with broadcast items: listThreadItems returns broadcast entries with the broadcast name, text and launching owner from broadcasts.itemDetails, and getThreadBroadcastItem reads one · **Wave:** 5 — after T8, T15, T16.
- **Lane:** shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T16; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T18; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T19; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T20; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T21; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T22; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T23 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It is every read a member sees a broadcast through — the list, the draft with its live breakdown, the launched broadcast with its report totals and recipient pages — plus the broadcast details the inbox thread shows.

## Inlined context

> An active member of either role gets every broadcast of the workspace, drafts and launched ones together, the most recently changed first, each with its name, status, audience size and who last changed or launched it (AC-01). A draft's audience size is its group's row count or its tag audience's matching count. A launched broadcast shows the breakdown frozen at launch.
>
> — `sad.md §6, flow 5, abridged` · full text: [sad.md](../sad.md)

> Every draft read asks `bots` for the current Telegram bot id, keeps only the stored tags that still exist, and runs one aggregate query with the Contacts filter's rules […] joined to the reach rows of that bot. It answers the audience size, blocked, never wrote to the current bot and would reach (AC-01, AC-10, AC-14). A renamed tag keeps working under its new name, and a deleted or merged one is dropped with a notice that uses its stored name. […] With no bot at all, only the audience size is shown.
>
> — `sad.md §6, flow 7, abridged` · full text: [sad.md](../sad.md)

> The page shows the name, the text, the audience as it was defined (tag names at launch), who launched it and when, its status and the totals by outcome, which are one grouped count over the recipient rows (AC-11). Recipients come 50 at a time in position order, optionally narrowed to one outcome, each with its outcome, reason and time.
>
> — `sad.md §6, flow 11, abridged` · full text: [sad.md](../sad.md)

> - With no bot at all (no bot row), the draft breakdown shows the audience size and says that reach is known once a bot is connected. A bot that is not working (`needs_token`, `taken_over`) still has its Telegram bot id, so the breakdown is computed against it.
> - The launch also freezes the breakdown it confirmed (audience size, blocked, never wrote to the current bot, recipients) on the broadcast. The Broadcasts list and the broadcast page read these numbers instead of recounting.
>
> — `sad.md §6, Assumptions (sequences), abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The matching is the Contacts list's by construction. The breakdown is one aggregate query joined to the reachability rows of the current bot, and the reachable set is at most 10 001 rows (the extra one proves "over the limit"). Groups go to `contacts` as an id array (`= ANY($1)`), which stays inside the targets at 10 000 ids. Detecting a missing tag at read time needs no cross-module hook.
>
> — `adr/0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set.md §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set.md)

> **Chosen:** Option 1. At most one report signal per broadcast per second plus a refetch of about 50 ms keeps the shown report within ~1.5 s of the newest outcome, inside the 3 s target, at a fixed cost per tab. Paging keeps every read small at 10 000 recipients. The contract stays ids-only.
>
> — `adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md §Decision outcome, ADR-0011, verbatim` · full text: [ADR-0011](../adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md)

> `inbox` adds each broadcast's name, text and launching owner from `broadcasts`, and names a deactivated owner too.
>
> — `sad.md §6, flow 18, abridged` · full text: [sad.md](../sad.md)

> - The draft breakdown is recomputed on every read, not cached.
>
> — `sad.md §11, Accepted debt, verbatim` · full text: [sad.md](../sad.md)

> **Hard rule (Logging):** pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only.
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Reads, through T14 / T15 and `contacts`:

| Table | Columns read | Index |
|---|---|---|
| `broadcasts` | every column; `audience_size`, `blocked_count`, `never_wrote_count`, `recipient_count` (frozen ⇔ not draft) | `broadcasts_workspace_id_last_changed_at_idx`, `broadcasts_workspace_id_id_key` |
| `broadcast_audience_tags` | `tag_id`, `kind`, `tag_name` (names at launch once launched) | pkey |
| `broadcast_group_contacts` | count per broadcast | pkey |
| `broadcast_recipients` | totals by `state`; page by `position` or (`state`, `position`) | `broadcast_recipients_broadcast_position_key`, `broadcast_recipients_state_position_idx` |

— `data-model.md §Entities and §Indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `GET …/broadcasts` → `200 BroadcastList { workspace_id, items: BroadcastListItem[] }` (`id, name, status, audience_kind, audience_size, author, last_changed_by, last_changed_at, launched_at, ended_at`), not paged, newest change first.
- `GET …/broadcasts/{broadcastId}` → `200 Broadcast` = `BroadcastDraft` (`version, name, text, author, last_changed_by, audience` with current tag names + `dropped_tags`, `breakdown: { audience_size, reach: { blocked_count, never_wrote_count, reachable_count } | null }`) or `LaunchedBroadcast` (`audience` as defined at launch, `launched_by, launched_at, launch_breakdown, stopped_by, stopped_at, ended_at, end_reason, totals: RecipientTotals, not_reached_count` — the last added at `tasks`, api flag F-5: `failed` with a fixable reason plus `stopped`, from T15's "did not reach" count) · `404` with no hint.
- `GET …/broadcasts/{broadcastId}/recipients?state&after` → `200 BroadcastRecipientPage` (50 per page; `BroadcastRecipient { id, position, contact, state, failure_reason, outcome_at }`); a draft answers an empty page.
- Internal for `inbox` (T25): `itemDetails(workspaceId, broadcastIds)` → name, text and launching owner (also when deactivated) per id (`ThreadBroadcastItem.broadcast_name / text / launched_by`).

— `contracts/openapi.yaml, operationId listBroadcasts / getBroadcast / listBroadcastRecipients, ThreadBroadcastItem, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
> **When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
> **Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — cross-context

> **Given** "Olena K.", whose conversation is closed, unassigned and not waiting for a reply, received the broadcast "Spring prices"
> **When** an operator opens her conversation in the inbox, and then she answers the broadcast in Telegram
> **Then** the thread shows the broadcast at the time it was delivered as a broadcast item — its text, its name and the business owner who launched it (still named if that owner was deactivated since) — distinct from the team's replies; a recipient whose send ended "not confirmed" also gets the item, marked "not confirmed" and placed at the time the send was made; receiving it did not reopen the conversation, did not change its assignee, its "waiting for a reply" marker, any unread or attention count, and triggered no ping; her answer is captured as a customer message as before: it reopens the conversation and counts for unread, "waiting for a reply" and pings like any message; a recipient whose broadcast failed for any other reason, was stopped before their turn, or who was left out gets no broadcast item
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add the read ports this needs — `ContactsApi.audienceBreakdown`, `existingTags`, `contactCards`; `BotsApi.launchReadiness` (current Telegram bot id or none); `WorkspacesApi` display names incl. deactivated — `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts`
- [ ] RED: unit tests for the draft view (tags kept / dropped, no-bot `reach: null`, not-working bot still counted), the launched view (frozen breakdown, totals), the list's audience sizes — `apps/api/src/modules/broadcasts/app/reads.test.ts`
- [ ] `listBroadcasts`, `getBroadcast`, `listRecipients` (50, position keyset, optional state), `itemDetails` — `apps/api/src/modules/broadcasts/app/reads.ts`
- [ ] Integration tests on seeds: the AC-01 tag audience (38 / 2 / 0 / 36), a launched broadcast's totals summing to `recipient_count`, a deactivated launcher still named, foreign id → not found — `apps/api/src/modules/broadcasts/app/reads.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| workspace with no bot row | draft `breakdown.reach` is null, only the size (AC-10) |
| bot `needs_token` or `taken_over` | breakdown still computed for its Telegram bot id |
| a chosen tag deleted or merged since | left out of the count, listed in `dropped_tags` by stored name (AC-01) |
| a chosen tag renamed since | counted, shown under its new name (AC-01) |
| a launched broadcast | audience and breakdown as frozen at launch, never recounted (AC-09) |
| the launching owner deactivated | still named in the page and in `itemDetails` (AC-16) |
| a broadcast id of another workspace | `404` with no hint (AC-08) |
| recipients of a draft | empty page |

## Definition of Done

- [ ] Unit and integration tests prove the list returns drafts and launched broadcasts together by last change with a draft's live audience size and a launched one's frozen size, a draft read carries the breakdown for the current Telegram bot (size only with no bot) and the dropped-tag notice, a launched read carries the audience as defined at launch, who launched and stopped it, the totals by outcome and not_reached_count (fixable failures plus stopped, api flag F-5), the recipients page follows position 50 at a time with an optional outcome filter, itemDetails names the launching owner even when deactivated, and a foreign broadcast id is not found.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
