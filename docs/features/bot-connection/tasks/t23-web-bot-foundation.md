---
id: T23
title: "Lay the web bot foundation: bot API client, store, /w/:workspaceId/bot route and the owner-only Bot entry in AppShell (SCR-01)"
layer: "ui"
deps: ["T4"]
blocks: ["T24"]
acs: ["AC-03"]
files_hint: ["apps/web/src/features/bot/api.ts", "apps/web/src/features/bot/store.ts", "apps/web/src/features/bot/store.test.ts", "apps/web/src/app/routes.tsx", "apps/web/src/pages/BotSettingsPage.tsx", "apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell.test.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "S"
status: "todo"
---

# T23 — Lay the web bot foundation: bot API client, store, /w/:workspaceId/bot route and the owner-only Bot entry in AppShell (SCR-01)

## Place in the sequence

- **Blocked by:** T4 — shared `BotSettings` / request schemas · **Blocks:** T24 — Build SCR-02 Bot settings with every declared state · **Wave:** 3 — the UI branch runs in parallel with the backend from here on (it needs only the contracts).
- **Lane:** creates `apps/web/src/pages/BotSettingsPage.tsx` as a stub that T24–T26 fill — serialized chain. Only task touching `routes.tsx` and `app-shell.tsx`.

## Why (user story)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task makes the Bot settings address exist, reachable by owners only, with a store every action response replaces.

## Inlined context

> The Bot settings page lives at `/w/<workspaceId>/bot`; its entry ("Bot") sits in the app shell next to Team, shown only to business owners, in both the desktop nav and the phone menu […]. State lives in a `features/bot/store.ts` Zustand store, loaded on page open and replaced by the response of every action.
>
> — `sad.md §4, UI architecture, abridged` · full text: [sad.md](../sad.md)

> SCR-01 — default: owner | `role: owner` — header gains **Bot** (link to `/w/<id>/bot`) after **Team**; the link is marked current on SCR-02 | AppShell, Button (link) · default: operator | `role: operator` — no **Bot** entry (and no Team, as before)
> Shared guard states (every `/api/workspaces/<id>/bot…` call). Handled once by the existing workspace-area guard handler […] `403 ACCESS_REMOVED` → clear that workspace's data (incl. the bot store) […] `403 OWNER_ONLY` **Not** a shared-handler case — SCR-02 state `owners only`
> Token secrecy: the token exists only in the SCR-03 input and, between a `409 TAKEOVER_CONFIRMATION_REQUIRED` and the SCR-04 answer, in component memory; […] never written to the store, URL, storage or logs
>
> — `screens.md §SCR-01 + §Shared guard states + §Source, abridged` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` […]. Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

Reuse: `apps/web/src/shared/api/client.ts` (parses with shared schemas), `features/workspaces/guard.ts` `useGuard`, existing Team link markup in `app-shell.tsx` (desktop nav + ☰ menu).

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`features/bot/api.ts`: `getBotSettings(ws, { background? })`, `pasteBotToken(ws, { token, confirm_takeover })`, `reconnectBot(ws, { confirm_takeover })`, `disconnectBot(ws)` — each parses `BotSettings`; refusals surface the envelope `code`, `message` and typed `details` (`reason`, `bot`, `settings`).

— `contracts/openapi.yaml, four owner operations, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-03 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to connect, rotate or disconnect the bot, or open the bot settings
> **Then** the system refuses and tells them that only business owners manage the bot; a person with no active membership in "Acme Flowers" gets no hint that the workspace or its bot exists
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] API functions — `features/bot/api.ts`
- [ ] Zustand store per workspace: `settings | null`, `status: loading|ready|error|owners_only`, `notice`, `load()`, `replace(settings)`, `clear()`; cleared on access-removed and workspace switch — `features/bot/store.ts` (+ `store.test.ts`)
- [ ] Route `/w/:workspaceId/bot` → stub `BotSettingsPage` inside AppShell — `app/routes.tsx`, `pages/BotSettingsPage.tsx`
- [ ] AppShell: owner-only **Bot** link after **Team** in desktop nav and ☰ menu, `aria-current` on `/bot` — `shared/ui/app-shell.tsx` (+ `app-shell.test.tsx` cases)

## Edge cases

| Case | Behaviour |
|---|---|
| Operator opens `/w/<id>/bot` by address | page renders (state `owners only` comes from the 403 in T24) |
| Workspace switch while on `/bot` | store cleared; reloads for the new workspace |

## Definition of Done

- [ ] Testing Library tests: owner sees **Bot** after Team (desktop + phone menu), operator sees neither; store replace/clear behaviour
- [ ] no token field exists in the store type
- [ ] lint + vet clean (`pnpm lint`)
