---
status: Accepted
owner: "Dmytro Hopko"
reviewers: []
updated_at: "2026-10-18"
feature_size: "S"
ticket: ""
---

# 0001 — Render workspace screens inside one layout route with nested Settings sections

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (delegated to the pipeline run at easy depth)

## Context

Every workspace page (`WorkspaceHomePage`, `TeamPage`, `BotSettingsPage`) wraps its body in `AppShell`, which enters the workspace of the URL and wires the shared guard. The redesign puts every workspace screen inside one frame with a side navigation and a breadcrumb, turns Team and Bot into sections of one Settings screen, and gives sample conversations and contacts their own addresses (spec AC-10/AC-11/AC-12/AC-15, `ux-flows.md` platform decisions).

## Decision drivers

- Behaviour preservation (spec §6, QG-1): the workspace entry, guard and access-removed handling must stay identical.
- Old Team / Bot links must lead to the matching Settings section (spec AC-11).
- Preview selections must survive reload, back and saved links (spec AC-12, AC-15).
- Every next UI feature (roadmap steps 4–8) builds into this structure.

## Considered options

1. **One layout route** — `/w/:workspaceId` renders `AppShell` with an `<Outlet/>`; inbox, contacts, Settings (with Bot/Team child routes) are children; old team/bot paths redirect; breadcrumb labels come from route metadata.
2. **Keep a per-page wrapper** — each page keeps wrapping its body in the new frame; Settings is a page that switches sections by local state.
3. **Settings as a dialog/sheet over the current screen** — Bot and Team open in an overlay instead of a page.

## Decision outcome

**Chosen:** Option 1. The frame and the workspace entry mount once while the outlet changes, so switching sections neither refetches the workspace nor flashes the skeleton; nested routes give Settings sections and preview selections real addresses for reload/back/links, and redirects keep old links working. Option 2 remounts the frame on every navigation and leaves section state unaddressable; option 3 contradicts the canon's Settings layout and makes the bot dialogs nest inside another overlay.

## Consequences

**Positive**
- One place owns workspace entry, guard wiring, navigation and breadcrumb.
- Section and preview addresses are bookmarkable; old links redirect.

**Negative**
- Pages and tests that render `AppShell` themselves must change (locators move from the page banner to the sidebar).
- Workspace switching must still reset per-workspace screen state (today done by `key={workspaceId}` on page bodies) — kept by keying the outlet content on the workspace id.
