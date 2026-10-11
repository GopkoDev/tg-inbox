---
id: T35
title: "Guard Team 'Show more', render SCR-10 in place without nested landmarks, link the invite form errors"
layer: "ui"
deps: ["T34"]
blocks: ["T36"]
acs: ["AC-13", "AC-14", "AC-20"]
files_hint: ["apps/web/src/features/workspaces/team/Team.tsx", "apps/web/src/features/workspaces/team/useTeam.ts", "apps/web/src/pages/TeamPage.test.tsx", "apps/web/src/pages/NotFoundPage.tsx", "apps/web/src/pages/NotFoundPage.test.tsx", "apps/web/src/features/workspaces/home/WorkspaceHome.tsx", "apps/web/src/features/workspaces/invite/InviteDialog.tsx", "apps/web/src/features/workspaces/invite/InviteDialog.test.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
source: "review-2026-10-11"
status: "done"
---

# T35 — Guard Team 'Show more', render SCR-10 in place without nested landmarks, link the invite form errors

## Place in the sequence

- **Blocked by:** T34 — Make the app shell enter the workspace in the URL, guard late responses, keep the access-removed notice · **Blocks:** T36 — Send malformed token links to SCR-03 and align screen copy with the manifest
- **Origin:** follow-up from the independent review — [../_review/review-2026-10-11.md](../_review/review-2026-10-11.md) (verdict *Fix now*). The finding numbers below are that record's.

## Review findings this task closes

- #18 (stage-2, low) — Team "Show more" has no in-flight flag (`Team.tsx:46-52`, `useTeam.ts:93-117`); two clicks fire two requests with the same cursor and append the page twice (duplicate React keys).
- #19 (stage-2, low) — SCR-10 rendered in place (`WorkspaceHome.tsx:47`, `Team.tsx:83`) nests a second `<main>` and `<h1>` and full-height centring inside AppShell (`NotFoundPage.tsx:25-29`, `app-shell.tsx:110`).
- #20 (stage-2, low) — InviteDialog email error has no `id` / `aria-describedby` (`InviteDialog.tsx:146-155`); the role radio group has only an `aria-label` while screens.md shows a visible "Role" label.

## Acceptance criteria

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13 (US-04), verbatim` · full text: [spec.md](../spec.md)

### AC-14 — happy path

> **Given** a business owner of "Acme Flowers"
> **When** they invite a new hire's email address as an operator
> **Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working
>
> — `spec.md §5, AC-14 (US-05), verbatim` · full text: [spec.md](../spec.md)

### AC-20 — happy path

> **Given** a business owner of "Acme Flowers" with three members and one pending invitation
> **When** they open the team list and revoke the pending invitation
> **Then** they see each member's name, email, role and state and each pending invitation's email, role and expiry (but not its link), the revoked invitation disappears from the pending list, and its link stops working
>
> — `spec.md §5, AC-20 (US-07), verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/) · [CLAUDE.md](../../../../CLAUDE.md)) and follow it. Do not guess.

## Checklist

- [x] Track `loadingMore` per list in `useTeam`; disable "Show more" while a page is loading and ignore re-entry.
- [x] Split a `NotFoundCard` body out of `NotFoundPage`; use the card in place inside the shell, keep the `<main>` wrapper only for the `*` route.
- [x] InviteDialog: `id="invite-email-error"` + `aria-describedby` on the input; a visible `<Label>` for the Role group (shadcn `Label`).
- [x] Tests: double click on "Show more" fires one request and no duplicate rows; in-place 404 inside the shell has exactly one `main` and one `h1`; the email error is the input's accessible description.

## Edge cases

| Case | Behaviour |
|---|---|
| Double click Show more | One request, rows appended once |

## Definition of Done

- [x] Screens match screens.md structure
- [x] Web unit tests green; `pnpm lint` clean
- [x] every Hard Rule in CLAUDE.md still holds (layers, tenancy, errors, config, no `process.env`)
- [x] the regression test for each closed finding fails without the fix (RED first)
