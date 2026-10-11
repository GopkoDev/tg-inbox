---
id: T45
title: "Show role labels, not raw role values, in the picker, switcher and Team; reconcile the manifest"
layer: "ui"
deps: []
blocks: []
acs: ["AC-12", "AC-14"]
files_hint: ["apps/web/src/features/workspaces/picker/WorkspacePicker.tsx", "apps/web/src/features/workspaces/picker/WorkspaceSwitcher.tsx", "apps/web/src/features/workspaces/team/Team.tsx", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/pages/WorkspaceHomePage.test.tsx", "apps/web/src/shared/lib/roles.ts", "apps/web/src/features/workspaces/invite/InviteDialog.tsx", "apps/web/e2e/flows.spec.ts", "docs/features/workspace-operators/screens.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11-r3"
status: "done"
---

# T45 — Show role labels, not raw role values, in the picker, switcher and Team; reconcile the manifest

## Place in the sequence

- **Blocked by:** — · **Blocks:** —
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11-r3.md](../_review/review-2026-10-11-r3.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- W1 (stage-1, low) — raw role values (`owner` / `operator`) are shown in SCR-04 and SCR-07: picker and switcher badges (`picker/WorkspacePicker.tsx:64`, `picker/WorkspaceSwitcher.tsx:71`), the Team member badge and phone line and the pending-invitation badge and phone line (`team/Team.tsx:153,158,213,216`); two tests lock the lowercase value in (`pages/TeamPage.test.tsx:110,172`). screens.md SCR-04 (:188-190) and SCR-07 (:285-306) show labels; SCR-07 says «Owner» while SCR-02/SCR-08 and `ROLE_LABEL` say «Business owner».
- W3 (stage-2, low) — `shared/lib/roles.ts:1` declares its own `Role` union; `@tg/shared` already exports `Role` (`packages/shared/src/workspaces.ts:28-29`) and CLAUDE.md §Contracts puts DTO types there.

## Acceptance criteria

### AC-12 — happy path

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
> **When** they switch to "Bolt Bikes"
> **Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"
>
> — `spec.md §5, AC-12 (US-04), verbatim` · full text: [spec.md](../spec.md)

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14 (US-05), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Resolve the manifest conflict to the glossary term (CONTEXT.md: «Business owner»): in screens.md SCR-07 wireframes change `[Owner]` → `[Business owner]`; SCR-04 rows keep «Operator» / «Business owner» labels. Note the change in the SCR-07 source column if the file has a change log.
- [x] Render every role through `ROLE_LABEL` in WorkspacePicker, WorkspaceSwitcher and Team (member badge, member phone line, invitation badge, invitation phone line). No raw role value reaches the DOM.
- [x] `roles.ts`: `import type { Role } from '@tg/shared'` instead of the local union; same in InviteDialog if it declares one.
- [x] Tests: update the two TeamPage assertions to the label; add a picker/switcher assertion (`Business owner` / `Operator`) that fails on the raw value; check `flows.spec.ts` selectors that read a role badge.

## Edge cases

| Case | Behaviour |
|---|---|
| Owner viewing own row | Badge «Business owner» |
| Pending invitation as operator | Badge «Operator» |

## Definition of Done

- [x] No raw role value rendered anywhere in the web UI
- [x] screens.md has one label per role
- [x] Web unit tests green; e2e typecheck clean; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
