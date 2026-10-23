---
id: T24
title: "Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components"
layer: "docs"
deps: ["T10", "T14", "T17", "T20", "T21", "T22"]
blocks: []
acs: ["AC-09", "AC-10"]
files_hint: ["CLAUDE.md", "docs/architecture-map.md", "docs/design-system.md", "CONTEXT.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T24 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components

## Place in the sequence

- **Blocked by:** T10 — Unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps, T14 — Add the close and reopen routes with the close snapshot and confirm, and prove the change limit across all four change routes, T17 — Build the SCR-01 lenses: status tabs and assignee select, the assignee line and closed mark on rows, per-lens empty states and live join and leave, T20 — Build SCR-11, the confirm-over-a-recent-change dialog: current state, who or what changed it and when, go ahead or leave it, asks again, T21 — Build SCR-12, the close confirmation: every close reason, close anyway with the refusal's version and snapshot, asks again, T22 — Add the unassign sentence to the deactivate confirmation (SCR-14) and keep the lenses in the sign-in return address (SCR-09) · **Blocks:** — · **Wave:** 9 — after T10, T14, T17, T20, T21, T22.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** the thread to show who assigned, unassigned, closed or reopened the conversation and when
> **So that** I understand its history before I act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** a deactivated member's conversations to return to the team automatically
> **So that** no customer waits on someone who no longer works here
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It keeps the binding project docs true once assignment and statuses exist, so the next step (notifications to the assignee) builds on what is really there.

## Inlined context

> | `CLAUDE.md` and the architecture map do not yet mention the deactivation port, the new conversation columns, the activity table or the extended signal. | Low | Update both in this feature's tasks (the map's `reflects_commit` is stale too). | Tech Lead |
>
> — `sad.md §11, Risks, verbatim` · full text: [sad.md](../sad.md)

> The decided architecture lives in `docs/architecture-map.md` (+ ADRs in `docs/adr/`); this file is the short version. When they disagree, the map wins — fix this file.
>
> — `CLAUDE.md §preamble, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | ConversationActions | […] | pending |
> | AssigneeChooser | […] | pending |
> | StateChangedDialog | […] | pending |
> | CloseConfirmDialog | […] | pending |
> | ActivityLine | […] | pending |
> | ConversationList (extended) | […] canon row updated, not duplicated | pending |
> | Thread (extended) | […] canon row updated | pending |
>
> — `screens.md §New components, abridged` · full text: [screens.md](../screens.md)

> | State version † | The per-conversation counter raised by every assignee or status change. […] |
> | Customer message counter † | A per-conversation count raised by capture, under the row lock, for every newly captured customer message. […] |
> | Close snapshot † | The customer message counter plus the latest reply's id and state. […] |
> | Lens † | A filter of the inbox list that is part of the page address: status (open / closed) and assignee (all / mine / unassigned). |
>
> — `sad.md §12, Glossary, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-09 — happy path

> **Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
> **When** any member opens its thread
> **Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** an operator of "Acme Flowers" who is the assignee of open and closed conversations
> **When** a business owner deactivates their membership
> **Then** every conversation of "Acme Flowers" assigned to them, open and closed, becomes unassigned as part of the deactivation itself — there is no moment when a deactivated member is anyone's assignee, and an assignment to them made at the same moment is either refused (AC-04) or, if it was recorded first, undone by the deactivation itself with its own activity line — open ones appear under "unassigned" for the team without reloading, and each thread records "unassigned — <member> was deactivated"; conversations of another workspace the same account belongs to keep that assignee; reactivating the member later does not give the conversations back
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `CLAUDE.md`: `conversations` owns status / assignee / state version / activity entries and serves them via `inbox` routes; `workspaces` declares `onMembershipDeactivated`, wired in `buildDeps()` with `conversations` built before `team`; the four new error codes; no new tenancy exception — `CLAUDE.md`
- [ ] Architecture map: module rows, the port edge (runtime, not import), the lens indexes, the change-limit advisory key `changes:<ws>:<account>`, run-book integrity queries; bump `reflects_commit` — `docs/architecture-map.md`
- [ ] Design-system canon: add `ConversationActions`, `AssigneeChooser`, `StateChangedDialog`, `CloseConfirmDialog`, `ActivityLine`; update `ConversationList`, `Thread`, `Tabs` (also the inbox status lens) rows — `docs/design-system.md`
- [ ] Add the † terms (state version, customer message counter, close snapshot, lens) — `CONTEXT.md`

## Edge cases

| Case | Behaviour |
|---|---|
| Map and CLAUDE.md disagree after the edit | the map wins; CLAUDE.md is corrected |

## Definition of Done

- [ ] CLAUDE.md and the architecture map name the conversation state and activity table, the deactivation port, the buildDeps order and the change routes exactly as built; every new / extended component of screens.md has its canon row (status no longer pending); CONTEXT.md carries the four new glossary terms.
- [ ] CONTEXT.md carries the four glossary terms with a NOT-reference each
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
