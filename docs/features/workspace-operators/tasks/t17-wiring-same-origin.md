---
id: T17
title: "Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs"
layer: "wiring"
deps: ["T14", "T15", "T16"]
blocks: ["T18"]
acs: ["AC-11"]
files_hint: ["apps/api/src/app.ts", "apps/api/src/deps.ts", "apps/api/src/platform/logger.ts", "apps/web/vite.config.ts", "apps/api/package.json", "CLAUDE.md", "docs/architecture-map.md"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T17 — Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs

## Place in the sequence

- **Blocked by:** T14 — Expose the workspace guard and the me / workspaces / enter routes · T15 — Expose the invitation lookup and acceptance routes · T16 — Expose the owner-only team routes · **Blocks:** T18 — Build the admin CLI with its three commands · **Wave:** 8 — runs once every module is registered, so the extraction moves a complete composition root.
- **Lane:** shares `apps/api/src/app.ts` with T13 → T14 and `apps/api/package.json` with T5, T13, T18 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

This task makes the session cookie first-party in every environment (one origin), so signing in and out works in the real panel, and gives the admin CLI the same dependency graph as the API.

## Inlined context

> The CLI (`pnpm admin <command>`, entry under `apps/api/src/cli/`) […] builds the same module dependencies as the HTTP app (a shared dependency builder used by both `buildApp()` and the CLI), calls the same app-layer use cases […].
>
> — `adr/0001-build-an-api-a-spa-and-a-server-side-admin-cli.md §Decision outcome, abridged` · full text: [ADR-0001](../adr/0001-build-an-api-a-spa-and-a-server-side-admin-cli.md)

> Shape: every feature module's HTTP routes live under `/api/…` (`/health` stays where it is; Telegram webhook ingress in roadmap step 3 picks its own non-`/api` prefix). In production the API serves the built `apps/web` bundle as static files, and any other `GET` that asks for HTML falls back to `index.html` so SPA routes such as `/w/<id>/team` or `/invite/<token>` load directly. In development Vite proxies `/api` to the API port, and `VITE_API_URL` defaults to empty, so the client calls relative paths. Mutating routes accept only `application/json` bodies.
>
> — `adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md §Decision outcome, shape, verbatim` · full text: [ADR-0004](../adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md)

> - `WEB_DIST_DIR` — optional path to the built web panel; when unset (local development) the API serves no static files and Vite's dev server proxies `/api`
> - The session cookie's `Secure` flag follows `NODE_ENV` (off only in development); `VITE_API_URL` defaults to empty so the web client calls relative `/api` paths
>
> — `sad.md §7, Configuration added, abridged` · full text: [sad.md](../sad.md)

> Logging — pino through `platform/logger.ts`; request logs redact the `cookie` and `set-cookie` headers; passwords, session tokens and link tokens are never logged
>
> — `sad.md §8, Logging row, abridged` · full text: [sad.md](../sad.md)

> `CLAUDE.md` and `docs/architecture-map.md` still say only `buildApp()` builds dependencies and leave the route prefix, static serving and dev CORS open — Update both as part of this feature's tasks (shared dependency builder, `/api` prefix, same origin, `auth` + `workspaces` modules, new error classes, the three tenancy-rule exceptions of §5)
>
> — `sad.md §11, risk row 8, verbatim` · full text: [sad.md](../sad.md)

> Three `workspaces` repository reads cannot take a `workspaceId` because they are what *produce* it […]: *memberships of an account* — scoped by the signed-in account id; *invitation by token hash* — scoped by possession of the secret link; *membership for the guard* — scoped by (account id, workspace id from the URL). […] a new exception needs a change to this SAD.
>
> — `sad.md §5, Controlled exceptions to the tenancy rule, abridged` · full text: [sad.md](../sad.md)

> The decided architecture lives in `docs/architecture-map.md` (+ ADRs in `docs/adr/`); this file is the short version. When they disagree, the map wins — fix this file.
>
> — `CLAUDE.md §intro, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-11 — happy path

> **Given** a signed-in operator
> **When** they sign out
> **Then** their session ends on that device and opening the web panel again asks them to sign in
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/deps.ts` — `buildDeps(config)`: db, clock, logger, `auth` and `workspaces` app layers (plus `destroy()`); no Fastify import.
- [ ] `apps/api/src/app.ts` — `buildApp()` calls `buildDeps()` and only registers plugins/modules; behaviour unchanged.
- [ ] Add `@fastify/static` to `apps/api/package.json`; when `WEB_DIST_DIR` is set, serve it and fall back to `index.html` for non-`/api` `GET`s that accept HTML; unknown `/api/*` still gets the JSON `404` envelope.
- [ ] `apps/api/src/platform/logger.ts` — redact `req.headers.cookie` and `res.headers["set-cookie"]`.
- [ ] `apps/web/vite.config.ts` — dev proxy `/api` → the API port.
- [ ] `apps/api/src/app.int.test.ts` (or `static.int.test.ts`) — with a temp `WEB_DIST_DIR`: `GET /w/<id>/team` (Accept: text/html) → `index.html`; `GET /api/nope` → JSON `404`; `/health` → `200`; sign-in → sign-out → `GET /api/me` → `401` (AC-11 end to end through `buildApp()`).
- [ ] `CLAUDE.md` + `docs/architecture-map.md` — shared dependency builder, `/api` prefix + same-origin serving, `auth` + `workspaces` modules, `UnauthenticatedError` / `TooManyRequestsError` and the specific-code error classes, the three tenancy-rule exceptions.

## Edge cases

| Case | Behaviour |
|---|---|
| `WEB_DIST_DIR` unset | No static serving; SPA served by Vite in dev |
| `GET /api/unknown` | JSON `404 NOT_FOUND` envelope, never `index.html` |
| `GET /assets/<file>.js` | The static file, not the fallback |
| Request log of a signed-in call | `cookie` / `set-cookie` shown as redacted |
| CLI and API built from `buildDeps()` | Same use-case instances graph, no Fastify in the CLI |

## Definition of Done

- [ ] The static / fallback / AC-11 integration test passes; existing `app.int.test.ts` stays green
- [ ] `buildDeps()` is the only place that constructs module dependencies
- [ ] `CLAUDE.md` and `docs/architecture-map.md` describe the new conventions and no longer contradict each other
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
