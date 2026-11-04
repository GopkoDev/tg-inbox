---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: M
---

# Events — group-posts

The async contract for the flows in `sad.md` §6. Derived from the sequences: every frame, signal, job and inbound update here maps to a publish, enqueue or deliver message in a §6 diagram (flows 1–11). It is a **delta** over [shared-inbox `events.md`](../../shared-inbox/contracts/events.md) and [broadcasts `events.md`](../../broadcasts/contracts/events.md); everything not named here is unchanged.

The feature adds:

- **Live socket:** two server → client frames, `post.changed` and `destinations.changed`.
- **Realtime signals:** the same two, published inside the writing transaction (`platform/realtime.ts`).
- **pg-boss:** `posts.send` (one job per post moment, ADR-0004) and its dead letter `posts.send-dlq`.
- **Inbound Telegram updates:** `channel_post` added to `allowed_updates`; group / supergroup / channel `message`, `channel_post` and `my_chat_member` classified by `bots` into four facts for `posts` (ADR-0003).
- **Log events:** `post.timing` and `bots.inbound.classified` counts (sad.md §7).

No frame, signal or job payload carries content: ids and a change kind only. No post text, chat title, username, code or chat id travels on the bus, the socket or the job queue.

## Assumptions (autonomous run 2026-11-03)

1. Both frames go to **every socket of the workspace** (both roles see every post and destination). The hub forwards them like `tags.changed`.
2. One signal per changed post per transaction; a transaction that wrote nothing publishes nothing (`unchanged` answers, refusals).
3. `destinations.changed` also covers the workspace time zone and connect-code results, so the Settings page and the connect dialog re-read on one frame.
4. The `posts.send` payload is `{post_id, workspace_id, moment}`; the job finds everything else. No `singletonKey` — at most once is the post row's claim (ADR-0004).

## Channel: live socket (`GET /api/workspaces/{workspaceId}/inbox/live`) — changed

### Frame: `post.changed` (v1) — server → client, added

```json
{ "type": "post.changed", "workspace_id": "01920000-0000-7000-8000-000000000001", "post_id": "01920000-0000-7000-8000-000000000901" }
```

- **Producer:** `posts` app layer, every write to a post (create, save, duplicate, delete draft, publish, schedule, back to draft, deactivation and destination-removal returns, claim, outcome, delete from Telegram, seen).
- **Consumers:** the Posts list (re-read `listPosts`), an open post (re-read `getPost`), the navigation count (re-read `getPostAttention`).
- **Delivery:** at most once per socket; a reconnect re-reads (shared-inbox gap rule).

### Frame: `destinations.changed` (v1) — server → client, added

```json
{ "type": "destinations.changed", "workspace_id": "01920000-0000-7000-8000-000000000001" }
```

- **Producer:** `posts` — a code created, used or refused; a destination connected, revived, renamed, upgraded, marked available / unavailable, removed; the time zone set.
- **Consumers:** Settings → Channels & groups (`listDestinations`), an open connect dialog (`getDestinationCode`), the editor's destination picker.

## Realtime signals (`platform/realtime.ts` union) — added

| Signal | Payload | Published by |
|---|---|---|
| `post.changed` | `{ workspace_id, post_id }` | `posts`, inside the writing transaction |
| `destinations.changed` | `{ workspace_id }` | `posts`, inside the writing transaction |

Both stay far below `MAX_SIGNAL_BYTES` (1000).

## Queue: `posts.send` — added

| Property | Value |
|---|---|
| Producer | `posts` publish / schedule / change-time transactions (`jobDb(tx)`), and the job itself for "queue again" (an earlier post due in the chat, `next_send_at`, `paused_until`, the bot's send pause) |
| Consumer | `posts` `sendPost` job body (sad.md §6 flow 2, flow 11) |
| Payload | `{ "post_id": uuid, "workspace_id": uuid, "moment": ISO-8601 instant }` |
| Policy | `standard`, no `singletonKey` |
| `startAfter` | the moment (or the wait's end) |
| Retry | `retryLimit: 2`, `retryBackoff: true`, `expireInSeconds: 60` |
| Dead letter | `posts.send-dlq` |
| Idempotency | the post row: the job exits unless the post is `scheduled` for exactly `moment`; it commits `sending` before calling Telegram; an attempt that finds `sending` without an outcome settles `not_confirmed` and never sends |

## Queue: `posts.send-dlq` — added

| Property | Value |
|---|---|
| Consumer | `posts` — settles what a failed job left: a stale `sending` → `not_confirmed` (+ attention); a `scheduled` post whose moment is more than 15 minutes ago → `missed` with `service_down`; otherwise queues a fresh `posts.send` for the same moment |
| Retry | `retryLimit: 0` |

## Inbound Telegram updates — changed (bots)

| Update | Chat types | Classified as | Handed to `posts` |
|---|---|---|---|
| `message` with a `/connect` (or `/connect@<bot>`) command and a `tgp_…` argument | group, supergroup | `destination_code` | `{workspaceId, telegramBotId, chatId, kind, title, username, messageId, code, botStatus?}` |
| `channel_post` whose text contains `tgp_…` | channel | `destination_code` | same |
| `my_chat_member` | group, supergroup, channel | `chat_membership` | `{chatId, kind, title, username, status, canPost, date}` |
| `message` with `migrate_to_chat_id` | group | `chat_migrated` | `{chatId, newChatId}` |
| `message` / `channel_post` with `new_chat_title` | group, supergroup, channel | `chat_renamed` | `{chatId, title}` |
| anything else from those chats | group, supergroup, channel | `ignored` | nothing (one bot lookup, no write) |

The `my_chat_member` handling for private chats (blocked / unblocked, broadcasts) is unchanged. A code's bot rights are checked with the status Telegram reported for the bot in that chat, or a `getChatMember` call for the bot when none is known yet (data-model: the row's `availability`).

## Log events

- `post.timing` — `{post_id, workspace_id, scheduled_for, sending_started_at, accepted_at, outcome}`; no text, no chat id.
- `bots.inbound.classified` — counter per bot and classification (`destination_code`, `chat_membership`, `chat_migrated`, `chat_renamed`, `ignored`).
