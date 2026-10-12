---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0007 — Bind a bot to one workspace with unique constraints and two controlled tenancy exceptions

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

A bot belongs to at most one workspace and a workspace keeps at most one bot (CONTEXT invariants). AC-04 refuses a bot connected to another workspace, or through which another workspace captured conversations, without revealing which; AC-05 keeps a workspace with its bot once customers have written; AC-19 lets the same bot be connected again after a disconnect. The repo's tenancy rule says every repository method takes `workspaceId`; exceptions are listed in a SAD. Checking "is this bot taken elsewhere", resolving an inbound webhook to its workspace and finding the bots due for a health check all start without a workspace id.

## Decision drivers

- CONTEXT invariants; AC-04, AC-05, AC-18, AC-19; spec §6.1 cross-tenant bot hijack abuse case.
- Spec §6 cross-workspace isolation: 0 reads or writes across workspaces; an isolation test for every data-access path.
- Architecture map: DB constraints welcome, no triggers; tenancy exceptions only by SAD change.

## Considered options

1. **Unique constraints decide ownership; two listed reads produce the workspace id** — the bots table has a unique `workspace_id` and a unique `telegram_bot_id`; a bot row lives while the bot is connected or has captured conversations, and is deleted on disconnect when nothing was captured. Connecting inserts or updates the workspace's own row; a unique violation on `telegram_bot_id` means "belongs to another workspace". The only reads without a `workspaceId`: *bot by webhook id* (scoped by possession of the matching webhook secret) and *bots due for a health check* (a system job; returns ids and workspace ids only).
2. **Ownership checked by a cross-workspace query under a lock** — the same row lifecycle (rows with captures outlive a disconnect), but before connecting the application reads whether any other workspace's row holds this Telegram bot id, serialised by an advisory lock on that id.

## Decision outcome

**Chosen:** Option 1. The database enforces both invariants under concurrency (two owners in two workspaces pasting the same token at once), and the refusal is decided without the application ever reading another workspace's row, so there is nothing to leak. Option 2 adds a third cross-tenant read to the exception list on the owner's main action and needs a lock to be correct, where a constraint is correct by construction. Keeping the row after a disconnect that had captures is also what makes AC-19 work: the same bot reconnects to the same row and existing conversations continue.

The two exceptions are added to the list kept in the workspace-operators SAD §5 and `CLAUDE.md`; each gets its own isolation test.

## Consequences

**Positive**
- Both invariants hold under any interleaving; AC-04 never names the other workspace because the application never learns it.
- The exception list stays short and explicit.

**Negative**
- Once a bot captured anything, freeing it for another workspace is a manual operation (spec §3 non-goal: done by the tg-inbox team on a verified request).
- A disconnected row with captures keeps the bot's public identity (`telegram_bot_id`, name, username) but no token.

**Neutral**
- AC-05's two refusal messages are distinguished by reading the workspace's own row: connected → "disconnect it first", disconnected with captures → "the workspace stays with that bot".

## Links

- Spec: [[../spec.md]] AC-04, AC-05, AC-18, AC-19; §6.1
- SAD: [[../sad.md]] §5, §8
- Related ADR: [[0002-receive-updates-through-one-webhook-per-bot-authenticated-by-a-per-bot-secret]], [[0008-check-bot-health-with-a-scheduled-job-and-show-the-stored-state]]; workspace-operators [[../../workspace-operators/adr/0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request]]
