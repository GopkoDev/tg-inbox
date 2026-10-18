---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 5 — assignment-statuses"
---

# 0001 — Store assignee, status and activity in the conversations module and serve them through inbox routes

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Architect (autonomous pipeline run, 2026-10-18), to be confirmed by the Tech Lead at review

## Context

Conversations need an assignee, an open/closed status and a history of changes (spec US-01…US-06). Two automatic paths must change this state inside transactions that `conversations` already owns: capture of a customer message (AC-07) and the recording of a reply outcome (AC-08). The list lenses and the thread must also filter and merge by it (AC-01, AC-09). The repo rules forbid querying another module's tables. The feature touches two surfaces: the API and the existing SPA inbox.

## Decision drivers

- Spec §6: "0 closed conversations whose latest customer message arrived after the close", which needs the reopen in the capture transaction
- Spec §6: inbox list p95 "≤ 500 ms server time" for every lens, where filtering by status and assignee should be a single-module indexed query
- `CLAUDE.md`: cross-module calls only through app layers, no foreign tables, one-way dependencies (`bots → conversations → contacts`, `inbox → …`)
- The existing surfaces: the `inbox` module owns the inbox HTTP routes, and the SPA inbox exists (shared-inbox ADR-0001, ADR-0007)

## Considered options

1. **Columns on `conversations` plus an activity table, all owned by `conversations`, with change routes in `inbox`.** Capture, reply outcomes, list and thread stay in one module, and `inbox` orchestrates the membership checks.
2. **A new `assignments` module owning a conversation-state table and the activity table.** This is a cleaner capability boundary. But `conversations` would have to call it during capture and reply outcome (a new edge `conversations → assignments`), and the list's status and assignee filters would need either a cross-module join (forbidden) or an id-list hand-off between modules on every list page.

## Decision outcome

**Chosen:** Option 1. Keeping the state in `inbox` is excluded by constraint, not weighed: `inbox` owns no tables (shared-inbox ADR-0007), and capture could not reach it without a dependency cycle. Of the two real options, only this one lets the reopen happen in the transactions that already lock the conversation row, and keeps every lens a one-module keyset query. The target surfaces are `backend-service` (the `inbox` routes plus `conversations` / `workspaces` changes in the existing API process) and `web-frontend` (the existing SPA). No worker surface is added.

## Consequences

**Positive**
- Reopen-on-capture and reopen-on-failed-reply are a few lines in existing transactions (ADR-0004).
- The list and thread queries stay single-module, so the latency targets are met with B-tree indexes.
- No new module and no new dependency edge.

**Negative**
- `conversations` grows again: it now holds messages, replies, attempts, read marks, state and activity. Its app layer needs clear sub-files to stay readable.
- Assignment as a capability is not separately deployable or replaceable.

**Neutral**
- Splitting the state into its own module later means moving two columns plus one table and replacing the list filter. That is a migration of a few days.

## Links

- Spec: [[../spec.md]] US-01…US-06, AC-01, AC-07, AC-08, AC-09
- SAD: [[../sad.md]] §4, §5
- Related ADR: [[0004-reopen-closed-conversations-inside-the-capture-and-reply-outcome-transactions]], [[0006-store-activity-entries-in-their-own-table-and-merge-them-into-the-thread-by-position-time]]; shared-inbox ADR-0007
