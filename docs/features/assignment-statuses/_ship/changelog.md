# Changelog — assignment-statuses

## assignment-statuses — every conversation has an owner and a status: the team assigns, closes and reopens from the thread, and the inbox reopens what a customer or a failed reply brings back

**What:** The shared inbox now answers "who is handling this?" and "is it done?". Operators and business owners of a workspace (same rights for both) can work conversations as a team instead of as one undifferentiated list.

- **Lenses.** The list shows **Open** or **Closed** conversations and filters by assignee: **All**, **Mine** or **Unassigned**. The choice lives in the address, so reload, back button and saved links keep it. Each row shows its assignee (or "unassigned"); an assignee or status change never becomes a row's preview or time. Search ignores the status lens and marks closed hits with a Closed badge.
- **Assign, reassign, unassign.** From the thread, to oneself or to any active teammate (the chooser lists only active members, me first). The change appears for the whole team without reloading and the conversation moves between the Mine and Unassigned lenses.
- **Close and reopen.** Closing keeps the assignee and leaves the open lenses for everyone. If the customer is waiting for a reply, the newest customer message is unread by the closer, or the latest reply is "not delivered" / "not confirmed", the inbox lists every reason and asks whether to close anyway; the condition is checked again under the row lock, so a message that arrived during the question asks again.
- **Honest concurrent changes.** Every change carries the state version the operator saw. If the assignee or status changed meanwhile (a teammate, a customer reopen, a deactivation), nothing happens until the operator confirms over the current state, with who changed it and when. A no-op request changes nothing and records nothing.
- **Automatic reopen.** A newly captured customer message (also a late redelivery) reopens a closed conversation with the same assignee; so does a reply that ends "not delivered" or "not confirmed". An edit of an earlier message does not.
- **Activity in the thread.** Every recorded change is a short line among the messages and replies, at its position time: "<member> assigned this to <assignee>", "closed this", "reopened — the customer wrote", "reopened — a reply was not delivered", "unassigned — <member> was deactivated". Lines are live, are not message activity and do not touch unread counts.
- **Deactivation.** Deactivating a member unassigns all their conversations (open and closed) inside the deactivation itself; reactivating does not give them back. The deactivate confirmation says so. An assignment racing the deactivation is refused or undone.
- **Limit.** 60 recorded changes per minute per member per workspace; the 61st is refused with the time to retry.

**Why:** A shared inbox without ownership and status leaves operators guessing which conversations are taken or finished, and risks two people answering the same customer — roadmap step 5 ([spec](../spec.md) §1–§2). Key decisions:

- [ADR-0001](../adr/0001-store-assignee-status-and-activity-in-the-conversations-module-and-serve-them-through-inbox-routes.md): state and activity live in `conversations`, served through `inbox` routes.
- [ADR-0002](../adr/0002-guard-member-changes-with-a-per-conversation-state-version-the-client-echoes.md): a per-conversation state version the client echoes guards every member change.
- [ADR-0003](../adr/0003-recheck-close-reasons-under-the-conversation-row-lock-against-an-acknowledged-close-snapshot.md): close reasons are re-checked under the row lock against the snapshot the closer acknowledged.
- [ADR-0004](../adr/0004-reopen-closed-conversations-inside-the-capture-and-reply-outcome-transactions.md): reopening happens inside the capture and reply-outcome transactions.
- [ADR-0005](../adr/0005-unassign-on-deactivation-through-a-workspaces-port-called-inside-the-deactivation-transaction.md): unassign on deactivation through a `workspaces` port called in the same transaction.
- [ADR-0006](../adr/0006-store-activity-entries-in-their-own-table-and-merge-them-into-the-thread-by-position-time.md): activity has its own table and merges into the thread by position time.
- [ADR-0007](../adr/0007-signal-assignment-and-status-changes-as-activity-items-on-conversation-changed.md): changes are signalled as activity items on `conversation.changed`.

**How to use:** Open *Inbox*, pick Open/Closed and an assignee lens, open a conversation and use the actions bar (assignee button, Close / Reopen). The HTTP surface is in [openapi.yaml](../contracts/openapi.yaml), all under `/api/workspaces/:workspaceId/inbox`:

- `POST /conversations/:conversationId/assign` (`assignee_account_id`, `expected_state_version`) — assign, reassign; `null` unassigns.
- `POST /conversations/:conversationId/unassign`, `POST /conversations/:conversationId/reopen` (`expected_state_version`).
- `POST /conversations/:conversationId/close` (`expected_state_version`, `expected_close_snapshot`, `confirm_close_reasons`).
- `GET /members` — active members for the assignee chooser (any role).
- `GET /conversations?status=open|closed&assignee=all|mine|unassigned&q=&after=`; the thread (`GET /conversations/:id/items`) and `GET /conversations/:id/activities/:activityId` now carry activity items; the summary carries the close snapshot.
- Refusals: `CONVERSATION_STATE_CHANGED` (409, current state and latest change), `CLOSE_NEEDS_CONFIRMATION` (409, reasons + snapshot), `ASSIGNEE_NOT_ACTIVE` (400), `CHANGE_LIMIT_REACHED` (429).
- Live: the same `GET /live` socket; the activity item type is added to the conversation frame, see [events.md](../contracts/events.md).

**Operational notes:**

- **Migrations:** five reversible migrations, `1791681109993_add_conversations_state_columns` … `1791681109997_contract_conversations_state_columns` (expand → backfill → `conversation_activities` table → lens indexes → contract). Run `pnpm db:migrate` on deploy before the new API starts; the contract migration makes status, version and the customer message counter `NOT NULL`, so the backfill must run first (same batch, in order).
- **Locking:** the workspace row lock taken by membership deactivation is now `FOR NO KEY UPDATE`, so FK checks of concurrent inserts are not blocked. This fixed a deadlock between deactivation and a concurrent assign found by the race test. Conversation-row locks in the state path are also `FOR NO KEY UPDATE`.
- **Config:** no new keys. **Feature flag:** none. **Jobs:** no new queues.
- **Rollback:** revert the deploy, then `pnpm db:rollback` five times. This drops every assignment, status and activity entry (conversations, messages and replies stay; every conversation becomes open and unassigned again).
- **Run-book integrity queries** (see `docs/architecture-map.md`, conversation state): (1) assignees that are not active members of the conversation's workspace — expect 0 rows; (2) closed conversations whose last customer arrival is later than their latest `closed` activity — expect 0 rows.
- **Not yet done:** real-bot verification still waits for a public HTTPS host (as in bot-connection); spec §8 keeps the open question whether a customer's thank-you should reopen a closed conversation (revisit after 30 days of pilot use) and the deferred muting of a flooding sender.

**Acceptance criteria delivered:** AC-01 – AC-12 — lenses (AC-01), assign / reassign / unassign (AC-02), stale-state confirmation (AC-03), active-member rule (AC-04), close and close reasons (AC-05, AC-06), automatic reopen by a customer message or a failed reply (AC-07, AC-08), activity in the thread (AC-09), unassign on deactivation (AC-10), access control (AC-11), change limit (AC-12).
