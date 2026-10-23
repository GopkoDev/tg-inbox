---
id: T21
title: "Build SCR-12, the close confirmation: every close reason, close anyway with the refusal's version and snapshot, asks again"
layer: "ui"
deps: ["T18"]
blocks: ["T23", "T24"]
acs: ["AC-06", "AC-08"]
files_hint: ["apps/web/src/features/inbox/CloseConfirmDialog.tsx", "apps/web/src/features/inbox/CloseConfirmDialog.test.tsx", "apps/web/src/features/inbox/ConversationActions.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T21 — Build SCR-12, the close confirmation: every close reason, close anyway with the refusal's version and snapshot, asks again

## Place in the sequence

- **Blocked by:** T18 — Build the SCR-02 actions bar (ConversationActions) and the activity line in the thread: status badge, assignee button, close and reopen, pending lock, limit countdown and live changes · **Blocks:** T23 — Add browser end-to-end assignment flows against the real API and the fake Bot API, T24 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components · **Wave:** 7 — after T18.
- **Lane:** shares `ConversationActions.tsx` with T18, T19, T20 — serialized after T18.

## Why (user story)

> **As an** Operator
> **I want** to close a conversation when the customer needs nothing more, and see closed ones when I look for them
> **So that** the working list holds only what still needs work
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It makes a close over a waiting, unread or failed-reply customer a conscious choice.

## Inlined context

> | default | **Close** → `409 CLOSE_NEEDS_CONFIRMATION` — `AlertDialog`: title «Close this conversation?»; «It may be too early:» + one line per reason in `details.reasons` (Decision 6): `customer_waiting` «The customer is waiting for a reply»; `unread_customer_message` / `new_customer_message` «A customer message arrived that you haven't read — <relative time of `details.newest_unread_message.received_at`>» (or «— since you opened it» when only `new_customer_message`); `reply_not_delivered` «The latest reply was not delivered»; `reply_not_confirmed` «The latest reply was not confirmed — it may not have reached the customer»; `state_changed` «It changed since you looked: <`details.stale_change` as in SCR-11>»; buttons **Keep it open** (cancel) and **Close anyway** (primary) (AC-06, AC-08, AC-03; flow 7) | NEW: CloseConfirmDialog (AlertDialog, Button) | wireframe «confirm close» |
> | pending | **Close anyway** pressed — both buttons disabled, spinner; `closeConversation` with `details.conversation.state_version`, `details.conversation.close_snapshot` and `confirm_close_reasons: true` (AC-06) | NEW: CloseConfirmDialog | — |
> | asks again | another `409 CLOSE_NEEDS_CONFIRMATION` (a customer message or a failed reply recorded meanwhile, or another change) — the dialog stays, the reason lines are replaced, and «Something changed while you were deciding — check again.» appears above the buttons; buttons enabled (AC-06; flow 7 «the dialog asks again with what is new») | NEW: CloseConfirmDialog | wireframe «confirm close» (asks again) |
>
> — `screens.md §SCR-12, state table, abridged` · full text: [screens.md](../screens.md)

> Other SCR-12 states: kept open (**Keep it open** / Esc; header takes `details.conversation`) · success (`200` recorded → «Closed» + «<me> closed this», row leaves the open lenses; `200` unchanged → SCR-02 unchanged) · error: change limit (closes; SCR-02 limit line) · error («Couldn't close the conversation — try again» in the dialog). Empty: N/A (≥ 1 reason).
>
> — `screens.md §SCR-12, state table, abridged` · full text: [screens.md](../screens.md)

> 5. **The close dialog opens only from the server's answer.** **Close** always sends the version and close snapshot on screen; SCR-12 opens on `409 CLOSE_NEEDS_CONFIRMATION` and shows `details.reasons`. The panel does not pre-evaluate the reasons — the record-time check is the single source (ADR-0003). A close with no reason is recorded at once, with no dialog (AC-05).
>
> — `screens.md §Source, Decision 5, verbatim` · full text: [screens.md](../screens.md)

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

Consumes `409 CLOSE_NEEDS_CONFIRMATION` `{ reasons, stale_change, newest_unread_message, conversation }` from `closeConversation`; Close anyway sends `CloseRequest { expected_state_version, expected_close_snapshot, confirm_close_reasons: true }` from `details.conversation`. — `contracts/openapi.yaml, closeConversation + CloseNeedsConfirmationError, abridged`

## Acceptance criteria

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" about to close a conversation
> **When** its customer is still waiting for a reply, or a customer message arrived after the operator's own arrival watermark (they have not read it — a thread in a background tab marks nothing read)
> **Then** before closing the inbox shows why — the customer is waiting for a reply, the newest message the operator has not read, or the conversation's latest reply was "not delivered" / "not confirmed" — and asks whether to close anyway or keep it open; the conversation is closed only if the operator confirms; the condition is checked again at the moment the close is recorded, so a customer message recorded between the question and the close asks again — a customer is never put out of sight by a close made over a message the closer had not read; a customer message recorded after the close reopens it (AC-07)
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — cross-context

> **Given** a closed conversation of "Acme Flowers" holding a reply that is still sending (the conversation was closed right after the reply was sent)
> **When** that reply ends "not delivered" or "not confirmed"
> **Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with its assignee, and the thread records "reopened — a reply was not delivered" with the time, so the team sees it and can try again; closing a conversation whose latest reply is already "not delivered" or "not confirmed" asks first (AC-06) — the "waiting for a reply" marker itself keeps its meaning (the customer wrote after the last reply marked sent)
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `CloseConfirmDialog` (AlertDialog, Alert, Button) with one line per reason (merged unread / new) — `features/inbox/CloseConfirmDialog.tsx`
- [ ] Open it from `ConversationActions` on the close refusal; carry the refusal's version + snapshot into Close anyway — `ConversationActions.tsx`
- [ ] Testing Library tests for every state — `CloseConfirmDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Both `unread_customer_message` and `new_customer_message` | one line with the relative time |
| Only `new_customer_message` | «… — since you opened it» |
| Close anyway answers `200 unchanged` (a teammate closed it) | dialog closes, header «Closed», no line from me |

## Definition of Done

- [ ] Testing Library tests cover every SCR-12 state in screens.md (one line per reason with the merged unread / new line, kept open, pending with confirm_close_reasons and the refusal's version and snapshot, success recorded / unchanged, asks again, change limit, error), and Close never pre-evaluates reasons on the client.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
