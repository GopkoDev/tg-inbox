---
id: T29
title: "Make the sign-in lockout atomic per email and use the contract's credential message"
layer: "app"
deps: []
blocks: ["T28", "T32"]
acs: ["AC-08", "AC-09", "AC-04"]
files_hint: ["apps/api/src/modules/auth/app/credentials.ts", "apps/api/src/modules/auth/app/credentials.test.ts", "apps/api/src/modules/auth/app/ports.ts", "apps/api/src/modules/auth/infra/", "apps/api/src/modules/auth/http/routes.ts", "apps/api/src/modules/auth/http/routes.int.test.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
source: "review-2026-10-11"
status: "done"
---

# T29 — Make the sign-in lockout atomic per email and use the contract's credential message

## Place in the sequence

- **Blocked by:** — · **Blocks:** T28 — Make concurrent invitation acceptance refuse cleanly instead of failing with 500, T32 — Move the session cookie helpers out of auth's HTTP layer, add response schemas, end the previous session on sign-in
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #7 (stage-2, medium) — `check()` in `credentials.ts:31-45` reads recent failures, decides there is no lockout, runs argon2 and only then records the failure. Nothing serialises attempts for one email, so N parallel requests all pass the check: 10 per 15 minutes is not a hard limit. The same applies to `verifyPassword` used by invitation acceptance.
- #3 (stage-1, part) — `InvalidCredentialsError` is thrown with "Invalid email or password" (`credentials.ts:42,58`); sign-in remaps it to the contract text (`auth/http/routes.ts:29-33`) but `/api/invitations/accept` does not, so SCR-02 shows a different generic message than SCR-01 (openapi.yaml:319-325, 699-710: "Email or password is incorrect").

## Acceptance criteria

### AC-08 — error

> **Given** a person on the sign-in screen
> **When** they enter an unknown email or a wrong password
> **Then** the system refuses with the same message in both cases, without revealing whether the email has an account
>
> — `spec.md §5, AC-08 (US-03), verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** 10 failed sign-in attempts for the same email within 15 minutes
> **When** anyone tries to sign in to that email again within the next 15 minutes
> **Then** the system refuses even a correct password and tells them to try again later — "too many failed attempts"; it behaves exactly the same for an email that has no account, so the lockout never reveals whether an account exists. The 15 minutes count from the 10th failure; a successful sign-in or a password reset clears the failure count
>
> — `spec.md §5, AC-09 (US-03), verbatim` · full text: [spec.md](../spec.md)

### AC-04 — cross-context

> **Given** a valid invitation for an email that already has an account (whatever the state of its other memberships, and even if that account is already signed in on this device)
> **When** the person opens the invitation link
> **Then** the system asks them to enter that account's existing password instead of creating a new one, and after they confirm it adds the new membership while their other memberships stay unchanged
>
> — `spec.md §5, AC-04 (US-02), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Serialise check → verify → record per normalised email: e.g. run it inside a transaction holding `pg_advisory_xact_lock(hashtext(email))` (through an auth-infra port, no raw SQL in the app layer), or insert the attempt first and count including it. No triggers or stored procedures.
- [x] Throw `InvalidCredentialsError` with the contract message "Email or password is incorrect" from `credentials.ts` itself, and drop the now-redundant remap in `auth/http/routes.ts` (keep behaviour identical for sign-in).
- [x] Integration test: 20 parallel wrong-password sign-ins for one email → at most 10 reach the hash check / are recorded as failures; the rest get `429 TOO_MANY_ATTEMPTS`. The same holds for an email without an account.
- [x] Unit test: the credential error message equals the contract text on both the sign-in and the invitation-accept path.

## Edge cases

| Case | Behaviour |
|---|---|
| 20 concurrent wrong passwords | ≤10 failures recorded, rest 429 |
| Unknown email, concurrent attempts | Same behaviour as a known email (no enumeration) |
| Correct password after the burst | Still 429 until 15 min after the 10th failure |

## Definition of Done

- [x] Parallel-attempt integration test passes against real Postgres
- [x] Both sign-in and accept 401 carry "Email or password is incorrect"
- [x] Unit + integration green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
