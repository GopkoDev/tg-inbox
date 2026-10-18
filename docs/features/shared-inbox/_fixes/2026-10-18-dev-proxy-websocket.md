---
slug: shared-inbox
date: 2026-10-18
triage: regression
acs: [AC-15, AC-06]
commit: 77e2899
recurrence_of: none
---

# Fix: live inbox updates never arrive in local dev

## Symptom

Running `pnpm dev` (Vite on :5173 proxying `/api` to the API on :3000) with a real bot behind
ngrok: customer messages were captured (`telegram update captured` in the API log) but never
appeared in the open inbox, and a sent reply stayed "sending" until a reload. The API log showed
no request to `/api/workspaces/:id/inbox/live` at all. Scope: every member, local dev only (the
built SPA served by the API itself was unaffected).

## Root cause

`apps/web/vite.config.ts:9` proxied `/api` as a plain string target, which Vite proxies for HTTP
only. The live socket (ADR-0002) is a WebSocket upgrade on `/api/…/inbox/live`, so the dev server
never forwarded it; the client kept reconnecting with backoff and no change signal ever reached
the page, so neither new messages nor reply state changes were refetched. It slipped past the
tests because the browser e2e (`apps/web/e2e`) serves the built SPA from the API on one origin,
so the Vite proxy was never on the path.

## The pinning test

`apps/web/src/test/dev-proxy.test.ts` — "forwards the live socket upgrade on /api to the API"
(integration: a real Vite dev server built from the repo's `/api` proxy options, pointed at a
local HTTP server that records upgrades). RED before the fix:

```
AssertionError: expected [] to deeply equal [ '/api/workspaces/w1/inbox/live' ]
```

Green after `'/api': { target: 'http://localhost:3000', ws: true }`. Also confirmed against the
running dev server: an upgrade on `:5173/api/…/inbox/live` now reaches the API (`401` without a
session cookie instead of never arriving).

## Spec patch

None — regression; the spec is environment-agnostic and right. AC-15 (live updates) and AC-06
(sending → sent without reload) re-verified in dev through the proxy.

## Follow-ups

- The panel shows nothing while the live socket keeps failing; a small "live updates paused —
  reconnecting" hint would have made this visible at once (screens.md has no such state yet).
