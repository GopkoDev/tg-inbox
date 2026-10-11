---
id: T28
title: "Make concurrent invitation acceptance refuse cleanly instead of failing with 500"
layer: "app"
deps: ["T29"]
blocks: []
acs: ["AC-03", "AC-06"]
files_hint: ["apps/api/src/modules/workspaces/app/accept-invitation.ts", "apps/api/src/modules/workspaces/app/accept-invitation.int.test.ts", "apps/api/src/modules/workspaces/app/accept-invitation.test.ts", "apps/api/src/modules/auth/app/accounts.ts", "apps/api/src/modules/auth/app/accounts.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
source: "review-2026-10-11"
status: "todo"
---

# T28 — Make concurrent invitation acceptance refuse cleanly instead of failing with 500

## Place in the sequence

- **Blocked by:** T29 — Make the sign-in lockout atomic per email and use the contract's credential message · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #1 (stage-1) — two concurrent accepts (same invitation, or the same new email through two workspaces' invitations): the loser hits the unique `accounts_email_key` and gets `500 INTERNAL_ERROR` instead of `404 INVITATION_INVALID`, because `createAccount` runs before `consume` (`accept-invitation.ts:100-120`). argon2 hashing also runs inside the transaction while it holds the workspace row lock. The concurrency test (`accept-invitation.int.test.ts:121-135`) only counts fulfilled promises and never asserts the loser's error.

## Acceptance criteria

### AC-03 — happy path

> **Given** a valid, unused invitation for a person whose email has no account yet
> **When** the person opens the invitation link, enters their name and a password, and confirms
> **Then** the system creates their account, gives them an active membership with the invited role, signs them in and opens that workspace
>
> — `spec.md §5, AC-03 (US-02), verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an invitation that has expired (older than 7 days), was already used, or was revoked or replaced by the business owner
> **When** a person opens its link
> **Then** the system refuses it, explains that the invitation is no longer valid, and suggests asking for a new one — from a business owner of the workspace, or from the tg-inbox team when it was the first business owner's invitation (only a platform admin re-issues that one)
>
> — `spec.md §5, AC-06 (US-02), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] Check the password policy and hash the password **before** `uow.run` (split `createAccount` in `auth/app/accounts.ts` so the hash can be prepared outside the transaction, e.g. `prepareAccount(input)` → `{ email, displayName, passwordHash }` + `insertPreparedAccount(prepared, tx)`, or let `createAccount` accept a precomputed hash). A policy failure must still write nothing (AC-05 keeps holding).
- [ ] Inside the transaction: lock the workspace, then `consume` the invitation **first**; only when it was consumed insert the account (new-account path) and the membership.
- [ ] Map a Postgres unique violation on `accounts_email_key` (code `23505`, constraint `accounts_email_key`) raised during the insert to `InvitationInvalidError` (404 envelope) — the transaction rolls back, so the consumed invitation is restored.
- [ ] Strengthen `accept-invitation.int.test.ts`: two concurrent accepts of the same invitation for a new email → exactly one fulfils, the other rejects with `InvitationInvalidError`; two invitations (two workspaces) for the same new email accepted concurrently → one fulfils, the other rejects with `InvitationInvalidError` (not a raw DB error), and nothing half-written remains.

## Edge cases

| Case | Behaviour |
|---|---|
| Same invitation accepted twice concurrently (new email) | One 200, the other `InvitationInvalidError` / 404 |
| Two workspaces' invitations, same new email, concurrently | One succeeds, the other `InvitationInvalidError`; no orphan account or membership |
| Password shorter than 10 chars | `ValidationError` `details.field=password`, nothing written (AC-05) |

## Definition of Done

- [ ] `accept-invitation.int.test.ts` asserts the loser's error class for both races
- [ ] No argon2 hashing inside `uow.run`
- [ ] Unit + integration green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
