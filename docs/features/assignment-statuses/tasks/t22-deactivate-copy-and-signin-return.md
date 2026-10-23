---
id: T22
title: "Add the unassign sentence to the deactivate confirmation (SCR-14) and keep the lenses in the sign-in return address (SCR-09)"
layer: "ui"
deps: ["T16"]
blocks: ["T23", "T24"]
acs: ["AC-10", "AC-11"]
files_hint: ["apps/web/src/features/workspaces/team/Team.tsx", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/shared/api/guard.ts", "apps/web/src/shared/api/guard.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T22 — Add the unassign sentence to the deactivate confirmation (SCR-14) and keep the lenses in the sign-in return address (SCR-09)

## Place in the sequence

- **Blocked by:** T16 — Teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames · **Blocks:** T23 — Add browser end-to-end assignment flows against the real API and the fake Bot API, T24 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components · **Wave:** 6 — after T16.
- **Lane:** own lane (`Team.tsx`, `shared/api/guard.ts`).

## Why (user story)

> **As a** Business owner
> **I want** a deactivated member's conversations to return to the team automatically
> **So that** no customer waits on someone who no longer works here
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It tells a business owner what deactivating does to the member's conversations, and brings a signed-out member back to the lens they asked for.

## Inlined context

> | default: confirm deactivate | inherited: ui-redesign §SCR-17 / workspace-operators §SCR-07 «confirm deactivate», with one added sentence (Decision 8): «Deactivate Bob? Bob loses access to Acme Flowers at once. Conversations assigned to Bob here become unassigned, and reactivating does not give them back. You can reactivate them later.» Cancel / Deactivate (AC-10) | AlertDialog, Button | — |
>
> — `screens.md §SCR-14, default, verbatim` · full text: [screens.md](../screens.md)

> | default | inherited verbatim: shared-inbox `screens.md` §SCR-09. New entry only: the return address now keeps the lens parameters (`/w/<id>/inbox?status=closed&assignee=mine`), so after sign-in the same lenses open (AC-01, AC-11; flow 4) | AuthLayout, Field, Input, Label, Button | — |
>
> — `screens.md §SCR-09, default, verbatim` · full text: [screens.md](../screens.md)

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

Internal — no new API call (deactivate is the unchanged `POST /memberships/{membershipId}/deactivate`).

## Acceptance criteria

### AC-10 — cross-context

> **Given** an operator of "Acme Flowers" who is the assignee of open and closed conversations
> **When** a business owner deactivates their membership
> **Then** every conversation of "Acme Flowers" assigned to them, open and closed, becomes unassigned as part of the deactivation itself — there is no moment when a deactivated member is anyone's assignee, and an assignment to them made at the same moment is either refused (AC-04) or, if it was recorded first, undone by the deactivation itself with its own activity line — open ones appear under "unassigned" for the team without reloading, and each thread records "unassigned — <member> was deactivated"; conversations of another workspace the same account belongs to keep that assignee; reactivating the member later does not give the conversations back
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to assign, unassign, close or reopen a conversation of "Acme Flowers", or to see its assignee, status or activity (for example through a saved link)
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace or the conversation exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add the sentence to the deactivate `AlertDialog` copy — `features/workspaces/team/Team.tsx`, `pages/TeamPage.test.tsx`
- [ ] Keep `location.search` in the sign-in return address for inbox paths (check the existing guard; add a test if it already does) — `shared/api/guard.ts`, `guard.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Member display name with markup | rendered as text in the sentence |
| Return address with an unknown lens value | after sign-in the list rewrites it to the default (T16) |

## Definition of Done

- [ ] Testing Library tests prove the deactivate confirmation shows the unassign sentence with the member's name as plain text, and that a signed-out visit to an inbox address with lenses returns to the same address and lenses after sign-in.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
