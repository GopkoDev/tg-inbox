---
id: T44
title: "Bring SCR-02 and SCR-03 copy to the manifest and fix the AC-03 accept test"
layer: "ui"
deps: []
blocks: []
acs: ["AC-03", "AC-04", "AC-04b", "AC-06"]
files_hint: ["apps/web/src/features/auth/accept-invitation/AcceptInvitationForm.tsx", "apps/web/src/features/auth/link-unavailable/LinkUnavailable.tsx", "apps/web/src/features/auth/link-unavailable/LinkUnavailable.test.tsx", "apps/web/src/pages/AcceptInvitationPage.test.tsx", "apps/web/src/pages/ResetPasswordPage.test.tsx", "apps/web/src/shared/lib/roles.ts", "apps/web/src/features/workspaces/invite/InviteDialog.tsx", "apps/web/e2e/flows.spec.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r2"
status: "todo"
---

# T44 — Bring SCR-02 and SCR-03 copy to the manifest and fix the AC-03 accept test

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r2.md](../_review/review-2026-10-11-r2.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- R7 (stage-1, low; closes round-1 #21) — SCR-02/SCR-03 copy still differs from screens.md: the role badge shows the raw `operator`/`owner` value (manifest: "You are invited as [Operator]"), the name field is "Name" (manifest: "Your name"), the existing-account hint is "You already have an account — enter its password." (manifest: "<email> already has a tg-inbox account. Enter its password to join.") — `AcceptInvitationForm.tsx:136,172,205-207`; the SCR-03 headings are "Link unavailable" / "Wrong account" (manifest: "This link can't be used" / "This invitation is for another email") — `LinkUnavailable.tsx:57`.
- R10 (stage-2, low) — `AcceptInvitationPage.test.tsx:14,19,121,135` mocks `enterWorkspace` on `@/features/auth/api`, which no longer exports it, so `not.toHaveBeenCalled()` proves nothing; a second enter reintroduced via `@/features/workspaces/api` would pass; the title ("…enters the workspace and navigates") contradicts the assertion.

## Acceptance criteria

### AC-03 — happy path

> **Given** a valid, unused invitation for a person whose email has no account yet
> **When** the person opens the invitation link, enters their name and a password, and confirms
> **Then** the system creates their account, gives them an active membership with the invited role, signs them in and opens that workspace
>
> — `spec.md §5, AC-03 (US-02), verbatim` · full text: [spec.md](../spec.md)

### AC-04 — cross-context

> **Given** a valid invitation for an email that already has an account (whatever the state of its other memberships, and even if that account is already signed in on this device)
> **When** the person opens the invitation link
> **Then** the system asks them to enter that account's existing password instead of creating a new one, and after they confirm it adds the new membership while their other memberships stay unchanged
>
> — `spec.md §5, AC-04 (US-02), verbatim` · full text: [spec.md](../spec.md)

### AC-04b — authorization

> **Given** a person signed in with an account whose email differs from the email the invitation was issued for
> **When** they open the invitation link
> **Then** the system does not add any membership to the signed-in account and tells them the invitation belongs to another email — sign out and open the link again to accept it
>
> — `spec.md §5, AC-04b (US-02), verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an invitation that has expired (older than 7 days), was already used, or was revoked or replaced by the business owner
> **When** a person opens its link
> **Then** the system refuses it, explains that the invitation is no longer valid, and suggests asking for a new one — from a business owner of the workspace, or from the tg-inbox team when it was the first business owner's invitation (only a platform admin re-issues that one)
>
> — `spec.md §5, AC-06 (US-02), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] Map roles to their labels through one shared helper (move `ROLE_LABEL` from `InviteDialog.tsx:27` to e.g. `shared/lib/roles.ts` and use it in both places).
- [ ] Apply the exact screens.md strings for SCR-02 (badge label, "Your name", existing-account hint with the email) and SCR-03 (both headings). Re-read screens.md SCR-02/SCR-03 in full and fix any other remaining difference.
- [ ] AcceptInvitationPage test: mock `@/features/workspaces/api`'s `enterWorkspace`, assert it is not called by the form, drop the stale auth mock key, rename the test to "…navigates; the shell enters".
- [ ] Update selectors in AcceptInvitationPage / ResetPasswordPage / LinkUnavailable tests and `e2e/flows.spec.ts` that depend on the changed strings.

## Edge cases

| Case | Behaviour |
|---|---|
| Owner invitation | Badge "Business owner" (per manifest) |
| Signed in as another email | SCR-03 "This invitation is for another email" |

## Definition of Done

- [ ] SCR-02 and SCR-03 strings equal screens.md
- [ ] Accept test would fail if the form called enterWorkspace
- [ ] Web unit tests green; e2e typecheck clean; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
