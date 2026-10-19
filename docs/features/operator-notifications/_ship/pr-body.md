## Summary

Roadmap step 6: operator notifications. The shared inbox now tells operators when a customer is waiting: an attention count in the tab title and navigation, desktop notifications, and a Telegram ping from the workspace's bot when a linked member is away from the web. Members link their own Telegram with a single-use connect link; pings carry no message text or contact name and are limited per conversation and per member. Spec: [`docs/features/operator-notifications/spec.md`](docs/features/operator-notifications/spec.md) · changelog: [`_ship/changelog.md`](docs/features/operator-notifications/_ship/changelog.md).

## Acceptance criteria

- AC-01 — attention count in the tab title and navigation: open conversations that are mine or unassigned with unread messages, live ✓
- AC-02 — desktop notifications held back only while a tab of the workspace is in focus; one replaces the previous; click opens the right tab ✓
- AC-03 — blocked or unsupported desktop notifications: the panel says how to allow them, never asks without a click ✓
- AC-04 — connect Telegram with a single-use link; the bot confirms and the panel turns to Connected live ✓
- AC-05 — expired, used or foreign connect links are refused with an honest answer, throttled per Telegram user ✓
- AC-06 — an existing link is never replaced silently; one link per member and per Telegram account ✓
- AC-07 — an away, linked member whose customer waited 5 minutes gets one ping; presence counted; later-away members pinged when they become away ✓
- AC-08 — at most one ping per conversation per waiting period and one per member per 10 minutes; due conversations combine, with the right wording and lens link ✓
- AC-09 — an assignee who cannot be pinged (no link or not reachable) lets the team be pinged; a reachable assignee gets the team ping only at 30 minutes ✓
- AC-10 — bot paused, taken over, blocked, deactivation and bot replacement: no ping sent or queued while paused, links removed when due, replies never crowded out ✓
- AC-11 — a linked member's messages to the bot are never captured; the bot answers at most once per hour ✓
- AC-12 — non-members, deactivated and signed-out callers are refused; a member sees and removes only their own link ✓
- AC-13 — 5 connect links per 10 minutes per member, then refused with the retry time; no link offered for a bot that is not working ✓

## Design

- Spec: `docs/features/operator-notifications/spec.md` · UX: `ux-flows.md`, `screens.md`
- Architecture: `docs/features/operator-notifications/sad.md`
- Decisions: `docs/features/operator-notifications/adr/` (0001–0010)
- Data model + migrations: `docs/features/operator-notifications/data-model.md` (migrations `1791681109998`–`1791681110005`)
- API: `docs/features/operator-notifications/contracts/openapi.yaml` + `contracts/events.md`
- Test plan: `docs/features/operator-notifications/test-plan.md`
- Review: `docs/features/operator-notifications/_review/review-2026-10-19.md` — 4 parallel clean-context reviewers, 18 findings + 8 re-review findings, all fixed; final verdict **PASS**

## Stacked PR

This branch is based on `assignment-statuses` (PR pending). Merge that PR first, then retarget this one to `main`. Later feature branches (contacts) will stack on this branch.

## Tasks (SDD-Task trailers)

- `709ae33` spec: operator-notifications
- `92da507` clarify: operator-notifications — 18 resolved, 0 deferred
- `d2ec727` ux-flows: operator-notifications
- `8efad2d` design: operator-notifications — SAD + 10 ADRs (critic pass)
- `9d60fc7` sequences: operator-notifications runtime flows
- `b7d6e64` data-model: operator-notifications (data-model.md + staged migrations)
- `6dc893f` api: operator-notifications contract
- `4bab917` screens: operator-notifications manifest
- `2c6ef71` operator-notifications: no QR code in v1 (no new dependency) — connect link with Copy and Open in Telegram
- `2948ec7` tasks: operator-notifications (breakdown + tasks.json)
- `e1a5858` test-plan: operator-notifications
- `982958d` [T1] feat(operator-notifications): promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures
- `7d93213` [T2] feat(operator-notifications): add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal
- `b731e2e` [T3] feat(operator-notifications): add the notifications domain due rules: the 5 / 30-minute marks, the unpingable assignee, read-holds-back unless reopen, the ledger and 10-minute spacing, and the presence predicate
- `59d4ec2` [T4] feat(operator-notifications): add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time
- `81fe635` [T5] feat(operator-notifications): record the waiting period in conversations — set by capture, cleared by a sent reply and a close, restarted by a reopen while waiting — and promote migrations 01–03
- `37d0a3f` [T7] feat(operator-notifications): give bots sendMemberMessage (paced, behind the send pause, with a blocked outcome) and pingReadiness, and store the send pause on any 429
- `fb76f09` [T6] feat(operator-notifications): add the conversations reads waitingForPings (period start, start kind, assignee, per-member read state) and attentionCount
- `c81e615` [T8] feat(operator-notifications): build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link
- `35fd140` [T9] feat(operator-notifications): build the presence-lease and ping-ledger repositories with cross-workspace isolation tests
- `2e67245` [T10] feat(operator-notifications): add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting
- `689bc58` [T11] feat(operator-notifications): redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer
- `c0b17bd` [T12] feat(operator-notifications): intercept every private update in bots before capture through a port: redeem connect-link starts, consume linked members' messages with the hourly notice, pass everyone else
- `967cb92` [T13] feat(operator-notifications): add the presence use cases opened / alive / screen / closed, with the member's expired-lease cleanup and the ping opened-at mark
- `cfdafe1` [T14] feat(operator-notifications): teach the inbox hub to read presence frames and report socket lifecycle to notifications, and deliver telegram_link.changed only to that account's sockets
- `dc57bad` [T15] feat(operator-notifications): add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id
- `a0bb9f7` [T16] feat(operator-notifications): add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction
- `b94a56b` [T17] feat(operator-notifications): wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests
- `94bf46b` [T18] feat(operator-notifications): remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions
- `66c5321` [T19] feat(operator-notifications): serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module
- `fd8fddb` [T20] feat(operator-notifications): add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes
- `56a1a72` [T21] test(operator-notifications): add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames
- `f4db4a7` [T22] feat(operator-notifications): move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe
- `71c07f6` [T23] feat(operator-notifications): build the attention store and SCR-15's count: the (N) title prefix, the Inbox SidebarMenuBadge, the phone header badge, the collapsed tooltip and Settings for operators
- `2651977` [T24] feat(operator-notifications): build Settings — Notifications (SCR-16) with the TelegramPingsCard, the notifications store, the role-filtered SettingsLayout and the route
- `b47d99d` [T25] feat(operator-notifications): build SCR-17, the ConnectTelegramDialog: the link with Copy and Open in Telegram, its expiry, waiting for Start, the live turn to Connected, new-link refusals and the bot-stopped state
- `105cdd0` [T26] feat(operator-notifications): build the DesktopNotificationsCard on SCR-16: capability and permission checks, the click-only permission request (OS-01), worker registration and the per-browser flag
- `8f69f34` [T27] feat(operator-notifications): add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02)
- `258cc31` [T28] feat(operator-notifications): add the «Telegram pings» column to Settings — Team (SCR-13) and the pings sentence to the deactivate confirmation (SCR-14)
- `42add37` [T29] test(operator-notifications): add browser end-to-end notification flows against the real API and the fake Bot API
- `87fee64` [T30] docs(operator-notifications): update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components
- `70ab8fc` review(operator-notifications): independent review — 18 findings, CHANGES REQUESTED
- `fa5a792` [review B1 B2 B3 B4 B5 B6 B7 B8] fix(operator-notifications): close the backend review findings B1–B8
- `117ca2d` [review W1 W2 W3 W4 W5 W6 W7 W8 W9 W10] fix(operator-notifications): close the web review findings W1–W10
- `485f33f` [review R1 R2 R3 R4] fix(operator-notifications): close the re-review findings R1–R4
- `bda562f` [review RR1 RR2] fix(operator-notifications): close re-review findings RR1–RR2
- `cf79df3` [review RR3] fix(operator-notifications): hidden_for_ms counts time asleep (larger of monotonic and wall elapsed)
- `2887a5b` review(operator-notifications): re-review rounds closed — PASS

## Verification

- Unit + integration (Testcontainers Postgres, real pg-boss, fake Bot API): `pnpm test` — 232 files, 3050 tests passed
- Lint + typecheck: `pnpm lint` clean
- Browser e2e: 29/29 passed, including 5 notification flows in `apps/web/e2e/notifications.spec.ts`
- Review: PASS — 4 parallel reviewers, 18 findings + 8 re-review findings all fixed; record `docs/features/operator-notifications/_review/review-2026-10-19.md`
- Not verified: a real Telegram bot and real OS desktop notifications — they need a public HTTPS host and a headed browser; listed as a manual pre-release check.

## Operational notes

- Migrations: eight reversible migrations (`1791681109998`–`1791681110005`) — run `pnpm db:migrate` before the new API starts. Rollback: revert the deploy, then `pnpm db:rollback` x8 (drops Telegram links, pings and presence). Dev databases that applied `1791681110001` before commit `485f33f` must roll back and re-migrate: the `tab_presences` check changed in place.
- New pg-boss queues: `notifications.send-pings` (stately chain per workspace), `notifications.schedule-pings` (cron), `notifications.send-bot-message` + `notifications.send-bot-message-dlq`.
- Sixth tenancy exception: *workspaces with a live Telegram link* (ids only, used by the `schedule-pings` backstop), recorded in CLAUDE.md and the architecture map.
- Service worker `/notifications-sw.js` is served no-cache.
- Config / feature flag: none new.
- Security: F-3 — the Telegram user id is kept in `send-bot-message` payloads for two answer kinds (and the DLQ); pending the security review spec §6.1 requires.
- Run-book integrity queries (`test-plan.md` §6): eight queries, all expect 0 rows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
