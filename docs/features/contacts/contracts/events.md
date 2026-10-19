---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: M
---

# Events — contacts

This is the async contract for the flows drawn in `sad.md` §6. It is **derived** from the sequences: every frame and signal here maps to a publish or push message in a §6 diagram (seeded flows 1 and 2, flows 8, 9, 10, 11, 13). It is a **delta** over [shared-inbox `events.md`](../../shared-inbox/contracts/events.md), [assignment-statuses `events.md`](../../assignment-statuses/contracts/events.md) and [operator-notifications `events.md`](../../operator-notifications/contracts/events.md). Every channel, frame, close code and signal not named here is unchanged and stays defined there.

The feature adds ([ADR-0007](../adr/0007-signal-tag-changes-as-contact-changed-per-contact-and-tags-changed-per-workspace.md)):

- **Live socket:** two server → client frames, `contact.changed` (one contact's tags) and `tags.changed` (the workspace's tag list), delivered to every socket of the workspace. Existing frames get new consumers (the contact profile).
- **Realtime signals:** the same two, `contact.changed { workspace_id, contact_id, change }` and `tags.changed { workspace_id }`, published inside the writing transaction.
- **pg-boss:** nothing. Every write runs inside its request transaction and no job is needed (sad.md §4, §7).
- **Inbound Telegram updates:** the contract of bot-connection's `receiveTelegramUpdate` is unchanged. Capture now also keeps the contact's first and last send time (flow 14, ADR-0005); that publishes nothing new.

As before, no frame or signal carries a name: ids and a change kind only. No tag name, contact name or username ever travels on the bus or the socket (sad.md §8 *Logging*, *Events*).

## Assumptions (autonomous run 2026-10-19)

Each can be vetoed at review.

1. **Both frames go to every socket of the workspace.** Neither is account-scoped: any member may have the contact's header or profile, a picker or a filter open (flow 11). The hub forwards them like `bot.changed`.
2. **`contact.changed` carries `change: "tags"` only in v1.** The field exists so a later contact change (for example a profile refresh) can be added without a new frame type. A new value is additive; a client ignores a value it does not know. A captured new Telegram name is **not** signalled here: the open profile learns it from `conversation.changed` for the contact's conversation (sad.md §6 assumption, flow 7).
3. **A member's add that also created the tag publishes both signals**, `contact.changed` for the contact and `tags.changed` for the workspace, in that order, in the same transaction (flow 9).
4. **Owner operations publish exactly one `tags.changed`** per rename, merge or delete, however many contacts the tag was on, and no `contact.changed` (ADR-0007). A rename to the same text publishes nothing. A refused request publishes nothing, because signals exist only if their transaction commits.
5. **`tag.merged` is a structured log event, not a bus event.** It feeds the spec §7 look-alike KPI (sad.md §7 *Alerts*) and has no subscriber. It is listed below so the KPI's source is in the contract.

## Channel: live socket (`GET /api/workspaces/{workspaceId}/inbox/live`) — changed

The producer, the opener (the workspace frame on every page, operator-notifications ADR-0002), the heartbeat, the re-check, the at-most-once delivery, the `presence` client frame and the close codes are unchanged. Changed: the two server → client frames below.

### Frame: `contact.changed` (v1) — server → client, added

```json
{
  "type": "contact.changed",
  "v": 1,
  "workspace_id": "<uuid — contacts.workspace_id>",
  "contact_id": "<uuid — contacts.id>",
  "change": "tags"
}
```

- **Required fields:** `type`, `v`, `workspace_id`, `contact_id`, `change` (`"tags"`).
- **Delivered to:** every socket of `workspace_id`.
- **Origin:** seeded flow 1 "publish contact changed … commit", "contact changed frame with ids only"; flow 8 "contact changed for K, published with the write"; flow 9; flow 10; flow 11 "frame with the workspace and contact ids only, to every socket of W".
- **Panel reaction** (flow 11):
  - drop a frame of another workspace; ignore other contacts;
  - the inbox conversation header (SCR-02) whose `ConversationSummary.contact.id` is `contact_id` re-reads `getContact` and shows the tags in place;
  - the contact profile (SCR-19) of `contact_id` re-reads `getContact` and `listContactTagHistory` from the top;
  - an open tag control (SCR-20) on that contact re-renders from the re-read tags.
  - The Contacts list (SCR-18) and Settings — Tags (SCR-21) ignore it: they are not live (spec §1).

### Frame: `tags.changed` (v1) — server → client, added

```json
{ "type": "tags.changed", "v": 1, "workspace_id": "<uuid — tags.workspace_id>" }
```

- **Required fields:** `type`, `v`, `workspace_id`.
- **Delivered to:** every socket of `workspace_id`.
- **Origin:** seeded flow 1 "publish contact changed and tags changed"; seeded flow 2 "delete Loyal, publish tags changed", "tags changed frame to every open tab of the workspace"; flow 9 "tags changed for W when a tag was created"; flow 13 "tags changed for W, published with the write"; flow 11.
- **Panel reaction** (flow 11):
  - the tag store re-reads `listTags`, so an open picker learns a new tag, a renamed tag shows its new name and a merged or deleted tag disappears (AC-06, AC-09, AC-14);
  - every open header and profile re-reads `getContact` of its own contact (and, on a profile, `listContactTagHistory`), so a merge or delete shows without reloading (AC-09);
  - the Contacts list filter re-labels its chosen tags from the re-read tag list; the list itself is not re-queried (not live).
  - Settings — Tags ignores it (refreshes when opened).

### Existing frames — new consumers

| Frame | New consumer | Re-reads | Spec |
|---|---|---|---|
| `conversation.changed` (any change) for the profile's conversation | contact profile (SCR-19) | `getContactConversation` (status, assignee, waiting marker), the new thread items through `listThreadItems`, and `getContact` (a captured new Telegram name). **Never** `markConversationRead` (ADR-0006) | AC-04, AC-05, AC-13 |
| `resync` | contact profile, conversation-header tags, tag store | `getContact`, `listContactTagHistory`, `getContactConversation`, `listTags` | AC-05, AC-06 |
| `membership.deactivated` (close `4403`) | unchanged | — the access-removed landing | AC-12 |

- **Old bundles:** a tab opened before the deploy parses `LiveFrame` without `contact.changed` / `tags.changed`, so the frames fail `safeParse` and are ignored (the existing "unknown → ignore" rule, `onInvalidFrame`). Such a tab shows a teammate's tag change only after its next read; accepted for the deploy window (sad.md §11).

## Channel: realtime signals (Postgres `NOTIFY realtime`) — added signals

Delivery (at-most-once, gap → `resync`), the 1000-byte cap and zod validation in `apps/api/src/platform/realtime.ts` are unchanged.

| Signal | Payload | Dispatched to | Producers (all inside the writing transaction) | Origin (sad.md §6) |
|---|---|---|---|---|
| `contact.changed` v1 | `workspace_id`, `contact_id`, `change: "tags"` | every socket of `workspace_id`, as the frame above | **`addContactTag`** with `outcome: recorded`; **`removeContactTag`** with `outcome: recorded` | seeded flow 1; flows 8, 9, 10, 11 |
| `tags.changed` v1 | `workspace_id` | every socket of `workspace_id`, as the frame above | **`addContactTag`** when `tag_created: true`; **`renameTag`** with `outcome: renamed` or `merged`; **`deleteTag`** on success | seeded flows 1, 2; flows 9, 11, 13 |
| `conversation.changed`, `bot.changed`, `membership.deactivated`, `telegram_link.changed` | unchanged | unchanged | unchanged | — |

- **Not signalled:** an `unchanged` add or remove, a same-text rename, and every refusal (`TAG_NAME_INVALID`, `TAG_LIMIT_REACHED`, `CONTACT_TAG_LIMIT_REACHED`, `TAG_NOT_FOUND`, `TAG_NAME_TAKEN`, `TAG_MERGE_TARGET_CHANGED`, `TAG_COUNT_CHANGED`, `TAG_CHANGE_LIMIT_REACHED`, `OWNER_ONLY`). The transaction rolls back or writes nothing, so nothing is published.
- **Size:** at most two ids and a short string, well under the cap.

## Log event: `tag.merged` (structured log, not on the bus)

```json
{
  "event": "tag.merged",
  "workspace_id": "<uuid>",
  "merged_tag_id": "<uuid — the tag merged away>",
  "target_tag_id": "<uuid — the tag it went into>",
  "actor_account_id": "<uuid>"
}
```

- **Producer:** `renameTag` with `outcome: merged`, after the commit, including merges of a tag no contact carried (those write no history entry).
- **Consumer:** none at runtime. The run-book query for the spec §7 KPI "look-alike tag merges" (alert when an owner merges more than 5 tags in 7 days) counts these lines (sad.md §7).
- Ids only, never a tag name.

## Idempotency & retry

- **Socket frames:** at-most-once. A lost `contact.changed` or `tags.changed` costs a refetch on the next frame, `resync` or reload; no frame carries state, so a repeat is harmless.
- **Signals:** exist only if their transaction committed.
- **HTTP writes:** idempotent by state, so a retried request never double-records: an add of a carried tag and a remove of a tag no longer carried answer `unchanged`; a rename to the current text answers `unchanged`; a repeated delete answers `TAG_NOT_FOUND`. No `Idempotency-Key` (api-sync-report.md *Deviations*).
- **Retry / dead-letter:** none — no job or queue.

## Schema registry

- Socket frames: `LiveFrame` in `packages/shared/src/inbox.ts` gains `ContactChangedFrame` (`change: z.enum(['tags'])`) and `TagsChangedFrame`, both non-strict like the existing frames.
- Signals: `realtimeSignalSchema` in `apps/api/src/platform/realtime.ts` gains `contact.changed` and `tags.changed`. The hub (`modules/inbox/infra/hub.ts`) maps each to its frame for every socket of the workspace.
- The publisher: `modules/contacts/infra/tag-signals.ts` (sad.md §5), called inside the tag write transactions.
- Validator: zod 4.
