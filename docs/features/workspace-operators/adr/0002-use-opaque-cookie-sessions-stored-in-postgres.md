---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 2 — workspace-operators"
---

# 0002 — Use opaque cookie sessions stored in Postgres

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk

## Context

This feature introduces sign-in to the web panel (US-03). Every later web-panel request — team management now, the inbox and its live updates in roadmap step 4 — carries whatever session mechanism is chosen here. The spec asks for sessions that end at once on sign-out (that device) and on a password reset (every device), that expire after 30 days without user activity, and whose expiry is not extended by automatic background checks.

## Decision drivers

- Spec §6 NFR: session ends after 30 days without activity (background checks do not extend it); ends at once on sign-out (that device) or password reset (all devices).
- Spec §6 NFR: sign-in p95 ≤ 500 ms; team / switch / invite actions p95 ≤ 300 ms.
- Spec §6.1: credentials are confidential; AC-21 ends every other session of the account on a password reset.
- sad.md §2: PostgreSQL 16 is already the single datastore; no cache or key-value store exists.

## Considered options

1. **Opaque session token in an HttpOnly cookie, sessions stored in Postgres** — a random token identifies a server-side session row; revocation is deleting rows.
2. **Short-lived signed JWT access token plus a refresh token stored in Postgres** — requests are verified by signature; the SPA rotates tokens; revocation needs a deny-list.

## Decision outcome

**Chosen:** Option 1. It meets "ends at once" literally — sign-out deletes one row, a password reset deletes every row of the account — and the 30-day idle rule is a check on the session's last activity time. Option 2's advantage, verifying a request without the database, disappears here: an immediate revocation needs a deny-list lookup on every request, and the workspace-membership check of ADR-0003 hits the database on every request anyway.

Shape: on sign-in (and on invitation acceptance or password reset, which also sign the device in) the server generates 32 random bytes, sends them base64url-encoded in a cookie that is `HttpOnly`, `Secure` (outside local development), `SameSite=Lax`, `Path=/`, and stores only the SHA-256 hash of the token with the account id, `created_at` and `last_seen_at`. Each authenticated request looks the hash up; a session idle for more than 30 days is deleted and the request treated as signed out. Only requests triggered by a user action refresh `last_seen_at` — the SPA marks automatic requests with a request header and the server leaves `last_seen_at` alone for them — and the refresh is written at most once a minute per session.

## Consequences

**Positive**
- Sign-out and password-reset revocation are immediate and simple to test.
- The token never reaches page JavaScript, so a script injected into the page cannot read it.
- No token-refresh logic in the SPA.

**Negative**
- One indexed lookup per request plus a throttled write for active users.
- Cookies tie the SPA and the API to one origin (ADR-0004).
- Expired session rows linger until they are next looked up (accepted debt, sad.md §11).

**Neutral**
- A non-browser client (the MCP server, roadmap step 11) will need its own token mechanism; it can reuse the same `sessions`-style storage.

## Links

- Spec: [[../spec.md]] — US-03, US-08, AC-11, AC-21, §6 (session lifetime), §6.1
- SAD: [[../sad.md]] §4
- Related ADR: [[0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request]], [[0004-serve-the-spa-and-the-api-from-one-origin-under-api]]
