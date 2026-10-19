# Tracker — operator-notifications

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | [Promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures](./t01-promote-bot-pause-and-notifications-tables.md) | migration | Dmytro Hopko | M | — | done |
| T2 | [Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal](./t02-notifications-contracts.md) | ports | Dmytro Hopko | M | — | done |
| T3 | [Add the notifications domain due rules: the 5 / 30-minute marks, the unpingable assignee, read-holds-back unless reopen, the ledger and 10-minute spacing, and the presence predicate](./t03-due-rules-and-presence-predicate.md) | domain | Dmytro Hopko | M | — | done |
| T4 | [Add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time](./t04-ping-text-answers-and-connect-link-rules.md) | domain | Dmytro Hopko | M | — | done |
| T5 | [Record the waiting period in conversations — set by capture, cleared by a sent reply and a close, restarted by a reopen while waiting — and promote migrations 01–03](./t05-conversations-waiting-period.md) | app | Dmytro Hopko | M | T1 | done |
| T6 | [Add the conversations reads waitingForPings (period start, start kind, assignee, per-member read state) and attentionCount](./t06-conversations-reads-for-notifications.md) | infra | Dmytro Hopko | M | T5 | done |
| T7 | [Give bots sendMemberMessage (paced, behind the send pause, with a blocked outcome) and pingReadiness, and store the send pause on any 429](./t07-bots-send-member-message.md) | app | Dmytro Hopko | M | T1 | done |
| T8 | [Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link](./t08-telegram-link-and-connect-link-repos.md) | infra | Dmytro Hopko | M | T1 | done |
| T9 | [Build the presence-lease and ping-ledger repositories with cross-workspace isolation tests](./t09-presence-and-ping-ledger-repos.md) | infra | Dmytro Hopko | M | T1 | done |
| T10 | [Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting](./t10-connect-settings-disconnect-use-cases.md) | app | Dmytro Hopko | M | T2, T4, T8 | todo |
| T11 | [Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer](./t11-redeem-connect-link.md) | app | Dmytro Hopko | M | T2, T4, T8 | todo |
| T12 | [Intercept every private update in bots before capture through a port: redeem connect-link starts, consume linked members' messages with the hourly notice, pass everyone else](./t12-inbound-interceptor.md) | app | Dmytro Hopko | M | T11 | todo |
| T13 | [Add the presence use cases opened / alive / screen / closed, with the member's expired-lease cleanup and the ping opened-at mark](./t13-presence-use-cases.md) | app | Dmytro Hopko | S | T3, T9 | todo |
| T14 | [Teach the inbox hub to read presence frames and report socket lifecycle to notifications, and deliver telegram_link.changed only to that account's sockets](./t14-hub-presence-frames-and-account-frame.md) | ports | Dmytro Hopko | M | T2, T13 | todo |
| T15 | [Add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id](./t15-send-bot-message-job.md) | app | Dmytro Hopko | M | T4, T7, T8 | todo |
| T16 | [Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction](./t16-sweep-and-send-pings.md) | app | Dmytro Hopko | M | T3, T4, T6, T7, T8, T9 | todo |
| T17 | [Wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests](./t17-ping-jobs-and-cron-backstop.md) | wiring | Dmytro Hopko | M | T11, T16 | todo |
| T18 | [Remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions](./t18-deactivation-and-bot-connected-hooks.md) | app | Dmytro Hopko | M | T2, T8 | todo |
| T19 | [Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module](./t19-notifications-and-attention-routes.md) | ports | Dmytro Hopko | M | T6, T10, T12 | todo |
| T20 | [Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes](./t20-team-telegram-pings-mark.md) | ports | Dmytro Hopko | S | T8, T10, T18 | todo |
| T21 | [Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames](./t21-api-e2e-and-secrecy.md) | tests | Dmytro Hopko | M | T14, T15, T17, T19, T20 | todo |
| T22 | [Move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe](./t22-web-frame-live-connection.md) | ui | Dmytro Hopko | M | T2 | todo |
| T23 | [Build the attention store and SCR-15's count: the (N) title prefix, the Inbox SidebarMenuBadge, the phone header badge, the collapsed tooltip and Settings for operators](./t23-scr15-attention-count.md) | ui | Dmytro Hopko | M | T22 | todo |
| T24 | [Build Settings — Notifications (SCR-16) with the TelegramPingsCard, the notifications store, the role-filtered SettingsLayout and the route](./t24-scr16-telegram-pings-card.md) | ui | Dmytro Hopko | M | T22 | todo |
| T25 | [Build SCR-17, the ConnectTelegramDialog: the link with Copy and Open in Telegram, its expiry, waiting for Start, the live turn to Connected, new-link refusals and the bot-stopped state](./t25-scr17-connect-dialog.md) | ui | Dmytro Hopko | M | T24 | todo |
| T26 | [Build the DesktopNotificationsCard on SCR-16: capability and permission checks, the click-only permission request (OS-01), worker registration and the per-browser flag](./t26-scr16-desktop-notifications-card.md) | ui | Dmytro Hopko | M | T24 | todo |
| T27 | [Add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02)](./t27-desktop-notifier-and-service-worker.md) | ui | Dmytro Hopko | M | T22, T26 | todo |
| T28 | [Add the «Telegram pings» column to Settings — Team (SCR-13) and the pings sentence to the deactivate confirmation (SCR-14)](./t28-scr13-team-mark-and-scr14-copy.md) | ui | Dmytro Hopko | S | T20 | todo |
| T29 | [Add browser end-to-end notification flows against the real API and the fake Bot API](./t29-browser-e2e.md) | tests | Dmytro Hopko | M | T21, T23, T25, T27, T28 | todo |
| T30 | [Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components](./t30-docs-and-canon.md) | docs | Dmytro Hopko | S | T17, T18, T19, T20, T23, T25, T26, T27, T28 | todo |

**Total:** 30 tasks, ~28 person-days (S = ½ day, M = 1 day, L = 1 full day at the edge of the ≤ 1-day bound).
