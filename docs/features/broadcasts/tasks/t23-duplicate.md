---
id: T23
title: "Add duplicate: any member copies any broadcast into a new draft named \"Copy of …\" within 80, a draft with its audience, a launched one as the same tags, all recipients or only the recipients it did not reach once ended"
layer: "app"
deps: ["T6", "T15", "T16"]
blocks: ["T26"]
acs: ["AC-07", "AC-13", "AC-18"]
files_hint: ["apps/api/src/modules/broadcasts/app/duplicate.ts", "apps/api/src/modules/broadcasts/app/duplicate.test.ts", "apps/api/src/modules/broadcasts/app/duplicate.int.test.ts", "apps/api/src/modules/broadcasts/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T23 — Add duplicate: any member copies any broadcast into a new draft named "Copy of …" within 80, a draft with its audience, a launched one as the same tags, all recipients or only the recipients it did not reach once ended

## Place in the sequence

- **Blocked by:** T6 — Add the broadcasts domain for sending and copies: recipient states and failure reasons, the bots answer → outcome map with its abort kinds, the fixable set, the pace constants and the round-robin turn picker, and the duplicate audience choices, T15 — Build the broadcasts recipient repository: the launch insert by unnest with positions, the conditional claim, outcome writes, back to waiting, stale in-flight resolution, settling waiting recipients, totals, the report page, the next waiting recipient and the duplicate sets, with isolation tests, T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner · **Blocks:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Wave:** 5 — after T6, T15, T16.
- **Lane:** shares `apps/api/src/modules/broadcasts/app/ports.ts` with T16; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T17; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T18; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T19; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T20; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T21; shares `apps/api/src/modules/broadcasts/app/ports.ts` with T22 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to duplicate any broadcast into a new draft with the same text and audience
> **So that** a follow-up goes to the same customers without picking them again
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It lets any member reuse a broadcast's text and audience — or only the recipients it did not reach — as a new draft, without changing the original.

## Inlined context

> - **Duplicates** are one transaction in `broadcasts`: a new draft row (author = the member, name "Copy of …" cut to 80 characters by the shared name rule, same text) plus a copy of the source's audience: the tag rows; the group rows; for a launched broadcast "all recipients" (every recipient row) or "only recipients it did not reach" (outcomes `failed` with reason `bot_stopped`, `text_refused` or `telegram_error`, plus `stopped`, plus `not_confirmed` only when the request carries `include_not_confirmed`), offered only when the broadcast has ended. Copied contacts are re-checked against the workspace by the composite foreign key (AC-13).
>
> — `sad.md §4, Supporting choices, verbatim` · full text: [sad.md](../sad.md)

> Any member duplicates any broadcast. A draft is copied at once with its text and its audience rows. A launched broadcast asks for the copy's audience first (AC-13). "Same tags" copies the tag audience it was launched with, evaluated again at the copy's launch. "All recipients" makes a group of every recipient, and those who blocked the bot are counted unreachable by the breakdown. "Only recipients it did not reach" is offered once the broadcast has ended, and the server refuses it before then. […] Delivered, blocked and deleted-account recipients are never copied. The copy is named "Copy of …" within 80 characters by the shared name rule, its author is the member who duplicated it, and the source does not change. That is how an operator duplicates any broadcast while launching none (AC-07). Every copied contact passes the composite foreign key to the workspace's contacts (AC-08).
>
> — `sad.md §6, flow 15, abridged` · full text: [sad.md](../sad.md)

> - A failure "chat not found" (Telegram does not know a private chat between the bot and that user) is a recipient-level failure that a new attempt cannot fix. It is not copied by "only recipients it did not reach" (AC-13 lists the fixable reasons, and this is not one).
>
> — `sad.md §1, Assumptions, verbatim` · full text: [sad.md](../sad.md)

> 13. **Duplicate audiences are named** `same` (a draft source, the default), `same_tags`, `all_recipients`, `not_reached`; a choice that does not fit the source is `400 VALIDATION_ERROR` with `details.field = audience`. "Only recipients it did not reach" while the source still sends is the new `409 BROADCAST_NOT_ENDED` (flag F-2).
>
> — `contracts/api-sync-report.md §Assumptions, 13, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> **Hard rule (Logging):** pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only.
>
> — `sad.md §8, Logging, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Writes a new `broadcasts` row (`status = 'draft'`, `version` 1, `author_account_id` = `last_changed_by_account_id` = the caller) plus `broadcast_audience_tags` rows (same tags, names at launch) or `broadcast_group_contacts` rows (`added_by_account_id` = the caller), reading the source's tag, group or `broadcast_recipients` rows (`state`, `failure_reason`) through T14 / T15.

— `data-model.md §Entities, broadcasts / broadcast_group_contacts / broadcast_recipients, abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `POST …/broadcasts/{broadcastId}/duplicate` `BroadcastDuplicate { audience: same | same_tags | all_recipients | not_reached, include_not_confirmed? }` → `201 BroadcastDraft` (the copy).
- `same` only for a draft; `same_tags` only for a launched tag audience; `all_recipients` / `not_reached` only for a launched broadcast; otherwise `400 VALIDATION_ERROR` (`details.field: audience`).
- `not_reached` while the source is `sending` → `409 BROADCAST_NOT_ENDED` (`details.broadcast_id, status`). `404` for a foreign id. Any member.
- Signal: `broadcast.changed { change: draft }` for the copy.

— `contracts/openapi.yaml, operationId duplicateBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-07 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they open a draft they could launch if they were an owner, or try to launch it in any other way (for example from a saved link to the confirmation), or try to delete a draft that a teammate created
> **Then** the draft shows no launch action and says that only a business owner launches broadcasts; the attempt sends nothing and changes nothing; the delete is refused with the explanation that a draft is deleted by its author or a business owner; the operator can still edit, duplicate and delete their own drafts
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — happy path

> **Given** "Acme Flowers" with a draft "Wholesale catch-up" (a group of 14 contacts) and the sent broadcast "Spring prices" (tag audience; 33 delivered, 1 blocked the bot, 2 failed because the bot stopped working)
> **When** an operator duplicates the draft, and duplicates "Spring prices" choosing first "all recipients" and then "only recipients it did not reach"
> **Then** each duplicate is a new draft named "Copy of …" (shortened to fit 80 characters) with the same text, listed for every member, its author being the member who duplicated it, and the original is unchanged; the copy of the draft has the same group of 14 contacts; the copy of "Spring prices" with "all recipients" has a broadcast group of its 36 recipients, the one who blocked the bot counted as unreachable; "only recipients it did not reach" is offered once a broadcast has ended, and gives a group of the 2 who failed: it copies recipients who failed for a reason a new attempt can fix (the bot stopped working, Telegram refused the text, a Telegram error, stopped before their turn) and those marked "not confirmed" only after a warning that they may have received it, while recipients who were delivered, who blocked the bot or whose account no longer exists are not copied; a tag audience can also be duplicated as the same tags, evaluated again at the copy's launch; the copy is then edited and launched like any draft
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] RED: unit tests for the choice-vs-source matrix, the copied set per choice (T6's fixable set), the copy name — `apps/api/src/modules/broadcasts/app/duplicate.test.ts`
- [x] `duplicateBroadcast(ws, actor, sourceId, { audience, includeNotConfirmed })` in one transaction: read the source (no lock needed beyond a consistent read), insert the draft, copy rows, publish `draft` — `apps/api/src/modules/broadcasts/app/duplicate.ts`
- [x] Repository helpers it needs from T15 (`allRecipientContacts`, `notReachedContacts(includeNotConfirmed)`) wired through the ports — `apps/api/src/modules/broadcasts/app/ports.ts`
- [x] Integration tests on the AC-13 seed (33 delivered, 1 blocked, 2 `bot_stopped`): all recipients → group of 36; not reached → 2; with stopped and not-confirmed recipients added; still sending → `BROADCAST_NOT_ENDED`; an operator duplicates; the source unchanged — `apps/api/src/modules/broadcasts/app/duplicate.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| "did not reach" while the source still sends | `409 BROADCAST_NOT_ENDED` (AC-13) |
| `not_confirmed` recipients without `include_not_confirmed` | not copied; with it, copied (AC-13) |
| delivered, blocked, `account_gone`, `chat_not_found` | never copied by "did not reach" (AC-13) |
| stopped before their turn | copied by "did not reach" (AC-18) |
| "all recipients" with a blocked recipient | kept in the group, counted unreachable (AC-13) |
| a name of 80 graphemes | "Copy of …" cut to 80 without splitting a grapheme |
| `same` on a launched broadcast, `same_tags` on a group | `400 VALIDATION_ERROR` |
| operator duplicates | allowed; the copy's author is the operator (AC-07) |

## Definition of Done

- [x] Unit and integration tests on the AC-13 seed prove a draft copy keeps the text and the 14-contact group, "all recipients" makes a group of all 36 with the blocked one counted unreachable, "only recipients it did not reach" gives the 2 bot_stopped failures (plus stopped recipients and, only with include_not_confirmed, not confirmed ones) and never delivered, blocked or account_gone, the same-tags copy keeps the frozen tags, a not-reached copy of a still-sending broadcast answers BROADCAST_NOT_ENDED, a choice that does not fit the source answers VALIDATION_ERROR, the copy's author is the member and the source is unchanged, and an operator can duplicate. Every duplicate works with no bot row and with a needs-token bot (test plan).
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T23): `createDuplicate` (`broadcasts/app/duplicate.ts`): `duplicateBroadcast(ws, actorAccountId, sourceId, { audience, include_not_confirmed? })`. The source is read without a lock (404 for a foreign id), the choice checked by the domain's `checkDuplicateChoice` (`VALIDATION_ERROR` `details.field: audience`, or `BROADCAST_NOT_ENDED`), then one transaction: the source's group ids / recipient sets read with `tx`, `insertDraft` (version 1, author = last changer = the member, `duplicateName`, same text), `audienceTags.copy` (draft tag audience or `same_tags`, the stored names — at launch for a launched source) or `groups.addMany` (added by the member), and one `draft` signal; the answer is `views.draftView` after the commit.
- `implement` (T23): the checklist's repository helpers already existed from T15 (`allContactIds`, `notReachedContactIds(includeNotConfirmed)`); no port change was needed. "Did not reach" = fixable failures (`bot_stopped`, `text_refused`, `telegram_error`) + `stopped` (+ `not_confirmed` when asked); delivered, blocked, `account_gone`, `chat_not_found` never.
- `implement` (T23): RED `Cannot find module './duplicate.js'` (GOOD red); integration (AC-13 seed: 36 → group of 36 with 1 blocked counted unreachable; 2 `bot_stopped`; + stopped / not confirmed; sending → `BROADCAST_NOT_ENDED`; operator author; source unchanged; needs-token bot and no bot row) written after GREEN, green on first run.
- `implement` (T23): gate — full `pnpm test`: 3 failures, all in the known timing set (`e2e/contacts-load` merge, `notification-load` reply p95, `inbox/http/changes` p95); the three files passed re-run alone. `pnpm lint` clean.
