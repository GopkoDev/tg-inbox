---
status: draft
feature_size: "M"
tool: "code"
updated_at: "2026-10-18"
---

# Screens — shared-inbox

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`) — inline wireframes below, one per state that needs a distinct layout.
- **File:** inline wireframes below.
- **Inventory:** SCR ids from [`ux-flows.md`](ux-flows.md) §Screen inventory (SCR-01…SCR-09, all covered). SCR-01/02 are the ui-redesign inbox preview (ui-redesign `screens.md` §SCR-08) switched to real data; SCR-03/04/05 are new; SCR-06…SCR-09 are existing screens this feature only routes to.
- **Component names:** names from the canon inventory (`AppShell`, `NotFoundCard`, `Card`, `Button`, `Input`, `Textarea`, `Alert`, `Badge`, `AlertDialog`, `Dialog`, `Avatar`, `ScrollArea`, `Skeleton`, `AuthLayout`, `SettingsLayout`, `Field`, `Label`, `ConversationList`, `MessageBubble`, `ReplyComposer`, `EmptyFilterState`); `extended: <name>` = an existing inventory component that gains states (its canon row is updated, not duplicated); `NEW: <name>` = a reusable part listed under §New components. No primitive from the canon's *Not yet in the repo* list is needed (no toast: every outcome is shown in place).
- **Sources per row:** spec §5 ACs, sad.md §6 flows (`flow N`), contract responses (`openapi.yaml` `operationId` + status/code) and live frames / close codes (`contracts/events.md`). Every non-default state names at least one.
- **Copy:** existing texts stay word for word (`Inbox`, `Search conversations`, `No conversations match`, `Clear search`, `Pick a conversation to see it here`, `Back to conversations`, `Write a reply…`, `Send`, `Replies are limited to 4096 characters`); new texts are quoted below and may be polished in `implement` without changing their meaning. Error messages from the contract (`error.message`) are shown as given where quoted. Every customer- or member-supplied string (names, message text, captions, file names, venue, poll) renders as plain text (spec §6.1).
- **Removed by this feature:** the `SampleDataBadge` on the Inbox title row (AC-01) and the composer note «Preview — nothing is sent to customers» (AC-06). `sample-source.ts` is replaced by the API source (sad.md §5).
- **Decisions taken at this stage** (the contract and the SAD leave them to `screens`; recorded here, not elsewhere):
  1. **Try again is offered only for** `telegram_not_accepted` (AC-12) and `delivery_interrupted` (flow 9, pending api-sync-report OQ-2). The other `not_delivered` reasons show the reason without a button: a blocked or gone customer fails again until they write (AC-10); a broken bot is fixed in the bot settings (AC-13); a removed author's reply must not be sent (AC-09). The server still accepts Try again for every reason (`resendReply`).
  2. **The composer is not optimistic.** On Enter the composer locks (Send shows a spinner) while `sendReply` is in flight; on `201`/`200` the reply is appended as «Sending» and the box clears; on any refusal the text simply stays. The `201` comes back before Telegram is called (flow 1), so the reply still «appears at once» (AC-06), and no refused text ever has to be restored (AC-07, AC-12b, AC-16).
  3. **Stickers by type:** `image/webp` → shown as an image; `video/webm` → a muted looping video; animated `.tgs` (`application/x-tgsticker`) or no type → the kind label «Sticker» (+ caption). The contract carries no thumbnail, so no static frame is drawn (sad.md §11 risk «animated stickers» — decided here). `animation` plays as a muted looping video, `video_note` as a round video, `dice` shows the kind label «Dice».
  4. **Both confirmations are `AlertDialog`s** — the canon's confirmation flavour of the shadcn Dialog sad.md §4 names: an explicit choice is needed and a click outside does not dismiss. No architecture change.
  5. **The "not receiving" notice above the list is shown only for `taken_over`** (`receiving: false`, `can_reply: true` — contract `InboxBotStatus`); `not_connected` / `needs_token` surface in the reply area of SCR-02 and in the empty inbox (ux-flows Flow US-07).

## Screens

**Shared inbox states (SCR-01, SCR-02, SCR-03, SCR-04, SCR-05).** Handled once — in the API client, the realtime client (`shared/api/realtime.ts`) and the workspace-keyed store — not per screen. Each screen below lists them as one row pointing here.

| Trigger | What the panel does | Source |
|---|---|---|
| `401 UNAUTHENTICATED` on any inbox request | inherited: workspace-operators `screens.md` §Shared guard states — sign-in, state `session-ended`, return to this address after sign-in (SCR-09) | AC-08; flow 4, flow 5 |
| `403 ACCESS_REMOVED` on any inbox request | inherited: §Shared guard states — that workspace's inbox data is cleared at once, landing on SCR-07 with the access-removed notice | AC-08, AC-09; flow 4, flow 5 |
| `404 NOT_FOUND` from the workspace guard | inherited: §Shared guard states — SCR-06 in place | AC-08 |
| socket close `4403` | no reconnect; live updates stop, the screen stays as shown; the next request the member triggers (open, scroll, send, media) gets `403` → the row above | AC-09; flow 2; events.md close codes |
| socket close `4401` | no reconnect; the next request gets `401` → sign-in | AC-08; events.md close codes |
| socket close `1001`, network drop, `resync` frame | no visible state; reconnect with backoff, then re-read the first list page, the open thread's latest page and the bot status | AC-15; events.md `resync`, close codes; ADR-0003 |
| a response or frame tagged with another `workspace_id` | dropped, nothing drawn | AC-09, AC-18; flow 4 |
| workspace switched in this tab | the store resets and the socket closes **before** anything renders; SCR-01 starts in `loading` for the new workspace — the old workspace's rows are never shown, not even for a frame; other tabs are untouched | AC-09; flow 2 |
| `bot.changed` frame | re-read `getInboxBotStatus`; the SCR-01 notice and the SCR-02 reply area switch without a reload | AC-13, AC-14; flow 8 |

### SCR-01 — Inbox — conversation list

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default (desktop ≥ md) | `/w/<id>/inbox`, ≥ 1 conversation — title row «Inbox» (no Sample data label); one full-height `Card` with two panes: left = search `Input` «Search conversations» + the list; right = «Pick a conversation to see it here». Each row: `Avatar` (initials), contact full name, «how long ago» from `last_activity_at`, last item — a message by its kind and caption («Photo · new bouquet?», text as is), a team reply with a reply icon (lucide `CornerUpLeft`) before its text; unread count `Badge` when > 0; «Waiting for a reply» marker when `waiting_for_reply`; newest activity first (AC-01) | Card, Input, extended: ConversationList (Avatar, Badge), ScrollArea | wireframe «list desktop» |
| selected | a conversation is open — its row is highlighted (`aria-current`) and its unread count drops to 0 once read (AC-03) | extended: ConversationList | wireframe «list desktop» |
| loading | first page in flight (open, reload, workspace switch, reconnect without rows yet) — 6 skeleton rows in the list pane, the search disabled; nothing of another workspace (AC-09) | Skeleton | wireframe «list loading» |
| loading more | scrolled to the end while `has_next` — 2 skeleton rows under the list, next page by `next_cursor` (`listConversations`) | Skeleton | — |
| live: activity | `conversation.changed` (`created`/`message`, or `state`/`reply` turning «sent») — the row is re-read (`getConversation`), moves to the top, its unread count grows for a customer message; a new customer's first message adds a row at the top; an edit or a reply still sending / failed does not move it (AC-01, AC-15) | extended: ConversationList | — |
| live: read elsewhere | `read` frame from this member's other tab — the row's unread count updates (AC-03) | extended: ConversationList | — |
| filtered | search text typed — the request is sent with `q` (trimmed, one leading `@` dropped server-side); while it is in flight the previous rows stay (no skeleton flash); then only matching conversations (AC-02) | Input, extended: ConversationList | — |
| empty: no match | `q` set and `items` empty — «No conversations match» + **Clear search** (resets the field and the list) (AC-02) | extended: EmptyFilterState (action label «Clear search») | wireframe «list empty states» |
| empty: no conversations | no `q`, `items` empty, bot `connected` or `taken_over` — «No conversations yet. They appear here when customers write to your bot.» (AC-02) | Card | wireframe «list empty states» |
| empty: no bot, business owner | `items` empty, bot `not_connected` or `needs_token`, role owner — the sentence above + «Connect the bot to start receiving messages.» + **Open bot settings** → SCR-08 (AC-02, AC-13) | Card, Button | wireframe «list empty states» |
| empty: no bot, operator | `items` empty, bot `not_connected` or `needs_token`, role operator — the first sentence + «Ask a business owner to connect the bot.» — no link (AC-02; AC-13 role split) | Card | — |
| notice: not receiving | `getInboxBotStatus` → `taken_over` — warning `Alert` above the search, for every member: «New customer messages are not arriving in tg-inbox. Another service took over the bot's messages.» Owner: + **Open bot settings** → SCR-08; operator: «Ask a business owner to reconnect the bot.» The list stays usable (AC-14; flow 8) | Alert, Button (`link`) | wireframe «list desktop» (notice) |
| notice gone | `bot.changed` → `connected` — the notice disappears without a reload (AC-13; flow 8) | — | — |
| error | first page failed (network / `500`) — in the list pane: «Something went wrong» + **Retry** (re-reads the first page) | Alert (destructive), Button | wireframe «list empty states» |
| error: loading more | next page failed — under the list: «Couldn't load more conversations» + **Retry** | Alert (destructive), Button | — |
| validation | N/A: the only input is the search; the `Input` caps at 200 characters (`maxLength`), so `listConversations` `400` (`q` maxLength 200) cannot be produced | — | — |
| phone: list (< md) | the list pane fills the body (no right pane); picking a row replaces it with SCR-02 (AC-03) | extended: ConversationList | wireframe «list phone» |
| guard / live states | → §Shared inbox states | — | §Shared inbox states |

```text
list desktop (owner, bot taken over, Olena's thread open → SCR-02 fills the right pane)
+----------------------------------------------------------------------------+
| Inbox                                                                      |
| +-------------------------+----------------------------------------------+ |
| | ⚠ New customer messages | Pick a conversation to see it here           | |
| |   are not arriving in   |    (or SCR-02 when one is open)              | |
| |   tg-inbox. Another     |                                              | |
| |   service took over the |                                              | |
| |   bot's messages.       |                                              | |
| |   Open bot settings     |                                              | |
| |-------------------------|                                              | |
| | [ Search conversations ]|                                              | |
| |-------------------------|                                              | |
| |▌(OK) Olena Kravets  2m  |                                              | |
| |▌ Photo · new bouquet? ② |                                              | |
| |▌ ● Waiting for a reply  |                                              | |
| | (MB) Maks Bondar    1h  |                                              | |
| |  ↩ Delivery on Saturday…|                                              | |
| | (IS) Iryna S.      Yest.|                                              | |
| |  Thanks, got it!        |                                              | |
| +-------------------------+----------------------------------------------+ |
+----------------------------------------------------------------------------+

list loading                         list phone
+-------------------------+          +--------------------------------+
| [ Search conversations ]|          | Inbox                          |
|-------------------------|          | [ Search conversations       ] |
| (░░) ░░░░░░░░░░   ░░    |          | (OK) Olena Kravets          2m |
|      ░░░░░░░░░░░░░░     |          |  Photo · new bouquet?       ②  |
| (░░) ░░░░░░░░░░   ░░    |          |  ● Waiting for a reply         |
|      ░░░░░░░░░░░░░░     |          | (MB) Maks Bondar            1h |
| …                       |          |  ↩ Delivery on Saturday…       |
+-------------------------+          +--------------------------------+

list empty states (in the list pane)
+-------------------------------+ +-------------------------------+ +-------------------------------+
| No conversations match        | | No conversations yet. They    | | No conversations yet. They    |
|        [Clear search]         | | appear here when customers    | | appear here when customers    |
+-------------------------------+ | write to your bot.            | | write to your bot.            |
  empty: no match                 | Connect the bot to start      | +-------------------------------+
                                  | receiving messages.           |   empty: no conversations
+-------------------------------+ |    [Open bot settings]        |
| ✕ Something went wrong        | +-------------------------------+
|           [Retry]             |   empty: no bot, business owner
+-------------------------------+
  error
```

### SCR-02 — Inbox — conversation thread

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `/w/<id>/inbox/<conversationId>` — right pane: header (`Avatar`, contact full name, `@username` when present); the latest page of the history oldest-first, customer messages left, team replies right, each with its time; customer message = `MessageBubble` inbound with its content by kind; reply = `MessageBubble` outbound with the author's display name above the text and its delivery state under it; the composer at the bottom. Opening it in a visible tab marks read through the page's `read_through_at` for this member only (AC-03; flow 5) | extended: MessageBubble, NEW: MessageContent, NEW: ReplyDeliveryState, extended: ReplyComposer, Avatar, ScrollArea | wireframe «thread desktop» |
| loading | `getConversation` + latest `listThreadItems` page in flight (open, reload, back, saved link) — header skeleton + 4 alternating bubble skeletons; composer disabled | Skeleton | wireframe «thread loading» |
| loading older | scrolled to the top while `has_prev` — a skeleton bubble above the oldest item; the page before `prev_cursor` is added above, the scroll position stays on the item the member was reading (AC-03; flow 5 loop) | Skeleton | — |
| start of history | `has_prev` false — nothing more loads; the first message is at the top (AC-03) | — | — |
| error: older history | the older page failed — at the top: «Couldn't load earlier messages» + **Retry** | Alert (destructive), Button | — |
| error | summary or latest page failed (network / `500`) — in the thread pane: «Something went wrong» + **Retry**; the list stays usable | Alert (destructive), Button | — |
| not found | `getConversation` / `listThreadItems` `404` (unknown id, or another workspace's) → SCR-06 in the frame, no hint it exists (AC-03, AC-08; flow 5) | NotFoundCard | — |
| background tab | the tab is hidden — nothing is marked read (no visible change); on becoming visible, read is marked through the newest arrival shown (AC-15; flow 2) | — | — |
| live: customer message | `created`/`message` for this conversation — the message is re-read (`getThreadMessage`) and placed by `sent_at`; marked read if the tab is visible; the view follows it only if the member was already at the bottom (AC-15; flow 2) | extended: MessageBubble, NEW: MessageContent | — |
| live: late redelivery | a `created`/`message` whose `sent_at` is older than shown items — inserted at its place in the history (not at the end); counted unread by arrival like any new message (AC-15; flow 10) | extended: MessageBubble | — |
| live: edited | `edited`/`message` — the bubble shows the new text with «edited» next to its time; unread unchanged (AC-15; flow 10) | extended: MessageBubble | wireframe «thread desktop» (edited) |
| live: teammate reply | `created`/`reply` by another member — appended with their name and delivery state; later state changes follow (`state`/`reply`) (AC-15) | extended: MessageBubble, NEW: ReplyDeliveryState | — |
| content: photo / sticker / video / animation / video note | shown in the bubble, fetched through `openMessageMedia` with the API client (never a Telegram address); photo and video open SCR-03 on click; sticker per Decision 3; caption under it (AC-04) | NEW: MessageContent | wireframe «content kinds» |
| content: voice / audio | inline audio player (play, pause, seek — `Range` forwarded); caption under it (AC-04) | NEW: MessageContent | wireframe «content kinds» |
| content: file | file row: icon, captured file name (or «File»), size; **Download** saves it under that name (`Content-Disposition: attachment`) (AC-04) | NEW: MessageContent, Button (`outline`, sm) | wireframe «content kinds» |
| content: location / venue | «Location» + coordinates (venue: its title and address first) + **Open in map** — an external link built from the coordinates, `target="_blank" rel="noopener noreferrer"`; no map image, nothing is loaded from a map service until the click (AC-04) | NEW: MessageContent, Button (`link`) | wireframe «content kinds» |
| content: contact / poll / dice | contact: «Contact» + name + phone; poll: «Poll» + question + options as a plain list; dice: «Dice» (AC-04) | NEW: MessageContent | wireframe «content kinds» |
| content: unsupported | kind `other` — «Unsupported message — tg-inbox cannot show this kind yet» (AC-04) | NEW: MessageContent | wireframe «content kinds» |
| content: loading | media bytes in flight — a skeleton block the size of the media (image/video), or the player/file row disabled | Skeleton, NEW: MessageContent | — |
| content: unavailable | `openMessageMedia` `409 MEDIA_UNAVAILABLE` — the kind and caption + «Content unavailable — » and the reason by `details.reason`: `bot_not_connected` «the bot is disconnected», `bot_not_working` «the bot is not working — it needs a new token», `file_too_large` «the file is too large to open in tg-inbox», `file_gone` «Telegram no longer keeps this file»; the rest of the thread stays readable (AC-05; flow 3) | NEW: MessageContent | wireframe «content kinds» |
| content: Telegram not responding | `openMessageMedia` `503 TELEGRAM_UNAVAILABLE` (or `416` on a seek) — «Telegram is not responding — try again» + **Try again** on that message only (contract `TelegramUnavailable`) | NEW: MessageContent, Button (`outline`, sm) | — |
| reply: sending | `state: sending` — «Sending» with a clock icon; also while Telegram is retried for up to 5 minutes, and while an earlier reply of this conversation is still sending (AC-06, AC-12; flow 1, flow 9) | NEW: ReplyDeliveryState | wireframe «delivery states» |
| reply: sent | `state: sent` — «Sent» with a check icon; the list row moves to the top and its «Waiting for a reply» marker goes (AC-06) | NEW: ReplyDeliveryState | wireframe «delivery states» |
| reply: not delivered — customer | `failure_reason` `customer_blocked` → «Not delivered — the customer blocked the bot»; `customer_account_gone` / `chat_not_found` → «Not delivered — the customer's Telegram account no longer exists»; then the hint «They can be reached again only after they unblock the bot and write to it» (blocked) — no button; the waiting marker stays; the composer stays usable (AC-10) | NEW: ReplyDeliveryState | wireframe «delivery states» |
| reply: not delivered — bot | `bot_not_working` → «Not delivered — the bot is not working» — no button (AC-13; flow 9) | NEW: ReplyDeliveryState | — |
| reply: not delivered — author removed | `author_access_removed` → «Not delivered — the author's access was removed» — no button (AC-09; flow 9) | NEW: ReplyDeliveryState | — |
| reply: not delivered — try again | `telegram_not_accepted` → «Not delivered — Telegram did not accept it» + **Try again**; `delivery_interrupted` → «Not delivered — sending was interrupted» + **Try again** (Decision 1) (AC-12; flow 7, flow 9) | NEW: ReplyDeliveryState, Button (`outline`, xs) | wireframe «delivery states» |
| reply: not confirmed | `state: not_confirmed` — «Not confirmed — it may or may not have reached the customer» + **Send again** → SCR-05; never resent on its own (AC-11; flow 1, flow 9) | NEW: ReplyDeliveryState, Button (`outline`, xs) | wireframe «delivery states» |
| reply: bot taken over | while the bot is `taken_over`, every reply's state line also shows «New customer messages are not arriving» (with a warning icon) next to its delivery state (AC-14; flow 8) | NEW: ReplyDeliveryState | wireframe «delivery states» |
| reply: resending | **Try again** pressed — the button is disabled with a spinner while `resendReply` is in flight; on `200` the reply moves to the end of the thread at its new time as «Sending» (AC-12; flow 7) | NEW: ReplyDeliveryState, Button | — |
| reply: resend refused | `resendReply` `409 REPLY_NOT_RESENDABLE` → the reply is redrawn from `details.reply` (someone already resent it), no message; `429 REPLY_LIMIT_REACHED` → under that reply «Replies are limited to 30 per minute — you can send again in N seconds», the reply keeps its state; `409 BOT_CANNOT_REPLY` → the reply keeps its state and the composer turns `unavailable` from `details.bot`; network / `500` → «Something went wrong — try again» under the reply (AC-11, AC-12b, AC-13; flow 7) | NEW: ReplyDeliveryState | — |
| composer: empty | box empty or only spaces / new lines — **Send** disabled; Enter does nothing (AC-07) | extended: ReplyComposer (Textarea, Button) | wireframe «composer states» |
| composer: ready | valid text — **Send** enabled; Enter sends, Shift+Enter starts a new line (AC-06) | extended: ReplyComposer | wireframe «thread desktop» |
| validation | over 4096 characters (UTF-16 units) — **Send** disabled, `aria-invalid`, «Replies are limited to 4096 characters» under the box, text kept; a server `400 VALIDATION_ERROR` on `body` shows its message in the same slot (AC-07; flow 1) | extended: ReplyComposer | wireframe «composer states» |
| composer: sending | `sendReply` in flight — box read-only, **Send** disabled with a spinner, a second Enter is ignored and a retry reuses the same `client_key` (Decision 2) (AC-11) | extended: ReplyComposer | — |
| success: reply stored | `201` (or `200` — the same `client_key` already stored) — the reply appears at the end as «Sending» with the member's name, the box clears and gets a new `client_key`; `last_seen_reply_id` is reset to the newest reply shown (AC-06, AC-11; flow 1) | extended: ReplyComposer, extended: MessageBubble, NEW: ReplyDeliveryState | — |
| composer: teammate replied | `409 TEAMMATE_REPLIED` → SCR-04 opens over the thread; text kept (AC-16; flow 6) | extended: ReplyComposer | — |
| composer: rate-limited | `429 REPLY_LIMIT_REACHED` — text kept; under the box «Replies are limited to 30 per minute — you can send again in N seconds», N counting down to `details.retry_at`; **Send** disabled until then, then the message goes (AC-12b; flow 1) | extended: ReplyComposer | wireframe «composer states» |
| composer: unavailable, owner | `getInboxBotStatus` `can_reply: false` (or `409 BOT_CANNOT_REPLY` → `details.bot`) — the box and **Send** disabled; `Alert` in the reply area: `not_connected` «Replies can't be sent — the bot is disconnected.» / `needs_token` «Replies can't be sent — the bot is not working and needs a new token.» + «They can be sent again once the bot works.» + **Open bot settings** → SCR-08; the draft is kept (AC-13; flow 1, flow 8) | extended: ReplyComposer, Alert, Button (`link`) | wireframe «composer states» |
| composer: unavailable, operator | as above with «Ask a business owner to fix the bot.» instead of the link (AC-13) | extended: ReplyComposer, Alert | — |
| composer: available again | `bot.changed` → `can_reply: true` — the alert goes, the box and **Send** come back with the kept draft, no reload (AC-13; flow 8) | extended: ReplyComposer | — |
| composer: send failed | network failure or `500` on `sendReply` — text and `client_key` kept; under the box «Your reply was not sent — check your connection and send again»; sending again with the same key never makes a second reply (`200` replay) (AC-11) | extended: ReplyComposer | — |
| draft kept | switching to another conversation and back, or the bot becoming unavailable — each conversation keeps its own draft and `client_key` for this tab (sad.md §4 UI architecture) | extended: ReplyComposer | — |
| phone: thread (< md) | the thread replaces the list; header starts with **Back to conversations** → SCR-01; browser back does the same (AC-03) | Button (`ghost`), Avatar | wireframe «thread phone» |
| empty | N/A: a conversation exists only once a customer wrote (bot-connection capture), so a thread always has ≥ 1 message | — | — |
| guard / live states | → §Shared inbox states | — | §Shared inbox states |

```text
thread desktop (right pane of the inbox card)
+----------------------------------------------+
| (OK) Olena Kravets  @olena_k                 |
|----------------------------------------------|
| ┌──────────────────────────┐                 |
| │ Hi! Is the peony bouquet │                 |
| │ still available?         │                 |
| │ 10:02                    │                 |
| └──────────────────────────┘                 |
|                  Ana Shevchenko              |
|            ┌───────────────────────────────┐ |
|            │ Yes! Delivery today by 18:00  │ |
|            │ 10:05                         │ |
|            └───────────────────────────────┘ |
|                                  ✓ Sent      |
| ┌──────────────────────────┐                 |
| │ Great, can you add a card│                 |
| │ 10:07 · edited           │                 |
| └──────────────────────────┘                 |
|----------------------------------------------|
| [ Write a reply…                    ] [Send] |
+----------------------------------------------+

thread loading                       thread phone
+------------------------------+     +--------------------------------+
| (░░) ░░░░░░░░░               |     | [Back to conversations]        |
|------------------------------|     | (OK) Olena Kravets  @olena_k   |
| ░░░░░░░░░░░░                 |     |--------------------------------|
|              ░░░░░░░░░░░░░░  |     | ┌─────────────────┐            |
| ░░░░░░░░░░░░░░░              |     | │ Hi! Is the peony│            |
|              ░░░░░░░░░       |     | └─────────────────┘            |
|------------------------------|     |   ┌──────────────────────┐     |
| [ (disabled)          ][Send]|     |   │ Yes! Delivery today… │     |
+------------------------------+     |   └──────────────────────┘     |
                                     | [ Write a reply…      ] [Send] |
                                     +--------------------------------+

content kinds (inbound bubbles)
┌────────────────────┐ ┌──────────────────────┐ ┌──────────────────────────────┐
│ [   photo   ]      │ │ ▶ ━━━━━●────── 0:12  │ │ 📄 invoice-0815.pdf  1.2 MB  │
│ new bouquet?       │ │ (voice / audio)      │ │            [Download]        │
└────────────────────┘ └──────────────────────┘ └──────────────────────────────┘
┌──────────────────────────────┐ ┌───────────────────────┐ ┌────────────────────┐
│ 📍 Location                  │ │ 👤 Contact            │ │ 📊 Poll            │
│ Flower Market, Main St 5     │ │ Ivan Melnyk           │ │ Which colour?      │
│ 50.4501, 30.5234             │ │ +380 50 000 0000      │ │ · Red  · White     │
│ Open in map ↗                │ └───────────────────────┘ └────────────────────┘
└──────────────────────────────┘
┌────────────────────────────────────────┐ ┌──────────────────────────────────────┐
│ Photo · new bouquet?                   │ │ Unsupported message — tg-inbox cannot │
│ Content unavailable — Telegram no      │ │ show this kind yet                   │
│ longer keeps this file                 │ └──────────────────────────────────────┘
└────────────────────────────────────────┘

delivery states (under an outbound bubble, right-aligned)
  🕓 Sending
  ✓ Sent
  ✕ Not delivered — the customer blocked the bot
    They can be reached again only after they unblock the bot and write to it
  ✕ Not delivered — Telegram did not accept it   [Try again]
  ? Not confirmed — it may or may not have reached the customer   [Send again]
  ✓ Sent · ⚠ New customer messages are not arriving        (bot taken over)

composer states
+----------------------------------------------+
| [ Write a reply…                  ] [Send]   |  empty: Send disabled
+----------------------------------------------+
| [ …4 120 characters…              ] [Send]   |  validation
| Replies are limited to 4096 characters       |
+----------------------------------------------+
| [ Thanks! See you at 6           ] [Send]    |  rate-limited
| Replies are limited to 30 per minute — you   |
| can send again in 12 seconds                 |
+----------------------------------------------+
| ⚠ Replies can't be sent — the bot is not     |  unavailable, owner
|   working and needs a new token. They can be |
|   sent again once the bot works.             |
|   Open bot settings                          |
| [ (disabled)                     ] [Send]    |
+----------------------------------------------+
```

### SCR-03 — Media viewer

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default: photo | a photo in SCR-02 clicked — `Dialog` over the thread: the image at its full size, fit to the viewport; header = contact name + time; caption under the image; close with ✕, Esc or a click on the backdrop; focus returns to the photo (AC-04) | Dialog, Button (`ghost`, icon) | wireframe «viewer» |
| default: video | a video in SCR-02 clicked — the same dialog with a video player (play, seek — `Range` forwarded), the thread's inline player pauses (AC-04) | Dialog | wireframe «viewer» |
| loading | the bytes are not in memory yet (opened before the inline copy finished) — a skeleton the size of the media | Skeleton | — |
| error | a seek or load fails with `503 TELEGRAM_UNAVAILABLE` / `416` — inside the dialog «Telegram is not responding — try again» + **Try again**; `409 MEDIA_UNAVAILABLE` → the same «Content unavailable — <reason>» text as SCR-02 (AC-05; flow 3) | Alert (destructive), Button | — |
| empty | N/A: opened only from a photo or video that exists | — | — |
| guard / live states | → §Shared inbox states (a `403` closes the dialog with the rest of the workspace) | — | §Shared inbox states |

```text
viewer
+--------------------------------------------------------------+
| Olena Kravets · 10:02                                    [✕] |
|                                                              |
|                 +--------------------------+                 |
|                 |                          |                 |
|                 |        photo / video     |                 |
|                 |                          |                 |
|                 +--------------------------+                 |
|                 new bouquet?                                 |
+--------------------------------------------------------------+
```

### SCR-04 — Confirm send after a teammate's reply

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `sendReply` `409 TEAMMATE_REPLIED` — `AlertDialog` over the thread: title «A teammate just replied»; text «<details.reply.author.display_name> replied to this customer <how long ago from details.reply.position_at>. Send your reply anyway?»; **Keep editing** (cancel) and **Send anyway** (primary); the teammate's reply is already in the thread behind it (AC-16; flow 6) | AlertDialog, Button | wireframe «confirm teammate» |
| keep editing | **Keep editing** or Esc — the dialog closes, the draft and its `client_key` stay, `last_seen_reply_id` becomes `details.reply.id`, focus back in the box; nothing sent (AC-16; flow 6) | AlertDialog | — |
| pending | **Send anyway** pressed — both buttons disabled, a spinner in **Send anyway**; the same request is repeated with the same `client_key` and `confirm_teammate_reply: true` (AC-16, AC-11) | AlertDialog, Button | — |
| success | `201` / `200` — the dialog closes; SCR-02 `success: reply stored` (AC-16) | — | — |
| error: refused | `429 REPLY_LIMIT_REACHED` → the dialog closes, SCR-02 `composer: rate-limited`; `409 BOT_CANNOT_REPLY` → closes, SCR-02 `composer: unavailable` (the confirmation skips only the teammate check — contract `confirm_teammate_reply`) | — | — |
| error | network / `500` — the dialog stays open with «Your reply was not sent — try again» above the buttons; buttons enabled again; the draft stays | Alert (destructive), Button | — |
| empty | N/A: a confirmation with fixed content from the `409` answer, no list | — | — |
| guard / live states | → §Shared inbox states | — | §Shared inbox states |

```text
confirm teammate
            +--------------------------------------------+
            | A teammate just replied                    |
            | Bob Petrenko replied to this customer      |
            | 2 minutes ago. Send your reply anyway?     |
            |                                            |
            |            [Keep editing]  [Send anyway]   |
            +--------------------------------------------+
```

### SCR-05 — Confirm send again

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | **Send again** on a «Not confirmed» reply — `AlertDialog`: title «Send this reply again?»; text «tg-inbox could not confirm that it reached the customer. If it did, the customer will receive it twice.»; **Cancel** and **Send again** (primary) (AC-11; flow 7) | AlertDialog, Button | wireframe «confirm send again» |
| cancelled | **Cancel** or Esc — the dialog closes; the reply stays «Not confirmed»; nothing sent (AC-11; flow 7) | — | — |
| pending | **Send again** pressed — both buttons disabled, a spinner; `resendReply` with `confirm_duplicate_risk: true` (AC-11) | AlertDialog, Button | — |
| success | `200` — the dialog closes; the reply moves to the end of the thread as «Sending» (AC-11, AC-12; flow 7) | NEW: ReplyDeliveryState | — |
| error: confirmation required | `409 DUPLICATE_RISK_CONFIRMATION_REQUIRED` — the warning stays open with the buttons enabled again (flow 7) | AlertDialog | — |
| error: already resent | `409 REPLY_NOT_RESENDABLE` — the dialog closes and the reply is redrawn from `details.reply` (another member or tab resent it) (contract `resendReply`; api-sync-report OQ-1) | — | — |
| error: refused | `429 REPLY_LIMIT_REACHED` → closes, the limit message under the reply (SCR-02 `reply: resend refused`); `409 BOT_CANNOT_REPLY` → closes, the reply keeps its state, SCR-02 `composer: unavailable` (AC-12b, AC-13; flow 7) | — | — |
| error | network / `500` — the dialog stays open with «Something went wrong — try again» above the buttons | Alert (destructive), Button | — |
| empty | N/A: a confirmation with fixed copy, no data load | — | — |
| guard / live states | → §Shared inbox states | — | §Shared inbox states |

```text
confirm send again
            +--------------------------------------------+
            | Send this reply again?                     |
            | tg-inbox could not confirm that it reached |
            | the customer. If it did, the customer will |
            | receive it twice.                          |
            |                    [Cancel]  [Send again]  |
            +--------------------------------------------+
```

### SCR-06 — Not found (in frame)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `404 NOT_FOUND` from the guard or a conversation / item lookup — an unknown conversation id, one of another workspace, or a workspace the account is not a member of; inherited: ui-redesign `screens.md` §SCR-07 «not found» — the existing `NotFoundCard` in the frame body with its existing way back to the inbox; no hint that the conversation or the workspace exists (AC-03, AC-08) | AppShell, NotFoundCard | — |
| error / empty | N/A: a static card with no data load | — | — |

### SCR-07 — Access-removed landing

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `403 ACCESS_REMOVED` on any inbox request or on the socket upgrade, or the next request after socket close `4403`; inherited verbatim: ui-redesign `screens.md` §SCR-05 «access-removed» / §SCR-06 «access-removed» (picker or no-access with the notice naming the workspace); nothing of the workspace is shown (AC-08, AC-09; flow 2, flow 4) | AuthLayout, Alert, Button, Badge | — |
| loading, error, guard states | inherited: ui-redesign §SCR-05 / §SCR-06 | Skeleton, Alert, Button | — |

### SCR-08 — Settings — Bot

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | inherited verbatim: ui-redesign `screens.md` §SCR-11 «default layout» (owner-only). This feature adds only the entry points — **Open bot settings** in SCR-01 `empty: no bot, business owner` / `notice: not receiving` and SCR-02 `composer: unavailable, owner` — and no state; a fix made here reaches open inboxes through `bot.changed` (AC-02, AC-13, AC-14; flow 8) | SettingsLayout, Card, Badge, Button | — |
| loading, empty, error, other states | inherited verbatim: ui-redesign §SCR-11 (loading, not connected, needs token, taken over, error: Telegram unavailable, error: unexpected, owners only, guard states) | Card, Badge, Alert, Button, Skeleton | — |

### SCR-09 — Sign-in

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | inherited verbatim: ui-redesign `screens.md` §SCR-01 «default» (+ workspace-operators §SCR-01 `session-ended`). This feature adds no state: a signed-out visit to `/w/<id>/inbox[/<conversationId>]`, a `401`, or the next request after socket close `4401` lands here and returns to that address after sign-in, where the guard sends a non-member to SCR-06 and a deactivated member to SCR-07 (AC-08; flow 4, flow 5) | AuthLayout, Field, Input, Label, Button | — |
| validation, error, other states | inherited verbatim: ui-redesign §SCR-01 (validation, error: wrong credentials, submitting, session-ended, success, error: unexpected) | Field, Alert, Button | — |

## New components

| Component | Why no existing primitive fits | Registered in design-system |
|---|---|---|
| MessageContent | Renders one captured customer message by its kind — text, image, muted-loop / round video, audio player, file row with download, location with an on-click map link, contact, poll, dice, unsupported — plus its caption, its media loading skeleton and the «content unavailable» / «Telegram is not responding» variants; media is fetched through the API client so a JSON error can be shown instead of bytes (ADR-0006). No shadcn primitive renders media or message kinds; it lives inside `MessageBubble` | pending |
| ReplyDeliveryState | The line under a team reply: «Sending» / «Sent» / «Not delivered — <reason>» / «Not confirmed — …», the reason-specific hint, the Try again / Send again action with its pending and refused feedback, and the «not arriving» note while the bot is taken over. A `Badge` carries neither a reason sentence nor an action; the same line is used by every reply in every thread | pending |
| ConversationList (extended) | Existing NEW component (ui-redesign); gains the «Waiting for a reply» marker, the last item by kind + caption and the team-reply icon, real `Conversation` rows and the loading-more slot — its canon row is updated, not duplicated | pending |
| MessageBubble (extended) | Existing NEW component; gains the reply author's name, the «edited» mark, a `MessageContent` body for customer messages and a `ReplyDeliveryState` slot for replies — canon row updated | pending |
| ReplyComposer (extended) | Existing NEW component; gains the sending lock, the rate-limited countdown, the bot-unavailable alert (role-specific), the send-failed line, the per-conversation draft + `client_key`, and loses the preview note — canon row updated | pending |
| EmptyFilterState (extended) | Existing NEW component; gains an optional action label so the inbox keeps its existing **Clear search** text (AC-02) while Team / Contacts keep **Clear filters** — canon row updated | pending |
