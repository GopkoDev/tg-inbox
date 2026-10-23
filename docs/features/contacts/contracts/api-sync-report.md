---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-19"
feature_size: M
---

# API sync report — contacts

This report is derived from these inputs:
- `data-model.md` and the staged `migrations/01–06` (`tags`, `contact_tags`, `contact_tag_history`, `contacts.first_wrote_at` / `last_wrote_at`);
- the existing schema: `contacts` (`first_name`, `last_name`, `username`, `language_code` — `migrations/1791681109980_create_contacts.ts`), `memberships` (display names through `workspaces`), `conversations` (`conversations_contact_id_key`, the summary columns);
- `sad.md` §4, §5, §7, §8 and §6 (seeded flows 1–3, flows 4–14);
- `spec.md` §4/§5 (and §6, §6.1);
- feature ADR-0001…0007;
- the shipped contracts this one is a delta over (`../../shared-inbox/contracts/*`, `../../assignment-statuses/contracts/*`, `../../operator-notifications/contracts/*`, `../../workspace-operators/contracts/openapi.yaml`) and the live code they became (`packages/shared/src/{inbox,notifications,errors}.ts`, `apps/api/src/platform/{errors,realtime}.ts`, `apps/api/src/modules/workspaces/http/guard.ts` `ownerOnly`, `apps/api/src/modules/contacts/app/ports.ts` `normalizeSearchQuery`, `apps/api/src/modules/inbox/http/routes.ts`).

Size **M**, route **standard** (from `.size` / `.route`).

**Contract forms** (from `sad.md` `target_surfaces: [backend-service, web-frontend]`):

- `backend-service` → [`openapi.yaml`](openapi.yaml), OpenAPI 3.1, a **delta**: 9 added + 1 changed operation. Unchanged pieces are external `$ref`s into the shared-inbox, assignment-statuses and workspace-operators contracts; every operation and schema carries `x-delta`. `redocly lint` (`@redocly/cli@1.34.5`) resolves the external refs and reports the document **valid**, with the 3 warnings every precedent accepts:
  - no `info.license`;
  - `openLiveSocket` has no `2XX` (a `101` upgrade);
  - `ErrorCode` is never referenced. It documents the registry delta; the `*Error` schemas pin each code with `const`.
- `backend-service` (async) → [`events.md`](events.md): the `contact.changed` and `tags.changed` frames and signals, new consumers of existing frames, and the `tag.merged` log event. No job or queue.
- `web-frontend` consumes both. It does not author a contract.

## Assumptions (autonomous run 2026-10-19)

Each can be vetoed at review.

1. **Methods follow the repo, not sad.md §5's indicative table.** The repo uses GET reads and action POSTs only (`/memberships/{id}/deactivate`, `/bot/disconnect`; no PATCH or DELETE route exists). So: `POST …/contacts/{contactId}/tags` (add), `POST …/contacts/{contactId}/tags/{tagId}/remove`, `POST …/tags/{tagId}/rename`, `POST …/tags/{tagId}/delete`. The SAD said "`api` fixes the names". See flag F-1.
2. **Wire names are snake_case**, like every shipped body: `merge_into_tag_id` (SAD `mergeInto`), `expected_count` in the delete body (SAD `?expectedCount`), `missing_tag_ids`, `tag_created`.
3. **The list filter is `mode` + repeated `tag`** (`?mode=all&tag=<id>&tag=<id>`), at most 100 ids (the workspace limit). `mode` defaults to `any`. `mode=none` with a `tag` is `400 VALIDATION_ERROR` with `details.field = tag` (sad.md §6 flag: "a plain validation error is enough"; the repo code is `VALIDATION_ERROR`, not the SAD's `VALIDATION_FAILED`).
4. **Page sizes are fixed at 50** for the list (spec §1) and for the tag history (this contract's choice; the spec says only "older entries loaded on scrolling"). No `limit` parameter, so the 50-per-page rule cannot be bent by the client.
5. **One cursor type** — the shared-inbox opaque `Cursor`. The list cursor encodes (`last_wrote_at` or none, `id`), the history cursor (`created_at`, `id`). `has_prev` is true when `after` was given, as in the inbox.
6. **`ContactPage.filter` echoes what the page answers** (the normalised `q`, `mode`, the resolved `tag_ids`), so the panel can check that a late answer still matches the address, like `ConversationPage.lens`. `matching_count` equals `total_count` when no search or filter is given.
7. **Add answers `200` for both `recorded` and `unchanged`**, with the contact's current tags, after `ConversationStateChange.outcome` (assignment-statuses). A created tag is signalled with `tag_created: true`. Remove answers the same shape without `tag`.
8. **`TAG_NOT_FOUND` is a code of its own (404)**, so the tag control can tell "this tag no longer exists" (AC-14) from a contact that is not found (`NOT_FOUND`). A remove never answers it: a tag the contact does not carry — deleted, merged, foreign or never carried — is `200 unchanged`, so a remove gives no hint about foreign ids.
9. **`TAG_MERGE_TARGET_CHANGED` (409) is a new code** for flow 13's branch "V gone, or no longer holds that name → the dialog asks again". sad.md §8 names no code for it; `details.name_holder` is the tag holding the name now, or null. See flag F-2.
10. **Owner refusals name the tag with its count** (`TagWithCount`): `TAG_NAME_TAKEN.details.tag` (the merge offer, "VIP" with 12), `TAG_COUNT_CHANGED.details.tag` (the current count to ask again with), `TAG_MERGE_TARGET_CHANGED.details.name_holder`.
11. **`TagName` has no `maxLength`**: the 32 limit is in graphemes, and JSON Schema counts code points. Request names (`RawTagName`) are capped at 1000 code points only to bound the request; everything under that is judged by the domain (`TAG_NAME_INVALID`, with `details { field, min_length: 1, max_length: 32 }`).
12. **`getContactConversation` answers 404 for a contact with no conversation**, defensively. Capture creates the two together and nothing deletes either, so the case should not occur. See flag F-3.
13. **`listTags` is readable by both roles** (sad.md §5 "member" guard): the picker and the filter need it. Only rename and delete carry `ownerOnly` (`403 OWNER_ONLY`, message "Only a business owner manages the workspace's tags").
14. **No `Idempotency-Key`.** No mutating flow has an async actor or a retry note (sad.md §6); every write is idempotent by state (assumption 7, events.md).

## Operations

| operationId | Delta | Method + path (under `/api/workspaces/{workspaceId}`) | Flows | US | AC |
|---|---|---|---|---|---|
| `listContacts` | added | `GET /contacts` | 4, 5, 12 | US-01, US-05 | AC-01, AC-02, AC-03, AC-10, AC-12 |
| `getContact` | added | `GET /contacts/{contactId}` | 6, 7, 11, seeded 3 | US-02, US-03 | AC-04, AC-06, AC-12, AC-13 |
| `listContactTagHistory` | added | `GET /contacts/{contactId}/tag-history` | 6, 11 | US-02 | AC-04, AC-06, AC-09, AC-13 |
| `addContactTag` | added | `POST /contacts/{contactId}/tags` | 8, 9, seeded 1 | US-03 | AC-06, AC-07, AC-08, AC-12, AC-13, AC-14, AC-15 |
| `removeContactTag` | added | `POST /contacts/{contactId}/tags/{tagId}/remove` | 10 | US-03 | AC-06, AC-12, AC-15 |
| `listTags` | added | `GET /tags` | 12, 8 (picker), 11 | US-03, US-04, US-05 | AC-06, AC-08, AC-10, AC-11, AC-12 |
| `renameTag` | added | `POST /tags/{tagId}/rename` | 13, seeded 2 | US-04 | AC-07, AC-09, AC-11, AC-12, AC-14, AC-15 |
| `deleteTag` | added | `POST /tags/{tagId}/delete` | seeded 2 | US-04 | AC-09, AC-11, AC-12, AC-15 |
| `getContactConversation` | added | `GET /inbox/contacts/{contactId}/conversation` | seeded 3, 7 | US-02 | AC-04, AC-05, AC-12 |
| `openLiveSocket` | changed | `GET /inbox/live` (WebSocket) | 11, seeded 1, 2 | US-03, US-04 | AC-06, AC-09, AC-14 |

Unchanged and reused by the profile, not restated: `listThreadItems` and the media route (the history and media of the contact's conversation, flow 7), `getConversation` (the header's summary, which already carries `contact.id`), `getInboxBotStatus` (the owner's "no bot connected" hint on the empty list, sad.md §6 assumption). `markConversationRead` is unchanged and is the route the profile **never** calls (ADR-0006). bot-connection's `receiveTelegramUpdate` keeps its contract; capture's new first/last-wrote write (flow 14) has no wire surface.

## Deviations from the api-skill defaults

| Default | Contract | Authority |
|---|---|---|
| `BearerAuth` global | `SessionCookie` global (restated locally only because a security requirement names a local scheme) | workspace-operators ADR-0002; precedents |
| `/api/v1/…` URL versioning | `/api/workspaces/{workspaceId}/…` | workspace-operators ADR-0003, ADR-0004 |
| Envelope `{code, message, details?}`, code `module.error_name` | `{ "error": { code, message, details? } }`, UPPER_SNAKE codes in `ErrorCode` | `CLAUDE.md`, `packages/shared/src/errors.ts`, precedents |
| Cursor query `?after=&before=&limit=` | `after` only, fixed page size 50 (both lists are read forward: newest first, then older) | spec §1 (50 per page); assumption 4 |
| `Idempotency-Key` on mutating operations with async actors | none — no async actor; idempotent by state | sad.md §6; assumption 14 |
| Self-contained document | delta document with external `$ref`s into three earlier contracts | dispatch brief; operator-notifications precedent |

## A. Field origins

| schema_path | origin | confidence |
|---|---|---|
| listContacts.q | existing — `normalizeSearchQuery` + `searchContactIds` rule (`contacts/app/ports.ts`); 200 bound = shared-inbox `listConversations.q` | high |
| listContacts.mode | sad.md §4 supporting choice "any / all / none"; spec AC-02 | high |
| listContacts.tag[] | data-model → `tags.id` (resolved by `tags_workspace_id_id_key`); ≤ 100 = domain tag limit | high |
| listContacts.after | data-model → keyset `(last_wrote_at, id)` on `contacts_workspace_id_last_wrote_at_id_idx` | high |
| ContactRow.id / workspace_id | existing schema — `contacts.id`, `contacts.workspace_id` | high |
| ContactRow.first_name / last_name / username / language_code | existing schema — `contacts` (create_contacts migration) | high |
| ContactRow.first_wrote_at / last_wrote_at | data-model → `contacts.first_wrote_at`, `last_wrote_at` (NULL ⇔ NULL, assumption 7) | high |
| ContactRow.tags[] (TagRef) | data-model → `contact_tags` ⋈ `tags (id, name)`, tag-list order; ≤ 20 = contact limit | high |
| ContactPage.filter | derived — echo of the normalised request (assumption 6) | medium |
| ContactPage.matching_count / total_count | data-model access pattern "matching and total counts" (flows 4, 5) | high |
| ContactPage.missing_tag_ids | sad.md §4 "returned as `missing_tag_ids`"; flow 5 | high |
| ContactPage.has_prev / has_next / next_cursor | derived (cursor wrapper convention, shared-inbox `ConversationPage`) | high |
| ContactProfile.(facts) | as ContactRow | high |
| ContactTag.id / name | data-model → `contact_tags.tag_id` ⋈ `tags.name` | high |
| ContactTag.added_by | data-model → `contact_tags.added_by_account_id` → `workspaces` display name (MemberRef) | high |
| ContactTag.added_at | data-model → `contact_tags.added_at` | high |
| TagHistoryEntry.id / kind / tag_id / tag_name / merged_into_tag_id / merged_into_name / source / created_at | data-model → `contact_tag_history` columns (CHECKs: kind, source, merged-into pairing, non-empty names) | high |
| TagHistoryEntry.actor | data-model → `contact_tag_history.actor_account_id` → display name | high |
| TagHistoryPage.next_cursor | data-model → keyset `(created_at, id)` on `contact_tag_history_workspace_id_contact_id_created_at_idx` | high |
| ContactTagAdd.tag_id | data-model → `tags.id` | high |
| ContactTagAdd.name (RawTagName) | data-model → `tags.name` (tidied in the domain, 1–32 graphemes); 1000 bound = request cap (assumption 11) | high |
| ContactTagAdd.source / ContactTagRemove.source | data-model → `contact_tag_history.source` member values (`kind_source_check`); sad.md §4 "member routes accept only inbox / profile" | high |
| ContactTagAdded.outcome / ContactTagRemoved.outcome | derived — sad.md flows 8, 10 "unchanged - nothing recorded" (assignment-statuses `outcome` precedent) | medium |
| ContactTagAdded.tag_created | derived — flow 9 "when a tag was created" (drives `tags.changed`) | medium |
| ContactTagAdded.tags / ContactTagRemoved.tags | as ContactProfile.tags — flow 8 "S-->>UI: K's tags" | high |
| TagWithCount.id / name | data-model → `tags.id`, `tags.name` | high |
| TagWithCount.contact_count | data-model access pattern "count per tag" on `contact_tags_workspace_id_tag_id_contact_id_idx` | high |
| TagList.items | data-model → `tags` of the workspace (≤ 100), `ORDER BY name COLLATE "und-x-icu", name_key` | high |
| TagRename.name | as RawTagName | high |
| TagRename.merge_into_tag_id | sad.md §4 "resends with `mergeInto: <that id>`" → `tags.id` | high |
| TagRenameResult.outcome / tag / merged_tag_id | derived — flow 13 branches (unchanged, renamed, merged "V with its new count") | medium |
| TagDelete.expected_count | sad.md §4 / ADR-0004 "delete sends the count the owner saw" | high |
| TagDeleted.removed_from_count | data-model — `DELETE … RETURNING` row count = `expected_count` (ADR-0004) | high |
| TagNameInvalidError.details | spec AC-07 "1 to 32 characters"; sad.md §8 `TAG_NAME_INVALID` | high |
| TagLimitReachedError.details.limit / ContactTagLimitReachedError.details.limit | sad.md §7 constants (100, 20); spec AC-08 | high |
| TagNotFoundError.details.tag_id | the request's id (echo) | high |
| TagNameTakenError.details.tag | sad.md §4 "details: that tag's id, name and count" | high |
| TagMergeTargetChangedError.details.name_holder | flow 13 "V gone, or no longer holds that name"; assumption 9 | medium |
| TagCountChangedError.details.tag | sad.md §8 "details = current count"; ADR-0004 | high |
| TagChangeLimitReachedError.details.limit / window_seconds / retry_at | sad.md §4 / §7 (60 per 60 s); data-model → oldest member-kind entry on `contact_tag_history_workspace_id_actor_kind_created_at_idx` | high |
| getContactConversation (ConversationSummary) | existing — assignment-statuses `ConversationSummary`; `conversations_contact_id_key` (data-model "Reused") | high |
| contact.changed signal/frame `workspace_id`, `contact_id`, `change` | ADR-0007; sad.md §8 *Events*; data-model intro "a `pg_notify`, needs no table" | high |
| tags.changed signal/frame `workspace_id` | ADR-0007; sad.md §8 *Events* | high |
| tag.merged log event fields | sad.md §7 *Alerts* "(workspace, merged tag id, target tag id, actor)" | high |

No `low` row: every field traces to a column, an ADR constant or a drawn branch. `tags.created_by_account_id` has no field: nothing reads it in v1 (data-model assumption 6) — **accepted**, not an unused-in-spec gap.

## B. Drift checklist

1. **Endpoint ↔ data-model** *(core)* — ✓. `listContacts` reads `contacts` (+ `contact_tags`, `tags`); `getContact` reads `contacts`, `contact_tags`, `tags`; `listContactTagHistory` reads `contact_tag_history`; `addContactTag` writes `tags` (create), `contact_tags`, `contact_tag_history`; `removeContactTag` deletes `contact_tags` and writes `contact_tag_history`; `listTags` reads `tags` + `contact_tags` counts; `renameTag` updates `tags.name` / `name_key` or (merge) writes `contact_tag_history`, re-points `contact_tags`, deletes `tags`; `deleteTag` deletes `contact_tags` and `tags`, writes `contact_tag_history`; `getContactConversation` reads `conversations` by contact (existing schema). Every new table has a reader and a writer. `contacts.first_wrote_at` / `last_wrote_at` are written only by capture (flow 14, no wire surface) — **accepted** as intentionally internal.
2. **Error code ↔ repo error definition** *(core)* — ✓ with the expected proposal. Registry form: the `ErrorCode` const object in `packages/shared/src/errors.ts` + `AppError` subclasses in `apps/api/src/platform/errors.ts`. Existing codes used (`UNAUTHENTICATED`, `ACCESS_REMOVED`, `OWNER_ONLY`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`) all exist. The eight new codes are this contract's proposal: seven named by sad.md §8 (`TAG_NAME_INVALID`, `TAG_LIMIT_REACHED`, `CONTACT_TAG_LIMIT_REACHED`, `TAG_NOT_FOUND`, `TAG_NAME_TAKEN`, `TAG_COUNT_CHANGED`, `TAG_CHANGE_LIMIT_REACHED`) and `TAG_MERGE_TARGET_CHANGED` (F-2). `implement` adds them to `ErrorCode`, to `platform/errors.ts` (`TagChangeLimitReachedError` with `Retry-After`, after `ChangeLimitReachedError`) and the zod refusal schemas to a new `packages/shared/src/contacts.ts` (sad.md §5).
3. **Validation ↔ constraint** *(core)* — ✓. `kind` enum ↔ `contact_tag_history_kind_check`; `source` enums ↔ `contact_tag_history_source_check` + `kind_source_check` (member routes `inbox` / `profile`, owner entries `settings`); `merged_into_*` nullable together ↔ `merged_into_check`; `tag_name` / `merged_into_name` `minLength: 1` ↔ `<> ''` CHECKs; `TagName minLength: 1` ↔ `tags_name_check` (no DB length check — grapheme limit in the domain, data-model assumption 5, so no `maxLength`, assumption 11); `first_wrote_at` / `last_wrote_at` nullable ↔ nullable columns; `tags` ≤ 20 / items ≤ 100 / `limit` consts ↔ sad.md §7 domain constants (no CHECK encodes them, data-model "Triggers: none"); `contact_count` / `expected_count` integer ≥ 0. No conflict.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓. Every `alt` branch with an HTTP outcome has a response:
   - flow 4 guard: signed out → `401`, another workspace → `404` (no hint), deactivated → `403 ACCESS_REMOVED`; has contacts / no contacts (+ owner without bot) → `total_count` and the panel's existing bot read;
   - flow 5: `none` + ids → `400 VALIDATION_ERROR`; any/all with no tag → no predicate; ids not resolving → `missing_tag_ids`; nothing matches → `matching_count: 0`;
   - flow 6: unknown / foreign contact → `404 NOT_FOUND`; history paging → `TagHistoryPage.next_cursor`;
   - flow 7 / seeded flow 3: read-only conversation part → `getContactConversation` + unchanged `listThreadItems`; refetch on `conversation.changed` → events.md;
   - flow 8: contact not of W → `404 NOT_FOUND`; already carried → `200 unchanged`; 20 tags → `409 CONTACT_TAG_LIMIT_REACHED`; 60 changes → `429 TAG_CHANGE_LIMIT_REACHED`; tag row gone / foreign → `404 TAG_NOT_FOUND`; added → `200 recorded`;
   - flow 9 / seeded flow 1: name breaks rules → `400 TAG_NAME_INVALID`; found by key → reused (`tag_created: false`); 100 tags → `409 TAG_LIMIT_REACHED`; 20 / rate limit after create → rollback, the same refusals;
   - flow 10: not of W → `404`; not carried → `200 unchanged`; rate limit → `429`; removed → `200 recorded`;
   - flow 12: operator → no section (panel) and `403 OWNER_ONLY` on the owner routes; owner → `listTags`;
   - flow 13: operator → `403 OWNER_ONLY`; name rules → `400 TAG_NAME_INVALID`; T gone → `404 TAG_NOT_FOUND`; same text → `200 unchanged`; own key or free → `200 renamed`; held by V → `409 TAG_NAME_TAKEN`; merge with V gone / renamed → `409 TAG_MERGE_TARGET_CHANGED`; merge → `200 merged`;
   - seeded flow 2: count differs → `409 TAG_COUNT_CHANGED`; count matches → `200 TagDeleted`;
   - flow 11: frames → events.md; flow 14: capture → no wire change.

**Back-feed (coverage):**

| Spec AC | Covered by |
|---|---|
| AC-01 | `listContacts` (order, 50 per page, `after`, `total_count`, nullable username / language, tags in tag-list order) |
| AC-02 | `listContacts` (`q`, `mode`, `tag`, `matching_count`, `missing_tag_ids`, `400` for none + tags); tag ids survive a rename (ADR-0002) |
| AC-03 | `listContacts` `total_count: 0` / `matching_count: 0`; the panel's existing `getInboxBotStatus` |
| AC-04 | `getContact`, `listContactTagHistory`, `getContactConversation` + unchanged `listThreadItems` / media; `404` for not found |
| AC-05 | `getContactConversation` (read-only) + `listThreadItems` (never marks read); no mark-read call; events.md profile consumers of `conversation.changed` |
| AC-06 | `addContactTag` (by id / by name, `unchanged`), `removeContactTag`, `listTags` (picker), `ContactTag.added_by`, history `added` / `removed`, `source`; events.md `contact.changed`, `tags.changed` |
| AC-07 | `400 TAG_NAME_INVALID` on `addContactTag` and `renameTag` |
| AC-08 | `addContactTag` by name resolves the existing key; `409 TAG_LIMIT_REACHED`, `409 CONTACT_TAG_LIMIT_REACHED` (and rollback of the created tag) |
| AC-09 | `renameTag` (`renamed`, `unchanged`, `409 TAG_NAME_TAKEN`, `merged`, `409 TAG_MERGE_TARGET_CHANGED`), `deleteTag` (`expected_count`, `409 TAG_COUNT_CHANGED`), history `merged` / `deleted`; events.md `tags.changed` |
| AC-10 | `listTags` (tag-list order, zero counts, `contact_count`) = `listContacts?mode=any&tag=<id>` `matching_count` |
| AC-11 | `TagsOwnerRouteForbidden` (`403 OWNER_ONLY`) on `renameTag` / `deleteTag`; `listTags` and the tag writes stay member routes |
| AC-12 | guard responses on every operation; foreign contact → `404 NOT_FOUND`, foreign tag → `TAG_NOT_FOUND` / `missing_tag_ids` / remove `unchanged`; every count per workspace |
| AC-13 | `MemberRef` names of deactivated adders / actors; no Telegram call on any operation; capture's refresh reaches the profile through `conversation.changed` (events.md) |
| AC-14 | `404 TAG_NOT_FOUND` on `addContactTag`; rename keeps the id; events.md `tags.changed` refreshes pickers |
| AC-15 | `429 TAG_CHANGE_LIMIT_REACHED` with `Retry-After` on add / remove; `unchanged` not counted; owner routes not limited |

Every operation maps to a §4 user story and ≥ 1 AC (Operations table). Every §6 `alt` branch with an HTTP or async outcome has a response or an events.md entry. **No sequence gap** needs an upstream fix: the one branch without a named code (flow 13 "V gone, or no longer holds that name") is covered by a new code in the contract (F-2), not a missing branch.

## C. Flags (supporting — none blocks the contract)

- **F-1 · sad.md §5 HTTP table vs the repo's method style** — the SAD's indicative `PATCH /tags/:tagId`, `DELETE /tags/:tagId?expectedCount` and `DELETE /contacts/:contactId/tags/:tagId?source` become action POSTs with JSON bodies (assumptions 1, 2). Same guards, same semantics. **Accepted**; the SAD marked the table "intent; `api` fixes it". Owner: `tasks` (route names come from this contract).
- **F-2 · `TAG_MERGE_TARGET_CHANGED` is not in sad.md §8's code list** — flow 13 draws the branch ("refused - the dialog asks again with the current tags") without naming a code; reusing `TAG_NAME_TAKEN` or `TAG_NOT_FOUND` would mislead the dialog (the name may now be free, and the path's tag still exists). **Accepted** as the contract's proposal; a one-line §8 addition can follow at the next `design` touch.
- **F-3 · a contact with no conversation** — `getContactConversation` answers `404` defensively (assumption 12); the profile then shows the not-found card for the conversation part. The data model makes the case unreachable (capture creates both; nothing deletes either, spec OQ-2). **Accepted**; `screens` decides how the profile renders it.

Total flags: 3 supporting, 0 core. Three flags reach the drift-check pause threshold (≥ 3 flags in one run). In this autonomous run each was resolved with the shared 4-state action **Accept as is**, with an owner, instead of pausing; any of them can be reopened at review.

## Self-check

Structural self-check (drift check + coverage): **pass** — 4/4 points ✓, every AC covered, every operation traced to a US and ≥ 1 AC, no `low` field origin, `redocly lint` valid (3 accepted warnings). Spectral is not wired in the repo; `redocly` was used instead, as in the precedents.
