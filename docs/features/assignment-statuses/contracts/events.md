---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: M
---

# Events — assignment-statuses

This is the async contract for the flows drawn in `sad.md` §6, **derived** from the sequences. It is a **delta** over [shared-inbox `events.md`](../../shared-inbox/contracts/events.md): every channel, frame, close code, signal and queue not named here is unchanged and stays defined there.

The feature adds **no** new channel, frame type, signal type, queue or job ([ADR-0007](../adr/0007-signal-assignment-and-status-changes-as-activity-items-on-conversation-changed.md); sad.md §7 "No queue … is added"). Reopen and unassign run inside transactions that already exist (capture, `settle()`, deactivation — [ADR-0004](../adr/0004-reopen-closed-conversations-inside-the-capture-and-reply-outcome-transactions.md), [ADR-0005](../adr/0005-unassign-on-deactivation-through-a-workspaces-port-called-inside-the-deactivation-transaction.md)). The one change is:

- **`conversation.changed` gains the item type `activity`** (change `created`), on the live socket frame and on the `NOTIFY realtime` signal. Every recorded assignee or status change is exactly one new activity entry and exactly one such signal, published inside the writing transaction.

As before, no payload ever carries a name, a message or reply text, or a token: ids, kinds and times only (sad.md §8 *Logging*, *Events*).

## Channel: live socket (`GET /api/workspaces/{workspaceId}/inbox/live`) — changed frame

Producer, consumers, delivery (at-most-once, best effort), ordering (none), heartbeat and close codes are unchanged (shared-inbox events.md).

### Frame: `conversation.changed` (v1) — `item.type` gains `activity`

```json
{
  "type": "conversation.changed",
  "v": 1,
  "workspace_id": "<uuid — conversations.workspace_id>",
  "conversation_id": "<uuid — conversations.id>",
  "item": {
    "type": "message | reply | activity",
    "id": "<uuid — messages.id | replies.id | conversation_activities.id>"
  },
  "change": "created | edited | state | read"
}
```

- **Delta:** `item.type` enum `message | reply` → `message | reply | activity`. With `activity`, `change` is always `created` (activity entries are immutable — data-model `conversation_activities`). Still `v: 1`: the change is additive under the shared-inbox policy (a new enum value, no field removed or renamed).
- **Required fields:** unchanged. `item` is non-null for `activity`.
- **Origin:** sad.md §6 flow 1 "signal activity item created, inside the transaction"; flows 5, 6, 7, 8 "activity item created signal, published with the write"; flow 9 "message created and activity item created signals"; flow 10 "reply state changed and activity item created signals"; flow 12 "one activity item signal per conversation"; flow 13 (the consumer side). §8 *Events*.
- **Panel reaction** (rows added to the shared-inbox table; flow 13):

| `change` | `item.type` | Panel re-reads | Then | Spec |
|---|---|---|---|---|
| `created` | `activity` | `getConversation` (now a `ConversationSummary`: status, assignee, `state_version`, `close_snapshot`) and, if this conversation's thread is open, `getThreadActivity` | Re-evaluate whether the row belongs to the current lenses (only the assignee lens while a search is present) → insert, update or drop the row; an open thread stays open with the new header, version and close snapshot, and the line appears. Unread counts are not touched | AC-01, AC-02, AC-05, AC-07, AC-08, AC-09, AC-10 |
| `created` / `state` | `message` / `reply` (unchanged rows) | as in shared-inbox, plus: the `getConversation` answer now refreshes `state_version` and `close_snapshot` too | A new customer message or a reply state change alters the close snapshot, so the next close echoes the new one | AC-06, AC-08 |

- **Idempotency (client):** the panel ignores a frame of another workspace and an activity id it already shows (flow 13). Refetches of one conversation triggered by frames from the same transaction are coalesced (ADR-0007 *Neutral*):
  - a customer reopen publishes `created`/`message` **and** `created`/`activity` (flow 9);
  - a failed-reply reopen publishes `state`/`reply` **and** `created`/`activity` (flow 10).
- **Old bundles:** a tab opened before the deploy parses `LiveFrame` with the old `item.type` enum, so an `activity` frame fails `safeParse` and is ignored (the existing "unknown → ignore" rule in `packages/shared/src/inbox.ts`). It shows the change on its next resync or reload; its next change request is answered `CONVERSATION_STATE_CHANGED` / `CLOSE_NEEDS_CONFIRMATION` with the current state, the safe direction (sad.md §11). `tasks` verifies the frame is dropped without breaking the socket.

## Channel: realtime signals (Postgres `NOTIFY realtime`) — changed signal

Delivery (at-most-once, gap → `resync`), ordering, the 1000-byte cap (`MAX_SIGNAL_BYTES`) and zod validation in `apps/api/src/platform/realtime.ts` are unchanged.

| Signal | Payload delta | Dispatched to | Producers added by this feature (all inside the writing transaction) | Origin (sad.md §6) |
|---|---|---|---|---|
| `conversation.changed` v1 | `item.type` may be `activity` (with `change: created`, no `account_id`) | every socket of `workspace_id` (as for `message` / `reply`) | `conversations` change use cases (`changeAssignee`, `changeStatus` — member assign, reassign, unassign, close, reopen); `captureInbound` reopen (`customer_wrote`); `settle()` reopen (`reply_not_delivered`) — reached from `finishAttempt`, `skipReply`, `resolveStaleInFlight` and the dead-letter handler; `unassignDeactivatedMember` (`member_deactivated`), called through the `onMembershipDeactivated` port inside `workspaces.deactivateMembership` | flows 1, 2, 3, 5–10, 12 |
| `membership.deactivated` v1 | none | unchanged (closes that account's sockets with `4403`) | unchanged; now published in the same transaction as the per-conversation unassign signals | flows 3, 12 |
| `bot.changed` v1 | none | unchanged | — | — |

- **Volume:** one `conversation.changed`/`activity` per recorded change. A deactivation publishes one per conversation assigned to the member, then `membership.deactivated`, all in one transaction (fine at pilot scale; past a few thousand assignments, sad.md §7 switches to one workspace-level `resync`).
- **Size:** an `activity` signal is the same few hundred bytes of ids as a `reply` signal.
- **Not counted:** automatic signals carry no actor; they say nothing about the change limit, which is counted from `conversation_activities` (AC-12).

## Channel: pg-boss — unchanged

No queue or job is added. `inbox.deliver-replies` and `inbox.deliver-replies-dlq` keep their shared-inbox contract. Their outcome writes now pass `settle()`, which may also reopen a closed conversation in the same transaction and publish the `activity` signal above (flow 10). The drain's idempotency rule ("a reply that already has its final state never settles twice") keeps that reopen single.

Inbound Telegram updates stay bot-connection's `receiveTelegramUpdate`. A captured new customer message may now reopen in the capture transaction (flow 9); a duplicate redelivery or an edit never does. Telegram's own redelivery of an unacknowledged update is the retry, and the message's unique key keeps the reopen single.

## Idempotency & retry

- **Socket frames:** at-most-once; a lost frame costs a refetch, never data. Retry = reconnect + resync of the first list page in the current lenses and the open summary (flow 13).
- **Signals:** exist only if their transaction committed, so a refused or unchanged change publishes nothing.
- **Dead-letter:** none of its own. An unparseable frame is dropped and the tab resyncs (flow 13 dead-letter branch).

## Schema registry

- Socket frames: `LiveFrame` / `ConversationChangedFrame` in `packages/shared/src/inbox.ts` — the `item.type` enum gains `'activity'`.
- Signals: `realtimeSignalSchema` in `apps/api/src/platform/realtime.ts` — the `item.type` enum gains `'activity'`; the `superRefine` rule (item null only for `read`) is unchanged.
- Hub mapping (`modules/inbox/infra/hub.ts`): forwards the new item type unchanged.
- Validator: zod 4.
