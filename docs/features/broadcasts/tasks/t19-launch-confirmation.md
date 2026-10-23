---
id: T19
title: "Add the launch confirmation read, which is also the pre-check: owner only, a working bot, a non-empty text, at most 10 000, at least one reachable contact and the 10-per-24-hours cap, answering the trimmed text, version, breakdown and fingerprint"
layer: "app"
deps: ["T5", "T8", "T15", "T16"]
blocks: ["T20"]
acs: ["AC-05", "AC-06", "AC-07", "AC-09", "AC-10"]
files_hint: ["apps/api/src/modules/broadcasts/app/preview.ts", "apps/api/src/modules/broadcasts/app/preview.test.ts", "apps/api/src/modules/broadcasts/app/preview.int.test.ts", "apps/api/src/modules/broadcasts/app/ports.ts", "apps/api/src/modules/broadcasts/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T19 — Add the launch confirmation read, which is also the pre-check: owner only, a working bot, a non-empty text, at most 10 000, at least one reachable contact and the 10-per-24-hours cap, answering the trimmed text, version, breakdown and fingerprint

## Place in the sequence

- **Blocked by:** T5 — Add the broadcasts domain for drafts and launches: the status machine, the version rule, who may delete, launch and stop, the tag audience shape with the dropped-tag notice, the 10 000 limit and the audience fingerprint, T8 — Evaluate audiences in contacts with the Contacts filter rules: the breakdown for a tag audience or a list of ids against a Telegram bot, the reachable set sorted by id, existing tags, contacts matching a search and filter, contact cards and the blocked check at a recipient's turn, T15 — Build the broadcasts recipient repository: the launch insert by unnest with positions, the conditional claim, outcome writes, back to waiting, stale in-flight resolution, settling waiting recipients, totals, the report page, the next waiting recipient and the duplicate sets, with isolation tests, T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner · **Blocks:** T20 — Add the launch transaction: memberships FOR SHARE, the per-workspace launch lock and cap, the broadcast row, the bot and the audience re-checked against the confirmed version and fingerprint, then recipients frozen, the first broadcasts.send link queued and broadcast.changed status published · **Wave:** 5 — after T5, T8, T15, T16.
- **Lane:** shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T16; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T17; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T18; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T20; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T21; shares `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts` with T22; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T23 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see the final number of recipients and the text one last time, then launch the broadcast
> **So that** the message goes out once, to the customers I confirmed, from the workspace's bot
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It is the business owner's last look before launching — the exact text and the final number — and the one pre-check that keeps a draft that cannot be launched from ever opening the confirmation.

## Inlined context

> For a business owner, "Launch" reads the confirmation, which is also the pre-check (sequences assumption). It asks `bots` for the bot's state and Telegram id and counts the launches of the last 24 h. It then evaluates the audience for that bot. No bot or a bot that is not connected is refused with the way to the bot settings (AC-10). An audience over 10 000 (AC-05), nobody reachable (AC-09) and the 10th launch within 24 h are refused too, the last one with the next launch time (AC-09). Otherwise the confirmation shows the trimmed text, the count, who is left out and why, and the warning. It carries the version and the fingerprint (AC-06, ADR-0006).
>
> — `sad.md §6, flow 10, abridged` · full text: [sad.md](../sad.md)

> - "A working bot" for a **launch** means the bot row's state is `connected`. `needs_token` (not working), `disconnected` / no row (no bot) and `taken_over` (the webhook points elsewhere, so answers and block notices would not reach tg-inbox) refuse a launch with the way to the bot settings.
>
> — `sad.md §1, Assumptions, abridged` · full text: [sad.md](../sad.md)

> - **Launch cap counting.** The cap counts broadcasts of the workspace whose `launched_at` is within the last 24 h, under the advisory lock `broadcast-launches:<ws>`. A stopped or aborted broadcast keeps its `launched_at`, so it counts. A refused launch writes nothing, so it does not count. The refusal carries `next_launch_at` = the 10th newest `launched_at` + 24 h (AC-09).
>
> — `sad.md §4, Supporting choices, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The fingerprint proves "the same set" without shipping the set or writing a pending snapshot for every confirmation opened. Everything that decides the launch is re-read inside one transaction, behind the owner's share-locked membership (so a deactivation in flight serialises with it) and the per-workspace launch lock (so two launches of different drafts cannot both be the 10th). The broadcast row lock makes the second of two concurrent launches see `sending` and return the launched broadcast, so it launches once.
>
> — `adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md §Decision outcome, ADR-0006, verbatim` · full text: [ADR-0006](../adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md)

> - **Recipient position** = rank of the contact id in the sorted reachable set, the same sort as the fingerprint (ADR-0006), so the fingerprint and the positions come from one ordered read.
>
> — `_audit/data-model-2026-10-23.md §Code-level findings for tasks, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> 5. The breakdown partitions the audience in this order: blocked, then never wrote, then reachable. A contact whose reach row is blocked but who never wrote through that bot counts as blocked.
>
> — `data-model.md §Assumptions, 5, abridged` · full text: [data-model.md](../data-model.md)

> **Hard rule (Authorization):** Roles: any active member lists, reads, creates, edits, duplicates, adds to / removes from groups; the draft author or a business owner deletes a draft; only a business owner launches and stops, re-checked under `workspaces.lockActiveMembers` (`FOR SHARE`) inside the action's transaction. Foreign ids answer 404 (`NotFoundError`) with no hint
>
> — `sad.md §8, Authentication / authorization, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Reads only: the draft row (`text`, `version`, `audience_kind`, `tag_mode`), its tag or group rows, and the launch count by `broadcasts_workspace_id_launched_at_idx` (`WHERE launched_at IS NOT NULL`, the 10th newest `launched_at`).

— `data-model.md §Entities, broadcasts, Access patterns, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `GET …/broadcasts/{broadcastId}/launch-confirmation` → `200 LaunchConfirmation { broadcast_id, version, name, text (trimmed, never empty), breakdown: LaunchBreakdown { audience_size, blocked_count, never_wrote_count, recipient_count }, fingerprint }`. Writes nothing.
- Refusals, in this order: `403 OWNER_ONLY` (operator) · `404` · `409 BROADCAST_NOT_A_DRAFT` · `400 BROADCAST_TEXT_INVALID` (empty text) · `409 BROADCAST_NEEDS_WORKING_BOT` (`details.bot_state`, no row and `disconnected` → `not_connected`) · `429 BROADCAST_LAUNCH_LIMIT_REACHED` (`details.limit: 10, window_hours: 24, next_launch_at`, `Retry-After`) · `409 BROADCAST_AUDIENCE_TOO_LARGE` (`details.limit, audience_size, can_add`) · `409 BROADCAST_NO_REACHABLE_CONTACT` (`details.breakdown`).
- The same checks and codes are reused by `launchBroadcast` (T20).

— `contracts/openapi.yaml, operationId getLaunchConfirmation, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-05 — domain invariant

> **Given** a draft of "Acme Flowers" whose group holds 9 990 contacts
> **When** an operator adds a contact who is already in the group, or chooses "add all matching" for a filter matching 50 contacts not in the group, or a tag audience would match more than 10 000 contacts
> **Then** a contact already in the group is not added twice and the group says it is already there; the bulk add is refused as a whole and the editor says that a broadcast's audience can hold at most 10 000 contacts (reachable or not) and how many can still be added; a tag audience matching more than 10 000 contacts, reachable or not, can be saved as a draft but not launched, and says so; a group only ever holds contacts of its own workspace
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — happy path

> **Given** a business owner of "Acme Flowers" with the draft "Spring prices" whose audience would reach 36 contacts, and a working bot
> **When** they choose to launch it
> **Then** a confirmation shows the exact text as the customer will see it, the number of contacts it will be sent to (36), how many are left out because they blocked the bot or never wrote to the current bot (2), and a warning that customers who did not expect the message can block or report the bot, which can limit the bot for support too; on confirmation the recipient list is fixed to exactly the 36 contacts counted in the confirmation, the broadcast becomes "sending" for every member, records who launched it and when, and sending starts; if between opening the confirmation and confirming it the text, the audience or the set of contacts it would reach changed (even if their number is the same), nothing is launched and the owner is shown the current version and number to confirm again; choosing launch twice, or two business owners launching the same draft at the same moment, launches it once and sends each recipient one message
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] Add `BotsApi.launchReadiness(ws)` → `{ state, telegramBotId } | null` and `ContactsApi.reachableContacts(ws, audience, botId, limit 10 001)` to the ports and fakes — `apps/api/src/modules/broadcasts/app/ports.ts`, `apps/api/src/modules/broadcasts/app/fakes.ts`
- [ ] RED: unit tests for each refusal in order and the happy path (breakdown, fingerprint from T5) — `apps/api/src/modules/broadcasts/app/preview.test.ts`
- [ ] `evaluateLaunch(ws, broadcast, readiness, now)` shared with T20 (text, bot, cap with `next_launch_at`, size, ≥ 1 reachable, breakdown, sorted ids, fingerprint) and `getLaunchConfirmation` on top of it — `apps/api/src/modules/broadcasts/app/preview.ts`
- [ ] Integration tests: the AC-06 seed answers 36 with the fingerprint of the sorted ids; 10 launches in 24 h (one stopped) → 429 with the right `next_launch_at`; a group of 10 001 → too large; all blocked → no reachable — `apps/api/src/modules/broadcasts/app/preview.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| caller is an operator | `403 OWNER_ONLY`; the panel lands on the draft with the owners-only note (AC-07) |
| no bot row, `disconnected`, `needs_token` or `taken_over` | `409 BROADCAST_NEEDS_WORKING_BOT` with the state (AC-10) |
| draft text empty | `400 BROADCAST_TEXT_INVALID` |
| 10 launches in the last 24 h, one of them stopped | `429` with `next_launch_at` = 10th newest + 24 h (AC-09) |
| a tag audience matching 10 001 | `409 BROADCAST_AUDIENCE_TOO_LARGE` (AC-05) |
| everyone blocked or never wrote to the current bot | `409 BROADCAST_NO_REACHABLE_CONTACT` (AC-09) |
| contacts who wrote only to an older bot | counted as never wrote, left out (AC-10) |

## Definition of Done

- [ ] Unit and integration tests prove an operator gets OWNER_ONLY, no bot or a bot that is not connected answers BROADCAST_NEEDS_WORKING_BOT with the bot state, an empty text BROADCAST_TEXT_INVALID, an audience over 10 000 BROADCAST_AUDIENCE_TOO_LARGE, nobody reachable BROADCAST_NO_REACHABLE_CONTACT, an 11th launch in 24 h BROADCAST_LAUNCH_LIMIT_REACHED with next_launch_at = the 10th newest launch + 24 h, and otherwise the confirmation returns the text, the version, the breakdown (36 of 38 on the AC-06 seed) and the fingerprint of the sorted reachable ids.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
