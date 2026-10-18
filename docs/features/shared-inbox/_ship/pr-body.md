## Summary

Roadmap step 4: the shared web inbox. Operators and business owners read every customer conversation the workspace's bot captured, live for the whole team, and reply through the business's own bot — at most once, in order, with an honest delivery state. Spec: [`docs/features/shared-inbox/spec.md`](docs/features/shared-inbox/spec.md) · changelog: [`_ship/changelog.md`](docs/features/shared-inbox/_ship/changelog.md).

## Acceptance criteria

- AC-01 — one shared list, newest activity first, unread per member, "waiting for a reply" marker; owners = operators ✓
- AC-02 — search by any part of name/username; empty states ✓
- AC-03 — paged thread, mark read for this member only, reload/back/link, not-found, phone layout ✓
- AC-04 — every message kind; media only through the panel; map opens only on click ✓
- AC-05 — "content unavailable" with the reason; rest of the thread readable ✓
- AC-06 — sending → sent, row moves to the top, marker clears ✓
- AC-07 — empty / blank / >4096 never sent ✓
- AC-08 — non-members get nothing (404), deactivated get the access-removed notice, signed-out sign in ✓
- AC-09 — deactivation stops the open inbox within 5 s; workspace switch never leaks ✓
- AC-10 — blocked customer / account gone → "not delivered" with reason ✓
- AC-11 — at most once: double press = one send; unknown outcome = "not confirmed", resent only after a warning ✓
- AC-12 — Telegram slow-down retried up to 5 min, in order per conversation; then "Try again" ✓
- AC-12b — 30 replies / 60 s per member per workspace ✓
- AC-13 — bot disconnected / needs token: readable, role-specific explanation, recovers without reload ✓
- AC-14 — taken-over bot notice for every member ✓
- AC-15 — live list + thread updates, edits, teammates' replies, late redeliveries counted unread ✓
- AC-16 — teammate-replied confirmation before sending ✓
- AC-17 — customer gets plain text from the bot, no operator name; answer continues the conversation ✓
- AC-18 — two workspaces sharing a customer and an account never mix ✓

## Design

- Spec: `docs/features/shared-inbox/spec.md` · UX: `ux-flows.md`, `screens.md`
- Architecture: `docs/features/shared-inbox/sad.md`
- Decisions: `docs/features/shared-inbox/adr/` (0001–0008)
- Data model + migrations: `docs/features/shared-inbox/data-model.md` (migrations `1791681109983`–`1791681109992`)
- API: `docs/features/shared-inbox/contracts/openapi.yaml` + `contracts/events.md`
- Review: `docs/features/shared-inbox/_review/review-2026-10-18.md` — 4 parallel clean-context reviewers, 19 findings + 6 from re-review rounds, all fixed; final verdict **PASS**

## Tasks (SDD-Task trailers)

- `6ff2d52` [T1] feat(shared-inbox): promote the expand, backfill and new-table migrations 01–08, regenerate DB types and add the inbox test fixtures
- `32c68c5` [T2] feat(shared-inbox): define the inbox zod contracts, the live-frame schemas and the six new error codes
- `5b53afd` [T3] feat(shared-inbox): build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync
- `70592c8` [T4] test(shared-inbox): extend the fake Bot API with sendMessage, getFile and the file download, scriptable per call
- `b341b47` [T5] feat(shared-inbox): add the conversations domain rules: reply states and transitions, thread position order and cursors, the arrival-watermark rule
- `e6e5fc0` [T6] feat(shared-inbox): add the inbox domain rules: reply text check, delivery outcome to reply state, retry window, per-member limit window
- `b4c8488` [T12] feat(shared-inbox): add contact search ids and contacts by ids to the contacts module
- `1f7cc56` [T7] feat(shared-inbox): give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09
- `4730be8` [T13] feat(shared-inbox): expose the inbox bot status to every member and publish bot.changed on every bot state transition
- `5dfb8ff` [T14] feat(shared-inbox): add sendMessage to the bots gateway as send text, classifying every answer into a typed outcome
- `e78077b` [T8] feat(shared-inbox): maintain the conversation list columns on capture and edit, publish conversation.changed, and promote migration 10
- `dd2d3dd` [T15] feat(shared-inbox): add the media stream to the bots gateway: getFile, size check and a ranged byte stream with typed unavailability
- `fd79ed4` [T9] feat(shared-inbox): build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read
- `666f501` [T10] feat(shared-inbox): build reply creation and re-queueing in conversations: idempotent client key, per-member limit under an advisory lock, teammate check, attempt row and drain job in one transaction
- `77fd7b5` [T11] feat(shared-inbox): build the delivery side in conversations: pending replies, in-flight mark, outcome recording, mark sent, stale in-flight and dead-letter resolution
- `15c80a0` [T16] feat(shared-inbox): create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp
- `396a22d` [T17] feat(shared-inbox): add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook
- `66d7ce7` [T18] feat(shared-inbox): build the inbox.deliver-replies drain worker with pre-checks, pacing, outcome handling, back-off jobs and the dead-letter handler
- `0ecaf4a` [T19] feat(shared-inbox): add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability
- `e721fac` [T20] feat(shared-inbox): add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync
- `7afa696` [T21] test(shared-inbox): add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs
- `55cef66` [T23] feat(shared-inbox): replace the inbox sample source with the API source, a workspace-keyed store and the realtime client
- `2dbd4fc` [T21] test(shared-inbox): date the customer's answer after the reply's second in story 1
- `90fd9af` [T24] feat(shared-inbox): build SCR-01, the conversation list, on real data: rows, search, empty states, the not-receiving notice and live updates
- `33ad6cf` [T25] feat(shared-inbox): build SCR-02's reading side: thread header, paged history, mark read when visible, live items, edits, late redeliveries and phone layout
- `dc79744` [T26] feat(shared-inbox): build MessageContent for every message kind with media fetched through the API client, and SCR-03, the media viewer
- `66cb309` [T27] feat(shared-inbox): build the real reply composer and SCR-04: client key and drafts, sending lock, validation, rate limit, bot-unavailable states and the teammate confirmation
- `4455360` [T28] feat(shared-inbox): build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation
- `b594915` [T29] test(shared-inbox): add browser end-to-end inbox flows against the real API and the fake Bot API
- `f719349` [T22] docs(shared-inbox): update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components
- `7636060` review(shared-inbox): independent review — 19 findings, CHANGES REQUESTED
- `9e02a61` [review B1 B2 B3 B4 B5 B6 B7 B8 B9 W9 W10] fix(shared-inbox): close the backend review findings B1–B9 (+ API side of W9, W10)
- `1db5004` [review W1 W2 W3 W4 W5 W6 W7 W8 W9 W10] fix(shared-inbox): close the web review findings W1–W10
- `54cb084` [review R1 R2] fix(shared-inbox): close the re-review findings R1 (thread hole) and R2 (dead-letter race)
- `88a3cfd` [review R3 R4 R5 R6] fix(shared-inbox): close re-review findings R3–R6 on the re-read merge and the dead-letter lock
- `dd910df` review(shared-inbox): re-review rounds closed — PASS

## Verification

- Unit + integration (Testcontainers Postgres, real pg-boss, fake Bot API): `pnpm test` — 169 files, 1853 tests passed
- Lint + typecheck: `pnpm lint` (ESLint, Prettier, tsc for shared/api/web/e2e) — clean
- Browser e2e: `pnpm --filter @tg/web test:e2e` — 19/19 passed (14 earlier + 5 inbox flows)
- Ran the feature: Playwright drove the built SPA served by a real `buildApp()` listening on a port, with a migrated Postgres, the pg-boss worker and the fake Bot API. Observed: AC-01/AC-15 — a customer message appeared live in both the owner's and the operator's list and open thread; AC-06 — a reply showed Sending → Sent, one `sendMessage` reached the fake, the row moved to the top and the waiting marker cleared; AC-16 — the teammate dialog appeared and nothing was sent until "Send anyway"; AC-13 — `needs_token` gave role-specific composer text and replying worked again after the owner pasted a token in another tab, without reload; AC-09 — after deactivation the operator's socket closed, no further frames arrived, and the next click showed the access-removed notice. API stories (`apps/api/src/e2e/inbox-flows.int.test.ts`) cover AC-10, AC-11, AC-12b, AC-17, AC-18 and AC-08 end to end.
- Not verified: a real Telegram bot — still needs a public HTTPS host (as for bot-connection).

## Operational notes

- Migrations: ten reversible migrations — run `pnpm db:migrate` before the new API starts (expand/backfill run before the two contract steps in the same batch). Rollback: revert the deploy, then `pnpm db:rollback` ×10 (drops replies, attempts and read marks).
- Jobs: new queues `inbox.deliver-replies` + `inbox.deliver-replies-dlq`; alert on log `alert: 'inbox.deliver-replies.dead-letter'`.
- Realtime: one extra Postgres connection per API instance (`LISTEN realtime`); the proxy must pass WebSocket `Upgrade` for `/api/workspaces/*/inbox/live` and keep idle timeouts > 25 s.
- Config / feature flag: none.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
