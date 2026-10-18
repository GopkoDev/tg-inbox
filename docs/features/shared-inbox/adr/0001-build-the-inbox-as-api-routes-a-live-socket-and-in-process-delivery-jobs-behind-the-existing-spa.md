---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0001 — Build the inbox as API routes, a live socket and in-process delivery jobs behind the existing SPA

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

shared-inbox fills the ui-redesign inbox preview with real data and lets members reply. The spec's actors are Operators and Business owners in the web panel and End customers who act only in Telegram (spec §4; `ux-flows.md` lists SCR-01…SCR-09, all inside the existing SPA, and marks AC-17 as having no screen). Replies must be retried for up to 5 minutes (AC-12) and the inbox must update live (AC-15), so the feature needs backend work beyond request/response and a decision on where that work runs.

## Decision drivers

- Spec §4 roles and `ux-flows.md`'s screen inventory — every screen lives in the existing web panel.
- Spec §6: availability 99.5 % monthly (as bot-connection), reply latency p95 ≤ 2 s, live update p95 ≤ 3 s.
- Architecture map: one process runs HTTP, webhooks and pg-boss workers in v1; workers can be split out later without module changes.
- bot-connection ADR-0001 precedent: the same `[backend-service, web-frontend]` shape with in-process jobs.

## Considered options

1. **API + existing SPA, delivery as in-process pg-boss jobs** — `[backend-service, web-frontend]`; the delivery worker, the live socket endpoint and the media proxy run inside the API process.
2. **API + SPA + a separate delivery worker container** — `[backend-service, web-frontend, worker]`; replies are sent by a second deployable reading the same queue.
3. **API + SPA, sending inline in the reply request** — no background worker; retries driven by the browser.

## Decision outcome

**Chosen:** Option 1. It matches the decided v1 topology (one process) and the bot-connection precedent, keeps retries server-side as AC-12 requires ("tg-inbox keeps trying on its own" even when the operator closes the tab — which rules out option 3), and pg-boss queues let the worker move to its own process later without code changes, which is when option 2 starts paying for its extra deployable.

## Consequences

**Positive**
- No new deployable or infrastructure; the SPA keeps its routes and layout.
- Delivery survives the author closing the tab or losing connection.

**Negative**
- Reply delivery shares the event loop and database pool with webhook capture and HTTP reads; a slow Telegram can tie up worker slots (bounded by per-call timeouts, §8).

**Neutral**
- Splitting the worker out later is a deployment change; the queue names and payloads are already the boundary.

## Links

- Spec: [[../spec.md]] §4, AC-12, AC-15, AC-17, §6
- UX flows: [[../ux-flows.md]] screen inventory
- SAD: [[../sad.md]] §4, §5, §7
- Related ADR: [[0004-send-replies-at-most-once-through-a-per-conversation-delivery-queue-with-an-in-flight-mark]]
