---
id: T53
title: "Pin the shell's release of the address workspace when the person leaves for a page without a shell"
layer: "ui"
deps: []
blocks: []
acs: ["AC-17", "AC-13"]
files_hint: ["apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/shared/ui/app-shell.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r6"
status: "done"
---

# T53 — Pin the shell's release of the address workspace when the person leaves for a page without a shell

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r6.md](../_review/review-2026-10-11-r6.md) (AA1, *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- AA1 (stage-2, low; a test gap). The shell's layout-effect cleanup `releaseAddressWorkspace(workspaceId)` (`shared/ui/app-shell.tsx:41`) is the only thing that resets `addressWorkspaceId` when the person leaves for a page with no shell: `/workspaces`, `/no-access`, an invite page or `*`.
  - With the cleanup removed, all 163 web tests stay green. The cross-route tests pass because the next shell overwrites the value, and the sign-out test passes because of `clear()`.
  - Regression path: `/workspaces` → `/w/w1` → `/w/w1/team`, start Deactivate, press Back twice. A late 403 `ACCESS_REMOVED` for w1 would then run the full guard over the picker.
  - The current code is correct. This task only adds the missing pin.

## Acceptance criteria

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17 (US-06), verbatim` · full text: [spec.md](../spec.md)

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13 (US-04), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** read [spec.md](../spec.md) · [T51](./t51-guard-scoped-to-url-across-routes-and-sign-out.md) · [CLAUDE.md](../../../../CLAUDE.md) in full when unsure. Do not guess.

## Checklist

- [x] A fifth case in the Z1 block of `pages/TeamPage.test.tsx`: `/w/w1/team` → a route with no shell (the `*` route), then a late 403 `ACCESS_REMOVED` for w1. Assert: no notice in the store, `resolveWorkspace` not called, the location unchanged.
- [x] RED proof: the case fails when the cleanup in `app-shell.tsx` is removed.

## Edge cases

| Case | Behaviour |
|---|---|
| `/w/w1/team` → a route with no shell, late 403 for w1 | Ignored: no notice, no resolution, no navigation |

## Definition of Done

- [x] A test fails when the shell stops releasing the address workspace on unmount
- [x] Web unit tests green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds
