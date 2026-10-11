---
id: T40
title: "Let the loser of a same-email acceptance race continue through the existing-account path"
layer: "app"
deps: ["T38"]
blocks: []
acs: ["AC-04", "AC-06"]
files_hint: ["apps/api/src/modules/workspaces/app/accept-invitation.ts", "apps/api/src/modules/workspaces/app/accept-invitation.int.test.ts", "apps/api/src/modules/workspaces/app/accept-invitation.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r2"
status: "done"
---

# T40 — Let the loser of a same-email acceptance race continue through the existing-account path

## Place in the sequence

- **Blocked by:** T38 — Keep argon2 out of the sign-in lock transaction and bound the pg pool · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r2.md](../_review/review-2026-10-11-r2.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- R3 (stage-2, low) — `accept-invitation.ts:136-143`: when the account insert hits `accounts_email_key` because another workspace's invitation created the account a moment earlier, the transaction rolls back and the invitation stays pending and usable, yet the response is 404 `INVITATION_INVALID` (openapi.yaml:713 reserves it for unknown/expired/accepted/revoked/replaced invitations), so the panel sends the person away. `memberships.hasAnyMember` also runs on a second pool connection while the aborted transaction still holds one.

## Acceptance criteria

### AC-04 — cross-context

> **Given** a valid invitation for an email that already has an account (whatever the state of its other memberships, and even if that account is already signed in on this device)
> **When** the person opens the invitation link
> **Then** the system asks them to enter that account's existing password instead of creating a new one, and after they confirm it adds the new membership while their other memberships stay unchanged
>
> — `spec.md §5, AC-04 (US-02), verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an invitation that has expired (older than 7 days), was already used, or was revoked or replaced by the business owner
> **When** a person opens its link
> **Then** the system refuses it, explains that the invitation is no longer valid, and suggests asking for a new one — from a business owner of the workspace, or from the tg-inbox team when it was the first business owner's invitation (only a platform admin re-issues that one)
>
> — `spec.md §5, AC-06 (US-02), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Detect the email-taken case inside `uow.run`, let the transaction roll back, and handle it outside: retry once through the existing-account path (`credentials.verifyPassword(email, password)` → on success accept as an existing account; on mismatch 401 `INVALID_CREDENTIALS`, AC-04). No query on another connection while the transaction is open.
- [x] The same-invitation race (the invitation already consumed by the winner) still answers `InvitationInvalidError` (AC-06).
- [x] Integration tests: two invitations for the same new email accepted concurrently with the same password → both succeed (two memberships, one account); with different passwords → one succeeds, the other gets `InvalidCredentialsError`; the same-invitation race test stays as it is.

## Edge cases

| Case | Behaviour |
|---|---|
| Same new email, two workspaces, same password, concurrently | Both joined, one account |
| Same, different passwords | Second gets 401 INVALID_CREDENTIALS, its invitation stays pending |
| Same invitation twice | 404 INVITATION_INVALID (unchanged) |

## Definition of Done

- [x] No 404 for a still-pending invitation
- [x] No second-connection query inside an open transaction
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
