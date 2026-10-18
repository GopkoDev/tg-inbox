---
id: T5
title: "Move the team page into the Settings Team section with search and filters"
layer: "ui"
deps: ["T4"]
blocks: ["T8"]
acs: ["AC-08", "AC-09", "AC-10", "AC-19"]
files_hint: ["apps/web/src/features/workspaces/team/", "apps/web/src/pages/TeamPage.tsx", "apps/web/src/features/workspaces/invite/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T5 — Move the team page into the Settings Team section with search and filters

## Place in the sequence

- **Blocked by:** T4 — Build the Settings layout and move bot settings into its Bot section · **Blocks:** T8 — Register the new components in the canon and remove the reference markup · **Wave:** 4 — renders into the SettingsLayout from T4.
- **Lane:** own lane (team feature files).

## Why (user story)

> **As a** Business owner
> **I want** my workspace's bot and team as two sections of one Settings screen, with the team list searchable and filterable
> **So that** everything I administer is in one place and I find a member quickly
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** inviting members and revoking invitations, deactivating and reactivating members, connecting, reconnecting and managing the bot, switching workspaces and signing out to work exactly as before
> **So that** the redesign costs my team nothing in their daily work
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task renders the team lists as the Team section with a toolbar that filters the loaded rows, while every existing team action keeps working.

## Inlined context

> | default | `/settings/team` or the old team address — SettingsLayout with **Team** selected; section header «Team» + **Invite**; toolbar (search «Search by name or email», role filter: all / business owner / operator, state filter: all / active / deactivated); **Members** card table: avatar + name (+ «(you)»), email, role badge, state badge, row-actions `DropdownMenu` (Deactivate / Reactivate); **Pending invitations** card table: email, role badge, expiry, row-actions (Revoke); never a link (AC-08) |
> | filtered | search / role apply to both tables, state to members only, over the rows loaded so far; **Show more** stays under a table while more rows exist and newly loaded rows are filtered the same way (AC-08) |
> | empty: no match | a table with no matching loaded row — «Nothing matches among the loaded rows» + **Clear filters**, **Show more** still under it when more exist (AC-09) |
> | loading, empty: no pending invitations, confirm deactivate, confirm revoke, pending action, success, error: last active owner, error: stale row, self-deactivated, has-more, error: unexpected, guard states | inherited verbatim: workspace-operators §SCR-07 — row actions now in the row-actions menu, confirmations unchanged |
> | owners only | operator opened the Team section / the old team address — only «Only business owners manage the team» + **Back to inbox**; no list (AC-10) |
>
> — `screens.md §SCR-12, abridged (components column dropped)` · full text: [screens.md](../screens.md)

> Team search/filters work only over rows loaded so far (spec AC-08/AC-09); a server-side search is not part of this feature.
>
> — `sad.md §11, Accepted debt, verbatim` · full text: [sad.md](../sad.md)

> **Hard rule:** "100% of the existing web-panel tests pass, changed only where they locate elements on the page, never in what they assert happens"
>
> — `spec.md §6, Behaviour preserved, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no new API surface; reuses list memberships / pending invitations (with `has_next` + Show more), deactivate, reactivate, revoke and create invitation unchanged.

## Acceptance criteria

### AC-08 — happy path

> **Given** a Business owner of "Acme Flowers" whose team has 6 members and 2 pending invitations
> **When** they open the Team section, type part of a member's email in the search box and filter by role "operator" and state "active"
> **Then** the members table and the pending-invitations table both narrow to the rows loaded so far that match — search and role apply to both tables, the state filter (active / deactivated) applies to members only and leaves invitations unfiltered — each member row with an avatar, the name, the email, a role badge, a state badge and a row-actions menu; each invitation row with its email, role and expiry but never its link; **Show more** stays available under a table while more rows exist and the newly loaded rows are filtered the same way; clearing the search and filters shows every loaded row again
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — error

> **Given** a Business owner on the Team section
> **When** their search and filters match nobody
> **Then** each table with no match shows one sentence saying nothing matches among the rows loaded so far, with a button that clears the search and filters, and **Show more** stays available under it while more rows exist
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — authorization

> **Given** an Operator of "Acme Flowers" who is not a business owner
> **When** they look for Settings in the navigation, or open a saved link to Settings, its Team section or its Bot section
> **Then** Settings is not in their navigation; a link to the Team section shows the existing refusal that only business owners manage the team, a link to Settings or its Bot section shows the existing refusal that only business owners manage the bot, no team or bot detail is shown, and the refusal's way back leads to the inbox preview
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-19 — happy path

> **Given** a Business owner of "Acme Flowers"
> **When** they invite a member, copy the invitation link, revoke a pending invitation, deactivate and reactivate a member, connect a bot, replace its token, reconnect it (including confirming a takeover from another service), disconnect it, switch workspace and sign out
> **Then** each action asks the same confirmations, shows the same messages and has the same outcome as before the redesign
>
> — `spec.md §5, AC-19, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Render `Team` as the Team child of Settings; header «Team» + **Invite** (InviteDialog unchanged)
- [ ] Toolbar with `DataTableToolbar`: search (name or email), role `Select`, state `Select`; filtering is a pure function over loaded rows (unit-tested)
- [ ] Members and Pending invitations as card `Table`s with `Avatar`, badges and a row-actions `DropdownMenu`; confirmations (`AlertDialog`) unchanged
- [ ] `EmptyFilterState` per table when nothing matches; **Show more** stays rendered while `has_next`
- [ ] Owners-only state with **Back to inbox**; adjust existing team tests' locators only
- [ ] Component tests: AC-08 filtering incl. Show more, AC-09 empty + clear, AC-10 team refusal

## Edge cases

| Case | Behaviour |
|---|---|
| state filter set to active | members narrow; pending invitations are not filtered by state |
| nothing loaded matches but more rows exist | empty sentence + Clear filters, **Show more** still available; newly loaded rows filtered the same way |
| deactivating the last active owner | existing «A workspace must always have at least one active business owner» alert |

## Definition of Done

- [ ] unit test for the row filter and component tests for AC-08, AC-09, AC-10 (team) pass
- [ ] existing team, invite and confirmation tests pass; assertion diffs limited to locators and the way-back label
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
