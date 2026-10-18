---
id: T20
title: "Build SCR-11, the confirm-over-a-recent-change dialog: current state, who or what changed it and when, go ahead or leave it, asks again"
layer: "ui"
deps: ["T19"]
blocks: ["T23", "T24"]
acs: ["AC-03"]
files_hint: ["apps/web/src/features/inbox/StateChangedDialog.tsx", "apps/web/src/features/inbox/StateChangedDialog.test.tsx", "apps/web/src/features/inbox/ConversationActions.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
---

# T20 — Build SCR-11, the confirm-over-a-recent-change dialog: current state, who or what changed it and when, go ahead or leave it, asks again

## Place in the sequence

- **Blocked by:** T19 — Build SCR-10, the assignee chooser: me first, active teammates, unassign, current check, per-row pending and the in-place not-active refusal · **Blocks:** T23 — Add browser end-to-end assignment flows against the real API and the fake Bot API, T24 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components · **Wave:** 8 — after T19.
- **Lane:** shares `ConversationActions.tsx` with T18, T19, T21 — serialized after T19.

## Why (user story)

> **As an** Operator
> **I want** to assign a conversation to myself or a teammate, or unassign it
> **So that** the team knows who answers this customer
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It stops a member from silently overwriting a change a teammate — or the customer — just made.

## Inlined context

> | default | `409 CONVERSATION_STATE_CHANGED` on assign / unassign / reopen — `AlertDialog` over the thread: title «This conversation changed since you looked»; «Now: <assigned to <name> \| unassigned> · <Open \| Closed>» from `details.conversation`; the change from `details.latest_change` with its relative time — a member's change as its activity line («Bob Petrenko reassigned this from Ana Shevchenko to Bob Petrenko — 2 minutes ago»), an automatic one by cause («Reopened — the customer wrote — 1 minute ago», «Reopened — a reply was not delivered — …», «Unassigned — Bob Petrenko was deactivated — …»); buttons **Leave it** (cancel) and the go-ahead action: «Assign to <pick>» / «Unassign anyway» / «Reopen anyway» (AC-03; flow 6, flow 8) | NEW: StateChangedDialog (AlertDialog, Button) | wireframe «confirm change» |
> | left it | **Leave it** or Esc — the dialog closes; the header shows `details.conversation` (its version becomes the one on screen); nothing changed (AC-03; flow 6) | — | — |
> | asks again | another `409 CONVERSATION_STATE_CHANGED` — the dialog stays, its «Now» and change lines are replaced by the newer ones, and «It changed again — check before going ahead.» appears above the buttons; buttons enabled (AC-03; flow 6 «a third change asks again») | NEW: StateChangedDialog | — |
> | refused: not an active member | `400 ASSIGNEE_NOT_ACTIVE` on the go-ahead assign — the dialog closes and SCR-10 reopens in `refused: not an active member` (AC-04, AC-10; flow 12) | — | — |
>
> — `screens.md §SCR-11, state table, abridged` · full text: [screens.md](../screens.md)

> Other SCR-11 states: pending (both buttons disabled, spinner; the same request with `details.conversation.state_version`) · success (`200` recorded → SCR-02 recorded; `200` unchanged → SCR-02 unchanged) · error: change limit (closes; SCR-02 limit line) · error («Couldn't save the change — try again» in the dialog). Live frames do not change an open dialog (Decision 7).
>
> — `screens.md §SCR-11, state table, abridged` · full text: [screens.md](../screens.md)

> 4. **Both confirmations are `AlertDialog`s** (`NEW: StateChangedDialog`, `NEW: CloseConfirmDialog`), as shared-inbox SCR-04/05 […]. An explicit choice is needed; a click outside does not dismiss; Esc = the cancel choice; focus returns to the control that opened it.
>
> — `screens.md §Source, Decision 4, abridged` · full text: [screens.md](../screens.md)

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

Consumes `409 CONVERSATION_STATE_CHANGED` `{ conversation: ConversationSummary, latest_change: ThreadActivity|null }` from `assignConversation` / `unassignConversation` / `reopenConversation`; the go-ahead resends with `details.conversation.state_version`. — `contracts/openapi.yaml, ConversationStateChangedError, abridged`

## Acceptance criteria

### AC-03 — domain invariant

> **Given** an operator of "Acme Flowers" looking at a conversation with the assignee and status they last saw
> **When** its assignee or status has changed since then — by a teammate or automatically (reopened by the customer, unassigned by a deactivation) — and the operator now assigns, reassigns, unassigns, closes or reopens it; including when two members act at the same moment, where one change is recorded first and the other member counts as having seen the old state
> **Then** nothing changes yet: the inbox shows the current assignee and status, who changed them and how long ago, and asks whether to go ahead (take it over, close anyway…) or leave it; the change happens only if the operator confirms; when the conversation is already in the state the operator asked for, nothing changes, no line is recorded and the inbox simply shows it — a conversation has at most one assignee, and two members never take or close one conversation by accident
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `StateChangedDialog` (AlertDialog, Alert, Button) with the states above; relative time via `relative-time.ts` — `features/inbox/StateChangedDialog.tsx`
- [ ] Open it from `ConversationActions` for assign (pick kept), unassign and reopen refusals — `ConversationActions.tsx`
- [ ] Testing Library tests incl. focus return and no outside-click dismiss — `StateChangedDialog.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| `latest_change` null | only the «Now» line |
| A live frame arrives while open | dialog unchanged; header behind it updates |
| Go-ahead returns `200 unchanged` | dialog closes, header shows the answer, no line |

## Definition of Done

- [ ] Testing Library tests cover every SCR-11 state in screens.md (default for assign / unassign / reopen with member and automatic changes, left it, pending, success recorded / unchanged, asks again, refused not active reopening SCR-10, change limit, error), with the go-ahead resending the refusal's version.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
