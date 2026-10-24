---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0010 — Store broadcast items as a conversations thread entry that never touches conversation state

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

Each delivered broadcast shows in the recipient's thread as a **broadcast item** (text, broadcast name, launching owner) at the time it was delivered; a "not confirmed" one shows too, marked, at the time of the send (AC-16). The item never changes the conversation's status, assignee, waiting marker, unread or attention counts, and triggers no ping. The thread is one keyset-paged read in `conversations` over messages, replies and activity entries (`domain/thread.ts`), served by `inbox`. In the web panel the attention store refetches the count on every `conversation.changed` frame that is not an edit.

## Decision drivers

- AC-16; spec §6 report live update ≤ 3 s (the item appears with the report)
- One owner per table; the thread order is a `conversations` concern
- Nothing in the item may move state, waiting, unread or pings

## Considered options

1. **A new `conversations` table and thread kind `broadcast`.** `broadcast_items` (workspace, id, conversation, broadcast id, state `delivered` / `not_confirmed`, position time, Telegram message id), one per broadcast and conversation. `broadcasts` writes it through `conversations.recordBroadcastItem(tx, …)` in the send's outcome transaction (resolving the contact's conversation), which publishes `conversation.changed` with item type `broadcast` and touches no column of `conversations`. The thread read returns it in position order (after messages, replies and activity entries at the same instant); `inbox` adds name, text and launching owner from `broadcasts.itemDetails(workspaceId, broadcastIds)`. The attention store and the inbox list ignore broadcast items.
2. **`broadcasts` owns the items and `inbox` merges them into the thread.** Keeps the table with its feature, but merging two keyset-paged sources (with one cursor) across modules is fragile and every thread page would query two modules.
3. **Store the broadcast as a reply.** It would appear in the thread for free, but replies have an author, a delivery drain, a waiting-marker effect and resend actions, all wrong for a broadcast (CONTEXT: a broadcast item is not a reply).

## Decision outcome

**Chosen:** Option 1. The thread stays one ordered query in its owner. The item is written in the same transaction as the recipient's outcome, so the report and the thread never disagree. It has its own kind, so no existing rule about messages or replies (unread, waiting, reopen, pings) sees it.

## Consequences

**Positive**
- Answers to a broadcast are ordinary messages after the item, as AC-16 expects.
- A deactivated launching owner is still named: `inbox` resolves the name through `workspaces` display names, which include deactivated members.

**Negative**
- `conversations` gains a table and a foreign key to `broadcasts` (composite, same workspace).
- The web attention store needs a filter, or every broadcast send would refetch the count in every tab (25 per second).

**Neutral**
- The conversation's last activity and the inbox row do not move for a broadcast item, so the list does not reshuffle during a broadcast.

## Links

- Spec: [[../spec.md]] AC-16, §1 ("Answers to a broadcast are ordinary customer messages")
- SAD: [[../sad.md]] §4 choice 10, §6 flow 2
- Related ADR: [[0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report]], contacts ADR-0006
