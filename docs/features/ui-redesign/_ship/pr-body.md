## Summary

Moves every screen of the web panel onto the design canon — centred entry screens, one sidebar frame for the workspace, Bot and Team as sections of an owner-only Settings screen — and adds inbox, contacts and contact-profile preview screens on labelled sample data. Web panel only; no API, contract or migration change. Spec: [docs/features/ui-redesign/spec.md](docs/features/ui-redesign/spec.md).

## Acceptance criteria

- AC-01 — entering a workspace lands on the inbox inside the frame (switcher, Inbox, Contacts, account menu, breadcrumb) ✓
- AC-02 — at phone width the navigation opens as a drawer; no sideways page scroll ✓
- AC-03 — switching to a workspace where you are an operator hides Settings, nothing of the previous workspace stays ✓
- AC-04 — sign-in on the centred layout reaches the same destination as before ✓
- AC-05 — empty fields and wrong credentials refused with the existing messages ✓
- AC-06 — invitation, new-password and dead-link screens on the centred layout, unchanged outcomes ✓
- AC-07 — Settings opens on the Bot section with every bot action ✓
- AC-08 — Team search, role and state filters over loaded rows, Show more kept ✓
- AC-09 — no match shows a clear-filters state, Show more kept ✓
- AC-10 — operators see no Settings; saved links get the owners-only refusal leading back to the inbox ✓
- AC-11 — old Team / Bot links open the matching Settings section ✓
- AC-12 / AC-12b — inbox preview: list, addressable threads, unread cleared, labelled sample data; list → thread → back at phone width ✓
- AC-13 — empty / spaces-only / over-4096 replies can't be sent; Enter sends, Shift+Enter new line ✓
- AC-14 — a preview reply shows only until the conversation changes, the inbox is left, the workspace switches or the page reloads; nothing is sent ✓
- AC-15 / AC-16 — contacts preview: search, tag filter, profile by address, no-match state ✓
- AC-17 — previews show only sample data, identical in every workspace, no API calls ✓
- AC-18 — access removed: same landing rule and notice ✓
- AC-19 — every team and bot action keeps its confirmations, messages and outcomes ✓
- AC-20 — not found, Retry and the loading placeholder inside the frame ✓

## Design

- Spec: `docs/features/ui-redesign/spec.md` (+ `ux-flows.md`, `screens.md`)
- Architecture: `docs/features/ui-redesign/sad.md`
- Decisions: `docs/features/ui-redesign/adr/` — ADR-0001 layout route + nested Settings, ADR-0002 swappable sample-data source
- Data model / API: none (no schema or contract change)
- Review: `docs/features/ui-redesign/_review/review-2026-10-18.md` — PASS

## Tasks (SDD-Task trailers)

- 976f4ea T1 — add the canon's shadcn primitives and shared preview/list parts
- c75a315 T2 — move the entry screens onto the centred auth layout
- 4ca0a2a T3 — render workspace screens inside one layout route with the sidebar frame
- fee099d T4 — build the Settings layout and move bot settings into its Bot section
- 8b67dd3 T5 — move the team page into the Settings Team section with search and filters
- ba5e5cd T6 — build the inbox preview on a swappable sample-data source
- 7b4e0c0 T7 — build the contacts and contact-profile previews on a sample-data source
- 272c402 T8 — register the new components in the canon and remove the reference markup
- ecf84c4, a6786f9 — review fixes and review record

## Verification

- Unit / component: 357 / 357 (`apps/web`).
- Integration: n/a — no server change.
- Lint + typecheck (ESLint, Prettier, tsc incl. e2e): clean.
- e2e through the UI: 14 / 14 against the real API + Postgres + fake Bot API.
- Ran the feature (real stack, Playwright walk): 11 screens × 360 px and 1280 px — page `scrollWidth` equals the viewport everywhere (no sideways scroll); keyboard pass reaches switcher, Inbox, Contacts, Settings, account menu, sidebar toggle, breadcrumb, search, every conversation link, Reply and Send, and at 360 px the toggle opens the drawer with Enter/Space; AC-01, AC-10, AC-11, AC-14 (no network request on send, reply gone after reload) and AC-19 observed as specified.
- First load (inbox path, gzipped): +109 KB over `main` (budget +120 KB).

## Operational notes

- Migration: none.
- Feature flag / config: none (sidebar state kept in a `sidebar_state` cookie).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
