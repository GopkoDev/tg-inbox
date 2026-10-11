# tg-inbox — working rules

Shared Telegram inbox for small businesses: a business bot per workspace, a web panel for operators.
The decided architecture lives in `docs/architecture-map.md` (+ ADRs in `docs/adr/`); this file is
the short version. When they disagree, the map wins — fix this file.

## Layout

- `apps/api` — Fastify 5 + grammY + Kysely on Node 26 (modular monolith)
  - `src/app.ts` — `buildApp(config)`, the composition root: builds deps, registers every module
  - `src/platform/` — config, db, errors, ids, logger, jobs (pg-boss), telegram
  - `src/modules/<m>/{domain,app,infra,http}` — one module per roadmap capability; `modules/health` is the precedent
  - `migrations/` — Kysely migrations (kysely-ctl)
- `apps/web` — React 19 + Vite SPA, Tailwind + shadcn/ui (`src/shared/ui`), Zustand stores per feature
- `packages/shared` — zod schemas, DTO types and error codes shared by api + web

## Rules

- **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildApp()` constructs deps and registers modules. No self-registration, no globals.
- **Layers:** `domain` (pure, no I/O) → `app` (use cases, ports) → `infra` (Kysely repos, Telegram adapters) → `http` (routes, zod schemas). Imports flow inward only.
- **Cross-module:** call the other module's **app layer** (passed in via the composition root). Never query another module's tables. Async work → pg-boss queue `<module>.<job>`.
- **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` from `src/platform/errors.ts`. The one error handler returns `{ "error": { "code", "message", "details"? } }`; codes are declared in `packages/shared/src/errors.ts`.
- **IDs:** UUIDv7 from `newId()` (`src/platform/ids.ts`), never DB defaults. Telegram ids are `bigint` columns, never primary keys.
- **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
- **DB:** one shared `Kysely<DB>` (`src/platform/db.ts`). `DB` is generated into `src/platform/db.types.gen.ts` — never hand-edit it. No triggers or stored procedures; constraints are fine.
- **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. Destructive changes still go expand → migrate → contract.
- **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
- **Config:** env vars are parsed only in `src/platform/config.ts`; document every key in `.env.example`. No `process.env` elsewhere.
- **Telegram:** all Bot API calls go through `telegramApi(token)` in `src/platform/telegram.ts`; webhooks are authenticated by `X-Telegram-Bot-Api-Secret-Token`. Bot tokens are secrets — never logged, never returned.
- **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.

## Tests

- Vitest everywhere; `pnpm test` runs every workspace.
- Unit: `*.test.ts` next to the code — domain + app with in-memory port fakes.
- Integration: `*.int.test.ts` — real Postgres via Testcontainers (`apps/api/src/test/postgres.ts` applies migrations), HTTP via `app.inject()`. Needs Docker.
- Web: `*.test.tsx` with Testing Library.
- Smoke test: `apps/api/src/app.int.test.ts` — boots `buildApp()`, `GET /health` → 200.

## Commands

| Task                       | Command                                       |
| -------------------------- | --------------------------------------------- |
| Node version               | `nvm use` (reads `.nvmrc` → 26)               |
| Local Postgres             | `docker compose up -d`                        |
| Dev (api + web)            | `pnpm dev`                                    |
| Build                      | `pnpm -r build`                               |
| Test                       | `pnpm test`                                   |
| Lint (ESLint+Prettier+tsc) | `pnpm lint` (`pnpm format` to fix formatting) |
| New migration              | `pnpm db:new <name>`                          |
| Apply / revert last        | `pnpm db:migrate` / `pnpm db:rollback`        |
| Regenerate DB types        | `pnpm db:codegen`                             |
