---
id: T5
title: "Add the broadcasts domain for drafts and launches: the status machine, the version rule, who may delete, launch and stop, the tag audience shape with the dropped-tag notice, the 10 000 limit and the audience fingerprint"
layer: "domain"
deps: ["T1"]
blocks: ["T16", "T19"]
acs: ["AC-03", "AC-05", "AC-06", "AC-07", "AC-09", "AC-18"]
files_hint: ["apps/api/src/modules/broadcasts/domain/broadcast.ts", "apps/api/src/modules/broadcasts/domain/broadcast.test.ts", "apps/api/src/modules/broadcasts/domain/audience.ts", "apps/api/src/modules/broadcasts/domain/audience.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
step: ""
---

# T5 — Add the broadcasts domain for drafts and launches: the status machine, the version rule, who may delete, launch and stop, the tag audience shape with the dropped-tag notice, the 10 000 limit and the audience fingerprint

## Place in the sequence

- **Blocked by:** T1 — Add the shared broadcast text and name rules: trim both ends, 1–4096 UTF-16 code units for the text, 1–80 graphemes for the name, and the "Copy of …" cut · **Blocks:** T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner, T19 — Add the launch confirmation read, which is also the pre-check: owner only, a working bot, a non-empty text, at most 10 000, at least one reachable contact and the 10-per-24-hours cap, answering the trimmed text, version, breakdown and fingerprint · **Wave:** 2 — after T1.
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to see the final number of recipients and the text one last time, then launch the broadcast
> **So that** the message goes out once, to the customers I confirmed, from the workspace's bot
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It writes down, without any I/O, the rules every draft and launch path enforces — which status moves are legal, which saves raise the version, who may delete, launch and stop, the 10 000 limit and what "the same audience" means.

## Inlined context

> ├── domain/   broadcast.ts (status machine draft → sending → sent | stopped, version rule, who may delete / launch / stop)
> │             audience.ts (tag audience shape, missing-tag notice, 10 000 limit, fingerprint over sorted ids)
>
> — `sad.md §5, Internal decomposition, domain, verbatim` · full text: [sad.md](../sad.md)

> - **Which draft edits are versioned.** The name, the text, the audience kind and a tag audience's tags are saved against the version the member saw, and a stale save is refused (AC-03). Adding contacts to a group and removing them are separate changes that never conflict and do not count as a change to the version. Switching the audience kind drops the other kind's choice: a group with contacts is dropped only after a confirmation naming how many it holds.
> - **The 10 000 limit is on the audience size.** It counts every contact a group holds or a tag audience matches, reachable or not.
>
> — `spec.md §1, Clarifications, abridged` · full text: [spec.md](../spec.md)

> **Chosen:** Option 1. Field edits get the stale-save protection AC-03 asks for; group edits are commutative set operations (insert on conflict do nothing, delete by key), so concurrent adds and removes by two members both stand. One counter is enough at draft scale …
>
> — `adr/0005 §Decision outcome, ADR-0005, abridged` · full text: [ADR-0005](../adr/0005-version-draft-fields-and-keep-the-group-as-per-contact-rows-outside-the-version.md)

> 6. **A launch confirms the shown version and an audience fingerprint …** The confirmation read returns the version, the breakdown and a fingerprint, the SHA-256 of the sorted reachable contact ids.
>
> — `sad.md §4, choice 6, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The fingerprint proves "the same set" without shipping the set or writing a pending snapshot for every confirmation opened. … The fingerprint changes when any reachable contact changes, including a block that would have been skipped at its turn anyway; the owner then confirms again.
>
> — `adr/0006 §Decision outcome + §Neutral, ADR-0006, abridged` · full text: [ADR-0006](../adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md)

> 4. … Tags are kept on the draft by id with the name at the moment they were chosen. A tag that no longer exists is left out of the evaluation and reported by that name, so a rename keeps working and a delete or merge drops it with a notice, without any hook from tag admin into `broadcasts`.
>
> — `sad.md §4, choice 4, abridged` · full text: [sad.md](../sad.md)

> | Authentication / authorization | … Roles: any active member lists, reads, creates, edits, duplicates, adds to / removes from groups; the draft author or a business owner deletes a draft; only a business owner launches and stops, re-checked under `workspaces.lockActiveMembers` (`FOR SHARE`) inside the action's transaction. |
>
> — `sad.md §8, Authentication / authorization, abridged` · full text: [sad.md](../sad.md)

> **Layers:** `domain` (pure, no I/O) → `app` (use cases, ports) → `infra` (Kysely repos, Telegram adapters) → `http` (routes, zod schemas). Imports flow inward only.
>
> — `CLAUDE.md §Rules, Layers, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (The rules mirror `broadcasts.status` / `version` / `audience_kind` / `tag_mode` and `broadcast_audience_tags.kind` from T3.)

## API contract

Internal — no API surface. (The rules decide `BROADCAST_NOT_A_DRAFT`, `BROADCAST_DRAFT_CHANGED`, `BROADCAST_AUDIENCE_TOO_LARGE`, `BROADCAST_AUDIENCE_CHANGED` and `OWNER_ONLY` / `FORBIDDEN`, raised by the use cases.)

## Acceptance criteria

### AC-03 — error

> **Given** two members of "Acme Flowers" with the same draft open
> **When** one changes the text or the audience and saves, and then the other saves a change made on the older version; or both add and remove contacts in the draft's group at the same moment
> **Then** the second text or audience change is not saved over the first: that member is told that a teammate changed the draft and is shown the current version to apply their change again; group additions and removals by both members are each kept (a contact added by one and not removed by the other stays in the group), so no one's additions silently disappear, and adding or removing group contacts never makes a teammate's text or name save count as stale
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

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

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Red: status machine table test — only `draft→sending`, `sending→sent`, `sending→stopped` are legal; `isEditable(status)` true only for draft — `apps/api/src/modules/broadcasts/domain/broadcast.test.ts`
- [ ] Red: `canDelete({ role, accountId, authorId })` (author or owner), `canLaunch(role)` / `canStop(role)` (owner only); `nextVersion` only for name / text / kind / tags saves — same file
- [ ] Red: `AUDIENCE_LIMIT = 10_000`, `checkAudienceSize(n)` (10 000 ok, 10 001 over with room left), `splitExistingTags(stored, existingIds)` → kept + dropped (by stored name), tag-audience shape (mode `none` takes no include tags; a tag is include or exclude, never both) — `apps/api/src/modules/broadcasts/domain/audience.test.ts`
- [ ] Red: `audienceFingerprint(ids)` = SHA-256 hex of the ids sorted ascending and joined with `\n`; order-independent; differs for a swapped contact at the same count — same file
- [ ] Green: `broadcast.ts`, `audience.ts` (pure; `node:crypto` hashing is the one allowed import)

## Edge cases

| Case | Behaviour |
|---|---|
| a group add / remove | never raises the version (AC-03, ADR-0005) |
| a delete request by an operator who is not the author | `canDelete` false → FORBIDDEN in the use case (AC-07) |
| `sent` → `stopped` (a stop after the last outcome) | illegal move; the stop answers unchanged (AC-18) |
| a stored tag deleted or merged away | dropped from the evaluation, reported by its stored name (AC-01) |
| same 36 contacts listed in another order | same fingerprint; one contact swapped → another fingerprint (AC-06) |

## Definition of Done

- [ ] Domain unit tests prove the status machine (draft → sending → sent | stopped, no other move), that only draft fields raise the version, that a draft is deletable by its author or a business owner and by no one else, that only a business owner launches and stops, that a tag audience keeps only existing tags and reports dropped ones by stored name, that 10 000 is allowed and 10 001 is not, and that the fingerprint is the same SHA-256 for the same set in any order and differs for the same count with another contact.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
