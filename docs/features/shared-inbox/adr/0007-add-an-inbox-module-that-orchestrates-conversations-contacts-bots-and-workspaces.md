---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0007 — Add an inbox module that orchestrates conversations, contacts, bots and workspaces

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

The inbox needs data from four modules: conversations and messages (`conversations`), contact names and search (`contacts`), the bot's state, sending and media (`bots` — the only module that talks to Telegram) and memberships, roles and names (`workspaces`). The existing dependency graph is one-way `bots → conversations → contacts`, `bots → contacts` (bot-connection ADR-0005), modules may not read each other's tables, and cycles are not allowed. Sending a reply needs `bots`, while capture already makes `bots` call `conversations`.

## Decision drivers

- Module rules (`CLAUDE.md`): app-layer calls only, no other module's tables, one-way dependencies.
- Roadmap: steps 5 (assignment & statuses), 6 (notifications) and 9 (AI drafts) all extend the inbox; one module per roadmap capability.
- Spec §6 list / thread targets (≤ 500 ms server time) — the hot queries should stay inside one module.

## Considered options

1. **A new `inbox` module on top** — owns routes, socket hub, delivery worker and use cases; calls the four app layers; stores nothing itself (replies, attempts and read marks are `conversations` tables).
2. **Extend `conversations` with routes, replies and delivery** — `conversations` would need `bots` to send and to stream media, creating the cycle `bots ⇄ conversations` (broken only by injecting a port implemented by `bots` back into `conversations`).
3. **Put replying and delivery into `bots`** — `bots` already depends on `conversations`; reads and the socket would go elsewhere.

## Decision outcome

**Chosen:** Option 1. It keeps the graph acyclic without inverted ports, keeps Telegram inside `bots`, and gives later inbox steps (statuses, notifications, drafts) one home for their orchestration. Storage stays with `conversations` because the thread interleaves messages and replies and the list sorts by both — moving replies into an `inbox`-owned table would force cross-module merges on every page (ADR-0008). Option 3 would turn `bots` from "the bot connection" into "everything that talks to customers", mixing the inbox's rules into the Telegram adapter.

## Consequences

**Positive**
- No cycles; `bots`, `conversations`, `contacts` and `workspaces` gain only narrow use cases.
- A single place for inbox orchestration as roadmap steps 5, 6 and 9 arrive.

**Negative**
- One more module and four new app-layer interfaces to keep narrow.
- Rows of the list combine two modules (conversation + contact names) in the app layer — a second query per page.

**Neutral**
- `CLAUDE.md` and the architecture map gain the `inbox` module and the new dependency line (§11).

## Links

- Spec: [[../spec.md]] §4, §6
- SAD: [[../sad.md]] §4, §5
- Related ADR: [[0008-store-replies-in-their-own-table-and-page-the-thread-by-position-time]], bot-connection [[../../bot-connection/adr/0005-split-the-feature-into-bots-conversations-and-contacts-modules]]
