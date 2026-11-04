## Summary

Roadmap step 10 adds group and channel posts. A business owner connects the business's Telegram channels and groups by posting a single-use code in the chat itself. Any member then drafts a plain-text post for one destination, and only an owner publishes it now or schedules it in the workspace time zone.

Each post goes out from the business bot exactly once and exactly as confirmed. It goes out on time, in order and paced per chat; if it cannot start within 15 minutes, it is marked missed and never published late. Outcomes (published with a link, failed with a reason, missed, not confirmed) show live and are counted for the team's attention. An owner can delete a published post from the chat within 48 hours.

Nothing written in a destination chat is captured, and posting never sets the bot's send pause.

Spec: [`docs/features/group-posts/spec.md`](docs/features/group-posts/spec.md) · changelog: [`_ship/changelog.md`](docs/features/group-posts/_ship/changelog.md).

**Stacked:** branched from `main` after PR #8 (broadcasts) was merged, so it has no dependency on another open PR.

## Acceptance criteria

- AC-01 — "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the cha… ✓
- AC-02 — the chat is not connected, and Settings tells the owner which right the bot needs in that chat; a chat the bot was added to without a code never becomes a destination; an expired o… ✓
- AC-03 — they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refuse… ✓
- AC-04 — the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot ✓
- AC-05 — the draft is saved as they type, shows how the text will look in the chat and how many characters remain, and appears on the Posts page for every member with its destination and wh… ✓
- AC-06 — the draft cannot be published or scheduled, the editor says plainly what is missing or too long, and a stale save is refused with the teammate's current version shown, never overwr… ✓
- AC-07 — the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published wi… ✓
- AC-08 — the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is mark… ✓
- AC-09 — the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due togeth… ✓
- AC-10 — the post is not scheduled and the owner is told the allowed range, that this time does not exist on that day, or what right the bot is missing in that chat ✓
- AC-11 — the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publi… ✓
- AC-12 — it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, pac… ✓
- AC-13 — the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the d… ✓
- AC-14 — while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different… ✓
- AC-15 — the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the p… ✓
- AC-16 — the system refuses and says the daily posting limit (and when posting is possible again) or the scheduled-post limit was reached; a scheduled post whose time comes while the daily… ✓
- AC-17 — nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegra… ✓
- AC-18 — they are refused and told only its author or a business owner can delete it; a scheduled post must be moved back to a draft first, and a published, failed or missed post is kept as… ✓

## Design

- Spec: `docs/features/group-posts/spec.md` · UX: `ux-flows.md`, `screens.md` (SCR-33 – SCR-44, changed SCR-15)
- Architecture: `docs/features/group-posts/sad.md`
- Decisions: `docs/features/group-posts/adr/` (0001–0008)
- Data model + migrations: `docs/features/group-posts/data-model.md` (live `1791681110021` … `1791681110025`)
- API: `docs/features/group-posts/contracts/openapi.yaml`, `events.md`
- Review: `docs/features/group-posts/_review/review-2026-11-04.md`. It took four rounds and 36 findings; all were fixed and none deferred. Final verdict: PASS.

## Tasks (SDD-Task trailers)

- `1e2250a` T1 — feat(group-posts): add the shared workspace time-zone rule: IANA validity, local wall time to instant, display formatting
- `f2e2788` T3 — feat(group-posts): promote staged migrations 01-04 (time_zone, destinations, destination_codes, posts) and regenerate DB types
- `5123d84` T2 — feat(group-posts): add the posts zod contracts, the 17 new error codes, and the post.changed / destinations.changed frames and signals
- `02d70c4` T7 — feat(group-posts): add workspaces.timeZone and setTimeZone in the workspaces app layer
- `3834888` T7 — feat(group-posts): fix T7 merge with T2 error codes (dedupe TIME_ZONE_INVALID, restore closing brace)
- `0ad9e31` T4 — feat(group-posts): add the posts domain with states, schedule window, miss rule, limits and connect codes
- `0defbba` T17 — feat(group-posts): add the web posts api, stores, time helpers, routes and the posts nav item
- `76db5ea` T5 — feat(group-posts): classify group and channel updates in bots into four facts and hand them to chat events port
- `f41d9b8` T8 — feat(group-posts): build the posts repositories for destinations, destination codes and posts
- `cea7f44` T18 — feat(group-posts): build scr-33 channels & groups with connect-code, remove and time-zone dialogs
- `eb28d06` T19 — feat(group-posts): build scr-36 the posts list with state filters, workspace-zone times and attention rows
- `60ffc2c` T20 — feat(group-posts): build scr-37 the post editor with autosave, destination picker, sound option and preview
- `d1631ee` T20 — feat(group-posts): add the post editor and dialog tests
- `039c0d1` T6 — feat(group-posts): add bots.sendPost, bots.deletePost and postReadiness with a 1-per-second post pacer
- `3a8121e` T10 — feat(group-posts): add the post draft use cases and reads
- `570b343` T21 — feat(group-posts): build scr-38 publish-now and scr-39 schedule dialogs with the first-time time-zone step
- `ec48ecc` T22 — feat(group-posts): build scr-40 the post page for every non-draft state with scr-41 delete-from-telegram
- `ab19e2f` T9 — feat(group-posts): add the destination use cases for connect codes, chat events, time zone and reads
- `3e86289` T13 — feat(group-posts): add delete from telegram within 48 hours and the deactivation return of scheduled posts
- `0501f9d` T11 — feat(group-posts): add the publish confirmation, publish now and schedule / change time against the shown version
- `6f0e258` T12 — feat(group-posts): add the posts.send job body with claim before send, outcomes and the dead-letter settler
- `5d489fb` T14 — feat(group-posts): wire posts in buildDeps and buildApp with chat events, queues and deactivation return
- `fb3d245` T15 — feat(group-posts): register the posts routes with zod schemas, guards and error mapping
- `cff4fac` T16 — test(group-posts): add postIntegrity queries and the posts integrity test
- `d263667` T24 — docs(group-posts): update CLAUDE.md, the architecture map and the design system for posts
- `111510c` T23 — test(group-posts): add browser end-to-end posts flows against the real api
- `edfe684` T25 — refactor(group-posts): fix the posts.send job order, pace, stale settle, missed-now wait and lock order
- `988a6be` T26 — refactor(group-posts): fix connecting and telegram classification for destinations
- `4879eb9` T27 — refactor(group-posts): fix posts reads and drafts: sql list filters, idempotent back-to-draft, owner lock
- `599cb57` T28 — test(group-posts): write the missing api end-to-end posts suites (reopened t16)
- `610089f` T29 — refactor(group-posts): fix the post address with one page instance, a post store and owner change time
- `552b021` T30 — feat(group-posts): complete the editor and post page states with save errors and workspace-zone times
- `1ff43c6` T31 — refactor(group-posts): fix the list and settings: needs_attention marker, live connect dialog, zone select, crumb
- `03ed16b` T32 — feat(group-posts): make the web tests assert real outcomes and run the browser e2e suite green, adding attention and change-time flows
- `db39131` T33 — refactor(group-posts): guard a live claim against a same-moment job, prove the owner re-check, step migration tests off 025
- `787dbc6` T35 — refactor(group-posts): keep one post page instance across new, :id, publish and schedule with real lazy routes
- `5740ba8` T34 — test(group-posts): add the missing api e2e suites for outage catch-up, on-time publish, delete, daily limit and posts-load
- `f47e01d` T36 — feat(group-posts): show the destination-limit result in the connect dialog and use the workspace zone for expiry and change-time
- `4af501d` T37 — test(group-posts): make the whole browser e2e suite pass, starting with the AC-01 connect flow
- `294c827` T38 — feat(group-posts): create one connect code per dialog open and show expiry without a time zone
- `3afeb37` T38 — feat(group-posts): mark T38 done in tasks.json
- `141ad86` T39 — feat(group-posts): guarantee a later run settles a claimed post as not confirmed
- `3563bfa` T40 — feat(group-posts): measure reply latency during posts and add error or retry when the zone cannot be read
- `318fb86` T38 — fix(group-posts): take the connect code's id and time after the posts lock so the later code stays live
- `bf55825` T38 — fix(group-posts): show the connect code expiry as minutes left while the workspace has no time zone
- `4edf042` T39 — test(group-posts): the dead-letter settler leaves a live sending claim alone and re-queues it
- `9429f6c` T40 — test(group-posts): keep posts going for the whole reply window in the AC-17 load run

## Verification

Each tier was run alone on a fresh Docker.

- **Lint + typecheck:** `pnpm lint` is clean (eslint, prettier, tsc for shared, api, web and web e2e).
- **Unit + integration:** `pnpm test` gives 4962 / 4964. The two failures:
  - the connect-code race, fixed afterwards in `318fb86` and green 3 / 3;
  - the `posts-load` reply-latency threshold under full-suite parallel load. That suite passes 3 / 3 when run alone (≈ 45 s).
- **Browser e2e (real API + Postgres + pg-boss + fake Bot API, Chromium):** 47 / 47, including every posts flow.
- **Ran the feature** through the browser e2e against the wired system:
  - **AC-01:** the owner posts the code in the channel, and the dialog turns to "Acme Flowers News is connected" while the destination appears live.
  - **AC-07:** an operator drafts and the owner publishes once; the post shows published with the owner and a Telegram link.
  - **AC-09:** a post scheduled for 09:00 in Europe/Kyiv goes out by itself with no one online; an owner changes the time; an operator is not offered it.
  - **AC-13:** a refused post is counted next to Posts for the whole team until a member opens it.
  - **AC-15:** the owner deletes a published post from Telegram, and its text stays readable.

## Operational notes

- **Migrations:** five reversible migrations; run `pnpm db:migrate` before the new API starts. To roll back, revert the deploy, then run `pnpm db:rollback` five times. This drops posts, destinations, codes and the workspace time zone.
- **Webhooks:** the bots health check re-registers each webhook with `channel_post` within ≤ 3 minutes of the deploy. A channel's connect code is received after that.
- **Jobs:** `posts.send` (standard, retry 2, expire 60 s) and `posts.send-dlq`.
- **Feature flag / config:** none. No new tenancy exception. Post text, chat titles, codes and chat ids are never logged.
- **Residual:** the timing thresholds in `posts-load` and `broadcasts-load` are load-sensitive under the full parallel suite on a developer machine.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
