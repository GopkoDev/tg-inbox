---
status: Accepted
owner: "Dmytro Hopko"
reviewers: []
updated_at: "2026-10-18"
feature_size: "S"
ticket: ""
---

# 0002 — Serve preview screens from a swappable per-feature sample-data source

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (delegated to the pipeline run at easy depth)

## Context

The inbox, contact-list and contact-profile previews need data now, while the real conversations and contacts arrive with roadmap steps 4 and 7. The spec requires that the sample data is identical in every workspace, never saved, never mixed with real data (AC-14, AC-17), and that the next steps ship by replacing the sample data rather than building new screens (spec §7 KPI "Screens reused by the next feature").

## Decision drivers

- Never mix sample and real data; nothing leaves the browser (spec §6.1).
- Steps 4 and 7 swap the data, keep the screens (spec §1 ¶3, §7).
- No server change in this feature (sad §2).
- First-load download ≤ +120 KB gzipped over `main` (spec §6).

## Considered options

1. **Per-feature read-only source** — `features/inbox/sample-source.ts` and `features/contacts/sample-source.ts` expose typed `list…` / `get…ById` functions backed by static fixtures in the same folder; screens and stores call the source only.
2. **Fake API layer** — intercept the panel's API client and answer invented endpoints (`/api/…/conversations`) with fixtures, so screens call "real" endpoints.
3. **Fixtures inline in components** — each screen imports and renders its own constant arrays.

## Decision outcome

**Chosen:** Option 1. It keeps fixtures out of the API client (no invented contract that steps 4/7 would have to honour or undo, no risk of mixing with real responses), and gives each later step one seam to replace — the source's functions become API calls with the shared contracts those steps define. Option 2 invents endpoints and payload shapes before their features are specified; option 3 spreads fixtures across components so the swap touches every screen.

## Consequences

**Positive**
- One seam per feature for steps 4 and 7; screens untouched by the swap.
- Sample data never travels through the API client, so it cannot be mistaken for, or merged with, a real response.

**Negative**
- The source's types are this feature's guess at conversation/contact shapes; steps 4/7 may reshape them when the real contracts land.
- The route table's breadcrumb resolvers (`apps/web/src/app/routes.tsx`) read sample names synchronously from both sources — a second consumer the step 4/7 swap must update (review R-1).
- Fixtures add to the bundle until replaced (bounded by the size NFR; the contacts routes may be lazy-loaded, the inbox fixtures sit on the measured first-load path).
