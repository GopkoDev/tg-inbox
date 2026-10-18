# Tracker — shared-inbox

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | [Promote the expand, backfill and new-table migrations 01–08, regenerate DB types and add the inbox test fixtures](./t01-promote-expand-migrations.md) | migration | Dmytro Hopko | M | — | done |
| T2 | [Define the inbox zod contracts, the live-frame schemas and the six new error codes](./t02-shared-inbox-contracts.md) | ports | Dmytro Hopko | M | — | done |
| T3 | [Build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync](./t03-platform-realtime.md) | infra | Dmytro Hopko | M | — | done |
| T4 | [Extend the fake Bot API with sendMessage, getFile and the file download, scriptable per call](./t04-fake-telegram-send-and-files.md) | tests | Dmytro Hopko | S | — | done |
| T5 | [Add the conversations domain rules: reply states and transitions, thread position order and cursors, the arrival-watermark rule](./t05-conversations-domain.md) | domain | Dmytro Hopko | S | — | done |
| T6 | [Add the inbox domain rules: reply text check, delivery outcome to reply state, retry window, per-member limit window](./t06-inbox-domain.md) | domain | Dmytro Hopko | S | — | done |
| T7 | [Give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09](./t07-workspaces-inbox-support.md) | app | Dmytro Hopko | M | T1, T3 | done |
| T8 | [Maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10](./t08-capture-list-columns-and-signals.md) | app | Dmytro Hopko | M | T1, T3, T7 | done |
| T9 | [Build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read](./t09-conversations-read-side.md) | infra | Dmytro Hopko | M | T5, T8 | done |
| T10 | [Build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction](./t10-conversations-reply-requests.md) | infra | Dmytro Hopko | M | T5, T8 | done |
| T11 | [Build the delivery side in conversations: pending replies, in-flight mark, outcome recording, mark sent, stale in-flight and dead-letter resolution](./t11-conversations-delivery-side.md) | infra | Dmytro Hopko | M | T10 | done |
| T12 | [Add contact search ids and contacts by ids to the contacts module](./t12-contacts-search.md) | infra | Dmytro Hopko | S | — | done |
| T13 | [Expose the inbox bot status to every member and publish bot.changed on every bot state transition](./t13-bots-inbox-status.md) | app | Dmytro Hopko | S | T3 | done |
| T14 | [Add sendMessage to the bots gateway as send text, classifying every answer into a typed outcome](./t14-bots-send-text.md) | infra | Dmytro Hopko | M | T4 | done |
| T15 | [Add the media stream to the bots gateway: getFile, size check and a ranged byte stream with typed unavailability](./t15-bots-media-stream.md) | infra | Dmytro Hopko | M | T4, T14 | done |
| T16 | [Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp](./t16-inbox-reads-and-wiring.md) | ports | Dmytro Hopko | M | T2, T7, T9, T12, T13 | done |
| T17 | [Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook](./t17-inbox-send-and-resend.md) | ports | Dmytro Hopko | M | T6, T10, T16 | done |
| T18 | [Build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler](./t18-delivery-drain-worker.md) | app | Dmytro Hopko | M | T6, T11, T14, T17 | done |
| T19 | [Add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability](./t19-media-route.md) | ports | Dmytro Hopko | M | T9, T15, T16 | done |
| T20 | [Add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync](./t20-live-socket-hub.md) | ports | Dmytro Hopko | M | T3, T16 | done |
| T21 | [Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs](./t21-api-e2e-and-secrecy.md) | tests | Dmytro Hopko | M | T17, T18, T19, T20 | done |
| T22 | [Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components](./t22-docs-and-canon.md) | docs | Dmytro Hopko | S | T18, T20, T26, T27, T28 | todo |
| T23 | [Replace the inbox sample source with the API source, a workspace-keyed store and the realtime client](./t23-web-inbox-foundation.md) | ui | Dmytro Hopko | M | T2 | done |
| T24 | [Build SCR-01, the conversation list, on real data: rows, search, empty states, the not-receiving notice and live updates](./t24-inbox-list-screen.md) | ui | Dmytro Hopko | M | T23 | done |
| T25 | [Build SCR-02's reading side: thread header, paged history, mark read when visible, live items, edits, late redeliveries and phone layout](./t25-inbox-thread-screen.md) | ui | Dmytro Hopko | M | T23 | done |
| T26 | [Build MessageContent for every message kind with media fetched through the API client, and SCR-03, the media viewer](./t26-message-content-and-viewer.md) | ui | Dmytro Hopko | M | T25 | done |
| T27 | [Build the real reply composer and SCR-04: client key and drafts, sending lock, validation, rate limit, bot-unavailable states and the teammate confirmation](./t27-reply-composer-and-teammate-dialog.md) | ui | Dmytro Hopko | M | T25 | done |
| T28 | [Build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation](./t28-delivery-state-and-resend.md) | ui | Dmytro Hopko | M | T26, T27 | todo |
| T29 | [Add browser end-to-end inbox flows against the real API and the fake Bot API](./t29-inbox-browser-e2e.md) | tests | Dmytro Hopko | M | T21, T24, T28 | todo |

**Total:** 29 tasks, ~26 person-days (S ≈ ½ day, M/L ≈ 1 day; every task fits one day).
