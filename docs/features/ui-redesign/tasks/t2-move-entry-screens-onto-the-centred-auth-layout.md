---
id: T2
title: "Move the entry screens onto the centred auth layout"
layer: "ui"
deps: ["T1"]
blocks: ["T8"]
acs: ["AC-04", "AC-05", "AC-06"]
files_hint: ["apps/web/src/shared/ui/auth-layout.tsx", "apps/web/src/features/auth/", "apps/web/src/features/workspaces/picker/WorkspacePicker.tsx", "apps/web/src/pages/SignInPage.tsx", "apps/web/src/pages/AcceptInvitationPage.tsx", "apps/web/src/pages/ResetPasswordPage.tsx", "apps/web/src/pages/WorkspacesPage.tsx", "apps/web/src/pages/NoAccessPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T2 — Move the entry screens onto the centred auth layout

## Place in the sequence

- **Blocked by:** T1 — Add the canon's shadcn primitives and the shared preview/list parts · **Blocks:** T8 — Register the new components in the canon and remove the reference markup · **Wave:** 2 — runs in parallel with T3 (disjoint files).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** the sign-in, invitation, new-password and workspace-choice screens in one consistent centred layout
> **So that** getting into the panel feels like one product and nothing about how I sign in changes
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task builds AuthLayout and re-lays sign-in, accept invitation, set new password, link unavailable, workspace picker and no access on it without touching their logic.

## Inlined context

> | default | `/sign-in` signed out — centred column: product mark (lucide `MessagesSquare` in a `size-8` rounded square), heading «Sign in» (existing text, spec: copy unchanged), one-line description «Answer your customers' Telegram messages together», email + password fields, **Sign in** | NEW: AuthLayout, shadcn:field, Input, Label, Button | wireframe «auth default» |
> | validation | submit with an empty / invalid email or empty password — message under the field, `aria-invalid` (AC-05) | shadcn:field, Input | wireframe «auth default» (field error line) |
> | error: wrong credentials | existing in-place message «Email or password is incorrect» above the button (AC-05) | Alert (destructive) | — |
>
> — `screens.md §SCR-01, states default / validation / error, verbatim` · full text: [screens.md](../screens.md)

> SCR-02 Accept invitation, SCR-03 Set new password, SCR-04 Link unavailable, SCR-05 Workspace picker (heading «Your workspaces» (existing text), one full-width row per workspace with a role badge, access-removed notice above the list), SCR-06 No access — all on NEW: AuthLayout; every other state inherited verbatim from workspace-operators §SCR-02 / §SCR-09 / §SCR-03 / §SCR-04 / §SCR-05.
>
> — `screens.md §SCR-02…SCR-06, abridged` · full text: [screens.md](../screens.md)

> **Auth screens** (sign-in, invite, reset): one centred column `max-w-sm`, `min-h-svh`, logo mark + `text-xl font-bold` heading + short description above the form; form fields stacked with `gap-6`.
>
> — `design-system.md §Visual direction, Auth screens, abridged` · full text: [../../design-system.md](../../../design-system.md)

> **Hard rule:** "100% of the existing web-panel tests pass, changed only where they locate elements on the page, never in what they assert happens"
>
> — `spec.md §6, Behaviour preserved, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface (the existing sign-in, invitation, reset and workspace-list calls are reused unchanged).

## Acceptance criteria

### AC-04 — happy path

> **Given** a person with an account who is signed out
> **When** they open the sign-in screen and sign in with their email and password
> **Then** they see one centred column with the product mark, a heading, a short description and the form, and after signing in they reach exactly the place the existing sign-in rule picks (the address they came from, else the workspace they used last, else their only workspace, else the workspace picker, else the no-access screen — `workspace-operators` AC-07)
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a person on the sign-in screen
> **When** they submit with an empty email, or with a password that does not match
> **Then** the system does not sign them in; an empty field is marked with its message right below it, and a wrong email or password shows the same in-place message as before the redesign, without saying which of the two was wrong
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — happy path

> **Given** a person who opens an invitation link, a password-reset link, or a link that is no longer valid
> **When** the screen loads
> **Then** they see the accept-invitation, set-new-password or link-unavailable screen in the same centred layout as sign-in, with the same fields, rules and outcomes as before the redesign
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/web/src/shared/ui/auth-layout.tsx` — `AuthLayout` (product mark, heading, description, children; `max-w-sm` default, `max-w-md` option)
- [ ] Re-lay `SignInForm`, `AcceptInvitationForm`, `ResetPasswordForm`, `LinkUnavailable` on AuthLayout + `Field` — no change to validation, calls or messages
- [ ] Re-lay `WorkspacePicker` and `NoAccessPage` on AuthLayout; picker rows as full-width outline buttons with a role `Badge`; keep the access-removed notice
- [ ] Adjust only locators in the existing auth / picker tests; assertions unchanged

## Edge cases

| Case | Behaviour |
|---|---|
| wrong email or password | the existing «Email or password is incorrect» message, never which field was wrong |
| dead invitation or reset link | SCR-04 on the same centred layout with **Go to sign-in** |
| arrived at the picker / no access through access removal | the dismissible notice naming the workspace above the content |

## Definition of Done

- [ ] component tests for AC-04/AC-05/AC-06 pass
- [ ] existing sign-in, invitation, reset and picker tests pass with assertion diffs = 0
- [ ] no social sign-in or sign-up link anywhere
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
