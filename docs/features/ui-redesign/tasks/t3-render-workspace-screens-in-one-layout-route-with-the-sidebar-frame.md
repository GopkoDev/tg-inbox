---
id: T3
title: "Render workspace screens inside one layout route with the sidebar frame"
layer: "ui"
deps: ["T1"]
blocks: ["T4", "T6", "T7"]
acs: ["AC-01", "AC-02", "AC-03", "AC-11", "AC-18", "AC-20"]
files_hint: ["apps/web/src/app/routes.tsx", "apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell-context.ts", "apps/web/src/features/workspaces/picker/WorkspaceSwitcher.tsx", "apps/web/src/pages/", "apps/web/e2e/"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "todo"
---

# T3 — Render workspace screens inside one layout route with the sidebar frame

## Place in the sequence

- **Blocked by:** T1 — Add the canon's shadcn primitives and the shared preview/list parts · **Blocks:** T4 — Build the Settings layout and move bot settings into its Bot section, T6 — Build the inbox preview on a swappable sample-data source, T7 — Build the contacts and contact-profile previews on a sample-data source · **Wave:** 2 — the frame every later workspace task renders into.
- **Lane:** owns `routes.tsx` and `app-shell.tsx`; T4/T6/T7 only fill their page files.

## Why (user story)

> **As an** Operator
> **I want** every workspace screen inside one frame with a side navigation, a workspace switcher and my account menu
> **So that** I always know where I am and reach any section in one step, on a desktop or a phone
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** inviting members and revoking invitations, deactivating and reactivating members, connecting, reconnecting and managing the bot, switching workspaces and signing out to work exactly as before
> **So that** the redesign costs my team nothing in their daily work
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task builds the frame every workspace screen lives in and the full route tree (with placeholder pages for inbox, contacts and settings that T4–T7 fill).

## Inlined context

> **Chosen:** Option 1. The frame and the workspace entry mount once while the outlet changes, so switching sections neither refetches the workspace nor flashes the skeleton; nested routes give Settings sections and preview selections real addresses for reload/back/links, and redirects keep old links working.
>
> — `adr/0001, Decision outcome, verbatim` · full text: [adr/0001-render-workspace-screens-inside-one-layout-route-with-nested-settings-sections.md](../adr/0001-render-workspace-screens-inside-one-layout-route-with-nested-settings-sections.md)

> **Addresses** (ADR-0001): entry — `/sign-in`, `/invite/<token>`, `/reset-password/<token>`, `/workspaces`, `/no-access`; workspace — `/w/<id>` → `/w/<id>/inbox`, `/w/<id>/inbox/<conversationId>`, `/w/<id>/contacts`, `/w/<id>/contacts/<contactId>`, `/w/<id>/settings` → `/w/<id>/settings/bot`, `/w/<id>/settings/team`; old `/w/<id>/team` → `/w/<id>/settings/team`, old `/w/<id>/bot` → `/w/<id>/settings/bot`.
>
> — `screens.md §Source, Addresses, verbatim` · full text: [screens.md](../screens.md)

> | default (desktop ≥ md) | workspace entered — inset sidebar: header = workspace switcher (workspace name + role, dropdown of other workspaces); nav group: **Inbox**, **Contacts**, and for an owner **Settings**; footer = account menu (avatar initials, email; menu: email label, **Sign out**); inset body: `h-16` header row = sidebar trigger, vertical separator, breadcrumb (`Acme Flowers › Inbox`, `… › Contacts › Olena Kravets`, `… › Settings › Team`); current item highlighted (AC-01) |
> | drawer (phone < md) | sidebar hidden; the trigger opens it as a sheet over the page; picking an item closes it (AC-02) |
> | role: operator | current membership role is operator — **Settings** absent from the nav (AC-03, AC-10) |
> | entering (loading) | workspace entry in flight — body skeleton, no workspace data; the sidebar shows the switcher skeleton (AC-20, QG-5) |
> | not found | workspace missing / not theirs, or an unknown sample conversation/contact — `NotFoundCard` in the body |
> | error | entry failed — «Something went wrong» + **Retry** in the body (AC-20) |
> | switching | switcher picks another workspace — outlet content remounts keyed on the workspace id; lands on its inbox (AC-03) |
>
> — `screens.md §SCR-07, states, abridged (components column dropped)` · full text: [screens.md](../screens.md)

> | Workspace isolation in the UI | Outlet content is keyed on the workspace id and the frame renders no body until the workspace is entered, so nothing of the previous workspace stays on screen after a switch | ADR-0001, spec §6.1 |
>
> — `sad.md §8, Workspace isolation in the UI, verbatim` · full text: [sad.md](../sad.md)

> | Moving `AppShell` into a layout route breaks many screen and e2e tests at once (they locate the account menu in the page banner) | Medium | Migrate locators in the same task as the frame; review that assertions are unchanged (QG-1) | Dmytro Hopko |
>
> — `sad.md §11, risk row 2, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface (the existing workspace entry, `getMe` and guard calls are reused unchanged).

## Acceptance criteria

### AC-01 — happy path

> **Given** an Operator who is an active member of "Acme Flowers" and is signed in
> **When** they enter "Acme Flowers"
> **Then** they land on the inbox preview inside the workspace frame: a side navigation with the workspace switcher at the top, Inbox and Contacts, and their account menu (their email and Sign out) at the bottom; the current section is highlighted and a breadcrumb above the page says where they are
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — happy path

> **Given** an Operator using the panel on a phone-width screen
> **When** they open any workspace screen
> **Then** the side navigation is hidden behind a menu button, opens as a drawer over the page, closes once they pick a section; the page itself never scrolls sideways — a wide table may scroll sideways only inside its own card
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — cross-context

> **Given** an account that is a Business owner of "Acme Flowers" and an Operator of "Bloom Bakery"
> **When** they switch from "Acme Flowers" to "Bloom Bakery" with the workspace switcher
> **Then** they land on "Bloom Bakery"'s inbox preview, Settings disappears from the navigation because their membership there is an operator's, and nothing shown for "Acme Flowers" remains on screen
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — happy path

> **Given** a Business owner who bookmarked the old Team page or the old Bot page of "Acme Flowers"
> **When** they open that bookmark
> **Then** they land on the Team or Bot section of Settings for "Acme Flowers"
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — cross-context

> **Given** an Operator viewing "Acme Flowers" whose membership a Business owner has just deactivated
> **When** their next action in "Acme Flowers" is refused
> **Then** they leave "Acme Flowers" and land where the existing rule sends them — another workspace's screen inside the new frame, or the workspace picker or no-access screen in the centred layout — with the same dismissible "Your access to Acme Flowers was removed" notice as before the redesign
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

### AC-20 — happy path

> **Given** a signed-in Operator
> **When** they open a workspace that does not exist or is not theirs, or the workspace fails to load
> **Then** the frame shows the same not-found card, or the same "Something went wrong" message with Retry, as before the redesign, and shows no workspace data while the workspace is loading
>
> — `spec.md §5, AC-20, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `routes.tsx` — layout route `/w/:workspaceId` → `AppShell` with `<Outlet/>`; index → redirect to `inbox`; children `inbox`, `inbox/:conversationId`, `contacts`, `contacts/:contactId`, `settings` (index → `bot`; children `bot`, `team`); redirects for old `team` / `bot`; route `handle` carries the breadcrumb label
- [ ] Create placeholder pages `InboxPage`, `ContactsPage`, `ContactProfilePage`, `SettingsPage` (filled by T4/T6/T7); `TeamPage` / `BotSettingsPage` / `WorkspaceHomePage` stop wrapping `AppShell`
- [ ] `app-shell.tsx` — rebuild on `SidebarProvider` + inset `Sidebar` (switcher header, nav group with owner-only Settings, account-menu footer) + `SidebarInset` header (trigger, separator, breadcrumb from route handles); keep entry, guard wiring, access-removed notice, not-found / error+Retry / skeleton states; key the outlet content on the workspace id
- [ ] Move `WorkspaceSwitcher` into the sidebar header; switching lands on the other workspace's inbox
- [ ] Migrate locators in the existing component tests and `apps/web/e2e/*.spec.ts` from the page banner to the sidebar; assertions unchanged
- [ ] Component tests: AC-01 nav + breadcrumb, AC-02 drawer closes on pick, AC-03 operator role hides Settings, AC-11 old addresses redirect, AC-20 not-found / Retry / skeleton

## Edge cases

| Case | Behaviour |
|---|---|
| workspace missing or not theirs | NotFoundCard in the frame body |
| entry fails | «Something went wrong» + Retry; no workspace data shown |
| access removed during an action | existing landing rule + the dismissible notice (another workspace in the frame, or picker / no access) |
| phone width | sidebar becomes a sheet behind the trigger; the page never scrolls sideways |

## Definition of Done

- [ ] component tests for AC-01, AC-02, AC-03, AC-11, AC-18, AC-20 pass
- [ ] existing component tests and the e2e suite pass; assertion diffs = 0 (locators only)
- [ ] no page wraps `AppShell` itself any more
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
