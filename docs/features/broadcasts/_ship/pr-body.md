## Summary

Roadmap step 8: broadcasts. Any member drafts a plain-text broadcast for a tag audience (any of / all of / no tags, plus tags to leave out) or a hand-picked group filled from the Contacts search and filter, and sees how many it would reach and how many are left out (blocked the bot, never wrote to the current bot). Only a business owner launches it, from a confirmation of the exact text and count; launch freezes the recipient list, sending is paced at 25 per second per bot in turns, waits for the bot's send pause and never delays replies, and each recipient gets it at most once. A live report shows per recipient delivered / failed (with reason) / blocked the bot; an owner can stop a sending broadcast; any broadcast can be duplicated (for an ended one, "only recipients it did not reach"). The bot now learns who blocked it from `my_chat_member` and refused sends, marked on Contacts and the profile, and each delivered broadcast shows in the recipient's inbox thread without touching the conversation's state. Spec: [`docs/features/broadcasts/spec.md`](docs/features/broadcasts/spec.md) · changelog: [`_ship/changelog.md`](docs/features/broadcasts/_ship/changelog.md).

## Acceptance criteria

- AC-01 — a tag-audience draft saved and listed for the team, with the audience / blocked / never wrote / would reach breakdown, left-out tags, renamed and deleted tags handled; nothing sent ✓
- AC-02 — name 1–80 and text 1–4096 characters as Telegram counts them (trimmed), the remaining length while typing; an invalid edit keeps the last valid content ✓
- AC-03 — a stale text or audience save is refused with the current version; concurrent group additions and removals are all kept and never make a text save stale ✓
- AC-04 — the hand-picked group: search and add, "add all matching" with its count (current matches added if they changed), remove, blocked markers, its size and reach ✓
- AC-05 — a contact is in a group once; at most 10 000 contacts per audience, a bulk add over it refused as a whole with what can still be added; a larger tag audience saves but cannot launch ✓
- AC-06 — the owner's confirmation (exact text, count, left-out, the spam-report warning); the list frozen to exactly the confirmed contacts; a changed version or reachable set refuses; double / concurrent launch launches once ✓
- AC-07 — an operator sees no Launch, a saved `/launch` link launches nothing, deleting a teammate's draft is refused; own drafts still editable ✓
- AC-08 — other workspaces, deactivated and signed-out callers refused with no hint; groups, recipients and reports only hold their own workspace's contacts; one workspace's bot never sends another's broadcast ✓
- AC-09 — a launched broadcast is read-only (duplicate offered) and its recipients never change; no launch of a draft reaching nobody; the 11th launch in 24 h refused with when the next is possible ✓
- AC-10 — no bot or a bot not working refuses the launch with the way to bot settings; contacts who never wrote to the current bot are left out and counted apart; the same bot reconnected keeps its marks ✓
- AC-11 — the live report (totals and per-recipient outcomes with plain reasons); the mark at the turn decides; a refused send is not retried; restart continues without resending; "not confirmed" never resent ✓
- AC-12 — Telegram refusing the text, or the bot stopping working / disconnected / replaced, ends the broadcast with waiting recipients failed with the reason; nothing sent later ✓
- AC-13 — duplicates "Copy of …" of drafts and launched broadcasts: all recipients, or only those it did not reach (fixable failures, stopped, "not confirmed" after a warning) ✓
- AC-14 — blocks and unblocks from Telegram and refused sends mark and clear the contact live on Contacts and the profile; no message, no unread, no ping; launches leave blocked contacts out ✓
- AC-15 — replies never wait for broadcasts; ≤ 25 broadcast sends per second per bot; two broadcasts take turns; a rate-limit answer pauses broadcasts and they continue without skipping or doubling; other workspaces unaffected ✓
- AC-16 — the broadcast item in the recipient's thread (text, name, launching owner, "not confirmed" when so) never reopens, assigns or marks read; an answer is an ordinary customer message ✓
- AC-17 — each recipient gets exactly one plain-text message with the confirmed text and nothing about other recipients ✓
- AC-18 — the owner's stop (waiting count, cannot be undone): no new send starts, waiting recipients "not sent — stopped", the broadcast "stopped" with who and when; operators cannot stop; a stop after the last outcome changes nothing ✓

## Design

- Spec: `docs/features/broadcasts/spec.md` · UX: `ux-flows.md`, `screens.md` (SCR-24 – SCR-32, changed SCR-02 / SCR-18 / SCR-19)
- Architecture: `docs/features/broadcasts/sad.md`
- Decisions: `docs/features/broadcasts/adr/` (0001–0012)
- Data model + migrations: `docs/features/broadcasts/data-model.md` (migrations `1791681110012`–`1791681110020`) · audit `_audit/data-model-2026-10-23.md`
- API: `docs/features/broadcasts/contracts/openapi.yaml` + `contracts/events.md`
- Test plan: `docs/features/broadcasts/test-plan.md`
- Review: `docs/features/broadcasts/_review/review-2026-10-24.md` — 4 parallel clean-context reviewers, 29 findings + 5 known from implement, 10 re-review findings over 4 rounds, all fixed (W6 dismissed with pinning tests); final verdict **PASS**
- Fix records: `docs/features/broadcasts/_fixes/` (pacer burst after a stall, launch 10 000 timing, turns for a broadcast launched mid-link, same-second unblock)

## Base

This branch is based on `main` at `faa9bda` (contacts, #7); no stacked PR in between.

## Tasks (SDD-Task trailers)

- `5cb9296` roadmap(broadcasts): step 8 takes a hand-picked broadcast group next to tags, draft until launch, read-only after
- `04e9cd5` specify: broadcasts spec.md (+ `84c99cf` .size+.route, `65aeb74` CONTEXT.md, `7e333d7` roadmap.md)
- `515a113` clarify: broadcasts spec.md (22 resolved, 0 deferred) (+ `a079100` CONTEXT.md)
- `f81acef` glossary: broadcasts CONTEXT.md
- `1125d9e` ux-flows: broadcasts ux-flows.md
- `82eb2ec` … `405b2b4` design: broadcasts ADR-0001 – ADR-0012; `1f1f626` design: broadcasts sad.md
- `7d997ae` sequences: broadcasts sad.md runtime flows
- `01dc30a` data-model: broadcasts data-model.md; `3f87b41` … `74a665d` staged migrations 01–08; `a6f38b9` data-model audit
- `5418187`, `e2d1e52` glossary: Count breakdown, sad.md §12 technical terms
- `de0f88b` api: broadcasts openapi.yaml (+ `2e3dd00` events.md, `d9e4b0e` api-sync-report.md, `3d32e3b` flow 8 branch, `8eff1b9` / `39993b4` F-5)
- `1c9f7a2` screens: broadcasts screens.md
- `e029286` tasks: broadcasts breakdown + tasks.json
- `a7c54a3` plan-tests: broadcasts test-plan.md (+ `ff8de15` tasks DoD)
- `4a4ed8d` implement: broadcasts roadmap.md building
- `0dbd51a` [T1] feat(broadcasts): shared broadcast text and name rules
- `a71ee35` [T2] feat(broadcasts): promote contact_bot_reach migrations and reach fixtures
- `fa01c95` [T3] feat(broadcasts): promote broadcast tables migrations and fixtures
- `f0ba3a3` [T4] feat(broadcasts): contracts, BROADCAST_* codes and live frames
- `77a393a` [T5] feat(broadcasts): draft and launch domain
- `d991cfe` [T6] feat(broadcasts): sending and copy domain
- `74c9f8d` [T7] feat(contacts): record per-bot reachability from capture and block changes
- `fa4a7e4` [T8] feat(contacts): evaluate broadcast audiences with the Contacts filter rules
- `11826b7` [T9] feat(contacts): blocked_since for the current bot on Contacts reads
- `3c0af41` [T10] feat(bots): learn blocks from my_chat_member and refused replies
- `94b748f` [T11] feat(bots): re-register outdated webhooks in the health check
- `efc7650` [T12] feat(bots): sendBroadcastMessage with a per-bot pacer, and launchReadiness
- `a515841` [T13] feat(conversations): broadcast items as a thread entry kind
- `6679f13` [T14] feat(broadcasts): draft-side repositories
- `350da78` [T15] feat(broadcasts): recipient repository
- `795e634` [T16] feat(broadcasts): draft use cases and the broadcast.changed publisher
- `f746d94` [T17] feat(broadcasts): the broadcast reads, recipients page and itemDetails
- `a37d308` [T18] feat(broadcasts): broadcast group use cases
- `ca49e4f` [T19] feat(broadcasts): launch confirmation and pre-check
- `507095e` [T20] feat(broadcasts): the launch transaction
- `87c0619` [T21] feat(broadcasts): stop and the settling transaction
- `ce2c29c` [T22] feat(broadcasts): one link of the sending chain
- `100a2df` [T23] feat(broadcasts): duplicate a broadcast into a new draft
- `050cbb4` [T24] feat(broadcasts): sending chain and blocked-share queues on pg-boss
- `7aa959e` [T25] feat(inbox): broadcast items in the thread
- `9f4db78` [T26] feat(broadcasts): register the broadcasts routes and wire the module
- `3e8e4d8` [T27] test(broadcasts): API end-to-end stories, tenancy and secrecy suite, broadcastIntegrity queries (+ `65fd398`, `77d3d8c`)
- `b410e14` [T28] test(broadcasts): seeded sending and timing checks at pilot scale (+ `e31c46d`)
- `e457821` [T29] feat(web): broadcasts API source and list, draft and report stores
- `1ac0f42` [T30] feat(web): Broadcasts list (SCR-24), navigation item and routes
- `efec14c` [T31] feat(web): SCR-25 draft editor Message card, actions and SCR-31
- `63a69b9` [T32] feat(web): SCR-25 tag audience and SCR-32 switch dialog
- `0f573c0` [T33] feat(web): SCR-25 hand-picked group and SCR-26 group picker
- `45e577b` [T34] feat(web): SCR-27 launch confirmation on the /launch address
- `906d042` [T35] feat(web): SCR-28 broadcast page with BroadcastReport and SCR-29 stop
- `8bb098a` [T36] feat(web): SCR-30 duplicate dialog for launched broadcasts
- `e88190a` [T37] feat(web): broadcast item in the inbox thread (SCR-02)
- `1c325d3` [T38] feat(web): blocked-the-bot marker on Contacts and the profile
- `e478cd0` [T39] test(broadcasts): browser end-to-end flows against the real API
- `a7f1e8e` [T40] docs(broadcasts): update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module
- `4432fe6` [fix review-web] fix: broadcasts web review findings — list delete, launch line, stale-save and paging races, field errors
- `b52fa6a` [fix same-second-unblock] fix: broadcasts a refused-send block is kept to the whole second, so a same-second message unblocks
- `0626c8c` [fix pacer-burst / turns / launch-10000] fix: broadcasts sending and launch review findings (+ docs `c93c996`, `6d5913d`, `5fe7a5e`)
- `2d3e831` [fix rereview-api] fix: broadcasts re-review findings — token lost and pasted again, pause check without a read, thread cursor ids (+ docs `21425f7`, `4cda296`)
- `0e751f4` [fix rereview-web] fix: broadcasts web re-review findings — Show more wins over a re-read, no armed save after a stale choice, shared serialRead
- `f01f2f7`, `71df6b2`, `137c5df` [fix rereview-api] `needs_token_at` on an undone paste, from the app's clock, required on a `needs_token` patch
- `998c896` fix: broadcasts record 2026-10-24 pacer burst, launch timing, turns, same-second unblock
- `7ccb4f9` review: broadcasts review-2026-10-24.md

## Verification

Re-run at ship (2026-10-24, head `7ccb4f9`, Node 26):

- Lint: `pnpm lint` (ESLint + Prettier + tsc) — clean. Build: `pnpm -r build` — green.
- Unit + integration: `pnpm test` — 323 files, 4 466 tests: 4 464 passed, 2 failed, both the known load-only server-time budgets under the full parallel suite: `e2e/broadcasts-load` freezing 10 000 recipients (4 046 ms vs the 2 s budget; review K2) and `e2e/contacts-load` merge on 10 000 contacts (hook timeout, pre-existing since contacts). Each re-run alone passes: `broadcasts-load.int.test.ts` 6/6 (incl. the 25-per-1 s pace check and stop-takes-effect), `contacts-load.int.test.ts` 10/10. Green alone = green; the launch budget is worth re-measuring on an idle production-like host.
- API end-to-end + smoke: `vitest run e2e/broadcasts-flows.int.test.ts e2e/broadcasts-tenancy.int.test.ts app.int.test.ts` — 3 files, 26 tests passed (the AC stories, tenancy and secrecy suite, the `broadcastIntegrity` queries, `GET /health`).
- Browser e2e against the real API, an ephemeral migrated Postgres and the fake Bot API: `pnpm --filter @tg/web test:e2e` — 39/39 passed, including the 5 broadcasts flows in `apps/web/e2e/broadcasts.spec.ts`. Observed:
  - AC-01 / AC-07 — an operator's tag audience "any of VIP, Staff left out" over 6 contacts shows Audience 3, left out — blocked the bot 1, never wrote 0, Would reach 2; "Saved", the draft listed for the owner as "Draft · 3 contacts · Ana"; no Launch button, "Only a business owner launches broadcasts.", the `/launch` link opens no dialog; no Delete on the owner's draft.
  - AC-04 — the group picker: search adds Customer01 and Olena ("In group ✓"), the Wholesale filter shows "4 of 6 contacts match" with Customer03 "Blocked the bot", "Add 3 contacts to this group?" → "3 contacts added."; the group holds 5 (Would reach 4), removing one leaves 4 (Would reach 3) and the contact keeps its tag.
  - AC-06 / AC-11 / AC-16 / AC-17 — the owner's confirmation ("This message goes to 3 contacts from your business bot") shows the exact text, 1 left out as blocked, "Would reach 3" and the warning that customers can block or report the bot, which can limit it for support too; after confirming the page shows "Launched by Olga ·", Sent to 3, goes Sending → "Finished" live with Delivered 3 / Waiting 0 / Failed 0, and the operator's list shows Sent; the fake Bot API received exactly one message per recipient (chat ids 792 001–792 003, none to the left-out contact) with the confirmed text; the recipient's closed conversation stays closed with 1 unread, and its thread shows the broadcast item "sent by Olga", linking to the broadcast, not as a reply bubble.
  - AC-18 / AC-07 / AC-13 — with 12 recipients and the first sends held by the fake, the stop dialog says "N recipients are still waiting." and "A stop can't be undone."; the broadcast becomes Stopped with "Stopped by Olga ·" for both members, the operator never sees Stop; in-flight sends finish as delivered, Waiting 0, and the Bot API received exactly 12 − stopped messages; Duplicate → "Only recipients it didn't reach" creates "Copy of Spring sale", a hand-picked group of exactly the stopped recipients.
  - AC-14 — a `my_chat_member` block marks the contact "Blocked the bot" on the open Contacts list live (others untouched), the profile says "since …" with no new message bubble; an unblock clears the line live; the bot sent nothing.
- Smoke boot of the production build (`node apps/api/dist/main.js`, `NODE_ENV=production`, `WEB_DIST_DIR` set) against a fresh Postgres 16 container: `pnpm db:migrate` applied all 50 migrations (incl. `1791681110012`–`1791681110020`); `GET /health` → 200 `{"status":"ok","db":"up"}`; `GET /api/workspaces/:id/broadcasts` without a session → 401 `UNAUTHENTICATED`; `GET /w/:id/broadcasts` (HTML) → 200 `index.html`; unknown `/api/*` → JSON 404. Then `pnpm db:rollback` x9 → 41 migrations, last `1791681110011_create_contact_tag_history`, no `broadcast*` / `contact_bot_reach` tables and no `bots.needs_token_at`; `pnpm db:migrate` again → 50. The container was removed.
- Noted, not a defect of this branch: a body-carrying POST without a session (e.g. `…/launch` with `{}`) answers 400 `VALIDATION_ERROR` before 401, because route schemas validate before the session `preHandler` — the same order as every existing module.
- Not verified: the spec §6 production-scale targets (10 000-recipient completion within 10 minutes against real Telegram, reply p95 during a broadcast, cross-workspace load) need a production-like host and a real bot; CI runs the seeded single-run versions with the fake Bot API.

## Operational notes

- Migrations: nine reversible migrations (`1791681110012`–`1791681110020`) — run `pnpm db:migrate` on deploy before the new API starts. The reach backfill treats existing contacts as having written to their workspace's current bot. Rollback: revert the deploy, then `pnpm db:rollback` x9 (drops broadcasts, groups, recipients, broadcast items, blocked marks and `bots.needs_token_at`; contacts, conversations and messages stay).
- After the deploy each bot's next health check (≤ 3 min) re-registers its webhook with `my_chat_member`; no owner action.
- New pg-boss queues: `broadcasts.send` (stately, per workspace, retry 3, expire 60 s), DLQ `broadcasts.send-dlq` (restarts the chain 60 s later), `broadcasts.measure-blocked-share` (48 h after a launch). New tenancy exception: none.
- Config / feature flag: none new.
- Live: `broadcast.changed`, `contact.changed` `reach` and `conversation.changed` item type `broadcast` (ids only); tabs opened before the deploy ignore them until their next read.
- Run-book integrity queries: `broadcastIntegrity.*` in `apps/api/src/e2e/helpers.ts`, nine queries, all expect 0 rows.
- Residual notes from the review: freezing 10 000 recipients is ~0.5 s idle but 3–4 s under full parallel-suite load vs the 2 s budget (machine load; dropping the redundant plain `workspace_id` FK of `broadcast_recipients` would save ~25 %, a schema follow-up); the `reply` / `activity` thread cursors accept any non-empty id (pre-existing).
- Open questions: OQ-1 (recent / opted-in audiences) and OQ-3 (grouping answers) are due after 30 days of pilot broadcasts; OQ-4 (removing a contact) was due before this step shipped and remains open on its default — no in-product deletion, the tg-inbox team erases by hand on request. Decide whether that is acceptable before merging.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
