# Changelog — ui-redesign

## ui-redesign — the web panel moves onto the design canon, with inbox and contacts previews

**What:** Every screen of the operator web panel now follows the design canon. Sign-in, invitation, password reset, the workspace picker and no-access share one centred layout. Every workspace screen lives in one frame with a collapsible side navigation (workspace switcher, Inbox, Contacts, owner-only Settings, account menu) and a breadcrumb; at phone width the navigation opens as a drawer. The business owner's Bot and Team pages are now two sections of one Settings screen, and the team list gained search and role/state filters. New preview screens — the shared inbox, the contact list and a contact's profile — show clearly labelled sample data: nothing there is saved, nothing reaches Telegram, and every workspace sees the same samples. Every existing action, message and safeguard works as before.

**Why:** The panel needed to look and navigate like one product before the shared inbox (roadmap step 4) and contacts (step 7) are built, so those steps fill an existing screen instead of building one — see [spec](../spec.md) §1–§2. Key decisions: one layout route renders the frame and Settings sections are nested routes, with redirects from the old addresses — [ADR-0001](../adr/0001-render-workspace-screens-inside-one-layout-route-with-nested-settings-sections.md); preview screens read sample data through a per-feature source that steps 4 and 7 swap for the API — [ADR-0002](../adr/0002-serve-preview-screens-from-a-swappable-per-feature-sample-data-source.md).

**How to use:** Sign in → the workspace opens on Inbox (sample data). Contacts is in the side navigation. Business owners find the bot and the team under Settings (`/w/<id>/settings/bot`, `/w/<id>/settings/team`); old `/w/<id>/bot` and `/w/<id>/team` links redirect there. A sample conversation or contact has its own address and can be bookmarked.

**Operational notes:**
- Migration: none — web panel only; no API, contract or database change.
- Feature flag / config: none. The panel stores the sidebar's collapsed/expanded state in a `sidebar_state` cookie.
- Rollback: revert the merge and redeploy; no data to undo.
- Bundle: the inbox first load is +109 KB gzipped over `main` (budget +120 KB); Contacts and Settings load on demand.

**Acceptance criteria delivered:** AC-01 … AC-20 and AC-12b — the frame and navigation, the centred entry screens with unchanged sign-in rules and messages, Settings with Bot and Team (search, filters, Show more), owners-only refusals that lead back to the inbox, the inbox / contacts / profile previews on labelled sample data, and every existing team and bot action unchanged.
