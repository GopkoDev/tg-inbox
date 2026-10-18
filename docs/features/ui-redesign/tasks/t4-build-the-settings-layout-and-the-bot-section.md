---
id: T4
title: "Build the Settings layout and move bot settings into its Bot section"
layer: "ui"
deps: ["T3"]
blocks: ["T5"]
acs: ["AC-07", "AC-10", "AC-19"]
files_hint: ["apps/web/src/features/settings/", "apps/web/src/pages/SettingsPage.tsx", "apps/web/src/pages/BotSettingsPage.tsx", "apps/web/src/features/bot/settings/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T4 — Build the Settings layout and move bot settings into its Bot section

## Place in the sequence

- **Blocked by:** T3 — Render workspace screens inside one layout route with the sidebar frame · **Blocks:** T5 — Move the team page into the Settings Team section with search and filters · **Wave:** 3 — after the route tree exists; parallel with T6 and T7.
- **Lane:** owns `features/settings/`; T5 renders into the layout built here.

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

This task builds SettingsLayout and renders the existing bot settings (and their dialogs) as its Bot section, with the owners-only refusal leading back to the inbox.

## Inlined context

> | default layout | `/w/<id>/settings` or `/settings/bot` or the old bot address — title «Settings», description «Manage your workspace's bot and team»; left section menu (**Bot**, **Team**; stacks above the content below `lg`); the Bot section in a `Card` (AC-07, AC-11) | NEW: SettingsLayout, Card, Button (`ghost` menu items) |
> | loading, not connected, connected, … guard states | inherited verbatim: bot-connection §SCR-02 — now rendered inside the Settings section card |
> | owners only | operator opened Settings / the Bot section / the old bot address — the section shows only «Only business owners manage the bot» + **Back to inbox**; no bot data (AC-10) | Card, Button |
>
> — `screens.md §SCR-11, abridged` · full text: [screens.md](../screens.md)

> SCR-13 Paste token, SCR-14 Confirm takeover, SCR-15 Confirm disconnect — all states inherited verbatim from bot-connection §SCR-03 / §SCR-04 / §SCR-05, opened from SCR-11 (AC-19).
>
> — `screens.md §SCR-13…SCR-15, abridged` · full text: [screens.md](../screens.md)

> **Hard rule:** "100% of the existing web-panel tests pass, changed only where they locate elements on the page, never in what they assert happens"
>
> — `spec.md §6, Behaviour preserved, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no new API surface; reuses the existing bot settings, connect, rotate, reconnect and disconnect calls unchanged.

## Acceptance criteria

### AC-07 — happy path

> **Given** a Business owner of "Acme Flowers"
> **When** they open Settings from the side navigation
> **Then** Settings opens on its Bot section: a Settings title with a short description, a section menu with Bot and Team (stacked above the content on narrow screens), and the Bot section shows the bot's state and every action it offers today — connect, replace the token, reconnect, disconnect
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `features/settings/SettingsLayout.tsx` — title + description, section menu (`NavLink`s Bot / Team, active state), `<Outlet/>`; menu stacks above content below `lg`
- [ ] `pages/SettingsPage.tsx` renders SettingsLayout; the bot child route renders `BotSettings` with its dialogs inside the section card
- [ ] Owners-only state: «Only business owners manage the bot» + **Back to inbox** (to the workspace inbox)
- [ ] Move/adjust the existing bot settings and dialog tests to the new location; assertions unchanged except the way-back label
- [ ] Component tests: AC-07 Settings opens on Bot with the menu, AC-10 operator refusal with way back to inbox

## Edge cases

| Case | Behaviour |
|---|---|
| operator opens Settings or the Bot section by address | owners-only refusal, no bot data, **Back to inbox** |
| reconnect needs takeover confirmation / a new token | SCR-14 / SCR-03 as today |
| Telegram unavailable on reconnect | «Telegram is not responding — try again», state unchanged |

## Definition of Done

- [ ] component tests for AC-07 and AC-10 (bot) pass
- [ ] existing bot settings and dialog tests pass; assertion diffs limited to the way-back label
- [ ] bot e2e (`apps/web/e2e/bot.spec.ts`) passes
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
