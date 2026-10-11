---
id: T4
title: "Implement the auth and workspaces domain rules"
layer: "domain"
deps: []
blocks: ["T5", "T6"]
acs: ["AC-05", "AC-06", "AC-09", "AC-16", "AC-18", "AC-19"]
files_hint: ["apps/api/src/modules/auth/domain/", "apps/api/src/modules/workspaces/domain/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T4 — Implement the auth and workspaces domain rules

## Place in the sequence

- **Blocked by:** — · **Blocks:** T5 — Build the auth repositories and the argon2id password hasher, T6 — Build the workspaces repositories with cross-workspace isolation tests · **Wave:** 1 — pure functions with no I/O, runs in parallel with the migrations.
- **Lane:** own lane (the two `domain/` folders are touched by no other task).

## Why (user story)

> **As an** Operator
> **I want** to accept an invitation link and set up my access
> **So that** I become a member of the business's workspace with the role I was invited for
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to deactivate a member who left and reactivate them if they return
> **So that** former staff lose access to our customers at once
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task encodes the pure rules behind those stories — password policy, normalised email, the lockout window, session idleness, invitation validity, membership transitions and the last-active-owner rule — so the app layer only orchestrates. (AC-16 belongs to US-05; its rule is the membership-exists check.)

## Inlined context

> each module has `domain` (pure rules — password policy, invitation validity, the "at least one active business owner" rule) → `app` (use cases and the ports they need) → `infra` …
>
> — `sad.md §5, Building block view, abridged` · full text: [sad.md](../sad.md)

> `auth/domain/` password policy, normalised email, lockout window rule · `workspaces/domain/` membership roles + states, invitation validity, last-active-owner rule
>
> — `sad.md §5, Internal decomposition, abridged` · full text: [sad.md](../sad.md)

> passwords are 10–1024 characters · Emails are trimmed and lower-cased before every comparison · 10 failures within 15 minutes lock the email for 15 minutes from the 10th failure … cleared by a successful sign-in or a password reset · invitations last 7 days, reset links 24 hours
>
> — `sad.md §8, Password storage + Email identity + Brute-force lockout + Invitation and reset links, abridged` · full text: [sad.md](../sad.md)

> a session idle for more than 30 days is deleted and the request treated as signed out. Only requests triggered by a user action refresh `last_seen_at` … and the refresh is written at most once a minute per session.
>
> — `adr/0002 §Decision outcome, Shape, abridged` · full text: [ADR-0002](../adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md)

> First-owner invitation: not a column — an invitation is "the first business owner's" while its workspace has no memberships; AC-06's "ask the tg-inbox team" hint and flow 5's refusal both derive it from that.
>
> — `data-model.md §Entities, invitations, verbatim` · full text: [data-model.md](../data-model.md)

> **Layers:** `domain` (pure, no I/O) → `app` … Imports flow inward only.
>
> — `CLAUDE.md §Rules, Layers, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-05 — error

> **Given** a person accepting a valid invitation
> **When** they choose a password shorter than 10 characters
> **Then** the system does not create the account and tells them the password must be at least 10 characters long
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an invitation that has expired (older than 7 days), was already used, or was revoked or replaced by the business owner
> **When** a person opens its link
> **Then** the system refuses it, explains that the invitation is no longer valid, and suggests asking for a new one — from a business owner of the workspace, or from the tg-inbox team when it was the first business owner's invitation (only a platform admin re-issues that one)
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** 10 failed sign-in attempts for the same email within 15 minutes
> **When** anyone tries to sign in to that email again within the next 15 minutes
> **Then** the system refuses even a correct password and tells them to try again later — "too many failed attempts"; it behaves exactly the same for an email that has no account, so the lockout never reveals whether an account exists. The 15 minutes count from the 10th failure; a successful sign-in or a password reset clears the failure count
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a business owner of "Acme Flowers" and a person who already has a membership there (active or deactivated)
> **When** the owner invites that person's email
> **Then** the system refuses and tells the owner the person is already a member — reactivate them instead if they are deactivated
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — domain invariant

> **Given** "Acme Flowers" has active business owners
> **When** any deactivation — of oneself or of another owner, including two deactivations made at the same moment — would leave the workspace with no active business owner
> **Then** the system refuses that deactivation and explains that a workspace must always have at least one active business owner (of two simultaneous deactivations at most the one that keeps an active owner succeeds); an owner may deactivate themselves while another active business owner remains
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

### AC-19 — happy path

> **Given** a deactivated member of "Acme Flowers"
> **When** a business owner reactivates them
> **Then** the member regains access to "Acme Flowers" with the role they had before
>
> — `spec.md §5, AC-19, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `normaliseEmail(raw)` (trim + lower-case) — `apps/api/src/modules/auth/domain/email.ts` + `email.test.ts`
- [ ] `checkPasswordPolicy(pw)` → ok | `{ field: 'password', message: 'The password must be at least 10 characters long' }`; max 1024 — `apps/api/src/modules/auth/domain/password-policy.ts` + test
- [ ] `lockoutState(failureTimes[], now)` → `{ locked: boolean, until?: Date }` (10 failures within 15 min; lock lasts 15 min from the 10th) — `apps/api/src/modules/auth/domain/lockout.ts` + test
- [ ] `sessionIsExpired(lastSeenAt, now)` (> 30 days) and `shouldRefreshLastSeen(lastSeenAt, now, background)` (user-triggered and ≥ 1 min since last write) — `apps/api/src/modules/auth/domain/session.ts` + test
- [ ] `RESET_LINK_TTL` = 24 h, `resetLinkIsUsable(link, now)` — `apps/api/src/modules/auth/domain/reset-link.ts` + test
- [ ] `Role`, `MembershipState`, `deactivate(m, now)` / `reactivate(m)` (role kept, `deactivated_at` cleared; idempotent on the target state) — `apps/api/src/modules/workspaces/domain/membership.ts` + test
- [ ] `assertKeepsActiveOwner(members, targetId)` → throws the last-active-owner domain error when the result has zero active owners — `apps/api/src/modules/workspaces/domain/team-rules.ts` + test
- [ ] `assertNotAMember(existing)` (active or deactivated → already-a-member, with its id + state) — same file + test
- [ ] `INVITATION_TTL` = 7 days; `invitationIsUsable(inv, now)` (pending and `expires_at > now`); `askFor(workspaceHasMembers)` → `tg_inbox_team` when none, else `business_owner` — `apps/api/src/modules/workspaces/domain/invitation.ts` + test

## Edge cases

| Case | Behaviour |
|---|---|
| 9 failures in 15 min, then a 10th | 10th locks; `until` = 10th failure + 15 min |
| 10 failures spread over 16 min | not locked (window is 15 min) |
| Exactly 15 min after the 10th failure | unlocked |
| Invitation `expires_at == now` | not usable (strict `>`) |
| Invitation in state `accepted` / `revoked` / `superseded` | not usable — AC-06 |
| Deactivating the only active owner (self or other) | last-active-owner error — AC-18 |
| Two active owners, one deactivates self | allowed — AC-18 |
| Deactivated owners only count as inactive | an operator-only active set still violates AC-18 |
| Reactivating an `owner` | comes back as `owner` — AC-19 |
| Session last seen 30 days + 1 ms ago | expired; background request never refreshes |

## Definition of Done

- [ ] unit tests for every rule above pass, with the clock passed in as a value (no `Date.now()` in domain)
- [ ] no imports from `app`, `infra`, `http`, Kysely or Fastify in either `domain/` folder
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
