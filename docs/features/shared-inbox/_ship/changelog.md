# Changelog — shared-inbox

## shared-inbox — the team reads every customer conversation in one live web inbox and replies through the business's own bot

**What:** The inbox is no longer a sample preview. Operators and business owners of a workspace now work their customers' real Telegram conversations from the web panel.

- **One shared list.** Every conversation the bot captured, newest activity first (a customer message or a reply marked sent). Each row has the contact's name, the last message (non-text shown by kind and caption), how long ago, this member's unread count and a "waiting for a reply" marker. Search by any part of the full name or username (case, spaces and a leading `@` ignored). Owners and operators see and do the same.
- **The thread.** The latest history with the contact in the header; scrolling up loads older items down to the first message. Customer messages and the team's replies sit in the order they happened (a message by its Telegram send time, a reply by when it was (re)sent — ADR-0008). Opening a conversation in a visible tab marks it read for that member only; unread is counted by arrival, so a late redelivery is unread even though it takes its earlier place. Reload, back button and saved links reopen it; a phone-width screen swaps list and thread.
- **Every message kind.** Photos, stickers, videos, voice notes and audio play inline; files download under their name; a location shows its coordinates and opens a map only on click; contacts, polls and unknown kinds are shown as text. Media streams through the panel (never a Telegram link), with a plain-language "content unavailable" reason when the bot is down, the file is over 20 MB or Telegram no longer keeps it.
- **Replies.** Enter sends, Shift+Enter starts a new line, up to 4096 characters. A reply shows "sending", then "sent" — or "not delivered" with its reason (customer blocked the bot, account gone, bot not working, author's access removed, Telegram did not accept it) or "not confirmed" when Telegram's answer never came back. The customer receives the plain text from the business's bot, with no operator name.
- **At most once.** A double press sends one reply; an unknown outcome is never resent automatically — "Send again" warns that the customer may receive it twice. Telegram slow-downs are retried for up to 5 minutes, in order, per conversation. 30 replies per minute per member per workspace.
- **Live for the whole team.** New conversations, messages, edits and teammates' replies appear without reloading, over one socket per tab. If a teammate replied while you were typing, the inbox asks before sending.
- **Bot and access states.** A disconnected or token-less bot keeps every conversation readable and explains why replies are unavailable (owners get the way to the bot settings); a taken-over bot shows that new messages are not arriving. A deactivated member's open inbox stops within 5 seconds and their next action shows the access-removed notice; another workspace's account gets a plain 404.

**Why:** Captured conversations had nowhere to be read or answered — this is roadmap step 4, the core of the product ([spec](../spec.md) §1–§2). Key decisions:

- [ADR-0001](../adr/0001-build-the-inbox-as-api-routes-a-live-socket-and-in-process-delivery-jobs-behind-the-existing-spa.md) / [ADR-0007](../adr/0007-add-an-inbox-module-that-orchestrates-conversations-contacts-bots-and-workspaces.md): a new `inbox` module of API routes, a live socket and in-process delivery jobs, orchestrating `conversations`, `contacts`, `bots` and `workspaces` through their app layers.
- [ADR-0002](../adr/0002-push-change-signals-over-a-per-tab-workspace-bound-websocket-and-refetch-through-the-reads.md) / [ADR-0003](../adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md): id-only change signals published with `pg_notify` inside the writing transaction, fanned out per workspace over a guarded WebSocket; the browser refetches through the normal reads.
- [ADR-0004](../adr/0004-send-replies-at-most-once-through-a-per-conversation-delivery-queue-with-an-in-flight-mark.md): replies go out at most once through a per-conversation pg-boss drain with an in-flight mark on each attempt; the sent time is our clock at acceptance.
- [ADR-0005](../adr/0005-track-read-state-as-a-per-member-arrival-watermark-per-conversation.md): read state is a per-member arrival watermark.
- [ADR-0006](../adr/0006-stream-customer-media-through-a-guarded-api-route-addressed-by-message.md): media streams through a guarded route addressed by message, with forced safe headers.
- [ADR-0008](../adr/0008-store-replies-in-their-own-table-and-page-the-thread-by-position-time.md): replies have their own table; the thread pages by position time.

**How to use:** Open *Inbox* in the panel. The HTTP surface is in [openapi.yaml](../contracts/openapi.yaml), all under `/api/workspaces/:workspaceId/inbox`:

- `GET /conversations` (`?q=`, `?after=`), `GET /conversations/:id`, `GET /conversations/:id/items` (`before` / `after` cursors), single message / reply reads, `POST /conversations/:id/read`.
- `POST /conversations/:id/replies` (`client_key`, `body`, `last_seen_reply_id`, `confirm_teammate_reply`) and `POST …/replies/:replyId/resend` (`confirm_duplicate_risk`).
- `GET /conversations/:id/messages/:messageId/media` (supports `Range`), `GET /bot`.
- `GET /live` — WebSocket; frames per [events.md](../contracts/events.md); close codes 4401 (session ended), 4403 (access removed), 1001 (shutdown).

**Operational notes:**

- **Migrations:** ten reversible migrations, `1791681109983_add_memberships_active_since` … `1791681109992_contract_conversations_list_columns` (expand → backfill → new tables `replies`, `reply_attempts`, `read_marks` → indexes → contract). Run `pnpm db:migrate` on deploy before the new API starts; the two contract migrations make `memberships.active_since` and the conversation list columns `NOT NULL`, so the backfills must run first (they are in the same batch, in order).
- **Jobs:** `buildApp()` creates the pg-boss queues `inbox.deliver-replies` (stately, `singletonKey` = conversation id, retry 3, expire 60 s) and `inbox.deliver-replies-dlq`. A dead-lettered drain is logged with `alert: 'inbox.deliver-replies.dead-letter'` — wire an alert on it.
- **Realtime:** each API instance holds one extra dedicated Postgres connection for `LISTEN realtime` (count it in the database's connection budget). A reverse proxy in front must pass WebSocket `Upgrade` for `/api/workspaces/*/inbox/live` and keep idle timeouts above the 25 s ping.
- **Config:** no new keys; the socket's `Origin` check uses `PUBLIC_WEB_URL`.
- **Feature flag:** none.
- **Rollback:** revert the deploy, then `pnpm db:rollback` ten times. This drops every reply, delivery attempt and read mark (customer messages and contacts stay). Replies still "sending" at that moment are never delivered.
- **Not yet done:** real-bot verification still waits for a public HTTPS host (as in bot-connection); spec §8 keeps two open questions (editing/deleting sent replies; muting a flooding sender).

**Acceptance criteria delivered:** AC-01 – AC-18 and AC-12b — list and search (AC-01, AC-02, AC-18), thread and media (AC-03 – AC-05), replies and validation (AC-06, AC-07, AC-17), delivery outcomes and at-most-once (AC-10 – AC-12b), bot states (AC-13, AC-14), live team updates and collision warning (AC-15, AC-16), access control (AC-08, AC-09).
