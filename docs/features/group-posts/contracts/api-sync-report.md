# API sync report — group-posts (2026-11-03)

Contract: `openapi.yaml` (18 paths, 19 operations, delta) + `events.md`. Inputs found: `data-model.md` ✓, `sad.md` §6 flows 1–11 ✓, `spec.md` §4/§5 ✓, `CONTEXT.md` ✓.

## Repo deviations from the skill defaults (kept, as in every earlier contract)

Session cookie (not bearer); `/api/...` with no version segment; GET reads + action POSTs; `{ "error": { code, message, details? } }` with UPPER_SNAKE codes from `packages/shared/src/errors.ts`; no `Idempotency-Key` (idempotent by state under the post row lock; jobs enqueued in the writing transaction).

## Field origins

| Path | Origin | Confidence |
|---|---|---|
| Destination.id / kind / title / username | destinations.id / kind / title / username | high |
| Destination.availability / problem | destinations.availability / problem + `not_current_bot` computed from destinations.telegram_bot_id vs bots.telegram_bot_id (existing schema) | high |
| Destination.scheduled_count, DestinationList.scheduled_total | count of posts WHERE state = scheduled (posts_scheduled_idx) | high |
| Destination.connected_by / connected_at | destinations.connected_by_account_id → memberships display name (workspaces app layer) / connected_at | high |
| DestinationList.time_zone, TimeZoneSet.time_zone | workspaces.time_zone | high |
| DestinationCodeCreated.code / group_command | generated, never stored (destination_codes.code_hash); bot username from bots (existing) | high |
| DestinationCodeStatus.status | destination_codes.result / used_at / expires_at / replaced_at | high |
| DestinationCodeStatus.needed_right | derived from result `no_post_right` + destinations kind (channel → post_messages, group → send_messages) | medium |
| PostSummary.text_start | posts.text (first 120 characters) | high |
| Post.state / version / text / silent | posts.state / version / text / silent | high |
| Post.schedule | posts.schedule_kind / scheduled_for / scheduled_by_account_id | high |
| Post.published_at / telegram_link | posts.published_at / telegram_message_id + destinations.username or chat_id (`t.me/c/` form) | high |
| Post.deletable_until | posts.published_at + 48 h (ADR-0008) | high |
| Post.outcome_reason / outcome_at / needs_attention / draft_notice | posts columns of the same names | high |
| Post.deleted_at / deleted_by | posts.deleted_at / deleted_by_account_id | high |
| PublishConfirmation.sent_last_24h / frees_at | count over posts_sent_idx; frees_at = 30th newest sending_started_at + 24 h | high |
| PublishConfirmation.blockers | derived from post, destination and bots readiness | high |
| PostAttention.count | count over posts_attention_idx | high |
| PostSchedule.local_time / time_zone | input; converted to posts.scheduled_for by packages/shared/src/time-zone.ts | high |

## Drift checklist

- [x] **Endpoint ↔ model** — every response field has a column or a stated derivation above; no field without origin.
- [x] **Error code ↔ repo** — reused: `NOT_FOUND`, `FORBIDDEN`, `OWNER_ONLY`, `ACCESS_REMOVED`, `VALIDATION_ERROR`, `TELEGRAM_UNAVAILABLE`. New (to add to `packages/shared/src/errors.ts` at implement): `POST_TEXT_INVALID`, `POST_DRAFT_CHANGED`, `POST_NOT_A_DRAFT`, `POST_NOT_SCHEDULED`, `POST_NOT_PUBLISHED`, `POST_SCHEDULE_OUT_OF_RANGE`, `POST_TIME_DOES_NOT_EXIST`, `POST_DAILY_LIMIT_REACHED`, `POST_SCHEDULED_LIMIT_REACHED`, `POST_DELETE_WINDOW_PASSED`, `POST_DELETE_REFUSED`, `DESTINATION_UNAVAILABLE`, `DESTINATION_LIMIT_REACHED`, `POSTS_NEED_WORKING_BOT`, `TIME_ZONE_REQUIRED`, `TIME_ZONE_INVALID`, `TIME_ZONE_CHANGED` (sad.md §8's list, finalised here; a missing destination at publish is a `blockers` entry and `400 VALIDATION_ERROR`).
- [x] **Validation ↔ constraint** — text ≤ 4096 (posts_text_check + shared rule), time_zone ≤ 64 (workspaces_time_zone_check), 20 / 30 / 100 limits stated in descriptions and schemas (`maxItems: 20`, `daily_limit`, `scheduled_limit`).
- [x] **OpenAPI ↔ sequence** — every §6 alt-branch has a response: flow 3 (stale, not a draft, invalid, foreign, delete refused), flow 4 (owner, version, bot / destination, daily, already scheduled), flow 5 (zone missing, skipped / range, limits, not scheduled), flow 8 (operator, window, refused, no answer → 503), flow 9 (not found), flow 10 (operator). Flows 1, 2, 6, 7, 11 are async / inbound and live in events.md.

## Back-feed (coverage)

| AC | Operations / events |
|---|---|
| AC-01 | createDestinationCode, getDestinationCode, inbound `destination_code`, `destinations.changed` |
| AC-02 | getDestinationCode `no_post_right` / `expired`, inbound `ignored` |
| AC-03 | `OWNER_ONLY` on code, remove, time zone, publish-confirmation, publish, schedule, delete-from-telegram |
| AC-04 | `PostsItemNotFound` on every id route |
| AC-05 | createPost, savePost, listPosts |
| AC-06 | savePost `POST_TEXT_INVALID`, `POST_DRAFT_CHANGED`; publish-confirmation `blockers` |
| AC-07 | getPublishConfirmation, publishPost, getPost `telegram_link`, duplicatePost |
| AC-08 | publishPost `already_scheduled`, `POST_DRAFT_CHANGED`; posts.send claim + `not_confirmed` |
| AC-09 | setPostingTimeZone, schedulePost, movePostBackToDraft |
| AC-10 | schedulePost `POST_SCHEDULE_OUT_OF_RANGE`, `POST_TIME_DOES_NOT_EXIST`, `DESTINATION_UNAVAILABLE` |
| AC-11 | movePostBackToDraft, savePost `POST_NOT_A_DRAFT`, `draft_notice` |
| AC-12 | posts.send / posts.send-dlq `missed`, getPostAttention |
| AC-13 | Post.outcome_reason, markPostSeen, getPostAttention, Destination.problem |
| AC-14 | `POSTS_NEED_WORKING_BOT`, problem `not_current_bot`, inbound `chat_migrated` |
| AC-15 | deletePostFromTelegram |
| AC-16 | `POST_DAILY_LIMIT_REACHED`, `POST_SCHEDULED_LIMIT_REACHED` |
| AC-17 | inbound `ignored`; posts.send per-chat wait (events.md) |
| AC-18 | deletePostDraft `FORBIDDEN`, `POST_NOT_A_DRAFT` |

Every operation maps to a §4 user story (summaries) and ≥ 1 AC. No sequence gap found.

## Open points (recorded, not blocking)

- `listPosts` is unpaged with a 200 cap and `truncated` — a pilot sends ≤ 30 posts a day; keyset paging is the follow-up if a workspace passes 200. Owner: Dmytro Hopko, due: after the first 30 days of pilot posting.
- `spectral lint` is not wired in the repo (as for earlier contracts); the contract was parsed and every `$ref` resolved by a script.
