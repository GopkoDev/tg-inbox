# Tracker — group-posts

> Status of every task in the epic. `implement` updates **Status** and **Step** after every
> subagent it runs (and commits them with the task), so this table shows where the run is right now.
> Status: `todo` · `in_progress` · `blocked` · `review` · `done`.
> Step: `SELECT` · `RED` · `GREEN` · `REFACTOR` · `GATE` · `REVIEW` · `COMMIT` (`—` before the task starts).

| # | Task | Layer | Owner | Estimate | Blocked by | Status | Step |
|---|---|---|---|---|---|---|---|
| T1 | Add the shared workspace time-zone rule: IANA validity, local wall time to instant with skipped and repeated hours, display formatting | domain | Dmytro Hopko | S | — | done | COMMIT |
| T2 | Add the posts zod contracts, the 17 new error codes, and the post.changed / destinations.changed frames and signals | ports | Dmytro Hopko | M | — | done | COMMIT |
| T3 | Promote staged migrations 01–04 (workspaces.time_zone, destinations, destination_codes, posts) and regenerate DB types | migration | Dmytro Hopko | S | — | done | COMMIT |
| T4 | Add the posts domain: states and transitions, the schedule window, the 15-minute miss rule, limits, connect-code format and hashing, outcome reasons, Telegram link | domain | Dmytro Hopko | M | T1, T2 | done | COMMIT |
| T5 | Classify group and channel updates in bots into four facts, add channel_post to allowed_updates, and hand them to a late-bound ChatEventsPort | app | Dmytro Hopko | M | T2 | done | COMMIT |
| T6 | Add bots.sendPost, bots.deletePost and postReadiness with a 1-per-second post pacer, and teach the fake Telegram group chats, deleteMessage and getChatMember | app | Dmytro Hopko | M | T2 | done | COMMIT |
| T7 | Add workspaces.timeZone and setTimeZone in the workspaces app layer | app | Dmytro Hopko | S | T3, T1 | done | COMMIT |
| T8 | Build the posts repositories for destinations, destination codes and posts, with cross-workspace isolation tests | infra | Dmytro Hopko | L | T3, T4 | done | COMMIT |
| T9 | Add the destination use cases: create and read a connect code, redeem it from ChatEventsPort, membership / upgrade / rename updates, remove, list, set the time zone | app | Dmytro Hopko | L | T5, T6, T7, T8 | done | COMMIT |
| T10 | Add the post draft use cases and reads: create, save against version, duplicate, delete draft, back to draft, list, get, attention count, mark seen | app | Dmytro Hopko | M | T8 | done | COMMIT |
| T11 | Add the publish confirmation, publish now and schedule / change time against the shown version, queuing one posts.send job in the transaction | app | Dmytro Hopko | L | T9, T10 | done | COMMIT |
| T12 | Add the posts.send job body: re-check owner and limits, per-chat order and pauses, claim before the send, outcomes, missed after 15 minutes, and the dead-letter settler | app | Dmytro Hopko | L | T6, T11 | todo | — |
| T13 | Add delete from Telegram within 48 hours and the deactivation return of scheduled posts | app | Dmytro Hopko | S | T6, T10 | done | COMMIT |
| T14 | Wire posts in buildDeps and buildApp: ChatEventsPort, onMembershipDeactivated, the posts.send queue + DLQ workers, the hub forwarding the two new frames | wiring | Dmytro Hopko | M | T9, T12, T13 | todo | — |
| T15 | Register the posts routes (registerPosts): the 18 operations with zod schemas, guards and error mapping | ports | Dmytro Hopko | M | T11, T13, T14 | todo | — |
| T16 | Add the API end-to-end posts stories, the tenancy and secrecy suite, postIntegrity queries and the timing checks | tests | Dmytro Hopko | M | T15 | todo | — |
| T17 | Add the web posts API source, stores (posts, destinations, attention), time helpers, routes and the Posts nav item with its count | ui | Dmytro Hopko | M | T2, T1 | done | COMMIT |
| T18 | Build SCR-33 Channels & groups with SCR-34 connect-code, SCR-35 remove and SCR-43 time-zone dialogs | ui | Dmytro Hopko | M | T17 | done | COMMIT |
| T19 | Build SCR-36 the Posts list with state filters, workspace-zone times and the attention rows | ui | Dmytro Hopko | S | T17 | done | COMMIT |
| T20 | Build SCR-37 the post editor with autosave, destination picker, sound option and preview, plus SCR-42 delete and SCR-44 back-to-draft dialogs | ui | Dmytro Hopko | M | T17 | done | COMMIT |
| T21 | Build SCR-38 publish-now and SCR-39 schedule dialogs on their owner-only addresses, with the first-time time-zone step | ui | Dmytro Hopko | M | T20 | done | COMMIT |
| T22 | Build SCR-40 the post page for every non-draft state, with SCR-41 delete-from-Telegram and mark-seen | ui | Dmytro Hopko | M | T20 | done | COMMIT |
| T23 | Add browser end-to-end posts flows against the real API: connect, draft, publish, schedule, outcome, delete | tests | Dmytro Hopko | M | T16, T18, T19, T21, T22 | todo | — |
| T24 | Update CLAUDE.md, the architecture map and the design-system canon for the posts module | docs | Dmytro Hopko | S | T15, T18, T19, T21, T22 | todo | — |

**Total:** 24 tasks, ~21 person-days.
