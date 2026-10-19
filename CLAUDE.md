# tg-inbox — working rules

Shared Telegram inbox for small businesses: a business bot per workspace, a web panel for operators.
The decided architecture lives in `docs/architecture-map.md` (+ ADRs in `docs/adr/`); this file is
the short version. When they disagree, the map wins — fix this file.

## Layout

- `apps/api` — Fastify 5 + grammY + Kysely on Node 26 (modular monolith)
  - `src/deps.ts` — `buildDeps(config)`, the shared dependency builder (db, clock, `auth` + `workspaces` repos + `contacts` → `conversations` → `team` (built after `conversations`: its `onMembershipDeactivated` port is `conversations.unassignDeactivatedMember`) → `bots` → `inbox` use cases incl. `changeState`, `destroy()`); no Fastify import, also used by the admin CLI
  - `src/app.ts` — `buildApp(config)`, the composition root: calls `buildDeps()`, registers plugins and every module under `/api` (`/health` stays at root), the realtime listener + live hub (`@fastify/websocket`), and the pg-boss queues/workers (`bots.schedule-health-checks`, `bots.check-health`, `inbox.deliver-replies` + DLQ `inbox.deliver-replies-dlq`); with `WEB_DIST_DIR` set it serves the built SPA from the same origin (HTML `GET` fallback to `index.html`, unknown `/api/*` stays a JSON 404)
  - `src/platform/` — config, db, errors, ids, logger, jobs (pg-boss), telegram, realtime (`publish(trx, signal)` = in-transaction `pg_notify` on channel `realtime`; `startRealtimeListener` = one dedicated `LISTEN` connection, reconnect + gap resync)
  - `src/modules/<m>/{domain,app,infra,http}` — one module per roadmap capability: `auth`, `workspaces`, `bots` (token, webhook, health; the only module that talks to Telegram), `conversations` + `contacts` (capture, list/thread reads with lenses, conversation state + activity entries, replies + delivery bookkeeping; app layer only, their routes are served by `inbox`), `inbox` (operator inbox routes under `/api/workspaces/:workspaceId/inbox/…`: list (status + assignee lenses), thread (messages, replies, activity entries), mark read, assign / unassign / close / reopen, active members, send / resend reply, media stream, bot status; the live socket + hub in `infra/hub.ts`; the `inbox.deliver-replies` drain worker in `infra/jobs.ts`; owns no tables). Dependencies are one-way: `inbox → {conversations, contacts, bots, workspaces}`, `bots → conversations → contacts`, `bots → contacts`
  - `migrations/` — Kysely migrations (kysely-ctl)
- `apps/web` — React 19 + Vite SPA, Tailwind + shadcn/ui (`src/shared/ui`), Zustand stores per feature
- `packages/shared` — zod schemas, DTO types and error codes shared by api + web

## Rules

- **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildDeps()` constructs module dependencies (shared by `buildApp()` and the CLI) and only `buildApp()` registers modules. No self-registration, no globals.
- **Layers:** `domain` (pure, no I/O) → `app` (use cases, ports) → `infra` (Kysely repos, Telegram adapters) → `http` (routes, zod schemas). Imports flow inward only.
- **Cross-module:** call the other module's **app layer** (passed in via the composition root). Never query another module's tables. Async work → pg-boss queue `<module>.<job>`; live updates → `platform/realtime` signals published inside the writing transaction (ids only), fanned out by the `inbox` hub.
- **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` / `UnauthenticatedError` / `TooManyRequestsError` (or a specific-code subclass such as `InvalidCredentialsError`) from `src/platform/errors.ts`. `TelegramUnavailableError` (503) is the one 5xx `AppError`: an upstream failure, logged by code only. The one error handler returns `{ "error": { "code", "message", "details"? } }`; codes are declared in `packages/shared/src/errors.ts`.
- **Conversation state:** `conversations` owns `status` (open / closed), `assignee_account_id`, `state_version` and `customer_message_seq` on the row, and the `conversation_activities` table (kind + cause + actor, thread position time, `activity` signals). Every change goes through `changeAssignee` / `changeStatus` (`conversations/app/state-changes.ts`): lock the row, compare the client's `state_version`, close reasons against the close snapshot, per-member limit (60 per 60 s, advisory lock `changes:<ws>:<account>`), write, activity entry, signal. Routes (`inbox`): `POST …/conversations/:id/{assign,unassign,close,reopen}`, `GET …/conversations/:id`, `GET …/conversations/:id/activities/:activityId`, `GET …/inbox/members`. `workspaces` declares `onMembershipDeactivated(tx, …)`, filled in `buildDeps()`; deactivation unassigns inside its transaction. Codes: `CONVERSATION_STATE_CHANGED`, `CLOSE_NEEDS_CONFIRMATION`, `ASSIGNEE_NOT_ACTIVE`, `CHANGE_LIMIT_REACHED`. Lock order: reply writes take the `drain:` advisory lock first; member changes take memberships (`FOR SHARE`, `lockActiveMembers`) then the conversation row; the workspace row lock is `FOR NO KEY UPDATE`. No new tenancy exception.
- **IDs:** UUIDv7 from `newId()` (`src/platform/ids.ts`), never DB defaults. Telegram ids are `bigint` columns, never primary keys.
- **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Six reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007) and one in `notifications` (_workspaces with a live Telegram link_, workspace ids only, used only by the `schedule-pings` backstop — operator-notifications ADR-0005); a new exception needs a change to the SAD (shared-inbox added none).
- **DB:** one shared `Kysely<DB>` (`src/platform/db.ts`). `DB` is generated into `src/platform/db.types.gen.ts` — never hand-edit it. No triggers or stored procedures; constraints are fine.
- **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. Destructive changes still go expand → migrate → contract.
- **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
- **Config:** env vars are parsed only in `src/platform/config.ts`; document every key in `.env.example`. No `process.env` elsewhere. Bot keys: `BOT_TOKEN_ENCRYPTION_KEY` (required), `TELEGRAM_WEBHOOK_BASE_URL`, `TELEGRAM_WEBHOOK_MAX_CONNECTIONS`, `TELEGRAM_API_ROOT` (tests).
- **Telegram:** all Bot API calls go through `telegramApi(token, { apiRoot })` in `src/platform/telegram.ts` (via the `bots` gateway). Each bot's webhook is `POST /api/telegram/webhook/:botId`, authenticated by `X-Telegram-Bot-Api-Secret-Token` (a per-bot derived secret, only its hash stored, checked before the body is parsed; the header is redacted from logs). Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts` (scriptable `sendMessage`, `getFile`, file download). Replies go out only via `deps.bots.sendText`, customer media streams via `deps.bots.openMedia` — the token never leaves `bots`.
- **Live socket:** `GET /api/workspaces/:workspaceId/inbox/live` — guarded upgrade (session + membership) with an `Origin` check against `PUBLIC_WEB_URL`; frames are change signals only (clients refetch through the read routes); ping every 25 s, membership + session re-validated every 5 s; close codes 4401 (session ended), 4403 (access removed), 1001 (shutdown). Web client: `apps/web/src/shared/api/realtime.ts` (`openLiveSocket`).
- **Delivery:** `inbox.deliver-replies` (policy `stately`, `singletonKey` = conversation id, retry 3, expire 60 s, dead letter `inbox.deliver-replies-dlq`) drains one conversation's pending replies at most once each (in-flight attempt mark); a Telegram back-off is a new delayed job, not a pg-boss retry; payload is ids only.
- **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.

## Tests

- Vitest everywhere; `pnpm test` runs every workspace.
- Unit: `*.test.ts` next to the code — domain + app with in-memory port fakes.
- Integration: `*.int.test.ts` — real Postgres via Testcontainers (`apps/api/src/test/postgres.ts` applies migrations), HTTP via `app.inject()`. Needs Docker.
- Web: `*.test.tsx` with Testing Library.
- Docker-backed suites remove their container and data (tmpfs, `stop()` removes volumes, even on failure); Ryuk stays enabled. After a killed run: `pnpm test:docker:clean` (only `org.testcontainers`-labelled containers).
- Smoke test: `apps/api/src/app.int.test.ts` — boots `buildApp()`, `GET /health` → 200.

## Commands

| Task                       | Command                                       |
| -------------------------- | --------------------------------------------- |
| Node version               | `nvm use` (reads `.nvmrc` → 26)               |
| Local Postgres             | `docker compose up -d`                        |
| Dev (api + web)            | `pnpm dev`                                    |
| Build                      | `pnpm -r build`                               |
| Test                       | `pnpm test`                                   |
| Clean test containers      | `pnpm test:docker:clean`                      |
| Lint (ESLint+Prettier+tsc) | `pnpm lint` (`pnpm format` to fix formatting) |
| New migration              | `pnpm db:new <name>`                          |
| Apply / revert last        | `pnpm db:migrate` / `pnpm db:rollback`        |
| Regenerate DB types        | `pnpm db:codegen`                             |
