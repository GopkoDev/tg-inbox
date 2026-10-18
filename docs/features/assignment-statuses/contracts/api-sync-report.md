---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-18"
feature_size: M
---

# API sync report — assignment-statuses

This report is derived from these inputs:
- `data-model.md`, plus the staged `migrations/01–05`;
- the existing schema: `memberships` (`state`, `active_since`, `memberships_workspace_id_account_id_key`), `accounts.display_name`, `replies.state`, `read_marks`;
- `sad.md` §4, §5, §8 and §6 flows 1–13;
- `spec.md` §4/§5 (and §6.1);
- feature ADR-0001…0007;
- the shipped shared-inbox contract (`../../shared-inbox/contracts/{openapi.yaml,events.md,api-sync-report.md}`) and the live code it became (`packages/shared/src/inbox.ts`, `packages/shared/src/errors.ts`, `apps/api/src/platform/errors.ts`, `apps/api/src/platform/realtime.ts`, `apps/api/src/modules/inbox/http/routes.ts`, `apps/api/src/modules/workspaces/http/team-routes.ts`).

Size **M**, route **standard** (from `.size` / `.route`).

**Contract forms** (from `sad.md` `target_surfaces: [backend-service, web-frontend]`):

- `backend-service` → [`openapi.yaml`](openapi.yaml), OpenAPI 3.1, a **delta** over the shared-inbox contract: 3 changed + 6 added operations. Unchanged shared pieces are external `$ref`s into `../../shared-inbox/contracts/openapi.yaml`; changed schemas are restated in full (the shipped ones are closed objects) and tagged `x-delta: changed` + `x-delta-fields`. `redocly lint` (1.34.5) resolves the external refs and reports the document valid, with 2 accepted warnings:
  - no `info.license`, as in every precedent;
  - `ErrorCode` is never referenced — it documents the registry delta, as the shared-inbox `ErrorCode` does (the `*Error` schemas pin each code with `const`).
- `backend-service` (async) → [`events.md`](events.md): the one change to `conversation.changed` (item type `activity`, ADR-0007). No new channel, signal, queue or job.
- `web-frontend` consumes both. It does not author a contract.

## Assumptions (autonomous run 2026-10-18)

Each can be vetoed at review.

1. **Four action routes**, not one `PATCH`: `POST …/assign`, `…/unassign`, `…/close`, `…/reopen`. This follows the repo's action-POST style (`…/read`, `…/resend`, `…/deactivate`) and lets each operation carry exactly the refusals its flow draws (only `close` has close reasons and a confirm flag; only `assign` has an assignee pick).
2. **No confirm flag for a stale version.** "Go ahead" (SCR-11) resends with the version from the refusal, as ADR-0002 states. The only confirm flag is `confirm_close_reasons` on `close` (name follows `confirm_teammate_reply` / `confirm_duplicate_risk`).
3. **Request field names** `expected_state_version` / `expected_close_snapshot` (the brief's "expected state_version"); answers carry `state_version` / `close_snapshot`.
4. **"Already in the requested state" is `200` with `outcome: unchanged`** and the current summary (sad.md §6 flag "make unchanged a success that returns the current state and version"). A recorded change is also `200` (not `201`): the resource acted on is the conversation; the activity entry comes back inside the answer.
5. **`getConversation` now answers `ConversationSummary`** (row + `close_snapshot`), while list rows (`Conversation`) carry status, assignee and version but **not** the snapshot. SAD §4 *UI architecture*: the store keeps status/assignee per row and the version + snapshot for the open conversation; this keeps the list free of a per-row latest-reply lookup.
6. **`ASSIGNEE_NOT_ACTIVE` is `400`.** sad.md §8 maps it to `ValidationError`, the repo has no `422`, and the precedent for a specific-code 400 is `BOT_TOKEN_INVALID`. `details: { field: assignee_account_id }` follows the error handler's validation `details.field` shape.
7. **The page echoes its lenses** (`ConversationPage.lens`) — flow 4 "list page tagged with the workspace id and the lenses it answers". `lens.status` is null while searching.
8. **`listActiveMembers` is a new inbox read** (`GET …/inbox/members`), not paged.

## Existing endpoint check — active members (brief item)

`GET /api/workspaces/{workspaceId}/memberships` (workspace-operators, `team-routes.ts`) does **not** serve the chooser:
- it is behind `ownerOnly` — operators, who make most assignments, get `403 OWNER_ONLY`;
- it lists deactivated members too and carries `email`, `role`, `state` — more personal data than SCR-10 needs (spec §6.1);
- it is cursor-paged for Settings — Team.

So the contract adds `listActiveMembers` under the inbox, backed by the new `workspaces` app-layer `activeMembers(workspaceId)` (sad.md §5). The existing `access.activeMembersAmong(workspaceId, accountIds)` and `displayNames(…)` stay the building blocks for the share-locked check and the names.

## Operations

| operationId | Delta | Method + path (under `/api/workspaces/{workspaceId}/inbox`) | Flows | US |
|---|---|---|---|---|
| `listConversations` | changed | `GET /conversations?status=&assignee=` | 4, 13 | US-01 |
| `getConversation` | changed | `GET /conversations/{conversationId}` | 11, 13 | US-01, US-02, US-03 |
| `listThreadItems` | changed | `GET /conversations/{conversationId}/items` | 11 | US-02, US-05 |
| `getThreadActivity` | added | `GET /conversations/{conversationId}/activities/{activityId}` | 11, 13 | US-05 |
| `listActiveMembers` | added | `GET /members` | 5 | US-02 |
| `assignConversation` | added | `POST /conversations/{conversationId}/assign` | 1, 3, 5, 6 | US-02 |
| `unassignConversation` | added | `POST /conversations/{conversationId}/unassign` | 1, 5, 6 | US-02 |
| `closeConversation` | added | `POST /conversations/{conversationId}/close` | 1, 7 | US-03 |
| `reopenConversation` | added | `POST /conversations/{conversationId}/reopen` | 1, 8 | US-03 |

Unchanged (stay in the shared-inbox contract): `getThreadMessage`, `openMessageMedia`, `markConversationRead`, `sendReply`, `getThreadReply`, `resendReply`, `getInboxBotStatus`, `openLiveSocket`. A member's reply never changes status or assignee (spec §1 assumption), so `sendReply` has no delta.

US-04 (end customer) and US-06 (deactivation) have **no new operation**: their effects are automatic (capture, `settle()`, the deactivation port) and reach the panel through events.md and the changed reads. US-06's trigger is the existing, unchanged `POST /memberships/{membershipId}/deactivate`.

## Deviations from the api-skill defaults

| Default | Contract | Authority |
|---|---|---|
| `BearerAuth` global | `SessionCookie` global (restated locally only because a security requirement names a local scheme) | workspace-operators ADR-0002; shared-inbox precedent |
| `/api/v1/…` URL versioning | `/api/workspaces/{workspaceId}/inbox/…` | workspace-operators ADR-0003, ADR-0004 |
| Envelope `{code, message, details?}`, code `module.error_name` | `{ "error": { code, message, details? } }`, UPPER_SNAKE codes in `ErrorCode` | `CLAUDE.md`, `packages/shared/src/errors.ts`, precedents |
| `Idempotency-Key` on a mutating operation | none: every change is idempotent by state (a repeat finds the state in place → `200 unchanged`) and guarded by `expected_state_version`. No async actor runs on the change path | ADR-0002; sad.md §7 (no queue) |
| Cursor page on every list | `listActiveMembers` returns all active members unpaged | data-model "Reused" (tens of rows per workspace) |
| Self-contained document | delta document with external `$ref`s into the shared-inbox contract | dispatch brief "do not redefine what exists"; changed schemas restated because they are closed objects |

## A. Field origins

Confidence: **high** — a column or a data-model/ADR rule with matching type and constraint; **medium** — a contract choice derived from a spec/SAD/ADR statement; **low** — none here.

| schema_path | origin | confidence |
|---|---|---|
| listConversations.status | data-model `conversations.status` CHECK (`open`,`closed`); AC-01 default open; sad.md §4 *List lenses* (ignored while searching) | high |
| listConversations.assignee | data-model `conversations.assignee_account_id` (mine = caller, unassigned = NULL); AC-01; index `conversations_workspace_id_assignee_status_idx` | high |
| listConversations.after / next_cursor | data-model keyset (`last_activity_at`, `id`) on `conversations_workspace_id_status_idx` / `…_assignee_status_idx` / `…_last_activity_at_idx` (search) | high |
| ConversationPage.lens.* | sad.md §6 flow 4 "list page tagged with the workspace id and the lenses it answers"; name is this contract's choice | medium |
| Conversation.status / ConversationSummary.status | data-model → `conversations.status` | high |
| Conversation.assignee.account_id | data-model → `conversations.assignee_account_id` (composite FK to `memberships`) | high |
| Conversation.assignee.display_name | existing schema — `accounts.display_name` (CHECK 1–200), through `workspaces` `displayNames` (sad.md §4 *List lenses*); the shared `MemberRef` | high |
| Conversation.state_version / StateVersion | data-model → `conversations.state_version` (integer, CHECK ≥ 0; assumption 2 → max 2³¹−1) | high |
| ConversationSummary.close_snapshot.customer_message_seq | data-model → `conversations.customer_message_seq` (integer, CHECK ≥ 0) | high |
| ConversationSummary.close_snapshot.latest_reply.id / state | data-model "Close snapshot is derived": latest reply by `replies_conversation_id_position_at_idx`; existing `replies.state` CHECK (4 values) | high |
| ThreadPage.items[] / ThreadItem | ADR-0006 three-way merge, ties message < reply < activity; shared `ThreadMessage` / `ThreadReply` unchanged | high |
| ThreadActivity.id | data-model → `conversation_activities.id` (UUIDv7) | high |
| ThreadActivity.kind | data-model → `conversation_activities.kind` CHECK (5 values) | high |
| ThreadActivity.cause | data-model → `conversation_activities.cause` CHECK (4 values) + kind↔cause CHECK | high |
| ThreadActivity.actor | data-model → `actor_account_id` (non-null ⇔ cause member) + `accounts.display_name` | high |
| ThreadActivity.previous_assignee / new_assignee | data-model → `previous_assignee_account_id` / `new_assignee_account_id` + assignee-pair CHECK + names | high |
| ThreadActivity.position_at | data-model → `conversation_activities.position_at` | high |
| ThreadActivity.workspace_id / conversation_id | data-model → `conversation_activities.workspace_id` / `conversation_id` | high |
| getThreadActivity.activityId | data-model access pattern "Live item by (workspace_id, id) → PK" | high |
| ActiveMemberList.items[] | existing schema — `memberships` (`state = 'active'`, by `memberships_workspace_id_account_id_key`) + `accounts.display_name`; sad.md §4 *Assignee choices* ("account id, display name") | high |
| AssignRequest.assignee_account_id | data-model → `conversations.assignee_account_id`; AC-04 (active member of this workspace, checked under `lockActiveMembers … FOR SHARE`) | high |
| *.expected_state_version | ADR-0002 "each member change carries the version the member last saw"; name is this contract's choice | high |
| CloseRequest.expected_close_snapshot | ADR-0003 "a close always sends the version and the snapshot the screen shows" | high |
| CloseRequest.confirm_close_reasons | ADR-0003 / sad.md §4 choice 3 "plus `confirm` after a refusal"; name is this contract's choice | medium |
| ConversationStateChange.outcome | sad.md §4 choice 2 + §6 flag ("unchanged" is a success with nothing recorded) | medium |
| ConversationStateChange.activity | data-model "one recorded change is exactly one entry" | high |
| ConversationStateChangedError.details.conversation | sad.md §4 choice 2 "the current assignee, the status, … and the current version"; §8 *Error handling* | high |
| ConversationStateChangedError.details.latest_change | sad.md §4 choice 2 "the latest activity entry (who or what cause, when)"; data-model access "latest entry … backward, limit 1" | high |
| CloseReason enum | ADR-0003 reasons + AC-03 (stale) + AC-06 + AC-08; data-model "Close reasons are derived under the row lock" (four reads) | high |
| CloseNeedsConfirmationError.details.reasons / stale_change / conversation | sad.md §4 choice 3 "every reason, the stale change if there is one, and the current snapshot and version" | high |
| CloseNeedsConfirmationError.details.newest_unread_message | AC-06 "the newest message the operator has not read"; `messages.id` / `received_at` via `messages_conversation_id_received_at_idx`; the shape is this contract's choice | medium |
| AssigneeNotActiveError.details.field | error handler's validation `details.field` convention (`platform/errors.ts`) | medium |
| ChangeLimitReachedError.details.limit / window_seconds | spec AC-12, §6 (60 per rolling 60 s); sad.md §4 *Per-member change limit* | high |
| ChangeLimitReachedError.details.retry_at / Retry-After | data-model assumption 4 → `conversation_activities.created_at` of the oldest counted entry + 60 s (`…_workspace_id_actor_created_at_idx`); shared `ReplyLimitReached` shape | high |
| events.md `item.type: activity`, `change: created` | ADR-0007; sad.md §8 *Events* | high |

**Fields in `data-model.md` with no contract field** (accepted, internal):
- `conversation_activities.created_at` — the change limit's clock; surfaces only as `retry_at`.
- `conversations.customer_message_seq` is exposed only inside `close_snapshot` (an opaque counter for the panel to echo, never displayed).
- `memberships.active_since`, `read_marks.read_through_at` are folded into the `unread_customer_message` reason.

None needs an `# unused-in-spec` flag; each serves an AC through a derived field.

## B. Drift findings (4-point checklist)

1. **Endpoint ↔ data-model** *(core)* — ✓.
   - The changed reads cover `conversations` (status, assignee, state_version, customer_message_seq) and `conversation_activities`; `getThreadActivity` reads `conversation_activities` by PK.
   - `assign` / `unassign` / `close` / `reopen` write `conversations` + `conversation_activities` (and read `memberships` through `workspaces.lockActiveMembers`, `replies` / `read_marks` / `messages` for the close reasons — through existing indexes).
   - `listActiveMembers` reads `memberships` + `accounts` through the `workspaces` app layer.
   - No operation reads another module's tables directly (ADR-0001).
2. **Error code ↔ repo error definition** *(core)* — ✓ with additions. The registry is `ErrorCode` in `packages/shared/src/errors.ts` + `AppError` subclasses in `apps/api/src/platform/errors.ts`.
   - **Existing codes used:** `VALIDATION_ERROR`, `UNAUTHENTICATED`, `ACCESS_REMOVED`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR`.
   - **New codes proposed** (names fixed here, as sad.md §5 delegated; to register in `tasks`):

   | Code | Status | `AppError` subclass (sad.md §8 *Error handling*) | `details` | Raised by |
   |---|---|---|---|---|
   | `CONVERSATION_STATE_CHANGED` | 409 | `ConversationStateChangedError` (Conflict family) | `{ conversation, latest_change }` | assign, unassign, reopen |
   | `CLOSE_NEEDS_CONFIRMATION` | 409 | `CloseNeedsConfirmationError` (Conflict family) | `{ reasons, stale_change, newest_unread_message, conversation }` | close |
   | `ASSIGNEE_NOT_ACTIVE` | 400 | `AssigneeNotActiveError` (Validation family, like `BotTokenInvalidError`) | `{ field: 'assignee_account_id' }` | assign |
   | `CHANGE_LIMIT_REACHED` | 429 | `ChangeLimitReachedError` (TooManyRequests family, with `headers: { 'Retry-After' }` like `ReplyLimitReachedError`) | `{ limit: 60, window_seconds: 60, retry_at }` | assign, unassign, close, reopen |

3. **Validation ↔ constraint** *(core)* — ✓.
   - `ConversationStatus` / `StatusLens` = `conversations_status_check`; `ActivityKind` = `conversation_activities_kind_check`; `ActivityCause` = `…_cause_check`.
   - `StateVersion` and `customer_message_seq`: `integer`, `minimum 0` = `…_state_version_check` / `…_customer_message_seq_check`; `maximum 2147483647` = column type `integer`.
   - `ThreadActivity` nullability: `actor` ⇔ `actor_cause_check`; the assignee pair ⇔ `assignees_check` (stated in the schema description — JSON Schema cannot express the cross-field rule cleanly, and the zod mirror gets `.refine`s as `ThreadReply` has).
   - `latest_reply.state` = shared `ReplyState` = `replies` state CHECK. `MemberRef.display_name` 1–200 = `accounts_display_name_length_check`.
   - `ChangeLimitReachedError.limit 60 / window 60` = spec AC-12 = sad.md §4. No spec ↔ model contradiction.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓, notes N1–N6 below. No sequence gap needs an Open Question.

**Every §6 `alt`-branch → response**

| Flow · branch | Response |
|---|---|
| 1 · chosen assignee not an active member | assign → 400 `ASSIGNEE_NOT_ACTIVE` |
| 1 · already in the requested state | assign / unassign / close / reopen → 200 `outcome: unchanged` |
| 1 · version differs, not a close | assign / unassign / reopen → 409 `CONVERSATION_STATE_CHANGED` |
| 1 · close stale or reason without confirm / snapshot mismatch | close → 409 `CLOSE_NEEDS_CONFIRMATION` |
| 1 · 60 changes in 60 s | 429 `CHANGE_LIMIT_REACHED` (all four) |
| 1 · allowed | 200 `outcome: recorded` + `activity`; events.md `activity` frame |
| 2 · duplicate / edit; newly captured closed; newly captured open | no operation (bot-connection `receiveTelegramUpdate`); events.md: `message` frame, plus `activity` frame on reopen |
| 2 · drain outcome in a closed conversation (opt) | events.md: `state`/`reply` + `created`/`activity` frames |
| 3 · deactivation committed first | assign → 400 `ASSIGNEE_NOT_ACTIVE` |
| 3 · the assignment took the share lock first | assign → 200 `recorded`; then the deactivation's `activity` frame (`unassigned`, `member_deactivated`) |
| 4 · not signed in / other workspace / deactivated | 401 `UNAUTHENTICATED` / 404 `NOT_FOUND` / 403 `ACCESS_REMOVED` |
| 4 · no search: read the lens page | listConversations `status`, `assignee` → 200 |
| 4 · search present: status set aside | listConversations `q` → 200, `lens.status: null`, rows with `status` |
| 4 · lens holds nothing / nothing matches | 200 with empty `items` |
| 4 · workspace switch (opt) | client only (new path without lenses) |
| 5 · chooser: active members | listActiveMembers → 200 |
| 5 · picks the assignee it already has | client only (nothing sent); the server would answer 200 `unchanged` |
| 5 · not signed in / caller deactivated (guard) | 401 / 403 `ACCESS_REMOVED` |
| 5 · caller deactivated meanwhile (share lock) | 403 `ACCESS_REMOVED` (`CallerAccessRemoved`) |
| 5 · pick not active / of another workspace | 400 `ASSIGNEE_NOT_ACTIVE` |
| 5 · no such conversation | 404 `NOT_FOUND` |
| 5 · already assigned as asked | 200 `unchanged` |
| 5 · version differs | 409 `CONVERSATION_STATE_CHANGED` |
| 5 · 60 in the window / allowed | 429 / 200 `recorded` |
| 6 · already in the state asked for | 200 `unchanged` |
| 6 · version W ≠ V → refused with state, who, when, W | 409 `CONVERSATION_STATE_CHANGED` (`details.conversation`, `details.latest_change`) |
| 6 · leave it | client only (takes `details.conversation.state_version`) |
| 6 · go ahead → already / third change / still W | resend with W → 200 `unchanged` / 409 again / 200 `recorded` |
| 7 · already closed | close → 200 `unchanged` |
| 7 · version moved / waiting / unread / counter grew / reply failed | close → 409 `CLOSE_NEEDS_CONFIRMATION` (`reasons`) |
| 7 · keep it open | client only |
| 7 · close anyway → already closed / new reasons / still Q and W | resend with `confirm_close_reasons` → 200 `unchanged` / 409 again / 200 `recorded` |
| 7 · limit / allowed (both branches) | 429 / 200 `recorded` |
| 8 · already open again | reopen → 200 `unchanged` |
| 8 · version differs | 409 `CONVERSATION_STATE_CHANGED` |
| 8 · limit / allowed | 429 / 200 `recorded` |
| 9 · duplicate / edit / new message (closed or open) / capture fails / Telegram retries | bot-connection `receiveTelegramUpdate` (unchanged) + events.md frames |
| 10 · reply final / accepted / failed in closed or open / dead-letter, stale in-flight | shared-inbox `inbox.deliver-replies` (unchanged) + events.md frames |
| 11 · guard branches; no such conversation | 401 / 404 / 403; listThreadItems → 404 |
| 11 · found → three-kind page; older pages loop | listThreadItems (no cursor / `before`) → items with `type: activity` |
| 11 · change while open (opt) | `activity` frame → getThreadActivity + getConversation |
| 12 · last owner / already deactivated | workspace-operators `deactivate` (unchanged refusals) |
| 12 · allowed → unassign per conversation | events.md: one `activity` frame per conversation + `membership.deactivated` |
| 12 · old chooser pick (opt) | assign → 400 `ASSIGNEE_NOT_ACTIVE` |
| 12 · deactivated member acts (opt) | 403 `ACCESS_REMOVED` |
| 12 · reactivation (opt) | workspace-operators `reactivate` (unchanged); no conversation change |
| 13 · frame → refetch row, summary, item | getConversation + getThreadActivity |
| 13 · row matches / no longer matches lenses | client only |
| 13 · gap, reconnect, unparseable frame | resync (shared-inbox), events.md *Old bundles* |

**Supporting notes** (follow-ups, not blockers):

- **N1. Assignee check before conversation lookup** (flow 5 order). A foreign or unknown conversation id with an inactive pick gets `400 ASSIGNEE_NOT_ACTIVE`, not `404`. This leaks nothing: the 400 says nothing about the conversation, and the pick's answer is the same for any account. *Accept* — keep the flow's lock order (memberships before conversation rows, sad.md §8 *Concurrency*).
- **N2. The guard branches (401 / 403 / 404)** are drawn in flows 4, 5 and 11 only; they apply to every operation (sad.md §8 *Authorization*), as in the precedents. `getThreadActivity`'s not-found branch (a foreign activity id) is the shared `ItemNotFound`.
- **N3. A stale close is never `CONVERSATION_STATE_CHANGED`.** The stale version is the `state_changed` reason of `CLOSE_NEEDS_CONFIRMATION` (ADR-0002 *Neutral*, ux-flows: one dialog, SCR-12). Flow 1's branch text says the same.
- **N4. Change-limit index column.** sad.md §6 flows 5 note "(workspace, actor, position time)"; data-model assumption 4 chose `created_at` (`conversation_activities_workspace_id_actor_created_at_idx`). The contract follows the data-model (`retry_at` from `created_at`). Cosmetic for `sequences`.
- **N5. AC-10 wording** ("refused" vs "refused or cleared by the deactivation"): already tracked in sad.md §1 decision override and §11 (owner Dmytro Hopko, align at review). The contract shows both outcomes (flow 3 rows above); no new OQ.
- **N6. Schema-level `400` / `413` / `415`** on every new mutating operation are cross-cutting (shared-inbox responses), not drawn in any flow.

## Back-feed (coverage cross-check)

- **Every §5 AC maps to ≥1 operation or response:** ✓.
  - AC-01 → listConversations `status` / `assignee` / `q`, `lens`, row `status` + `assignee`, empty `items`; `last_activity_at` / `last_item` unchanged by changes.
  - AC-02 → assign / unassign (`recorded`, `unchanged`), `ThreadActivity` kinds, closed stays closed, no bot check; events.md `activity` frame.
  - AC-03 → 409 `CONVERSATION_STATE_CHANGED` (`latest_change`), `state_changed` close reason, `200 unchanged`.
  - AC-04 → 400 `ASSIGNEE_NOT_ACTIVE` + listActiveMembers.
  - AC-05 → close / reopen 200 `recorded`; `ConversationSummary.status`.
  - AC-06 → 409 `CLOSE_NEEDS_CONFIRMATION` (`customer_waiting`, `unread_customer_message`, `new_customer_message`, `reply_not_*`) + `confirm_close_reasons` + snapshot re-check.
  - AC-07 → events.md `activity` frame (`reopened`, `customer_wrote`) + getConversation + getThreadActivity.
  - AC-08 → events.md (`reopened`, `reply_not_delivered`) + close reasons `reply_not_delivered` / `reply_not_confirmed`.
  - AC-09 → listThreadItems `ThreadActivity`, getThreadActivity, live frame.
  - AC-10 → events.md one `activity` frame per unassigned conversation (`member_deactivated`); assign 400 / 200 in both lock orders.
  - AC-11 → 401 / 403 `ACCESS_REMOVED` (incl. `CallerAccessRemoved`) / 404 on every operation.
  - AC-12 → 429 `CHANGE_LIMIT_REACHED` + `Retry-After` + `retry_at`.
- **Every operation maps to a §4 story and ≥1 AC:** ✓ (each `summary` names its US, each `description` its ACs).
- **Every §6 `alt` branch maps to a response:** ✓ (table above).
- **Responses the contract needs but no §6 flow shows:** none beyond the cross-cutting N2 / N6. **No sequence gap, no spec gap → no Open Question.**

## Open questions

None raised by this stage. Upstream items already tracked elsewhere: spec §8 OQ-1 (auto-assign on first reply — would add a cause, no contract change beyond an `ActivityCause` value) and OQ-2 (short acknowledgements after a close); sad.md §11 AC-10 wording (N5).

## Notes for `tasks` / `implement`

- **Error codes.** Register the 4 codes in `ErrorCode` and add one `AppError` subclass each (table in B.2). `ChangeLimitReachedError` sets `Retry-After` like `ReplyLimitReachedError`. The panel maps: `CONVERSATION_STATE_CHANGED` → SCR-11; `CLOSE_NEEDS_CONFIRMATION` → SCR-12; `ASSIGNEE_NOT_ACTIVE` → the SCR-10 in-place refusal + reload of `listActiveMembers`; `CHANGE_LIMIT_REACHED` → the limit text with `retry_at` (SCR-02).
- **Shared schemas** (`packages/shared/src/inbox.ts`): `StatusLens`, `AssigneeLens`, `ConversationStatus`, `StateVersion`, `CloseSnapshot`, `ConversationSummary`, `ThreadActivity` (with `.refine`s for the actor ⇔ cause and assignee-pair rules), `ActiveMemberList`, `AssignRequest`, `StateChangeRequest`, `CloseRequest`, `ConversationStateChange`, `CloseReason`, and the four `refusal(...)` schemas. Extend `Conversation` (strict) with `status`, `assignee`, `state_version`; `ConversationPage` with `lens`; `ThreadItem` union with `ThreadActivity`; `ConversationChangedFrame.item.type` with `'activity'`.
- **Routes** (`modules/inbox/http/routes.ts`): querystring of `GET /conversations` gains `status` / `assignee` (zod enums with defaults); `GET /conversations/:id` response becomes `ConversationSummary` (update `response-schemas` tests); add the 6 routes with `preHandler: pre`. `GET /members` uses `pre` (any active member) — **not** `ownerOnly`.
- **Realtime** (`platform/realtime.ts`): `item.type` enum gains `'activity'`; the hub already forwards `item` unchanged.
- **Cursor:** the thread cursor's `kind` gains `activity`; a cursor encoded before the deploy (kinds `message` / `reply`) must still decode.
- **`X-Background-Request: 1`** on the live refetches (`getConversation`, `getThreadActivity`), as for the existing reads.
- **Lint:** `npx @redocly/cli@1.34.5 lint docs/features/assignment-statuses/contracts/openapi.yaml` (the precedent's linter; it resolves the external refs). Spectral is not wired in the repo; adding a contract-lint target is optional.
