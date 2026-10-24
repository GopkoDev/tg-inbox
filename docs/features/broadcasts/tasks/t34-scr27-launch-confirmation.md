---
id: T34
title: "Build SCR-27, the LaunchConfirmDialog on the /launch address: the exact text, the count, who is left out and why, the risk warning, launch with the version and fingerprint, the re-ask on a changed draft or audience, and the operator redirect"
layer: "ui"
deps: ["T31"]
blocks: ["T39", "T40"]
acs: ["AC-06", "AC-07", "AC-09", "AC-10"]
files_hint: ["apps/web/src/features/broadcasts/LaunchConfirmDialog.tsx", "apps/web/src/features/broadcasts/LaunchConfirmDialog.test.tsx", "apps/web/src/pages/BroadcastDetailPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T34 — Build SCR-27, the LaunchConfirmDialog on the /launch address: the exact text, the count, who is left out and why, the risk warning, launch with the version and fingerprint, the re-ask on a changed draft or audience, and the operator redirect

## Place in the sequence

- **Blocked by:** T31 — Build SCR-25, the draft editor's Message card and frame: name and text saved as you go with the remaining length by the shared rule, the status line and the stale-save merge, AudienceBreakdown, the role-aware title actions with the launch pre-check refusals in place, and SCR-31 DeleteDraftDialog · **Blocks:** T39 — Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate "did not reach", the broadcast item in the thread, the blocked marker, and the operator's missing launch, T40 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components · **Wave:** 6 — after T31.
- **Lane:** shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T30; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T31; shares `apps/web/src/pages/BroadcastDetailPage.tsx` with T35 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see the final number of recipients and the text one last time, then launch the broadcast
> **So that** the message goes out once, to the customers I confirmed, from the workspace's bot
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It builds the owner's last look before the launch — the exact text, the final number and the risk warning — and sends back exactly what that look showed, so the message goes out once to the confirmed contacts.

## Inlined context

> | default | `200` — «This message goes to **36 contacts** from your business bot:», the text in a bordered read-only box exactly as the customer will see it (plain text, line breaks kept, scrolls above 12 lines), the AudienceBreakdown («Left out: 2 — blocked the bot 2, never wrote to the current bot 0»), and a warning `Alert` «Customers who did not expect this message can block or report the bot. That can limit the bot for support too.»; **Cancel** (focused) / **Send to 36 contacts** (primary) |
> | loading | the address opened directly — the draft loads, then `getLaunchConfirmation`; the dialog shows `Skeleton` lines until it answers; a refusal closes it and shows on the draft (SCR-25 refusal rows) |
> | launching | **Send to 36 contacts** — `launchBroadcast` with the version and fingerprint; spinner, both buttons disabled, Esc ignored |
> | launched | `200 outcome: launched` or `already_launched` — the dialog closes and the address becomes the broadcast's (`replace`), showing SCR-28 «Sending» |
> | asks again: audience changed | `409 BROADCAST_AUDIENCE_CHANGED` — the dialog stays and shows `details.confirmation`: a notice «The contacts this broadcast would reach changed. Check the number and confirm again.», the new count and breakdown; the next confirm sends the new version and fingerprint |
> | asks again: draft changed | `409 BROADCAST_DRAFT_CHANGED` — the dialog re-reads `getLaunchConfirmation` and shows «This draft was changed by a teammate. Check the text and number and confirm again.» with the new text and count |
> | refused at confirm time | `409 BROADCAST_NEEDS_WORKING_BOT` / `BROADCAST_AUDIENCE_TOO_LARGE` / `BROADCAST_NO_REACHABLE_CONTACT`, `429 BROADCAST_LAUNCH_LIMIT_REACHED`, `400 BROADCAST_TEXT_INVALID` — the same texts as SCR-25's refusal rows, shown as a destructive `Alert` in the dialog; only **Close** remains (the bot refusal adds **Open bot settings** → SCR-08) |
> | owner deactivated | `403 ACCESS_REMOVED` — nothing launched; → SCR-07 |
> | operator | `403 OWNER_ONLY`, or an operator opens the address — the dialog never opens; the draft at its own address (`replace`) with the owners-only note |
> | error | `launchBroadcast` fails (network / `500`) — destructive `Alert` «Couldn't send the broadcast. Nothing was sent.» + the confirm button enabled again (a repeat is safe: a second launch returns the launched broadcast) |
> | cancelled | **Cancel** or Esc — the dialog closes, the address returns to the draft, focus to **Launch** |
> | phone (< sm) | the dialog is full width; the text box takes the remaining height; buttons stack, the confirm first |
>
> — `screens.md §SCR-27, states (Source-ref column dropped), abridged` · full text: [screens.md](../screens.md)

> | launch refused: no working bot | `409 BROADCAST_NEEDS_WORKING_BOT` — destructive `Alert` under the title: `not_connected` «Launching needs a connected bot.», `needs_token` «Your bot's token stopped working — replace it to launch.», `taken_over` «Your bot is connected elsewhere — reconnect it to launch.», each + **Open bot settings** → SCR-08; the draft stays |
> | launch refused: daily limit | `429 BROADCAST_LAUNCH_LIMIT_REACHED` — `Alert` «A workspace can launch at most 10 broadcasts in 24 hours. The next launch is possible at 14:20 tomorrow.» (`next_launch_at`, `formatBotTime` / `formatBotDay`); drafts stay editable |
>
> — `screens.md §SCR-25, launch refusal rows (the texts SCR-27 reuses), abridged` · full text: [screens.md](../screens.md)

> 1. **Addresses** (sad.md §4): … `/w/<id>/broadcasts/<broadcastId>/launch` (SCR-27 over SCR-25 for an owner; an operator is sent to the draft address with `replace`, and the draft shows the owners-only note).
> 13. **Dialogs:** SCR-27, SCR-29, SCR-31 and SCR-32 are `AlertDialog`s (irreversible or dropping data; Cancel focused first); SCR-30 is a `Dialog` (a choice; closing loses nothing). Focus returns to the opener.
> - The launch-confirmation address opened by an owner for a draft that cannot be launched shows the draft with the refusal (the confirmation never opens), exactly as pressing **Launch** does.
>
> — `screens.md §Source, Decisions 1 and 13 + Assumptions, abridged` · full text: [screens.md](../screens.md)

> | LaunchConfirmDialog | SCR-27: shows the confirmation, sends its version and fingerprint, re-asks on `BROADCAST_AUDIENCE_CHANGED` / `BROADCAST_DRAFT_CHANGED`, owns the `/launch` address; after `CloseConfirmDialog`'s pattern; composes AlertDialog, Alert, ScrollArea, Button, AudienceBreakdown | pending |
>
> — `screens.md §New components, LaunchConfirmDialog, verbatim` · full text: [screens.md](../screens.md)

> **Chosen:** Option 1. The fingerprint proves "the same set" without shipping the set or writing a pending snapshot for every confirmation opened. Everything that decides the launch is re-read inside one transaction, behind the owner's share-locked membership (so a deactivation in flight serialises with it) and the per-workspace launch lock (so two launches of different drafts cannot both be the 10th). The broadcast row lock makes the second of two concurrent launches see `sending` and return the launched broadcast, so it launches once.
>
> — `adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md §Decision outcome, ADR-0006, verbatim` · full text: [ADR-0006](../adr/0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock.md)

**Reuse:** `AlertDialog`, `Alert`, `ScrollArea`, `Skeleton`, `Button` from `apps/web/src/shared/ui`; the pending / asks-again pattern of `features/inbox/CloseConfirmDialog.tsx` and `features/tags/DeleteTagDialog.tsx` (sends back what it shows); `AudienceBreakdown` (T31); the draft store's launch actions (T29); `formatBotTime` / `formatBotDay` from `features/bot/settings/format.ts`. NEW: `LaunchConfirmDialog` only.

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

- `GET …/broadcasts/{broadcastId}/launch-confirmation` → `200 LaunchConfirmation { text, version, breakdown { audience_size, blocked_count, never_wrote_count, recipient_count }, fingerprint }` · errors: `400 BROADCAST_TEXT_INVALID`, `403 OWNER_ONLY` / `ACCESS_REMOVED`, `404`, `409 BROADCAST_NOT_A_DRAFT` / `BROADCAST_NEEDS_WORKING_BOT` (`details.bot_state`) / `BROADCAST_AUDIENCE_TOO_LARGE` / `BROADCAST_NO_REACHABLE_CONTACT`, `429 BROADCAST_LAUNCH_LIMIT_REACHED` (`next_launch_at`). Writes nothing.
- `POST …/broadcasts/{broadcastId}/launch` body `BroadcastLaunch { expected_version, fingerprint }` → `200 BroadcastLaunched { outcome: launched | already_launched, broadcast }` · errors: `400 BROADCAST_TEXT_INVALID`, `403 OWNER_ONLY` / `ACCESS_REMOVED`, `404`, `409 BROADCAST_DRAFT_CHANGED` (current draft) / `BROADCAST_AUDIENCE_CHANGED` (`details.confirmation`) / `BROADCAST_NEEDS_WORKING_BOT` / `BROADCAST_AUDIENCE_TOO_LARGE` / `BROADCAST_NO_REACHABLE_CONTACT`, `429 BROADCAST_LAUNCH_LIMIT_REACHED`.

— `contracts/openapi.yaml, operationId getLaunchConfirmation + launchBroadcast, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

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

- [x] `LaunchConfirmDialog` on `AlertDialog`: the confirmation text in a read-only `ScrollArea` box (`whitespace-pre-wrap`, no links or formatting), «Send to N contacts», `AudienceBreakdown`, the warning `Alert`, Cancel focused — `apps/web/src/features/broadcasts/LaunchConfirmDialog.tsx`
- [x] Confirm sends `expected_version` + `fingerprint` once (button disabled while pending, Esc ignored); `launched` / `already_launched` → `navigate(replace)` to the broadcast address — same file
- [x] `BROADCAST_AUDIENCE_CHANGED` → show `details.confirmation` with the notice and keep its version / fingerprint for the next confirm; `BROADCAST_DRAFT_CHANGED` → re-read `getLaunchConfirmation` with the teammate notice — same file
- [x] Refusals at confirm time as a destructive `Alert` with only Close (+ Open bot settings for the bot refusal, the next-launch time via `formatBotTime` / `formatBotDay`); network / `500` → «Couldn't send the broadcast. Nothing was sent.» — same file
- [x] Mount on `/w/:workspaceId/broadcasts/:broadcastId/launch` in the detail page: an owner reads the confirmation first and opens the dialog only on `200` (a refusal shows on the draft); an operator, or `403 OWNER_ONLY`, is replaced to the draft address with the owners-only note; Cancel returns to the draft with focus on Launch — `apps/web/src/pages/BroadcastDetailPage.tsx`
- [x] Testing Library tests for every SCR-27 state above, including a double click launching once and a phone layout smoke check — `apps/web/src/features/broadcasts/LaunchConfirmDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| double click on «Send to 36 contacts» | one `launchBroadcast`; a second owner's or a retried launch answers `already_launched` and opens SCR-28 (AC-06) |
| a contact retagged between confirmation and confirm, same count | `409 BROADCAST_AUDIENCE_CHANGED`: the dialog stays with the new breakdown; the next confirm sends the new fingerprint (AC-06) |
| an operator opens a saved `/launch` link | no dialog; the draft at its own address with «Only a business owner launches broadcasts.» (AC-07) |
| the owner is deactivated while the dialog is open | `403 ACCESS_REMOVED` → SCR-07; nothing launched (AC-08) |
| the bot's token is revoked meanwhile | `409 BROADCAST_NEEDS_WORKING_BOT` in the dialog with Open bot settings; the draft stays a draft (AC-10) |
| the 11th launch in 24 h | `429` in the dialog with the next launch time; drafts stay editable (AC-09) |
| `/launch` opened for a draft nobody can be reached by | the confirmation never opens; the draft shows «This audience has no reachable contact.» (AC-09) |
| the text contains `<b>` or a URL | shown literally as plain text (spec §6.1) |

## Definition of Done

- [x] Testing Library tests cover every SCR-27 state in screens.md: the text as plain text with line breaks, Send to 36 with the left-out lines and the warning, Launch sending the version and fingerprint once (a double click launches once), BROADCAST_AUDIENCE_CHANGED and BROADCAST_DRAFT_CHANGED re-asking with the current numbers, each pre-check refusal shown on the draft instead of the dialog, the cap refusal with the next launch time, and an operator on the /launch address replaced to the draft with the owners-only note.
- [x] A test proves the confirm body carries exactly the version and fingerprint of the confirmation shown (the initial one, or the one from `details.confirmation` after an asks-again), never a recomputed one.
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T34): `LaunchConfirmDialog({ workspaceId, broadcastId, open, confirmation, onCancel, onLaunched, onOwnersOnly, returnFocus })` on `AlertDialog` (title «Send this broadcast?»): «This message goes to **N contacts** from your business bot:», the text in a bordered `ScrollArea` (`whitespace-pre-wrap`, rendered as a text node — no links, no markup), `AudienceBreakdown`, the warning `Alert`; Cancel focused on open. The confirm sends exactly the `version` + `fingerprint` of the confirmation shown (a ref blocks a second send while one is in flight); `BROADCAST_AUDIENCE_CHANGED` shows `details.confirmation` with its notice and keeps it for the next confirm; `BROADCAST_DRAFT_CHANGED` re-reads `getLaunchConfirmation` with the teammate notice; pre-check refusals at confirm time render the SCR-25 texts with only **Close** (the bot refusal keeps **Open bot settings**), `BROADCAST_TEXT_INVALID` «Write the text before launching»; 401 / 403 close it and go to the shell guard; `BROADCAST_NOT_A_DRAFT` counts as launched; anything else «Couldn't send the broadcast. Nothing was sent.» with the confirm enabled again. While the confirmation is read the dialog shows skeleton lines.
- `implement` (T34): **deviation** — the refusal texts and their parsing moved from `BroadcastEditor.tsx` into a new `launch-refusal.tsx` (`launchRefusalOf`, `RefusalAlert`, `BOT_REFUSALS`) so SCR-25 and SCR-27 share one copy; the editor (outside files_hint) owns the `/launch` behaviour through a new `atLaunch` prop from `BroadcastDetailPage` (`useMatch`): once per arrival (`location.key`) an owner's page reads the confirmation and opens the dialog only on `200`; a refusal shows on the draft and the address is replaced with the draft's; an operator is replaced to the draft (owners-only note) without asking; `OWNER_ONLY` swaps Launch for the note. Launched / already launched re-opens the draft store (so SCR-28 shows even when the router keeps the page mounted) and replaces the address with the broadcast's; Cancel replaces it with the draft's and returns focus to **Launch** (dialog `onCloseAutoFocus`, plus `location.state.focusLaunch` for a remount).
- `implement` (T34): `app/routes.test.tsx` «/launch mounts the same broadcast page» now mocks `getLaunchConfirmation` (a refusal, so the draft shows at its address) — setup only, its assertions are unchanged; before, the unmocked read left the new dialog open and hid the crumb from the accessibility tree.
- `implement` (T34): `LaunchConfirmDialog` is not yet registered in `docs/design-system.md` — T40.
- `implement` (T34): RED — `Unable to find role="alertdialog"` on every confirmation state, `Unable to find an element with the text: This audience has no reachable contact.` and the operator / OWNER_ONLY address assertions (GOOD red). Lint (`react-hooks/refs`, `set-state-in-effect`) shaped the editor's check into a promise callback keyed by the arrival.
- `implement` (T34): gate — `pnpm lint` clean; full `pnpm test`: `e2e/contacts-load` merge timing and `e2e/inbox-flows` story 5 (a `deadlock detected` in the test helper's TRUNCATE between flows — concurrency, known story family) failed; both green re-run alone.

