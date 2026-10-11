---
status: Accepted
owner: "Dmytro Hopko"
reviewers: []
updated_at: "2026-10-11"
feature_size: ""
ticket: ""
---

# 0001 — Use a TypeScript pnpm monorepo on Node 26 with Fastify, grammY and a React/Vite SPA

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko + Claude (survey greenfield foundation session)

## Context

tg-inbox is a multi-tenant SaaS: a web panel for operators, an API that ingests Telegram webhooks from many business bots, and background work (broadcasts, scheduled posts, pings) in later versions. The repo was empty; the stack had to be chosen before the first feature. Changing it later means a rewrite.

## Decision drivers

- One language across backend, frontend and bot code — a small team, shared types and validation between API and UI.
- First-class Telegram Bot API tooling in webhook mode with many bots per process.
- A live inbox (push updates to operators) without extra infrastructure.
- Owner preference: the newest stable Node, installable via nvm; Zustand for frontend state.

## Considered options

1. **TypeScript monorepo (pnpm workspaces): Fastify + grammY API, React + Vite SPA with Zustand, Tailwind + shadcn/ui** — one language, shared zod schemas in `packages/shared`.
2. **TypeScript with NestJS backend / Next.js frontend** — more framework structure and SSR, more weight and conventions to fight for a panel that needs no SEO.
3. **Go backend + React SPA** — strong runtime, but two languages, no shared types, and Go is not installed in the owner's environment.

## Decision outcome

**Chosen:** Option 1. It meets every driver with the lightest framework surface: Fastify for HTTP + WebSocket + webhook ingress, grammY for the Bot API, a static SPA for the panel. Node is pinned to the **26** line in `.nvmrc` (v26.11.1 current at decision time, LTS from end of October 2026). Frontend state is **Zustand** (chosen over MobX and TanStack Query for its minimal, hook-based stores that take live WebSocket events with a plain `set()`).

## Consequences

**Positive**
- Wire types are defined once (zod in `packages/shared`) and validated on both sides.
- No extra runtime infrastructure beyond Postgres.

**Negative**
- Without a server-cache library, caching/refetch/invalidation logic is hand-written in Zustand stores.
- Node 26 is "Current" for a few more weeks — a dependency may lag behind it.

**Neutral**
- Swapping Fastify for another Node framework later touches only `http/` layers and the composition root.

## Links

- Architecture map: [[../architecture-map.md]] § Stack
- Related ADR: [[0002-organize-the-backend-as-a-modular-monolith-with-layered-modules]], [[0003-use-postgres-with-drizzle-forward-only-migrations-and-workspace-scoped-tenancy]]
