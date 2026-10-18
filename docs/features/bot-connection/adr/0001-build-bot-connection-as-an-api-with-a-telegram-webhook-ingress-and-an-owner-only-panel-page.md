---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0001 — Build bot connection as an API with a Telegram webhook ingress and an owner-only panel page

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

Bot connection has two kinds of users who never meet in one interface: a business owner who connects, checks and manages the business bot in the web panel (US-01, US-05, US-06), and end customers whose messages arrive from Telegram with no human in tg-inbox involved (US-02–US-04). Both must be served by the system that already runs the workspace-operators API and SPA. `ux-flows.md` lists six screens, all in the existing workspace area of the web panel, and no panel UI for capture. The feature also needs background work (health checks of every connected bot, AC-15).

## Decision drivers

- Spec §1/§4: the owner connects alone, in the web panel; end customers act only in Telegram.
- Spec §6: capture p95 ≤ 2 s, inbound acknowledgement p95 ≤ 300 ms, ≥ 50 inbound messages/s per instance, availability 99.5%.
- Architecture map: one deployable process for HTTP, webhooks and pg-boss job workers in v1; SPA served from the same origin under `/api` (workspace-operators ADR-0004).
- Repo ADR-0001: React + Vite SPA is the fixed web stack.

## Considered options

1. **API (with the webhook ingress and in-process pg-boss workers) + the existing SPA** — `target_surfaces: [backend-service, web-frontend]`; health checks run as pg-boss jobs inside the API process.
2. **API + SPA + a separate worker process** — `[backend-service, web-frontend, worker]`; health checks (and later capture processing) run in their own deployable.

## Decision outcome

**Chosen:** Option 1. At pilot scale (5–10 workspaces, one bot each) the health checks are a handful of Bot API calls per minute and capture runs inside the webhook request (ADR-0003), so a second deployable buys no isolation while adding a deployment unit before any deployment target exists. pg-boss workers are registered from the composition root and can move to their own process later without module changes, as the architecture map already allows. The web-frontend surface stays a client-side SPA (repo ADR-0001): one new owner-only page in the workspace area, reached from the app shell next to Team.

## Consequences

**Positive**
- No new deployable; the feature reuses the existing composition root, session guard and SPA shell.
- One configuration and one log stream for webhook ingress, owner actions and health checks.

**Negative**
- A slow health-check batch shares the event loop and the database pool with webhook ingress; bounded by per-bot concurrency limits (sad.md §7) and visible in the flood load test.

**Neutral**
- Splitting the pg-boss workers into a `worker` surface later is a deployment change, not a code change.

## Links

- Spec: [[../spec.md]] US-01–US-06
- UX flows: [[../ux-flows.md]]
- SAD: [[../sad.md]] §4, §5, §7
- Related ADR: [[0002-receive-updates-through-one-webhook-per-bot-authenticated-by-a-per-bot-secret]], [[0003-capture-each-update-inside-the-webhook-request-with-idempotent-writes]], [[0008-check-bot-health-with-a-scheduled-job-and-show-the-stored-state]]
