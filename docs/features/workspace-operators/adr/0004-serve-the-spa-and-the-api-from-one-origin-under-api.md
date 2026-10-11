---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 2 — workspace-operators"
---

# 0004 — Serve the SPA and the API from one origin under /api

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk

## Context

The architecture map leaves three questions to "the first UI feature that calls the API": the API route prefix, how the SPA is served alongside the API, and CORS for `pnpm dev` (web on Vite's port, API on :3000). This is that feature, and its cookie sessions (ADR-0002) work cleanly only when the browser sees the SPA and the API as one site.

## Decision drivers

- ADR-0002: an `HttpOnly`, `SameSite=Lax` session cookie.
- Spec §6.1: credentials and the membership graph are confidential — cross-site request forgery must not be able to act with a signed-in person's cookie.
- sad.md §2: one process serves every workspace; no deployment target is decided yet.
- `ux-flows.md` posture: links are mostly opened on phones, including iOS Safari, which blocks third-party cookies.

## Considered options

1. **One origin, API under `/api`** — the API process also serves the built SPA in production; the Vite dev server proxies `/api` to the API in development.
2. **Two origins with CORS** — the SPA on its own host (static hosting or a CDN), the API on another; CORS with credentials and a cookie scoped to a shared parent domain or `SameSite=None`.

## Decision outcome

**Chosen:** Option 1. With one origin the session cookie is first-party everywhere — including iOS Safari — and `SameSite=Lax` already withholds it from cross-site form posts, so no CSRF tokens are needed. Option 2 adds CORS configuration, a second TLS host and `SameSite=None` cookies that then need CSRF tokens, for a CDN benefit that 5–10 pilots do not need.

Shape: every feature module's HTTP routes live under `/api/…` (`/health` stays where it is; Telegram webhook ingress in roadmap step 3 picks its own non-`/api` prefix). In production the API serves the built `apps/web` bundle as static files, and any other `GET` that asks for HTML falls back to `index.html` so SPA routes such as `/w/<id>/team` or `/invite/<token>` load directly. In development Vite proxies `/api` to the API port, and `VITE_API_URL` defaults to empty, so the client calls relative paths. Mutating routes accept only `application/json` bodies.

## Consequences

**Positive**
- No CORS configuration in any environment; the dev setup mirrors production.
- Session cookies are first-party on every browser.
- One deployable unit.

**Negative**
- The API process serves static files — fine at pilot scale, not a CDN.
- A reverse proxy or CDN added later must keep the SPA and `/api` on the same origin, or the session cookie must be revisited.

**Neutral**
- Moving static files to a proxy (nginx, Caddy) on the same origin later needs no application change.

## Links

- Spec: [[../spec.md]] — US-02, US-03, §6.1
- SAD: [[../sad.md]] §4, §7
- Related ADR: [[0002-use-opaque-cookie-sessions-stored-in-postgres]]
