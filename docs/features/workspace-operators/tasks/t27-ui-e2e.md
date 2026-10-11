---
id: T27
title: "Add the six browser end-to-end flows and their CI step"
layer: "ui"
deps: ["T25", "T26"]
blocks: []
acs: ["AC-03", "AC-04", "AC-07", "AC-11", "AC-12", "AC-14", "AC-17"]
files_hint: ["apps/web/e2e/", "apps/web/playwright.config.ts", "apps/web/package.json", "package.json", ".github/workflows/ci.yml", "pnpm-lock.yaml"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T27 — Add the six browser end-to-end flows and their CI step

## Place in the sequence

- **Blocked by:** T25 (last screen) and T26 (API e2e helpers prove the backend flows) · **Blocks:** — · **Wave:** last.
- **New dependency (approved by the user on 2026-10-11):** Playwright as a devDependency of `apps/web`, Chromium only.

## Why

`test-plan.md` chose `e2e-through-UI` for six flows from `ux-flows.md`: the SPA ↔ API seam (same-origin cookie, return-after-sign-in, the shared guard handler for access removed) is invisible to component tests.

— `test-plan.md §AC coverage (E2E-through-UI scope), verbatim list` · full text: [test-plan.md](../test-plan.md)

## Flows

1. Join as a new person (AC-03) — open invite link → name + password → lands on SCR-06 of the workspace.
2. Join with an existing account (AC-04) — invite link for an email that has an account → existing password → SCR-06; the other workspace still in the switcher.
3. Sign in and sign out (AC-07, AC-11) — SCR-01 → last-used workspace → sign out → SCR-01; reopening the panel asks to sign in.
4. Switch workspace (AC-12) — switcher on SCR-06 → pick "Bolt Bikes" → only its name in the header.
5. Invite a teammate (AC-14) — owner on SCR-07 → Invite → link shown once with Copy → Done → pending row without link.
6. Deactivate a member with an open second tab (AC-17) — two browser contexts; owner deactivates member; member's next action shows the access-removed notice and moves to the other workspace or SCR-05.

## Checklist

- [ ] `apps/web/playwright.config.ts` — `webServer` starts the API (built SPA served from the same origin via `WEB_DIST_DIR`) against an ephemeral Postgres; base URL from config.
- [ ] Seed through the admin CLI command functions / app layer (a global setup script), never through the UI under test; reset the database before each flow.
- [ ] `apps/web/e2e/*.spec.ts` — the six flows; select by role/label text, not CSS classes.
- [ ] `apps/web/package.json` script `test:e2e`; the e2e files are excluded from the Vitest projects so `pnpm test` stays browser-free.
- [ ] `.github/workflows/ci.yml` — a step after `pnpm test`: install Chromium, `pnpm --filter @tg/web test:e2e`.

## Definition of Done

- [ ] The six flows pass locally (Docker running) and in the CI step
- [ ] `pnpm test` does not pick up the browser specs
- [ ] lint + vet clean (`pnpm lint`)
