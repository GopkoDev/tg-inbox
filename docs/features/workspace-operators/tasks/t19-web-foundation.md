---
id: T19
title: "Lay the web foundation: shadcn primitives, API client, shared guard handling, stores"
layer: "ui"
deps: ["T2", "T3"]
blocks: ["T20"]
acs: ["AC-11", "AC-13", "AC-17"]
files_hint: ["apps/web/src/shared/ui/", "apps/web/src/shared/api/client.ts", "apps/web/src/shared/api/guard.ts", "apps/web/src/features/auth/store.ts", "apps/web/src/features/workspaces/store.ts", "apps/web/package.json"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T19 — Lay the web foundation: shadcn primitives, API client, shared guard handling, stores

## Place in the sequence

- **Blocked by:** T2 — Add platform primitives: error classes and codes, clock port, link tokens, config keys (the new `ErrorCode` values) · T3 — Define the auth and workspaces zod contracts in packages/shared · **Blocks:** T20 — Build SCR-01 sign-in, the workspace resolution, SCR-05 no access and SCR-10 not found · **Wave:** 2 — the first UI task; the whole UI branch runs in parallel with the backend because it needs only the shared contracts (component tests mock `fetch`).
- **Lane:** own lane (no other task touches `shared/api/` or the stores).

## Why (user story)

> **As an** Operator
> **I want** to sign in to the web panel with my email and password and sign out when I am done
> **So that** only I can act in the workspaces I belong to
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to deactivate a member who left and reactivate them if they return
> **So that** former staff lose access to our customers at once
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task builds the client plumbing every screen relies on: the primitives, the typed API client and the one place that reacts to the workspace guard's answers (session ended, access removed, not found).

## Inlined context

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **State / data-fetching:** **Zustand** stores per feature (`apps/web/src/features/<f>/store.ts`); API calls through a typed client in `apps/web/src/shared/api/client.ts` (fetch + shared zod schemas)
>
> — `architecture-map.md §Frontend / UI foundation, State / data-fetching, abridged` · full text: [architecture-map.md](../../../architecture-map.md)

> shadcn primitives to install: input, label, alert, skeleton, badge, dropdown-menu, table, alert-dialog, dialog, radio-group — standard registry primitives, not hand-rolled. Icons come from `lucide-react` (`components.json` → `iconLibrary: lucide`).
>
> — `screens.md §New components + §Source, shadcn primitives to install, abridged` · full text: [screens.md](../screens.md)

> **Shared guard states** — handled once, in the API client layer, not re-implemented per screen.
>
> | Guard answer | What the panel does |
> |---|---|
> | `401 UNAUTHENTICATED` | Clear the account + workspace stores, go to SCR-01 state `session-ended`, remember the current address to return to after sign-in |
> | `403 ACCESS_REMOVED` | Clear that workspace's data from the stores at once, re-run the AC-07 workspace resolution (`getMe` → `listMyWorkspaces`), land on SCR-06 / SCR-04 / SCR-05 with the `access-removed` notice naming the workspace |
> | `404 NOT_FOUND` from the guard | Render SCR-10 in place |
> | network failure / `500 INTERNAL_ERROR` | The screen's own `error` row (Retry) |
>
> — `screens.md §Screens, Shared guard states, abridged` · full text: [screens.md](../screens.md)

> Only requests triggered by a user action refresh `last_seen_at` — the SPA marks automatic requests with a request header and the server leaves `last_seen_at` alone for them
>
> — `adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md §Decision outcome, Shape, abridged` · full text: [ADR-0002](../adr/0002-use-opaque-cookie-sessions-stored-in-postgres.md)

> In development Vite proxies `/api` to the API port, and `VITE_API_URL` defaults to empty, so the client calls relative paths.
>
> — `adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md §Decision outcome, Shape, abridged` · full text: [ADR-0004](../adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

The client consumes (does not author) the contract's error model:

- Error envelope `{ "error": { code, message, details? } }`; `code` ∈ `ErrorCode` (`UNAUTHENTICATED` 401, `ACCESS_REMOVED` 403, `OWNER_ONLY` 403, `NOT_FOUND` 404, `INTERNAL_ERROR` 500, …).
- Header `X-Background-Request: 1` — «Sent as `1` by the web panel on automatic requests (polling, refetch on focus). Such a request is served normally but does not extend the session's 30-day idle window».

— `contracts/openapi.yaml, components.schemas.ErrorCode + components.parameters.BackgroundRequest, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-11 — happy path

> **Given** a signed-in operator
> **When** they sign out
> **Then** their session ends on that device and opening the web panel again asks them to sign in
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — authorization

> **Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
> **When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
> **Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
> **When** a business owner of "Acme Flowers" deactivates their membership
> **Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Install the ten primitives inside `apps/web`: `pnpm dlx shadcn@latest add input label alert skeleton badge dropdown-menu table alert-dialog dialog radio-group`; confirm each file in `apps/web/src/shared/ui/` imports `cn` from `@/shared/lib/utils` (fix the path if the CLI wrote another).
- [ ] Extend `apps/web/src/shared/api/client.ts`: type `ApiError.code` as `ErrorCode` from `@tg/shared`; add an option `background?: boolean` that sends `X-Background-Request: 1`; send `credentials: 'same-origin'`; tolerate empty `204` bodies (schema optional for void responses).
- [ ] Add `apps/web/src/features/auth/store.ts` (Zustand): signed-in account (`Account` from `@tg/shared`), `returnTo` address, `clear()`.
- [ ] Add `apps/web/src/features/workspaces/store.ts` (Zustand): current workspace (`WorkspaceSummary`), its loaded data slots, `accessRemovedNotice` (workspace name), `clearWorkspace(id)`, `clear()`.
- [ ] Add `apps/web/src/shared/api/guard.ts`: `handleGuardError(error, ctx)` implementing the Shared guard states table — 401 → clear both stores, remember the address, navigate to `/sign-in` with `session-ended`; 403 `ACCESS_REMOVED` → clear that workspace's data at once, set the notice, call the AC-07 resolver passed in by `ctx` (T20 supplies it); 404 → signal "render SCR-10 in place"; anything else → rethrow for the screen's own `error` row.
- [ ] Tests: `client.test.ts` (envelope → typed `ApiError`, background header, 204), `guard.test.ts` (each table row; data cleared before navigation for 403).

## Edge cases

| Case | Behaviour |
|---|---|
| Non-JSON or envelope-less error body | `ApiError` with `code: INTERNAL_ERROR` and the status text → screen's own error row |
| `403 OWNER_ONLY` (not a guard answer) | Not handled by the guard handler — rethrown so SCR-07/SCR-08 render their `owners only` state |
| `403 ACCESS_REMOVED` while another workspace is still active | Only the removed workspace's data is cleared; the account store is kept |
| Automatic refetch (focus / polling) | Sent with `X-Background-Request: 1`, so it never extends the session |
| `401` on a public route (sign-in, invite, reset) | Not routed through the guard handler — those screens handle their own answers |

## Definition of Done

- [ ] The ten primitives exist in `apps/web/src/shared/ui/` and import `@/shared/lib/utils`.
- [ ] `client.test.ts` and `guard.test.ts` pass, covering every row of the Shared guard states table.
- [ ] AC-17 client half: a test proves that on `403 ACCESS_REMOVED` the workspace's data is removed from the store before the resolver runs.
- [ ] every Hard Rule inlined above still holds (Tailwind only, primitives from `shared/ui`, no `process.env`).
- [ ] lint + vet clean (`pnpm lint`).
