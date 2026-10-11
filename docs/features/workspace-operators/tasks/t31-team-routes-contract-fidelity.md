---
id: T31
title: "Align team-route ids, statuses and error messages with the contract"
layer: "ports"
deps: []
blocks: []
acs: ["AC-13", "AC-15", "AC-16", "AC-17"]
files_hint: ["apps/api/src/modules/workspaces/http/team-routes.ts", "apps/api/src/modules/workspaces/http/team-routes.int.test.ts", "apps/api/src/modules/workspaces/http/guard.ts", "apps/api/src/modules/workspaces/domain/errors.ts", "apps/api/src/modules/workspaces/app/team.ts", "apps/api/src/modules/workspaces/app/team.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11"
status: "todo"
---

# T31 — Align team-route ids, statuses and error messages with the contract

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #4 (stage-1) — deactivate / reactivate / revoke validate `membershipId` / `invitationId` with `z.uuid()` during Fastify validation, before `authenticate` and the guard (`team-routes.ts:30-31,79,88,119`). A malformed id gets `400` even with no session (instead of 401) or from an operator (instead of 403); the contract lists only 200/204, 401, 403, 404, 409 (openapi.yaml:418-447, 459-479, 588-597).
- #3 (stage-1, part) — `OWNER_ONLY` says "Only a business owner can do this" (`guard.ts:34`) instead of the contract/AC text "Only business owners manage the team"; `ALREADY_A_MEMBER` (`domain/errors.ts:18`) drops the "reactivate them if they are deactivated" hint (openapi.yaml:568-576).

## Acceptance criteria

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13 (US-04), verbatim` · full text: [spec.md](../spec.md)

### AC-15 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to invite someone or manage the team
> **Then** the system refuses and tells them that only business owners manage the team
>
> — `spec.md §5, AC-15 (US-05), verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a business owner of "Acme Flowers" and a person who already has a membership there (active or deactivated)
> **When** the owner invites that person's email
> **Then** the system refuses and tells the owner the person is already a member — reactivate them instead if they are deactivated
>
> — `spec.md §5, AC-16 (US-05), verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17 (US-06), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] Accept the ids as `z.string()` in the route schemas; in the use cases treat a non-UUID id as `NotFoundError` (same as the guard does for `workspaceId`, `access.ts:51`).
- [ ] Use the contract's exact messages for `OWNER_ONLY` and `ALREADY_A_MEMBER` (copy them from openapi.yaml).
- [ ] Tests: malformed id with no session → 401; malformed id as operator → 403; malformed id as owner → 404; messages equal the contract text.

## Edge cases

| Case | Behaviour |
|---|---|
| `/memberships/not-a-uuid/deactivate`, no cookie | 401 |
| Same, operator | 403 OWNER_ONLY |
| Same, owner | 404 NOT_FOUND |

## Definition of Done

- [ ] No route answers a status absent from openapi.yaml
- [ ] Messages match the contract
- [ ] Unit + integration green; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
