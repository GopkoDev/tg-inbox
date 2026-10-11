---
id: T25
title: "Build SCR-08 invite member dialog"
layer: "ui"
deps: ["T24"]
blocks: []
acs: ["AC-14", "AC-15", "AC-16"]
files_hint: ["apps/web/src/features/workspaces/invite/", "apps/web/src/pages/TeamPage.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T25 — Build SCR-08 invite member dialog

## Place in the sequence

- **Blocked by:** T24 — Build SCR-07 team screen · **Blocks:** — · **Wave:** 6 — the last UI task.
- **Lane:** shares `apps/web/src/pages/TeamPage.tsx` with T24 — serialized (this task only wires the dialog into T24's `onInvite` slot). Does **not** touch `routes.tsx`.

## Why (user story)

> **As a** Business owner
> **I want** to invite a person by email as an operator or a business owner
> **So that** my team grows without asking the tg-inbox team
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task delivers the invite dialog that issues an invitation and shows its link exactly once.

## Inlined context

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` […]. Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Each link carries 32 random bytes; only their SHA-256 hash is stored; the link is shown exactly once (in the API response to the business owner right after creation […])
>
> — `sad.md §8, Invitation and reset links, abridged` · full text: [sad.md](../sad.md)

**SCR-08 — Invite member** (states to build):

> | State | Trigger / condition | Components |
> |---|---|---|
> | default | **Invite** on SCR-07 — a dialog over SCR-07: email field, role choice (Operator — preselected / Business owner), **Create invitation** | shadcn:dialog, shadcn:input, shadcn:label, shadcn:radio-group, Button |
> | submitting | `createInvitation` in flight — form disabled, button spinner | Button (disabled + `Loader2`) |
> | validation | `400 VALIDATION_ERROR` — email not a valid address after trimming → message under the email field | shadcn:input (`aria-invalid`), shadcn:label |
> | error: already a member | `409 ALREADY_A_MEMBER` — alert in the dialog «This person is already a member — reactivate them instead if they are deactivated»; the form stays | shadcn:alert (destructive) |
> | success: link shown once | `201 IssuedInvitation` — the form is replaced by: «Invitation created for max@acme.test (Operator), valid until 18 Oct 2026», the link in a read-only field with **Copy** (label turns «Copied» for 2 s), a warning «You won't see this link again — copy it now», **Done**; any earlier pending invitation for the email was replaced (said in the text) | shadcn:dialog, shadcn:input (`readOnly`, select-all on focus), Button, shadcn:alert (default) |
> | closed | **Done** / ✕ / Esc → back to SCR-07, the pending list refetched and showing the new row; the link is gone for good | — (→ SCR-07) |
> | error: owners only | `403 OWNER_ONLY` — not reachable from the UI (operators get no **Invite**), but if returned: the dialog closes and SCR-07 shows its `owners only` state | — (→ SCR-07) |
> | guard states | `401` / `403 ACCESS_REMOVED` / `404` → shared guard table | — |
> | error: unexpected | network failure / `500` — alert in the dialog, form kept | shadcn:alert (destructive) |
>
> — `screens.md §SCR-08, state table, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Consumed (authored by T16):

- `POST /api/workspaces/{workspaceId}/invitations` (`createInvitation`) — body `{ email, role }` (`role` ∈ `owner | operator`) → `201 IssuedInvitation { invitation { id, email, role, created_at, expires_at }, link }` — «Returned only here, never again» · errors: `400 VALIDATION_ERROR` (`details.field: email`), `401`, `403 ACCESS_REMOVED | OWNER_ONLY`, `404`, `409 ALREADY_A_MEMBER` (`details { membership_id, state }`).

— `contracts/openapi.yaml, operationId createInvitation + schema IssuedInvitation, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to invite someone or manage the team
> **Then** the system refuses and tells them that only business owners manage the team
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a business owner of "Acme Flowers" and a person who already has a membership there (active or deactivated)
> **When** the owner invites that person's email
> **Then** the system refuses and tells the owner the person is already a member — reactivate them instead if they are deactivated
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/web/src/features/workspaces/invite/InviteDialog.tsx`: form (email, role radio-group with Operator preselected), submit → `createInvitation`; error mapping (400 field, 409 alert, 403 `OWNER_ONLY` → close + notify SCR-07, guard answers → T19 handler).
- [ ] Success view: summary line with email, role, expiry date; read-only link field (select-all on focus) + Copy (clipboard, «Copied» for 2 s); «You won't see this link again — copy it now»; Done.
- [ ] Keep the link only in the dialog's local state — never in a store; drop it on close.
- [ ] `apps/web/src/pages/TeamPage.tsx`: open the dialog from T24's `onInvite` slot; on close refetch the pending list.
- [ ] Tests: `InviteDialog.test.tsx` — one per SCR-08 state; a test that after close and reopen the link is no longer rendered.

## Edge cases

| Case | Behaviour |
|---|---|
| Email with surrounding spaces / capitals | Sent as typed; the server normalises; success shows the normalised email |
| Invalid email | Field error from the `400` message, form kept |
| Email already a member (active or deactivated) | Alert «This person is already a member — reactivate them instead if they are deactivated», form kept |
| Same email invited again | New link shown; text says the earlier pending invitation was replaced |
| Dialog closed without copying | Link is gone for good; pending row is visible; inviting again issues a new link |
| Clipboard API unavailable | Link stays selectable in the read-only field |

## Definition of Done

- [ ] `InviteDialog.test.tsx` covers default, submitting, validation, already a member, success (link once), closed (list refetched, link gone), owners only and unexpected error.
- [ ] A test proves the link is never written to a Zustand store (AC-14 "once").
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
