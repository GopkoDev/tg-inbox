---
id: T36
title: "Send malformed token links to SCR-03 and align screen copy with the manifest"
layer: "ui"
deps: ["T35"]
blocks: ["T37"]
acs: ["AC-06", "AC-22", "AC-04"]
files_hint: ["apps/web/src/features/auth/accept-invitation/AcceptInvitationForm.tsx", "apps/web/src/pages/AcceptInvitationPage.test.tsx", "apps/web/src/features/auth/reset-password/ResetPasswordForm.tsx", "apps/web/src/pages/ResetPasswordPage.test.tsx", "apps/web/src/features/auth/sign-in/SignInForm.tsx", "apps/web/src/pages/SignInPage.test.tsx", "apps/web/src/pages/NotFoundPage.tsx", "apps/web/src/pages/NotFoundPage.test.tsx", "apps/web/e2e/flows.spec.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11"
status: "todo"
---

# T36 — Send malformed token links to SCR-03 and align screen copy with the manifest

## Place in the sequence

- **Blocked by:** T35 — Guard Team 'Show more', render SCR-10 in place without nested landmarks, link the invite form errors · **Blocks:** T37 — Exercise last-used workspace and direct Team loads in the browser flows
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #16 (stage-2, medium) — a malformed or truncated token (copy-paste damage) fails `LinkToken` (`^[A-Za-z0-9_-]{43}$`, `packages/shared/src/workspaces.ts:34`) → lookup `400 VALIDATION_ERROR`; both `AcceptInvitationForm.tsx:24-38,63-68` and `ResetPasswordForm.tsx:18-19,41-45` show an endless "Something went wrong / Retry" instead of SCR-03.
- #21 (stage-2, low) — copy diverges from screens.md: SCR-01 "Ask a platform admin" vs "Ask the tg-inbox team" (`SignInForm.tsx:129`); SCR-10 lacks "This page doesn't exist or you don't have access to it." (`NotFoundPage.tsx:28-36`); SCR-02 lacks the "Join <workspace>" / "You are invited as …" heading and the new-account button is not "Create account and join" (`AcceptInvitationForm.tsx:125,209`). Decision: bring the code to the manifest.

## Acceptance criteria

### AC-06 — domain invariant

> **Given** an invitation that has expired (older than 7 days), was already used, or was revoked or replaced by the business owner
> **When** a person opens its link
> **Then** the system refuses it, explains that the invitation is no longer valid, and suggests asking for a new one — from a business owner of the workspace, or from the tg-inbox team when it was the first business owner's invitation (only a platform admin re-issues that one)
>
> — `spec.md §5, AC-06 (US-02), verbatim` · full text: [spec.md](../spec.md)

### AC-22 — domain invariant

> **Given** a password-reset link that is older than 24 hours or was already used
> **When** a person opens it
> **Then** the system refuses it and explains that the reset link is no longer valid
>
> — `spec.md §5, AC-22 (US-08), verbatim` · full text: [spec.md](../spec.md)

### AC-04 — cross-context

> **Given** a valid invitation for an email that already has an account (whatever the state of its other memberships, and even if that account is already signed in on this device)
> **When** the person opens the invitation link
> **Then** the system asks them to enter that account's existing password instead of creating a new one, and after they confirm it adds the new membership while their other memberships stay unchanged
>
> — `spec.md §5, AC-04 (US-02), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] Check the token against the shared `LinkToken` schema on the client before the lookup, and also map a lookup `400 VALIDATION_ERROR` to SCR-03 (`invitation-invalid` / `reset-link-invalid`).
- [ ] Change the copy to screens.md's exact strings for SCR-01, SCR-02 and SCR-10; update `e2e/flows.spec.ts:36` (button name) and any unit-test selectors.
- [ ] Tests: a truncated token on `/invite/<t>` and `/reset/<t>` renders SCR-03 with the right ask; the new copy is asserted.

## Edge cases

| Case | Behaviour |
|---|---|
| Token of 42 chars | SCR-03, not Retry |
| Token with a `%` from bad paste | SCR-03 |

## Definition of Done

- [ ] Every token page reaches SCR-03 on any unusable link
- [ ] Copy equals screens.md
- [ ] Web unit tests green; e2e typecheck clean; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
