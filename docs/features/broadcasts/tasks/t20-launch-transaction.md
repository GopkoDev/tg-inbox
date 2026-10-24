---
id: T20
title: "Add the launch transaction: memberships FOR SHARE, the per-workspace launch lock and cap, the broadcast row, the bot and the audience re-checked against the confirmed version and fingerprint, then recipients frozen, the first broadcasts.send link queued and broadcast.changed status published"
layer: "app"
deps: ["T19"]
blocks: ["T24"]
acs: ["AC-06", "AC-08", "AC-09"]
files_hint: ["apps/api/src/modules/broadcasts/app/launch.ts", "apps/api/src/modules/broadcasts/app/launch.test.ts", "apps/api/src/modules/broadcasts/app/launch.int.test.ts", "apps/api/src/modules/broadcasts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T20 — Add the launch transaction: memberships FOR SHARE, the per-workspace launch lock and cap, the broadcast row, the bot and the audience re-checked against the confirmed version and fingerprint, then recipients frozen, the first broadcasts.send link queued and broadcast.changed status published

## Place in the sequence

- **Blocked by:** T19 — Add the launch confirmation read, which is also the pre-check: owner only, a working bot, a non-empty text, at most 10 000, at least one reachable contact and the 10-per-24-hours cap, answering the trimmed text, version, breakdown and fingerprint · **Blocks:** T24 — Add the broadcasts queues and workers: broadcasts.send (stately per workspace, retry 3, expire 60 s, 16 links per instance) with its dead letter that restarts the chain 60 s later, and broadcasts.measure-blocked-share logging the 48-hour blocked share · **Wave:** 6 — after T19.
- **Lane:** shares `apps/api/src/modules/broadcasts/app/ports.ts` with T16; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T17; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T18; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T19; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T21; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T22; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T23 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see the final number of recipients and the text one last time, then launch the broadcast
> **So that** the message goes out once, to the customers I confirmed, from the workspace's bot
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It turns the owner's confirmation into exactly one launch to exactly the contacts the confirmation counted, and starts sending.

## Inlined context

> Already-launched (a double click, a second owner) returns the launched broadcast from the row lock step. An operator, a deactivated owner or a foreign workspace is refused before any lock beyond the membership check (AC-07, AC-08).
>
> — `sad.md §6, Critical flow 1, verbatim` · full text: [sad.md](../sad.md)

> Confirming runs the launch transaction of seeded flow 1, which re-checks all of it. A double click or a second owner gets the launched broadcast back and launches nothing again. A changed text, audience or reachable set (even with the same number) is refused with the current version to confirm again. An owner deactivated meanwhile launches nothing (AC-08). A successful launch inserts the recipients in fingerprint order, freezes the text, the tag names, the Telegram bot id and the confirmed breakdown, sets status `sending`, queues the first link and signals every tab.
>
> — `sad.md §6, flow 10, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The fingerprint proves "the same set" without shipping the set or writing a pending snapshot for every confirmation opened. Everything that decides the launch is re-read inside one transaction, behind the owner's share-locked membership (so a deactivation in flight serialises with it) and the per-workspace launch lock (so two launches of different drafts cannot both be the 10th). The broadcast row lock makes the second of two concurrent launches see `sending` and return the launched broadcast, so it launches once.
>
> — `adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md §Decision outcome, ADR-0006, verbatim` · full text: [ADR-0006](../adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md)

> **Launch:** memberships `FOR SHARE` → advisory `broadcast-launches:<ws>` → broadcast row `FOR NO KEY UPDATE` → (contacts reads, no locks) → recipient inserts → job insert.
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> - **The launch inserts up to 10 000 recipients with app-generated UUIDv7 ids**: use one `INSERT … SELECT … FROM unnest($ids, $contact_ids, $positions, $user_ids)`, not 10 000 statements (measured above at ~300 ms with a join).
>
> — `_audit/data-model-2026-10-23.md §Code-level findings for tasks, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> 8. **The launch rewrites the tag rows to the names at launch** and removes rows of tags that no longer exist, so the report shows the audience "as it was defined" at launch (SAD §1 assumption). The group rows stay, read-only, after the launch. The recipient list is the source of truth for a launched group.
>
> — `data-model.md §Assumptions, 8, verbatim` · full text: [data-model.md](../data-model.md)

> - **Producer:** `launchBroadcast` (the first link, enqueued with `jobDb(tx)` inside the launch transaction); […]
> - **Policy:** `stately`, `singletonKey` = `workspace_id` (one active link per workspace across instances)
>
> — `contracts/events.md §Job: broadcasts.send, abridged` · full text: [events.md](../contracts/events.md)

> | `broadcast.launched` | `workspace_id`, `broadcast_id`, `recipient_count`, `blocked_count`, `never_wrote_count` | `launchBroadcast`, after commit | metrics (sad.md §7) |
>
> — `contracts/events.md §Log events, verbatim` · full text: [events.md](../contracts/events.md)

> | Launch p95 — freezing 10 000 recipients | ≤ 2 s server time from confirm to "sending" | request timing log; seeded integration test |
>
> — `spec.md §6, NFR, verbatim` · full text: [spec.md](../spec.md)

> **Hard rule (Tenancy):** every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six)
>
> — `sad.md §8, Tenancy, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. The launch writes, through T14 / T15:

| Table | Columns | Constraint it must satisfy |
|---|---|---|
| `broadcasts` | `status = 'sending'`, `launched_at`, `launched_by_account_id`, `launch_telegram_bot_id`, `audience_size`, `blocked_count`, `never_wrote_count`, `recipient_count`, `last_changed_*` | non-null ⇔ not draft; `audience = blocked + never_wrote + recipients`, `audience <= 10000`, `recipients >= 1` |
| `broadcast_audience_tags` | `tag_name` rewritten to the name at launch; rows of vanished tags deleted | — |
| `broadcast_recipients` | `id`, `contact_id`, `position` 1…n, `telegram_user_id`, `state = 'waiting'` | unique per (broadcast, contact) and (broadcast, position) |

— `data-model.md §Entities, broadcasts / broadcast_recipients, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `POST …/broadcasts/{broadcastId}/launch` `BroadcastLaunch { expected_version, fingerprint }` → `200 BroadcastLaunched { outcome: launched | already_launched, broadcast: LaunchedBroadcast }`.
- Refusals: `403 ACCESS_REMOVED` (deactivated meanwhile) / `403 OWNER_ONLY` · `404` · `409 BROADCAST_DRAFT_CHANGED` (`details.draft`) · every `getLaunchConfirmation` refusal with the same code (T19) · `409 BROADCAST_AUDIENCE_CHANGED` (`details.confirmation`, the current one). A refused launch writes nothing and does not count toward the cap.
- In the transaction: the first `broadcasts.send { workspace_id }` job and `broadcast.changed { change: status }`; after commit the `broadcast.launched` log line.

— `contracts/openapi.yaml, operationId launchBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-06 — happy path

> **Given** a business owner of "Acme Flowers" with the draft "Spring prices" whose audience would reach 36 contacts, and a working bot
> **When** they choose to launch it
> **Then** a confirmation shows the exact text as the customer will see it, the number of contacts it will be sent to (36), how many are left out because they blocked the bot or never wrote to the current bot (2), and a warning that customers who did not expect the message can block or report the bot, which can limit the bot for support too; on confirmation the recipient list is fixed to exactly the 36 contacts counted in the confirmation, the broadcast becomes "sending" for every member, records who launched it and when, and sending starts; if between opening the confirmation and confirming it the text, the audience or the set of contacts it would reach changed (even if their number is the same), nothing is launched and the owner is shown the current version and number to confirm again; choosing launch twice, or two business owners launching the same draft at the same moment, launches it once and sends each recipient one message
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

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

- [x] Add `jobs.enqueueSendLink(tx, workspaceId)` (pg-boss `jobDb(tx)`) to the ports — `apps/api/src/modules/broadcasts/app/ports.ts`
- [x] RED: unit tests for the order of checks (membership, already launched, version, T19's evaluation, fingerprint) — `apps/api/src/modules/broadcasts/app/launch.test.ts`
- [x] `launchBroadcast`: memberships `FOR SHARE` → `broadcast-launches:<ws>` → row `FOR NO KEY UPDATE` → `evaluateLaunch` (T19) → fingerprint compare → recipients by unnest in sorted order → freeze → job → signal; log after commit — `apps/api/src/modules/broadcasts/app/launch.ts`
- [x] Integration tests: two concurrent launches of one draft (one `launched`, one `already_launched`, one job); two drafts racing for the 10th slot; a retag after the confirmation with an equal count → `BROADCAST_AUDIENCE_CHANGED`; an owner deactivated in a racing transaction launches nothing; recipients equal the confirmed set — `apps/api/src/modules/broadcasts/app/launch.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| double click / two owners at once | one launch; the other answers `200 already_launched`, no second job (AC-06) |
| same count, different set since the confirmation | `409 BROADCAST_AUDIENCE_CHANGED` with the current confirmation (AC-06) |
| text or audience saved since the confirmation | `409 BROADCAST_DRAFT_CHANGED` (AC-06) |
| owner deactivated before the commit | `403 ACCESS_REMOVED`, nothing launched (AC-08) |
| two drafts launched at the 10th slot | the launch lock lets one through, the other gets `429` (AC-09) |
| bot reconnected as a different Telegram bot after the confirmation | the fingerprint or the bot check refuses |
| retags or new customers after the launch | the recipient list never changes (AC-09) |

## Definition of Done

- [x] Integration tests prove a launch at the confirmed version and fingerprint inserts exactly the confirmed recipients in fingerprint order, freezes the text, the tag names, the Telegram bot id and the breakdown, sets sending with launched_by and launched_at, queues one broadcasts.send link in the same transaction and publishes one broadcast.changed status; two concurrent launches of one draft launch once (the second answers already_launched), two launches racing for the 10th slot let one through, a retag between confirmation and launch with the same count answers BROADCAST_AUDIENCE_CHANGED, a changed text answers BROADCAST_DRAFT_CHANGED, and an owner deactivated before the commit launches nothing.
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T20): `createLaunchBroadcast` (`broadcasts/app/launch.ts`): `launchBroadcast(ws, { accountId, role }, id, { expected_version, fingerprint })`. Order: `OWNER_ONLY` by role (no lock) → in one transaction `lockActiveMembers` (`FOR SHARE`; not active → `ACCESS_REMOVED`) → `lockLaunches` (advisory `broadcast-launches:<ws>`) → row `FOR NO KEY UPDATE` (404) → not a draft → `already_launched` (no write, no job, no signal) → stale version → `BROADCAST_DRAFT_CHANGED` with `details.draft` read after the rollback → `evaluateLaunch(row, tx)` (T19's refusals unchanged) → fingerprint ≠ → `BROADCAST_AUDIENCE_CHANGED` with the current confirmation → recipients by `insertAll` (unnest) in the sorted reachable order, positions 1…n → tag rows rewritten to the names at launch, vanished tags' rows removed (`contacts.resolveTags`) → `markLaunched` (frozen trimmed text, Telegram bot id, breakdown, launcher, launched/last-changed at) → `jobs.enqueueSendLink(tx, ws)` → `broadcast.changed status`. After commit the `broadcast.launched` log (ids + counts only). The answer's broadcast comes from `views.broadcastView`.
- `implement` (T20): new ports `BroadcastRepo.lockLaunches` / `markLaunched` (+ `LaunchFreeze`) and `BroadcastJobs.enqueueSendLink(tx, ws, startAfter?)`; implemented in `infra/broadcast-repo.ts` and the fakes (outside files_hint — the repository is where the SQL lives), with isolation + "only a draft" + lock-serialisation tests in `broadcast-repo.int.test.ts` (RED `TypeError: repo.markLaunched is not a function`). `settle.ts` now takes `Pick<BroadcastJobs, 'enqueueBlockedShare'>` so existing callers compile. **Hand-off → T24:** implement `enqueueSendLink` over pg-boss with `jobDb(tx)`; **→ T26:** bind `views = reads.getBroadcast`, `drafts = reads`, `contacts.resolveTags`, `preview = createLaunchPreview(...)`.
- `implement` (T20): unit RED `Cannot find module './launch.js'` (GOOD red). Integration (`launch.int.test.ts`) written after GREEN, green on first run after fixing two test-side mistakes (fixture text must be stored trimmed — `broadcasts_text_check`; tag rows ordered by kind).
- `implement` (T20): gate — `pnpm lint` clean; full `pnpm test`: 4250/4250 tests passed, one suite (`platform/realtime.int`) reported a Docker teardown error (HTTP 409 removing a still-running container) under load — green re-run alone; no containers left.

