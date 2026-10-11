# tg-inbox

A shared Telegram inbox for small businesses: customers write to the business's own bot, operators
answer from one web panel. Architecture: [`docs/architecture-map.md`](docs/architecture-map.md);
roadmap: [`docs/roadmap.md`](docs/roadmap.md).

## Requirements

- [nvm](https://github.com/nvm-sh/nvm) (Node 26 is pinned in `.nvmrc`)
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Docker (local Postgres + Testcontainers for integration tests)

## Getting started

```sh
nvm install && nvm use      # Node 26
pnpm install
cp .env.example .env        # adjust POSTGRES_PORT / DATABASE_URL if 5432 is taken
docker compose up -d        # PostgreSQL 16
pnpm db:migrate             # apply all migrations
pnpm dev                    # api on :3000, web on Vite's port
```

`curl localhost:3000/health` → `{"status":"ok","db":"up"}`.

## Everyday commands

| Command              | What it does                                                   |
| -------------------- | -------------------------------------------------------------- |
| `pnpm dev`           | api (tsx watch) + web (Vite) in parallel                       |
| `pnpm -r build`      | build every workspace (tsc for api/shared, Vite for web)       |
| `pnpm test`          | Vitest across workspaces (integration tests need Docker)       |
| `pnpm lint`          | ESLint + Prettier check + `tsc --noEmit`                       |
| `pnpm db:new <name>` | create `apps/api/migrations/<timestamp>_<name>.ts` (up + down) |
| `pnpm db:migrate`    | apply all pending migrations                                   |
| `pnpm db:rollback`   | revert the last migration                                      |
| `pnpm db:codegen`    | regenerate `apps/api/src/platform/db.types.gen.ts` from the DB |

After every migration: `pnpm db:migrate && pnpm db:codegen`, and commit the regenerated types.

## Layout

```
apps/api         Fastify API, Telegram webhooks, pg-boss workers
apps/web         React + Vite operator panel
packages/shared  zod schemas + error codes shared by api and web
docs/            architecture map, ADRs, roadmap, feature specs
```
