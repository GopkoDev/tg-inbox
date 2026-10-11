---
id: T37
title: "Exercise last-used workspace and direct Team loads in the browser flows"
layer: "ui"
deps: ["T34", "T36"]
blocks: []
acs: ["AC-07", "AC-12", "AC-17"]
files_hint: ["apps/web/e2e/flows.spec.ts", "apps/web/e2e/support/"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11"
status: "todo"
---

# T37 — Exercise last-used workspace and direct Team loads in the browser flows

## Place in the sequence

- **Blocked by:** T34 — Make the app shell enter the workspace in the URL, guard late responses, keep the access-removed notice, T36 — Send malformed token links to SCR-03 and align screen copy with the manifest · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #22 (stage-2, low) — the browser AC-07 flow (`e2e/flows.spec.ts:63-72`) uses a single-workspace account, so the landing comes from the "only workspace" branch (`resolve.ts:29-30`) and "the last-used active workspace opens" is never exercised through the UI.
- #13 (stage-2, high, test part) — the e2e helper (`flows.spec.ts:11-16`) routes through workspace home on purpose to enter the workspace, and the `page.reload()` at `flows.spec.ts:129` never checks the header.

## Acceptance criteria

### AC-07 — happy path

> **Given** an operator with an active account and at least one active membership
> **When** they sign in with the correct email and password
> **Then** the system opens the workspace they used last; when they have exactly one active membership it opens that one; when the last-used workspace is no longer available to them (or there is none yet) and they have several active memberships, it shows the list of those workspaces and lets them pick one
>
> — `spec.md §5, AC-07 (US-03), verbatim` · full text: [spec.md](../spec.md)

### AC-12 — happy path

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
> **When** they switch to "Bolt Bikes"
> **Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"
>
> — `spec.md §5, AC-12 (US-04), verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17 (US-06), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [ ] AC-07 flow: seed two workspaces for one account, enter the second, sign out, sign in → the second opens (not the picker).
- [ ] Replace the helper workaround: open `/w/<id>/team` directly and assert the header shows the workspace name; after `page.reload()` assert the header again.
- [ ] Run the Playwright suite locally (`pnpm --filter @tg/web test:e2e`, needs Docker) and keep it out of `pnpm test`.

## Edge cases

| Case | Behaviour |
|---|---|
| Last-used workspace deactivated meanwhile | Picker shown (unchanged, already covered) |

## Definition of Done

- [ ] Playwright flows green locally
- [ ] `tsc -p e2e` clean; `pnpm lint` clean
- [ ] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [ ] the regression test for each closed finding fails without the fix (RED first)
