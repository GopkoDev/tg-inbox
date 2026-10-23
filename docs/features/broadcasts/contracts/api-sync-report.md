---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-23"
feature_size: L
---

# API sync report — broadcasts

This report is derived from these inputs:
- `data-model.md` and the staged `migrations/01–08` (`contact_bot_reach` + backfill, `conversations_workspace_id_id_key`, `broadcasts`, `broadcast_audience_tags`, `broadcast_group_contacts`, `broadcast_recipients`, `broadcast_items`);
- the existing schema: `contacts` (names, username, `telegram_user_id`), `tags` / `contact_tags` (the audience match, through `contacts`), `memberships` (display names through `workspaces`), `bots.state` (launch readiness through `bots`), `conversations` (`conversations_contact_id_key`);
- `sad.md` §1, §4, §5, §7, §8 and §6 (seeded flows 1–4, flows 5–19);
- `spec.md` §4/§5 (and §1 clarifications, §6, §6.1);
- feature ADR-0001…0012; `CONTEXT.md` (Audience, Tag audience, Broadcast group, Launch, Recipient list, Count breakdown, Delivery report, Broadcast item, Draft author, Duplicate, Not confirmed, Blocked the bot);
- the shipped contracts this one is a delta over (`../../shared-inbox/contracts/*`, `../../assignment-statuses/contracts/*`, `../../contacts/contracts/*`, `../../operator-notifications/contracts/*`, `../../bot-connection/contracts/openapi.yaml`, `../../workspace-operators/contracts/openapi.yaml`) and the live code they became (`packages/shared/src/{inbox,contacts,errors}.ts`, `apps/api/src/platform/errors.ts`).

Size **L**, route **full** (from `.size` / `.route`).

**Contract forms** (from `sad.md` `target_surfaces: [backend-service, web-frontend]`):

- `backend-service` → [`openapi.yaml`](openapi.yaml), OpenAPI 3.1, a **delta**: 17 added + 6 changed operations. Unchanged pieces are external `$ref`s into the shared-inbox, assignment-statuses, contacts, bot-connection and workspace-operators contracts; every operation and schema carries `x-delta`. `redocly lint` (`@redocly/cli@1.34.5`) resolves the external refs and reports the document **valid**, with the 3 warnings every precedent accepts:
  - no `info.license`;
  - `openLiveSocket` has no `2XX` (a `101` upgrade);
  - `ErrorCode` is never referenced. It documents the registry delta; the `*Error` schemas pin each code with `const`.
- `backend-service` (async) → [`events.md`](events.md): the `broadcast.changed` frame and signal, the widened `contact.changed` and `conversation.changed`, the three pg-boss queues, the inbound `my_chat_member` update and the log events.
- `web-frontend` consumes both. It does not author a contract.

## Assumptions (autonomous run 2026-10-23)

Each can be vetoed at review.

1. **Methods follow the repo:** GET reads and action POSTs only (`…/save`, `…/audience`, `…/delete`, `…/duplicate`, `…/launch`, `…/stop`, `…/group/contacts/{contactId}/remove`, `…/group/add-matching`). Wire names are snake_case (`expected_version`, `expected_group_size`, `exclude_tag_ids`, `include_not_confirmed`).
2. **Two save routes, one version.** Name and text save through `saveBroadcastFields` (either or both), the audience through `saveBroadcastAudience` (a whole tag audience, or a kind switch). Both carry `expected_version` and raise the one `version` (ADR-0005). An audience save sent as `kind: group` while already a group is a no-op without a version raise.
3. **A draft's text may be empty only until it is first saved with a value.** `createBroadcast` takes `text` optionally (the draft exists from its first valid name, data-model assumption 3); `saveBroadcastFields` refuses an empty text with `BROADCAST_TEXT_INVALID` (AC-02); the launch confirmation and the launch refuse an empty text with `BROADCAST_TEXT_INVALID` (the data-model hand-off).
4. **`mode: none` takes no tags at all** — neither chosen nor left out — and a tag cannot be both chosen and left out: both are `400 VALIDATION_ERROR`, as contacts' `mode=none` + `tag`. A foreign or gone tag id in a save is `404 TAG_NOT_FOUND` (the existing contacts code) naming the id, so the editor can drop it (flow 7 "refused as not found").
5. **Group writes on a draft whose audience is a tag audience** (a teammate switched the kind meanwhile) answer `409 BROADCAST_DRAFT_CHANGED` with the current draft. sad.md flow 8 now draws this branch (flag F-3). A remove answers `200 unchanged` instead, like every absent row.
6. **"Add all matching" is two calls:** `countBroadcastGroupMatching` (GET, the number the picker states) and `addBroadcastGroupMatching` (POST with the same search and filter plus `expected_count`). The add answers `expected_count` and `added_count`, so the picker can say the matches changed (AC-04). Over 10 000 is refused as a whole with `can_add`.
7. **The Contacts list re-reads on `contact.changed { change: reach }`** for a contact on its current page, though it ignores `tags` (contacts: not live). sad.md §4 ("refetch on `contact.changed` with `change: 'reach'`") and flow 16 ask for it; it is the list's one live field. `screens` draws it.
8. **The launch confirmation is the pre-check** (sad.md §6 sequences flag): `getLaunchConfirmation` answers either the confirmation or one of the launch refusals with the same codes as `launchBroadcast`. Order of checks: draft → text → bot → cap → size → reachable.
9. **Two "changed" codes at launch.** A version mismatch is `BROADCAST_DRAFT_CHANGED` with the current draft (as every draft save; the panel re-reads the confirmation); a different reachable set is `BROADCAST_AUDIENCE_CHANGED` with the current confirmation (version, breakdown, fingerprint) to confirm again (ADR-0006).
10. **A second launch answers `200` with `outcome: already_launched`** and the launched broadcast, not an error (ADR-0006 "returns the launched broadcast"); the panel opens the broadcast page either way.
11. **Launch and stop by an operator are `403 OWNER_ONLY`** (the repo's `ownerOnly` guard class, as contacts' tag admin), and a foreign delete is `403 FORBIDDEN` with the message "A draft is deleted by its author or a business owner" (sad.md §8 "`ForbiddenError`"). Neither needs a new code.
12. **Stop is idempotent by state:** only `sending` with waiting recipients settles; anything else (nothing waiting, ended, already stopped, a draft) answers `200 unchanged` with the broadcast as it is (seeded flow 4 "else nothing waiting → unchanged").
13. **Duplicate audiences are named** `same` (a draft source, the default), `same_tags`, `all_recipients`, `not_reached`; a choice that does not fit the source is `400 VALIDATION_ERROR` with `details.field = audience`. "Only recipients it did not reach" while the source still sends is the new `409 BROADCAST_NOT_ENDED` (flag F-2).
14. **Totals expose every recipient state** (`waiting`, `sending`, `delivered`, `blocked`, `failed`, `not_confirmed`, `stopped`). The spec's wording groups `sending` under waiting and `not_confirmed` under failed; `screens` decides the grouping on the page.
15. **The draft breakdown's `reach` is null with no bot row** (sad.md §6 assumption: "reach is known once a bot is connected"); a bot that is not working still gets a full breakdown.
16. **Page sizes are fixed at 50** for the group and the recipients (ux-flows), with no `limit` parameter. The Broadcasts list is not paged (ux-flows assumption).
17. **One cursor type** — the shared-inbox opaque `Cursor`. The group cursor encodes (`added_at`, `contact_id`), the recipients cursor the last `position`; the thread cursor gains the kind `broadcast`.
18. **No `Idempotency-Key`.** The one async actor (the `broadcasts.send` chain) is enqueued inside the launch transaction, under the broadcast row lock; a retried launch finds `sending` and enqueues nothing. Every other write is idempotent by state.

## Operations

| operationId | Delta | Method + path (under `/api/workspaces/{workspaceId}` unless noted) | Flows | US | AC |
|---|---|---|---|---|---|
| `listBroadcasts` | added | `GET /broadcasts` | 5 | US-01, US-04 | AC-01, AC-08 |
| `createBroadcast` | added | `POST /broadcasts` | 6 | US-01 | AC-01, AC-02, AC-10 |
| `getBroadcast` | added | `GET /broadcasts/{broadcastId}` | 7, 11 | US-01, US-03, US-04 | AC-01, AC-05, AC-08, AC-09, AC-10, AC-11, AC-14, AC-18 |
| `saveBroadcastFields` | added | `POST /broadcasts/{broadcastId}/save` | 6 | US-01 | AC-02, AC-03, AC-09 |
| `saveBroadcastAudience` | added | `POST /broadcasts/{broadcastId}/audience` | 7 | US-01, US-02 | AC-01, AC-03, AC-05, AC-08 |
| `listBroadcastGroup` | added | `GET /broadcasts/{broadcastId}/group` | 8 | US-02 | AC-04, AC-14 |
| `getBroadcastGroupMembership` | added | `GET /broadcasts/{broadcastId}/group/membership` | 8 | US-02 | AC-04, AC-05 |
| `addBroadcastGroupContact` | added | `POST /broadcasts/{broadcastId}/group/contacts` | 8 | US-02 | AC-03, AC-04, AC-05, AC-08 |
| `removeBroadcastGroupContact` | added | `POST /broadcasts/{broadcastId}/group/contacts/{contactId}/remove` | 8 | US-02 | AC-03, AC-04 |
| `countBroadcastGroupMatching` | added | `GET /broadcasts/{broadcastId}/group/matching` | 8 | US-02 | AC-04, AC-05 |
| `addBroadcastGroupMatching` | added | `POST /broadcasts/{broadcastId}/group/add-matching` | 8 | US-02 | AC-03, AC-04, AC-05 |
| `deleteBroadcast` | added | `POST /broadcasts/{broadcastId}/delete` | 9 | US-01 | AC-07, AC-08, AC-09 |
| `duplicateBroadcast` | added | `POST /broadcasts/{broadcastId}/duplicate` | 15 | US-05 | AC-07, AC-08, AC-13, AC-18 |
| `getLaunchConfirmation` | added | `GET /broadcasts/{broadcastId}/launch-confirmation` | 10 | US-03 | AC-05, AC-06, AC-07, AC-09, AC-10 |
| `launchBroadcast` | added | `POST /broadcasts/{broadcastId}/launch` | seeded 1, 10 | US-03 | AC-05, AC-06, AC-07, AC-08, AC-09, AC-10 |
| `stopBroadcast` | added | `POST /broadcasts/{broadcastId}/stop` | seeded 4, 11 | US-04 | AC-18 |
| `listBroadcastRecipients` | added | `GET /broadcasts/{broadcastId}/recipients` | 11 | US-04 | AC-11, AC-12, AC-18 |
| `getThreadBroadcastItem` | added | `GET /inbox/conversations/{conversationId}/broadcast-items/{broadcastItemId}` | 18 | US-07 | AC-16 |
| `listThreadItems` | changed | `GET /inbox/conversations/{conversationId}/items` | 18 | US-07 | AC-16 |
| `listContacts` | changed | `GET /contacts` | 8, 16 | US-02, US-06 | AC-04, AC-10, AC-14 |
| `getContact` | changed | `GET /contacts/{contactId}` | 16 | US-06 | AC-14 |
| `openLiveSocket` | changed | `GET /inbox/live` (WebSocket) | 5, 11, 16, 18 | US-04, US-06, US-07 | AC-01, AC-11, AC-14, AC-16 |
| `receiveTelegramUpdate` | changed | `POST /api/telegram/webhook/{botId}` | seeded 3, 16, 17 | US-06 | AC-14 |

Not on the wire: the send chain (flows 12–14, 19 — events.md jobs), the health check's webhook re-registration (flow 17), capture's reach write (flow 16), `bots.sendBroadcastMessage` and the pacer (ADR-0008), and a reply refused as blocked marking the contact (ADR-0003). US-08 (End customer) has no panel route: its AC-17 is the send's plain text with no `parse_mode` (events.md, integration tests against the fake Telegram).

## Deviations from the api-skill defaults

| Default | Contract | Authority |
|---|---|---|
| `BearerAuth` global | `SessionCookie` global (restated locally only because a security requirement names a local scheme); the webhook keeps `TelegramSecretToken` | workspace-operators ADR-0002; bot-connection; precedents |
| `/api/v1/…` URL versioning | `/api/workspaces/{workspaceId}/…` | workspace-operators ADR-0003, ADR-0004 |
| Envelope `{code, message, details?}`, code `module.error_name` | `{ "error": { code, message, details? } }`, UPPER_SNAKE codes in `ErrorCode` | `CLAUDE.md`, `packages/shared/src/errors.ts`, precedents |
| Cursor query `?after=&before=&limit=` | `after` only, fixed page size 50 for the group and recipients; the list is not paged | ux-flows; assumptions 16, 17 |
| `Idempotency-Key` on mutating operations with async actors | none — idempotent by state under the broadcast row lock; the job is enqueued in the launch transaction | ADR-0006, ADR-0007; assumption 18 |
| Self-contained document | delta document with external `$ref`s into five earlier contracts | contacts / operator-notifications precedent |

## A. Field origins

| schema_path | origin | confidence |
|---|---|---|
| BroadcastListItem.id / name / status / audience_kind | data-model → `broadcasts.id`, `name`, `status` (CHECK), `audience_kind` (CHECK) | high |
| BroadcastListItem.audience_size | data-model → frozen `broadcasts.audience_size` (launched); group row count / `contacts.audienceBreakdown` (draft, flow 5) | high |
| BroadcastListItem.author / last_changed_by / last_changed_at | data-model → `author_account_id`, `last_changed_by_account_id`, `last_changed_at` → `workspaces` display names | high |
| BroadcastListItem.launched_at / ended_at | data-model → `broadcasts.launched_at`, `ended_at` | high |
| BroadcastDraft.version | data-model → `broadcasts.version` (≥ 1) | high |
| BroadcastDraft.text / LaunchedBroadcast.text (BroadcastText) | data-model → `broadcasts.text` (`= btrim`, `char_length <= 4096`, non-empty unless draft); ADR-0012 | high |
| BroadcastName | data-model → `broadcasts.name` (`<> ''`, `= btrim`); 1–80 graphemes in the domain (ADR-0012) | high |
| BroadcastDraft.created_at | data-model → `broadcasts.created_at` | high |
| DraftTagAudience.mode | data-model → `broadcasts.tag_mode` (CHECK any / all / none) | high |
| DraftTagAudience.tags[] (AudienceTag) | data-model → `broadcast_audience_tags (tag_id, kind)` + current `tags.name` via `contacts.existingTags` (ADR-0004) | high |
| DraftTagAudience.dropped_tags[] | data-model → `broadcast_audience_tags.tag_name` for ids `existingTags` no longer returns (flow 7) | high |
| DraftGroupAudience.size / BroadcastGroupPage.size | data-model → `count(broadcast_group_contacts)` by `broadcast_group_contacts_pkey` | high |
| DraftBreakdown.audience_size / reach.* | ADR-0004 `contacts.audienceBreakdown` over `contact_tags` + `contact_bot_reach` for the current bot; data-model assumption 5 (partition order) | high |
| DraftBreakdown.reach = null | sad.md §6 assumption "no bot row → size only" | medium |
| LaunchedTagAudience.tags[].name | data-model assumption 8 (`tag_name` rewritten at launch) | high |
| LaunchedBroadcast.launched_by / launched_at | data-model → `launched_by_account_id`, `launched_at` | high |
| LaunchedBroadcast.launch_breakdown (LaunchBreakdown) | data-model → `audience_size`, `blocked_count`, `never_wrote_count`, `recipient_count` (CHECK they add up, ≤ 10 000, recipients ≥ 1) | high |
| LaunchedBroadcast.stopped_by / stopped_at / ended_at / end_reason | data-model → `stopped_by_account_id`, `stopped_at`, `ended_at`, `end_reason` (CHECKs) | high |
| LaunchedBroadcast.totals (RecipientTotals) | data-model → `broadcast_recipients.state` grouped on `broadcast_recipients_state_position_idx` | high |
| GroupContactCard.* | existing schema — `contacts` (names, username) + `contact_tags`/`tags` (TagRef) via `contacts.contactCards`; `blocked_since` ← data-model `contact_bot_reach.blocked_at` | high |
| BroadcastGroupRow.added_by / added_at | data-model → `broadcast_group_contacts.added_by_account_id`, `added_at` | high |
| BroadcastGroupPage.next_cursor | data-model → keyset (`added_at`, `contact_id`) on `broadcast_group_contacts_added_at_idx` | high |
| BroadcastGroupMembership.contact_ids | data-model → `broadcast_group_contacts_pkey` (flow 8 "which of these ids") | high |
| BroadcastGroupChange.outcome | derived — flow 8 "unchanged, already there" / "an absent row changes nothing" (contacts `ChangeOutcome` precedent) | medium |
| BroadcastGroupMatching.* | ADR-0004 `contacts.matchingContactIds` minus group rows; `can_add` = 10 000 − size (sad.md §7 constant) | high |
| BroadcastGroupAddMatching.expected_count / BroadcastGroupMatchingAdded.added_count | flow 8 "add all matching with the search, the filter and N" / "says how many" | high |
| BroadcastCreate / BroadcastFieldsSave / Raw* bounds | data-model name/text checks; request caps (1000 / 20000) bound the body only | high |
| BroadcastAudienceSave.tag_ids / exclude_tag_ids | data-model → `broadcast_audience_tags.kind` include / exclude; ≤ 100 = workspace tag limit | high |
| BroadcastAudienceSave.expected_group_size | ADR-0005 "Switching kind away from a non-empty group carries `expected_group_size`" | high |
| BroadcastDuplicate.audience / include_not_confirmed | sad.md §4 supporting choice (duplicates), flow 15, ADR-0009 "fixable" set | high |
| LaunchConfirmation.version / breakdown / fingerprint / text | ADR-0006 (version, breakdown, SHA-256 over sorted reachable ids); flow 10 | high |
| BroadcastLaunch.expected_version / fingerprint | ADR-0006 | high |
| BroadcastLaunched.outcome | ADR-0006 "a second launch … returns it" | medium |
| BroadcastStopped.outcome | seeded flow 4 "stopped" / "unchanged" | high |
| BroadcastRecipient.id / position / state / failure_reason / outcome_at | data-model → `broadcast_recipients` (CHECKs: state, reason ⇔ failed, outcome_at ⇔ not waiting/sending) | high |
| BroadcastRecipient.contact (RecipientContact) | existing schema — `contacts` names via `contacts.contactCards` | high |
| BroadcastRecipientPage.next_cursor | data-model → keyset `position` on `broadcast_recipients_broadcast_position_key` / `…_state_position_idx` | high |
| ThreadBroadcastItem.id / conversation_id / broadcast_id / state / position_at | data-model → `broadcast_items` (CHECK state delivered / not_confirmed) | high |
| ThreadBroadcastItem.broadcast_name / text / launched_by | data-model → `broadcasts.name`, `text`, `launched_by_account_id` via `broadcasts.itemDetails` (ADR-0010) | high |
| ContactRow.blocked_since / ContactProfile.blocked_since | data-model → `contact_bot_reach.blocked_at` for the current Telegram bot (ADR-0002) | high |
| TelegramUpdate.my_chat_member.* | sad.md §2 Telegram constraint; ADR-0003 | high |
| BroadcastNameInvalidError.details / BroadcastTextInvalidError.details | spec AC-02 (1–80, 1–4096); ADR-0012 | high |
| BroadcastDraftChangedError.details.draft | sad.md §8 "`BROADCAST_DRAFT_CHANGED` (409, current draft)" | high |
| BroadcastGroupChangedError.details.group_size | sad.md §8 "(409, current group size, on a kind switch)" | high |
| BroadcastNotADraftError.details | sad.md §8 "(409, launched: read-only)" + `broadcasts.status` | high |
| BroadcastNotEndedError.details | flow 15 "refused, not ended yet"; F-2 | medium |
| BroadcastAudienceChangedError.details.confirmation | sad.md §8 "(409, current breakdown + fingerprint)" | high |
| BroadcastAudienceTooLargeError.details | sad.md §8 "(409, limit + how many can still be added)" | high |
| BroadcastNoReachableContactError.details.breakdown | flow 10 "refused, no reachable contact" + the breakdown | medium |
| BroadcastNeedsWorkingBotError.details.bot_state | sad.md §8 "(409, bot state)"; `InboxBotStatus.state` values | high |
| BroadcastLaunchLimitReachedError.details | sad.md §4 "`next_launch_at` = the 10th newest `launched_at` + 24 h"; 10 / 24 h (spec) | high |
| broadcast.changed signal/frame fields | ADR-0011 | high |
| broadcasts.send / -dlq / measure-blocked-share payloads | sad.md §7 queue table | high |

No `low` row. Columns with no wire field: `broadcasts.launch_telegram_bot_id` (internal to the sender, ADR-0008), `broadcast_recipients.telegram_user_id`, `claimed_at`, `telegram_message_id`, `broadcast_items.telegram_message_id`, `created_at`, `contact_bot_reach.wrote_at` / `changed_at` (read only through the breakdown) — **accepted** as intentionally internal (no AC shows them; chat ids are never shown, sad.md §8).

## B. Drift checklist

1. **Endpoint ↔ data-model** *(core)* — ✓. `listBroadcasts` reads `broadcasts` (+ group counts, + `contacts` count for tag drafts); `createBroadcast` inserts `broadcasts`; `getBroadcast` reads `broadcasts`, `broadcast_audience_tags`, group count, `broadcast_recipients` totals, reach via `contacts`; `saveBroadcastFields` updates `broadcasts`; `saveBroadcastAudience` replaces `broadcast_audience_tags`, deletes `broadcast_group_contacts` on a switch, updates `broadcasts`; the four group writes and three group reads touch `broadcast_group_contacts`; `deleteBroadcast` deletes all three draft tables; `duplicateBroadcast` inserts `broadcasts` + tags or group rows from tags, group or `broadcast_recipients`; `getLaunchConfirmation` reads `broadcasts` + `contacts`/`bots`; `launchBroadcast` inserts `broadcast_recipients`, updates `broadcasts` and `broadcast_audience_tags`; `stopBroadcast` updates `broadcast_recipients` and `broadcasts`; `listBroadcastRecipients` reads `broadcast_recipients`; `getThreadBroadcastItem` / `listThreadItems` read `broadcast_items`; `listContacts` / `getContact` read `contact_bot_reach`; the webhook writes `contact_bot_reach`. Every new table has a reader and a writer (recipients' claims/outcomes and items are written by the job, events.md).
2. **Error code ↔ repo error definition** *(core)* — ✓ with the expected proposal. Registry form: the `ErrorCode` const object in `packages/shared/src/errors.ts` + `AppError` subclasses in `apps/api/src/platform/errors.ts`. Existing codes used (`UNAUTHENTICATED`, `ACCESS_REMOVED`, `OWNER_ONLY`, `FORBIDDEN`, `NOT_FOUND`, `TAG_NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`) all exist. The eleven new codes are this contract's proposal: ten named by sad.md §8 (`BROADCAST_NAME_INVALID`, `BROADCAST_TEXT_INVALID`, `BROADCAST_DRAFT_CHANGED`, `BROADCAST_GROUP_CHANGED`, `BROADCAST_NOT_A_DRAFT`, `BROADCAST_AUDIENCE_CHANGED`, `BROADCAST_AUDIENCE_TOO_LARGE`, `BROADCAST_NO_REACHABLE_CONTACT`, `BROADCAST_NEEDS_WORKING_BOT`, `BROADCAST_LAUNCH_LIMIT_REACHED`) and `BROADCAST_NOT_ENDED` (F-2). `implement` adds them to `ErrorCode`, to `platform/errors.ts` (`BroadcastLaunchLimitReachedError` with `Retry-After`, after `ChangeLimitReachedError`) and the zod refusal schemas to `packages/shared/src/broadcasts.ts` (sad.md §5).
3. **Validation ↔ constraint** *(core)* — ✓. `BroadcastStatus` ↔ `broadcasts.status` CHECK; `AudienceKind` / `TagFilterMode` ↔ `audience_kind` / `tag_mode` CHECKs; `AudienceTagKind` ↔ `broadcast_audience_tags.kind` CHECK; `RecipientState` / `RecipientFailureReason` ↔ `broadcast_recipients` CHECKs (reason set exactly when failed); `EndReason` ↔ `end_reason` CHECK; `ThreadBroadcastItem.state` ↔ `broadcast_items.state` CHECK; `BroadcastText.maxLength 4096` ↔ `char_length(text) <= 4096` (code points never exceed UTF-16 units — data-model assumption 4; the 4096-unit rule is the domain's); `BroadcastName minLength 1` ↔ `name <> ''` (graphemes in the domain, so no `maxLength`, as contacts' `TagName`); `LaunchBreakdown` integers ↔ the frozen-count CHECK; `size` / `can_add` ≤ 10 000 ↔ the domain limit (data-model "Triggers: none"); `version` ≥ 1 ↔ CHECK. No conflict.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓ (one sequence gap, F-3, fixed upstream). Every `alt` branch with an HTTP outcome has a response:
   - flow 5 guard: signed out → `401`, another workspace → `404` (no hint), deactivated → `403 ACCESS_REMOVED`; broadcasts / none → `BroadcastList` (empty `items`);
   - flow 6: name or text invalid → `400 BROADCAST_NAME_INVALID` / `BROADCAST_TEXT_INVALID`; not of W → `404`; launched → `409 BROADCAST_NOT_A_DRAFT`; another version → `409 BROADCAST_DRAFT_CHANGED`; the version shown → `200` draft;
   - flow 7: foreign tag id → `404 TAG_NOT_FOUND`; deleted / merged tag → `dropped_tags`; over 10 000 → `audience_size` (saved); no bot → `reach: null`; group size changed → `409 BROADCAST_GROUP_CHANGED`; switches → `200`;
   - flow 8: not a contact of W → `404`; already there → `200 unchanged`; 10 000 → `409 BROADCAST_AUDIENCE_TOO_LARGE` (`can_add: 0`); added → `200 added`; add all matching count → `countBroadcastGroupMatching`; over → `409` as a whole; within → `200` with `added_count`; remove → `200 removed` / `unchanged`; membership and group page reads;
   - flow 9: not author / owner → `403 FORBIDDEN`; not of W → `404`; launched → `409 BROADCAST_NOT_A_DRAFT`; may delete → `200`;
   - flow 10 / seeded flow 1: operator → `403 OWNER_ONLY`; no bot / not connected → `409 BROADCAST_NEEDS_WORKING_BOT`; over 10 000 → `409 BROADCAST_AUDIENCE_TOO_LARGE`; nobody reachable → `409 BROADCAST_NO_REACHABLE_CONTACT`; cap → `429 BROADCAST_LAUNCH_LIMIT_REACHED`; launched → `200 launched`; launched already → `200 already_launched`; changed set → `409 BROADCAST_AUDIENCE_CHANGED`; changed version → `409 BROADCAST_DRAFT_CHANGED`; owner deactivated → `403 ACCESS_REMOVED`; empty text → `400 BROADCAST_TEXT_INVALID` (data-model hand-off);
   - flow 11: not of W → `404`; draft / launched → `Broadcast` discriminated by `status`; edit or delete → `409 BROADCAST_NOT_A_DRAFT`; operator stop → `403 OWNER_ONLY`; recipients paged and narrowed;
   - seeded flow 4: sending with waiting → `200 stopped`; nothing waiting → `200 unchanged`;
   - flow 15: not of W → `404`; not ended yet → `409 BROADCAST_NOT_ENDED`; may duplicate → `201`;
   - seeded flows 2, 3, flows 12–14, 16, 17, 19 → events.md (jobs, inbound update, signals); flow 18 → `getThreadBroadcastItem`, `listThreadItems`.

**Back-feed (coverage):**

| Spec AC | Covered by |
|---|---|
| AC-01 | `listBroadcasts` (status, audience size, last changed by), `createBroadcast`, `saveBroadcastAudience` (any / all / none, left-out tags), `getBroadcast` (`breakdown`, current tag names, `dropped_tags`) |
| AC-02 | `400 BROADCAST_NAME_INVALID` / `BROADCAST_TEXT_INVALID` on `createBroadcast` and `saveBroadcastFields`; the shared length rule (ADR-0012) for the editor's counter |
| AC-03 | `expected_version` + `409 BROADCAST_DRAFT_CHANGED` with the current draft; group routes never raise the version; `409 BROADCAST_GROUP_CHANGED` on a kind switch |
| AC-04 | `listContacts` (picker), `getBroadcastGroupMembership`, `addBroadcastGroupContact`, `countBroadcastGroupMatching` + `addBroadcastGroupMatching` (`expected_count` vs `added_count`), `removeBroadcastGroupContact`, `listBroadcastGroup` (name, username, tags, `blocked_since`, size) |
| AC-05 | `200 unchanged` (already there); `409 BROADCAST_AUDIENCE_TOO_LARGE` with `can_add` on group adds, the confirmation and the launch; tag audience over 10 000 saved (`audience_size`) |
| AC-06 | `getLaunchConfirmation` (text, breakdown, version, fingerprint), `launchBroadcast` (`409 BROADCAST_AUDIENCE_CHANGED` / `BROADCAST_DRAFT_CHANGED`, `already_launched`) |
| AC-07 | `403 OWNER_ONLY` on `getLaunchConfirmation` / `launchBroadcast`; `403 FORBIDDEN` on `deleteBroadcast`; edit, duplicate, own delete open to operators |
| AC-08 | guard responses on every operation; foreign broadcast / contact → `404` with no hint; foreign tag → `TAG_NOT_FOUND`; `ACCESS_REMOVED` on the launch; composite FKs |
| AC-09 | `409 BROADCAST_NOT_A_DRAFT` on every edit and the delete; `409 BROADCAST_NO_REACHABLE_CONTACT`; `429 BROADCAST_LAUNCH_LIMIT_REACHED` with `next_launch_at`; frozen `launch_breakdown` and recipients |
| AC-10 | `409 BROADCAST_NEEDS_WORKING_BOT` (`bot_state`); `never_wrote_count` for the current bot; drafts need no bot (`reach: null`) |
| AC-11 | `getBroadcast` (`totals`, `ended_at`, `end_reason`), `listBroadcastRecipients` (state, reason, time); events.md `broadcast.changed report/status` and the send chain |
| AC-12 | `end_reason` `text_refused` / `bot_stopped`; `failure_reason` `text_refused` / `bot_stopped` on the waiting recipients (events.md: the abort) |
| AC-13 | `duplicateBroadcast` (`same`, `same_tags`, `all_recipients`, `not_reached` + `include_not_confirmed`, `409 BROADCAST_NOT_ENDED`) |
| AC-14 | `listContacts` / `getContact` / `GroupContactCard` `blocked_since`; `receiveTelegramUpdate` `my_chat_member`; events.md `contact.changed reach`; breakdown `blocked_count` |
| AC-15 | events.md `broadcasts.send` (pacing, turns, send pause); no route (replies unchanged) |
| AC-16 | `listThreadItems` + `getThreadBroadcastItem` (`ThreadBroadcastItem`: name, text, launching owner, delivered / not confirmed, position); events.md `conversation.changed` broadcast ignored by list and attention |
| AC-17 | events.md (plain text, no `parse_mode`); no panel route (US-08) |
| AC-18 | `stopBroadcast` (`stopped` / `unchanged`, `403 OWNER_ONLY`), `RecipientState.stopped`, `end_reason: stopped`; `not_reached` copies stopped recipients |

Every operation maps to a §4 user story and ≥ 1 AC (Operations table). Every §6 `alt` branch with an HTTP or async outcome has a response or an events.md entry.

## C. Flags (supporting — none blocks the contract)

- **F-1 · sad.md §5/§8 route names are intent** — the SAD's indicative routes become this contract's action POSTs and the two save routes (assumptions 1, 2). Same guards, same semantics. **Accepted**; the SAD says "`api` fixes the names". Owner: `tasks` (route names come from this contract).
- **F-2 · `BROADCAST_NOT_ENDED` is not in sad.md §8's code list** — flow 15 draws "refused, not ended yet" without naming a code; reusing `BROADCAST_NOT_A_DRAFT` would mislead (the source is not a draft either way). **Accepted** as the contract's proposal; a one-line §8 addition can follow at the next `design` touch.
- **F-3 · sequence gap: a group write after a teammate switched the kind** — flow 8's precondition was "the audience is a broadcast group", with no branch for a concurrent switch to a tag audience. The contract answers `409 BROADCAST_DRAFT_CHANGED` with the current draft (adds) and `200 unchanged` (removes) (assumption 5). **Fixed the source:** sad.md §6 flow 8 gains the branch on both adds (one line of prose, amended at `api`, committed separately).
- **F-4 · the Contacts list becomes live for one field** — contacts made the list not live; this feature refetches it on `contact.changed reach` per sad.md §4 / flow 16 (assumption 7). **Accepted**; `screens` draws the marker's refresh.

Total flags: 4 supporting, 0 core. Four flags reach the drift-check pause threshold (≥ 3 flags in one run). In this autonomous run each was resolved with the shared 4-state actions — F-1, F-2, F-4 **Accept as is**, F-3 **Fix the source** (a minimal sad.md flow 8 amendment) — instead of pausing; any of them can be reopened at review.

## Self-check

Structural self-check (drift check + coverage): **pass** — 3/3 core points ✓, point 4 ✓ (the one sequence gap, F-3, fixed in sad.md flow 8), every AC covered, every operation traced to a US and ≥ 1 AC, no `low` field origin, `redocly lint` valid (3 accepted warnings), the data-model hand-off (`BROADCAST_TEXT_INVALID` on launch) included. Spectral is not wired in the repo; `redocly` was used instead, as in the precedents.
