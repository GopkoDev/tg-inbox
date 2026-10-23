---
id: T35
title: "Build SCR-28, the read-only broadcast page with BroadcastReport (live totals, outcome filter, 50-recipient pages with plain reasons) and SCR-29 StopBroadcastDialog for business owners"
layer: "ui"
deps: ["T30"]
blocks: ["T36"]
acs: ["AC-11", "AC-12", "AC-18"]
files_hint: ["apps/web/src/features/broadcasts/BroadcastPage.tsx", "apps/web/src/features/broadcasts/BroadcastPage.test.tsx", "apps/web/src/features/broadcasts/BroadcastReport.tsx", "apps/web/src/features/broadcasts/BroadcastReport.test.tsx", "apps/web/src/features/broadcasts/StopBroadcastDialog.tsx", "apps/web/src/features/broadcasts/StopBroadcastDialog.test.tsx", "apps/web/src/pages/BroadcastDetailPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T35 — Build SCR-28, the read-only broadcast page with BroadcastReport (live totals, outcome filter, 50-recipient pages with plain reasons) and SCR-29 StopBroadcastDialog for business owners

## Place in the sequence

- **Blocked by:** T30 — Build SCR-24, the Broadcasts list: BroadcastsTable with statuses, audience sizes and last change, the empty state with New broadcast, the Broadcasts navigation item, the broadcast routes and BroadcastCrumb · **Blocks:** T36 — Build SCR-30, the DuplicateBroadcastDialog from the list, the draft and the broadcast page: the audience choice with per-option counts, "did not reach" disabled until the broadcast ends, and the not-confirmed warning · **Wave:** 5 — after T30.
- **Lane:** shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T30; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T31; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T34; shares `apps/web/src/features/broadcasts/BroadcastPage.tsx` with T36 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It builds the read-only page where both roles follow a launched broadcast's live delivery report and where a business owner can stop it while it sends.

## Inlined context

> | loading | `getBroadcast` in flight — `Skeleton` header, text and report; then the first recipient page with 8 skeleton rows |
> | default: sending | `status: sending` — title row: name, «Sending» status, **Duplicate**, and for a business owner **Stop** (outline destructive); a line «Launched by Test User · today 09:00» and «Read-only — a launched broadcast can't be changed.»; cards **Message** (the text, plain), **Audience** (as defined: «Any of VIP · leaving out Staff» with the names at launch, or «Hand-picked group», and the frozen AudienceBreakdown «Sent to 36»), and **Delivery report** |
> | report | totals and the recipients table per Decision 10; picking a contact → SCR-19 |
> | report: narrowed | an outcome chosen in the `Select` — `listBroadcastRecipients?state=…` from the top; «No recipients with this outcome.» when empty |
> | report: more | **Show more** — the next 50 after `next_cursor`; spinner; gone when `has_next` is false; a failure → `Alert` «Couldn't load more recipients» + **Retry** |
> | live | `broadcast.changed` `report` / `status` — the totals and the current page re-read in place (at most one per second per broadcast), no scroll jump; rows already shown keep their place |
> | sent | `status: sent`, `end_reason: completed` — «Sent» status, «Finished today 09:02»; no Stop |
> | sent: ended early | `end_reason: text_refused` / `bot_stopped` — «Sent» + an `Alert` «Sending ended early: Telegram refused the text.» / «Sending ended early: the bot stopped working.» + «You can duplicate it, fix the text or the bot, and send the copy to the recipients it did not reach.» with **Duplicate** |
> | stopped | `status: stopped` — «Stopped», «Stopped by Test User · today 09:03», the «Not sent — stopped» total; no Stop |
> | operator | no **Stop**; nothing else differs |
> | read-only | the page has no edit or delete control; an attempt from an old tab (`409 BROADCAST_NOT_A_DRAFT`) lands here with «This broadcast was launched and can no longer be changed.» |
> | error | `getBroadcast` fails — destructive `Alert` «Couldn't load this broadcast» + **Retry**; a recipients page fails — `Alert` in the report + **Retry**; a background re-read failing keeps what is shown |
> | phone (< md) | the three cards stack; the totals wrap two per row; the recipients table becomes stacked rows (name, then outcome + time, then the reason) |
>
> — `screens.md §SCR-28, states (Source-ref column dropped; stop / duplicate rows open SCR-29 / SCR-30), abridged` · full text: [screens.md](../screens.md)

> 10. **The report** (NEW: BroadcastReport) shows five totals as small stat blocks inside one `Card`: **Waiting** (`waiting` + `sending`), **Delivered**, **Blocked the bot**, **Failed** (`failed` + `not_confirmed`), and **Not sent — stopped** (only when `stopped` > 0). Below: an outcome `Select` («All recipients», «Waiting», «Delivered», «Blocked the bot», «Failed», «Not confirmed», «Not sent — stopped») and the recipients `Table` (Contact link to SCR-19 · Outcome `Badge` · Reason · Time), 50 at a time with **Show more**. Reasons in plain words: `account_gone` «Account no longer exists», `chat_not_found` «Chat not found», `telegram_error` «Telegram error», `text_refused` «Telegram refused the text», `bot_stopped` «The bot stopped working»; `not_confirmed` «Not confirmed — Telegram did not answer, not sent again»; `stopped` «Not sent — stopped»; `sending` «Sending…».
> 11. **Statuses** read «Draft» (`secondary`), «Sending» (`default` with a pulsing dot), «Sent» (`outline`), «Stopped» (`outline`, muted); a sent broadcast that ended early adds «— ended early: Telegram refused the text» or «— ended early: the bot stopped working» on SCR-28.
>
> — `screens.md §Source, Decisions 10–11, verbatim` · full text: [screens.md](../screens.md)

> | default | **Stop** pressed — «22 recipients are still waiting. They will not get this message. Sends already on their way finish. A stop can't be undone.» (the waiting total from the last read; it may be stale, no second confirmation); **Keep sending** (focused) / **Stop broadcast** (destructive) |
> | stopping | confirm — spinner, both disabled, Esc ignored |
> | stopped | `200 outcome: stopped` — the dialog closes; SCR-28 shows «Stopped» from the answer's broadcast |
> | unchanged | `200 outcome: unchanged` — the dialog closes; SCR-28 shows the answer's status («Sent» when the last outcome came in first) and a one-line notice «Nothing was waiting any more — the broadcast had already finished.» |
> | owners only | `403 OWNER_ONLY` (the role changed) — the dialog closes; **Stop** disappears |
> | error | network / `500` — destructive `Alert` in the dialog «Couldn't stop the broadcast» + the confirm enabled again (a repeat is safe) |
>
> — `screens.md §SCR-29, states (Source-ref column dropped), abridged` · full text: [screens.md](../screens.md)

> - an open broadcast page (SCR-28) of `broadcast_id` re-reads `getBroadcast` and its current `listBroadcastRecipients` page on `report` and `status`, one fetch at a time (flow 11);
>
> — `contracts/events.md §Frame: broadcast.changed, panel reaction, verbatim` · full text: [events.md](../contracts/events.md)

> **Chosen:** Option 1. At most one report signal per broadcast per second plus a refetch of about 50 ms keeps the shown report within ~1.5 s of the newest outcome, inside the 3 s target, at a fixed cost per tab. Paging keeps every read small at 10 000 recipients. The contract stays ids-only.
>
> — `adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md §Decision outcome, ADR-0011, verbatim` · full text: [ADR-0011](../adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md)

**Reuse:** `Card`, `Badge`, `Button`, `Alert`, `Skeleton`, `Select`, `Table`, `AlertDialog` from `apps/web/src/shared/ui`; `AudienceBreakdown` (T31, the «Sent to» variant); the report store (T29); `relativeTime` from `features/inbox/relative-time.ts`; the SCR-19 contact address from `features/contacts`; the pending pattern of `features/tags/DeleteTagDialog.tsx`. NEW: `BroadcastPage`, `BroadcastReport`, `StopBroadcastDialog` (screens.md §New components). The Duplicate button opens SCR-30 (T36).

> | `401 UNAUTHENTICATED` on any broadcasts route | an open dialog (SCR-26, SCR-27, SCR-29…SCR-32) closes; an unsent edit in the editor is kept in the draft store for the same address; as the inherited 401 row → SCR-09, then back to the same address |
> | `403 ACCESS_REMOVED` on the same routes (including the launch and the stop), or the socket closes `4403` | an open dialog closes; as the inherited 403 row → SCR-07; nothing is launched or stopped; nothing of the workspace stays on screen |
> | guard `404 NOT_FOUND`, or `BroadcastNotFound` (unknown, deleted or foreign broadcast) | the frame shows `NotFoundCard` (inherited); no hint the workspace or the broadcast exists |
>
> — `screens.md §Screens, Shared states, abridged` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET …/broadcasts/{broadcastId}` → `200 LaunchedBroadcast { status, name, text, audience (as launched), launched_by, launched_at, launch_breakdown, stopped_by, stopped_at, ended_at, end_reason, totals: RecipientTotals { waiting, sending, delivered, blocked, failed, not_confirmed, stopped } }` (a draft answers `BroadcastDraft` → SCR-25) · errors: `404 BroadcastNotFound`, guard `401` / `403`.
- `GET …/broadcasts/{broadcastId}/recipients?state=&after=` → `200 BroadcastRecipientPage { items: [{ id, position, contact { id, first_name, last_name, username }, state, failure_reason, outcome_at }], has_next, next_cursor }`, 50 per page in position order.
- `POST …/broadcasts/{broadcastId}/stop` (no body) → `200 BroadcastStopped { outcome: stopped | unchanged, broadcast }` · errors: `403 OWNER_ONLY` / `ACCESS_REMOVED`, `404`.

— `contracts/openapi.yaml, operationId getBroadcast + listBroadcastRecipients + stopBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" while it is sending
> **When** Telegram refuses the text itself, or the bot stops working (its token is revoked) or is disconnected or replaced by another bot
> **Then** sending ends at once: every recipient still waiting is marked failed with the plain reason ("Telegram refused the text" or "the bot stopped working"), the broadcast becomes "sent" with the report showing who got it before that, and nothing of it is sent later when the bot works again or by a newly connected bot; the owner can duplicate it, fix the text or the bot, and launch the copy to the recipients it did not reach (AC-13)
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `BroadcastPage`: title row with the status badge (Decision 11), Duplicate, Stop for an owner while `sending`; launched-by / finished / stopped lines; Message card (plain text, line breaks kept); Audience card «as defined» from the launched tag names or «Hand-picked group» + `AudienceBreakdown` «Sent to N»; the ended-early `Alert` with Duplicate; skeleton and error + Retry — `apps/web/src/features/broadcasts/BroadcastPage.tsx`
- [ ] `BroadcastReport`: the five totals (Waiting = waiting + sending, Failed = failed + not_confirmed, Not sent — stopped only when > 0), the outcome `Select` restarting from the top, the recipients `Table` with plain reasons and times, Show more with its failure + Retry, contact links to SCR-19, stacked rows below `md` — `apps/web/src/features/broadcasts/BroadcastReport.tsx`
- [ ] Live: subscribe through the report store — on `broadcast.changed` `report` / `status` re-read totals and the current page in place, one fetch at a time, keeping scroll and shown rows — same files
- [ ] `StopBroadcastDialog` (`AlertDialog`, Keep sending focused): the waiting count from the last read, stopping state, `stopped` / `unchanged` answers applied to the page (with the «Nothing was waiting any more» notice), `OWNER_ONLY` hiding Stop, error + enabled retry — `apps/web/src/features/broadcasts/StopBroadcastDialog.tsx`
- [ ] Route page shows `BroadcastPage` when `getBroadcast` answers a launched status (and after a `409 BROADCAST_NOT_A_DRAFT` with the read-only notice) — `apps/web/src/pages/BroadcastDetailPage.tsx`
- [ ] Testing Library tests for every SCR-28 and SCR-29 state above, for both roles — `BroadcastPage.test.tsx`, `BroadcastReport.test.tsx`, `StopBroadcastDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| stop confirmed while the last outcome lands | `200 unchanged`; the page shows «Sent» and the «Nothing was waiting any more» notice (AC-18) |
| an operator on a sending broadcast | no Stop control anywhere on the page (AC-18) |
| report frames arrive while a re-read is in flight | one more re-read queued, never two in parallel; no scroll jump (AC-11) |
| a narrowed outcome with no recipients | «No recipients with this outcome.» (AC-11) |
| aborted on a revoked token | «Sent» + «Sending ended early: the bot stopped working.» with Duplicate; the waiting ones show «The bot stopped working» (AC-12) |
| a background re-read fails | what is shown stays; no error; the next frame asks again (AC-11) |
| a `not_confirmed` recipient | counted under Failed; row reason «Not confirmed — Telegram did not answer, not sent again» (AC-11) |
| a stale tab tries to edit | `409 BROADCAST_NOT_A_DRAFT` lands here with the read-only notice (AC-09) |

## Definition of Done

- [ ] Testing Library tests cover every SCR-28 and SCR-29 state in screens.md: the message, the audience as defined, launched by and when, the status and the ended-early line, the five totals, the outcome filter and Show more with each reason in plain words, live re-reads on report and status one at a time, Stop only for an owner with the waiting count, the stopped and unchanged answers, and Duplicate offered instead of any edit.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
