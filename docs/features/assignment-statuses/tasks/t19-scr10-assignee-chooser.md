---
id: T19
title: "Build SCR-10, the assignee chooser: me first, active teammates, unassign, current check, per-row pending and the in-place not-active refusal"
layer: "ui"
deps: ["T18"]
blocks: ["T20"]
acs: ["AC-02", "AC-04"]
files_hint: ["apps/web/src/features/inbox/AssigneeChooser.tsx", "apps/web/src/features/inbox/AssigneeChooser.test.tsx", "apps/web/src/features/inbox/ConversationActions.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T19 — Build SCR-10, the assignee chooser: me first, active teammates, unassign, current check, per-row pending and the in-place not-active refusal

## Place in the sequence

- **Blocked by:** T18 — Build the SCR-02 actions bar (ConversationActions) and the activity line in the thread: status badge, assignee button, close and reopen, pending lock, limit countdown and live changes · **Blocks:** T20 — Build SCR-11, the confirm-over-a-recent-change dialog: current state, who or what changed it and when, go ahead or leave it, asks again · **Wave:** 7 — after T18.
- **Lane:** shares `ConversationActions.tsx` with T18, T20, T21 — serialized after T18.

## Why (user story)

> **As an** Operator
> **I want** to assign a conversation to myself or a teammate, or unassign it
> **So that** the team knows who answers this customer
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It is how a member takes a conversation or hands it to an active teammate.

## Inlined context

> | loading | the assignee button pressed — the `Popover` opens under it and `listActiveMembers` is read (every time it opens); 3 skeleton rows (avatar + name) (AC-04; contract `listActiveMembers`) | NEW: AssigneeChooser (Popover, Skeleton) | — |
> | default | members loaded — heading «Assign to»; first «Me (<my display name>)», then the other active members by display name (from the answer's order), each with `Avatar` initials; when the conversation has an assignee, a `Separator` and «Unassign»; the current assignee carries a check icon and `aria-current`; arrow keys move, Enter picks, Esc closes and returns focus to the assignee button (AC-02, AC-04; flow 5) | NEW: AssigneeChooser (Popover, Button `ghost`, Avatar, Separator) | wireframe «chooser» |
> | pick: the current assignee | the checked row picked — the chooser closes; nothing is sent, nothing recorded (AC-02; flow 5) | — | — |
> | refused: not an active member | `400 ASSIGNEE_NOT_ACTIVE` — the chooser stays open; destructive `Alert` at its top «A conversation can be assigned only to an active member of this workspace.»; the members are re-read (skeleton, then the list without the gone member); nothing changed (AC-04, AC-10; flow 5, flow 12) | NEW: AssigneeChooser (Alert) | wireframe «chooser» (refused) |
> | changed since I looked | `409 CONVERSATION_STATE_CHANGED` — the chooser closes; SCR-11 opens with the pick kept (AC-03; flow 6) | — | — |
>
> — `screens.md §SCR-10, state table, abridged` · full text: [screens.md](../screens.md)

> Other SCR-10 states: only me · pending (spinner on the row, others disabled) · success (closes; SCR-02 recorded / unchanged) · error: change limit / change failed (closes; SCR-02 lines) · error: members not loaded («Couldn't load the team» + **Retry**) · phone (popover as wide as the header row, min 240px, scrolls past 8 rows). Empty and validation: N/A.
>
> — `screens.md §SCR-10, state table, abridged` · full text: [screens.md](../screens.md)

> 3. **SCR-10 is a `Popover`** with a list of member buttons (`NEW: AssigneeChooser`), not a `DropdownMenu`: it must stay open to show the AC-04 refusal and the reloaded members in place, which a menu that closes on select cannot do. The repo has no `command` primitive; tens of members need no search, so none is added.
>
> — `screens.md §Source, Decision 3, verbatim` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Display names in assignee labels and activity lines are rendered as plain text (React escaping, spec §6.1 abuse case). Activity entries store account ids and resolve names at read time.
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`GET …/inbox/members` (`listActiveMembers`) on every open; `assignConversation` (`AssignRequest`) / `unassignConversation` (`StateChangeRequest`) through the T16 store; `400 ASSIGNEE_NOT_ACTIVE`, `409 CONVERSATION_STATE_CHANGED`, `429 CHANGE_LIMIT_REACHED`. — `contracts/openapi.yaml, listActiveMembers + assign/unassign, abridged`

## Acceptance criteria

### AC-02 — happy path

> **Given** an operator with a conversation of "Acme Flowers" open in its thread (assignee, status and their changes are made from the thread; list rows only show them)
> **When** they assign it to themselves or to a teammate who is an active member of "Acme Flowers", reassign it from one member to another, or unassign it
> **Then** the conversation shows the new assignee in its header and in the list for the whole team without reloading (within the live-update target of §6), it moves between the "mine" and "unassigned" lenses accordingly, the thread records one line — "<member> assigned this to <assignee>", "<member> reassigned this from <previous> to <assignee>" or "<member> unassigned this" — with the time, and the conversation keeps its place in the activity order (assigning does not count as activity); a closed conversation can be assigned or unassigned too and stays closed; a teammate reading the thread while it drops out of their current lens keeps it open with the new assignee shown, and only its row leaves their list; choosing the assignee it already has changes nothing and records nothing; assignment, closing and reopening work in every state of the bot
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — error

> **Given** an operator of "Acme Flowers" choosing an assignee for a conversation
> **When** the person they pick is no longer an active member of "Acme Flowers" (deactivated a moment ago), or belongs to another workspace
> **Then** nothing changes, the inbox says that a conversation can be assigned only to an active member of this workspace, and the list of members to choose from shows only active members of "Acme Flowers"
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `AssigneeChooser` (Popover, Button ghost, Avatar, Separator, Skeleton, Alert) with the states above — `features/inbox/AssigneeChooser.tsx`
- [ ] Mount from the assignee button in `ConversationActions`; hand the pick to SCR-11 on `409` (T20 renders it) — `ConversationActions.tsx`
- [ ] Testing Library tests incl. keyboard and focus return — `AssigneeChooser.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Only the caller is active | «Me (<name>)» (+ «Unassign» when assigned) |
| Gone member picked | refusal in place, list re-read without them |
| Esc | closes, focus back to the assignee button |

## Definition of Done

- [ ] Testing Library tests cover every SCR-10 state in screens.md (loading, default with Me first and the current check, only me, pick the current assignee sends nothing, pending, success, refused not active with re-read, changed since I looked hands off to SCR-11, limit / failed close the chooser, members load error with Retry, keyboard, phone width).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
