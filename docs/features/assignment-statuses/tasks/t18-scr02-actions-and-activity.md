---
id: T18
title: "Build the SCR-02 actions bar (ConversationActions) and the activity line in the thread: status badge, assignee button, close and reopen, pending lock, limit countdown and live changes"
layer: "ui"
deps: ["T16"]
blocks: ["T19", "T21"]
acs: ["AC-02", "AC-05", "AC-09", "AC-12"]
files_hint: ["apps/web/src/features/inbox/ConversationActions.tsx", "apps/web/src/features/inbox/ConversationActions.test.tsx", "apps/web/src/features/inbox/ActivityLine.tsx", "apps/web/src/features/inbox/ActivityLine.test.tsx", "apps/web/src/features/inbox/Thread.tsx", "apps/web/src/features/inbox/Thread.test.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T18 — Build the SCR-02 actions bar (ConversationActions) and the activity line in the thread: status badge, assignee button, close and reopen, pending lock, limit countdown and live changes

## Place in the sequence

- **Blocked by:** T16 — Teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames · **Blocks:** T19 — Build SCR-10, the assignee chooser: me first, active teammates, unassign, current check, per-row pending and the in-place not-active refusal, T21 — Build SCR-12, the close confirmation: every close reason, close anyway with the refusal's version and snapshot, asks again · **Wave:** 6 — after T16.
- **Lane:** `ConversationActions.tsx` is shared with T19, T20, T21 (they mount into it) — serialized, T18 first; `Thread.tsx` only here.

## Why (user story)

> **As an** Operator
> **I want** to assign a conversation to myself or a teammate, or unassign it
> **So that** the team knows who answers this customer
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the thread to show who assigned, unassigned, closed or reopened the conversation and when
> **So that** I understand its history before I act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It is where a member sees and changes who handles a conversation and whether it is done, and reads its history of changes.

## Inlined context

> | default: open | `getConversation` `status: open` — header as before (Avatar, name, @username) plus the actions bar: «Open» `Badge` (outline), the assignee button («Unassigned» or the assignee's display name, `ChevronDown`) → SCR-10, **Close** (`outline`, sm); the screen keeps `state_version` and `close_snapshot` from the summary it rendered (AC-02; ADR-0002, ADR-0003) | extended: Thread, NEW: ConversationActions (Badge, Button) | wireframe «thread header» |
> | default: closed | `status: closed` — «Closed» `Badge` (secondary), the assignee button (still usable: a closed conversation can be assigned and stays closed), **Reopen** instead of **Close**; the composer works as in an open conversation — a reply does not reopen (AC-02, AC-05; spec §1 assumption) | NEW: ConversationActions | wireframe «thread header» |
> | activity lines | `listThreadItems` items of `type: activity` — a centred muted line among messages and replies at its `position_at`, with its time: «<actor> assigned this to <new>», «<actor> reassigned this from <previous> to <new>», «<actor> unassigned this», «<actor> closed this», «<actor> reopened this»; automatic: «reopened — the customer wrote», «reopened — a reply was not delivered», «unassigned — <previous> was deactivated»; never counted unread, never part of `read_through_at` (AC-09; flow 11; contract `listThreadItems`) | NEW: ActivityLine, extended: Thread | wireframe «thread with activity» |
> | error: change limit | `429 CHANGE_LIMIT_REACHED` — under the actions bar a warning line «Changes are limited to 60 per minute — you can continue in N seconds», N counting down to `details.retry_at`; the three controls disabled until then, then the line goes; the composer is not affected; nothing changed (AC-12; flow 5, flow 7, flow 8) | Alert, NEW: ConversationActions | wireframe «thread header» (limit) |
>
> — `screens.md §SCR-02, state table, abridged` · full text: [screens.md](../screens.md)

> Other SCR-02 states: loading (actions skeleton until the summary arrives) · pending (spinner on the used control, all three disabled) · success: recorded (header from the answer, `activity` line appended) · success: unchanged (header from the answer, no line) · error: change failed («Couldn't save the change — check your connection and try again», version kept) · live: teammate / automatic change · live: reopened by the customer / by a failed reply · live: unassigned by deactivation · background tab · phone (actions bar as a second header row).
>
> — `screens.md §SCR-02, state table, abridged` · full text: [screens.md](../screens.md)

> 2. **Thread actions live in one header bar** (`NEW: ConversationActions`) […]. One change per conversation is in flight per tab: while one is pending, all three controls are disabled.
>
> — `screens.md §Source, Decision 2, abridged` · full text: [screens.md](../screens.md)

> - Activity lines always name members by display name (also the caller's own changes — no «you»), exactly as the contract composes them.
> - The change-limit and change-failed lines appear under the thread header (where the member acted), not in the composer slot, so a reply and a change refusal never overwrite each other.
>
> — `screens.md §Assumptions, verbatim` · full text: [screens.md](../screens.md)

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

Reads `getConversation` / `listThreadItems` (activity items) and sends `closeConversation` / `reopenConversation` through the T16 store; the assignee button opens SCR-10 (T19); `409` answers open SCR-11 / SCR-12 (T20 / T21). — `contracts/openapi.yaml, abridged`

## Acceptance criteria

### AC-02 — happy path

> **Given** an operator with a conversation of "Acme Flowers" open in its thread (assignee, status and their changes are made from the thread; list rows only show them)
> **When** they assign it to themselves or to a teammate who is an active member of "Acme Flowers", reassign it from one member to another, or unassign it
> **Then** the conversation shows the new assignee in its header and in the list for the whole team without reloading (within the live-update target of §6), it moves between the "mine" and "unassigned" lenses accordingly, the thread records one line — "<member> assigned this to <assignee>", "<member> reassigned this from <previous> to <assignee>" or "<member> unassigned this" — with the time, and the conversation keeps its place in the activity order (assigning does not count as activity); a closed conversation can be assigned or unassigned too and stays closed; a teammate reading the thread while it drops out of their current lens keeps it open with the new assignee shown, and only its row leaves their list; choosing the assignee it already has changes nothing and records nothing; assignment, closing and reopening work in every state of the bot
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — happy path

> **Given** an operator in an open conversation of "Acme Flowers" whose customer is not waiting for a reply and who has read every customer message in it (none arrived after their arrival watermark)
> **When** they close it
> **Then** the conversation leaves the open lenses for the whole team without reloading and appears under "closed", keeping its assignee; the thread records "<member> closed this" with the time; closing does not count as activity and does not change anyone's unread count; the conversation can be opened again from the thread ("reopen") by any member, which records "<member> reopened this" and returns it to the open lenses with the same assignee
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
> **When** any member opens its thread
> **Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — error

> **Given** an operator of "Acme Flowers" who has assigned, unassigned, closed or reopened 60 conversations within the last 60 seconds
> **When** they try to make another such change
> **Then** nothing changes, the inbox says that changes are limited to 60 per minute per member and when they can continue; only recorded changes count (a reassignment is one change; a refused, declined or already-in-place request is none); the limit is per workspace, so changes in another workspace of the same account are not affected; automatic changes (a customer's message, a failed reply, a deactivation) never count and are never refused
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `ConversationActions`: status `Badge`, assignee button (mount point for T19), Close / Reopen, pending lock, limit countdown to `retry_at`, change-failed line, phone second row — `features/inbox/ConversationActions.tsx`
- [ ] `ActivityLine`: composed from `kind` + `cause` + names (plain text) with the thread's time format — `features/inbox/ActivityLine.tsx`
- [ ] Thread renders `activity` items in history and live; never unread — `features/inbox/Thread.tsx`
- [ ] Testing Library tests for every state — `ConversationActions.test.tsx`, `ActivityLine.test.tsx`, `Thread.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Close answers `409 CLOSE_NEEDS_CONFIRMATION` before T21 exists | handled through the store's refusal; dialog mounts in T21 |
| Limit countdown reaches 0 | line disappears, controls enabled |
| Activity by a since-deactivated member | still shows their name |
| Change failed (network) | version kept; next action sends the same version |

## Definition of Done

- [ ] Testing Library tests cover every SCR-02 state this feature adds in screens.md (open / closed header, activity lines for every kind and cause, actions loading, pending lock, recorded / unchanged, change-limit countdown, change failed, live teammate / automatic changes, phone header row), with names as plain text.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
