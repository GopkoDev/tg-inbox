---
id: T4
title: "Add the contacts zod contracts, the eight tag error codes, and the contact.changed / tags.changed frames and signals with their hub mapping"
layer: "ports"
deps: ["T1"]
blocks: ["T10", "T11", "T13", "T18"]
acs: ["AC-06", "AC-07", "AC-15"]
files_hint: ["packages/shared/src/contacts.ts", "packages/shared/src/contacts.test.ts", "packages/shared/src/index.ts", "packages/shared/src/errors.ts", "packages/shared/src/errors.test.ts", "packages/shared/src/inbox.ts", "packages/shared/src/inbox.test.ts", "apps/api/src/platform/errors.ts", "apps/api/src/platform/errors.test.ts", "apps/api/src/platform/realtime.ts", "apps/api/src/platform/realtime.test.ts", "apps/api/src/modules/inbox/infra/hub.ts", "apps/api/src/modules/inbox/infra/hub.test.ts", "apps/web/src/features/inbox/store.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T4 — Add the contacts zod contracts, the eight tag error codes, and the contact.changed / tags.changed frames and signals with their hub mapping

## Place in the sequence

- **Blocked by:** T1 — Add the shared tag-name rules: tidy, name key, 1–32 grapheme length and tag-list order · **Blocks:** T10 — Add the contacts read use cases: the list page (normalised search, resolved and missing tag ids, the none-with-tags refusal), the profile with adders' names and the tag-history page with actors' names, through a contacts → workspaces display-name port, T11 — Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals, T13 — Add the owner tag use cases listTags and renameTag: rename, case-only rename, same-text no-op, TAG_NAME_TAKEN with the holder's count, and the confirmed merge with TAG_MERGE_TARGET_CHANGED, tags.changed and the tag.merged log event, T18 — Add the web contacts and tags API sources and stores, with the live subscriptions to contact.changed, tags.changed, conversation.changed (never mark read) and resync · **Wave:** 2 — after T1.
- **Lane:** Shares `packages/shared/src/index.ts` with T1 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It fixes every wire shape the server answers and the panel parses, so both sides of the tag control speak one contract.

## Inlined context

> 2. **Error code ↔ repo error definition** *(core)* — ✓ with the expected proposal. Registry form: the `ErrorCode` const object in `packages/shared/src/errors.ts` + `AppError` subclasses in `apps/api/src/platform/errors.ts`. Existing codes used (`UNAUTHENTICATED`, `ACCESS_REMOVED`, `OWNER_ONLY`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`) all exist. The eight new codes are this contract's proposal: seven named by sad.md §8 (`TAG_NAME_INVALID`, `TAG_LIMIT_REACHED`, `CONTACT_TAG_LIMIT_REACHED`, `TAG_NOT_FOUND`, `TAG_NAME_TAKEN`, `TAG_COUNT_CHANGED`, `TAG_CHANGE_LIMIT_REACHED`) and `TAG_MERGE_TARGET_CHANGED` (F-2). `implement` adds them to `ErrorCode`, to `platform/errors.ts` (`TagChangeLimitReachedError` with `Retry-After`, after `ChangeLimitReachedError`) and the zod refusal schemas to a new `packages/shared/src/contacts.ts` (sad.md §5).
>
> — `contracts/api-sync-report.md §B. Drift checklist, 2, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> | Error handling | `AppError` subclasses, codes in `packages/shared/src/errors.ts` (indicative): `TAG_NAME_INVALID` (`ValidationError`), `TAG_LIMIT_REACHED` and `CONTACT_TAG_LIMIT_REACHED` (`ConflictError`), `TAG_NOT_FOUND` (`NotFoundError`, also for a tag deleted or merged meanwhile), `TAG_NAME_TAKEN` (`ConflictError`, details = the existing tag and its count), `TAG_COUNT_CHANGED` (`ConflictError`, details = current count), `TAG_CHANGE_LIMIT_REACHED` (`TooManyRequestsError`, retry time), `OWNER_ONLY` (existing). Already carried / already removed / same-text rename are successes with nothing recorded. | `CLAUDE.md` + here |
>
> — `sad.md §8, Error handling, verbatim` · full text: [sad.md](../sad.md)

> 9. **`TAG_MERGE_TARGET_CHANGED` (409) is a new code** for flow 13's branch "V gone, or no longer holds that name → the dialog asks again". sad.md §8 names no code for it; `details.name_holder` is the tag holding the name now, or null. See flag F-2.
>
> — `contracts/api-sync-report.md §Assumptions, 9, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> 2. **Wire names are snake_case**, like every shipped body: `merge_into_tag_id` (SAD `mergeInto`), `expected_count` in the delete body (SAD `?expectedCount`), `missing_tag_ids`, `tag_created`.
>
> — `contracts/api-sync-report.md §Assumptions, 2, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> - Socket frames: `LiveFrame` in `packages/shared/src/inbox.ts` gains `ContactChangedFrame` (`change: z.enum(['tags'])`) and `TagsChangedFrame`, both non-strict like the existing frames.
> - Signals: `realtimeSignalSchema` in `apps/api/src/platform/realtime.ts` gains `contact.changed` and `tags.changed`. The hub (`modules/inbox/infra/hub.ts`) maps each to its frame for every socket of the workspace.
>
> — `contracts/events.md §Schema registry, verbatim` · full text: [events.md](../contracts/events.md)

> 1. **Both frames go to every socket of the workspace.** Neither is account-scoped: any member may have the contact's header or profile, a picker or a filter open (flow 11). The hub forwards them like `bot.changed`.
>
> — `contracts/events.md §Assumptions, 1, verbatim` · full text: [events.md](../contracts/events.md)

> - **Old bundles:** a tab opened before the deploy parses `LiveFrame` without `contact.changed` / `tags.changed`, so the frames fail `safeParse` and are ignored (the existing "unknown → ignore" rule, `onInvalidFrame`). Such a tab shows a teammate's tag change only after its next read; accepted for the deploy window (sad.md §11).
>
> — `contracts/events.md §Existing frames, Old bundles, verbatim` · full text: [events.md](../contracts/events.md)

> **Hard rule:** **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
>
> — `CLAUDE.md §Rules, Contracts, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Schemas to add to `packages/shared/src/contacts.ts` (names as in `components.schemas`): `TagName`, `TagRef`, `ContactTag`, `TagWithCount`, `TagList`, `TagFilterMode`, `ContactRow`, `ContactPage`, `ContactProfile`, `TagHistoryKind`, `TagHistorySource`, `TagHistoryEntry`, `TagHistoryPage`, `MemberTagSource`, `RawTagName` (1–1000), `ContactTagAdd` (exactly one of `tag_id` / `name`, + `source`), `ContactTagRemove`, `TagRename` (`name`, optional `merge_into_tag_id`), `TagDelete` (`expected_count`), `ChangeOutcome`, `ContactTagAdded`, `ContactTagRemoved`, `TagRenameResult`, `TagDeleted`, the list query (`q` ≤ 200, `mode`, repeated `tag` ≤ 100 refused with `mode=none`, `after`).

| Code | Status | Class | `details` |
|---|---|---|---|
| `TAG_NAME_INVALID` | 400 | `ValidationError` subclass | `{ field: name, min_length: 1, max_length: 32 }` |
| `TAG_LIMIT_REACHED` | 409 | `ConflictError` subclass | `{ limit: 100 }` |
| `CONTACT_TAG_LIMIT_REACHED` | 409 | `ConflictError` subclass | `{ limit: 20 }` |
| `TAG_NOT_FOUND` | 404 | `NotFoundError` subclass | `{ tag_id }` |
| `TAG_NAME_TAKEN` | 409 | `ConflictError` subclass | `{ tag: TagWithCount }` |
| `TAG_MERGE_TARGET_CHANGED` | 409 | `ConflictError` subclass | `{ name_holder: TagWithCount \| null }` |
| `TAG_COUNT_CHANGED` | 409 | `ConflictError` subclass | `{ tag: TagWithCount }` |
| `TAG_CHANGE_LIMIT_REACHED` | 429 | `TooManyRequestsError` subclass + `Retry-After` (1–60 s) | `{ limit: 60, window_seconds: 60, retry_at }` |

Frames: `{ type: "contact.changed", v: 1, workspace_id, contact_id, change: "tags" }` and `{ type: "tags.changed", v: 1, workspace_id }`, non-strict like the existing frames.

— `contracts/openapi.yaml, components.schemas + responses, abridged`; `contracts/events.md §Channel: live socket, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md)

## Acceptance criteria

### AC-06 — happy path

> **Given** an operator answering a conversation of "Acme Flowers" in the inbox, or on its contact's profile, while "Acme Flowers" has the tags "VIP" and "Wholesale"
> **When** they open the tag control on the contact and type "vi", pick "VIP", then type "Kyiv" (which no tag matches) and confirm creating it, then remove "Wholesale"
> **Then** while typing, existing tags that contain the text are offered first (those that start with it before the others; tags the contact already carries are shown as carried, not offered) and creating a new tag is a separate, named choice ("Create tag "Kyiv"") that appears only when no existing tag has that name ignoring letter case and spacing; the contact now carries "VIP" and "Kyiv" and not "Wholesale", "Kyiv" exists in the workspace's tag list for everyone, each added tag records the member who added it and when, the contact's tag history shows the two additions and the removal with the member and time, the change shows for every member who has that conversation header or profile open without reloading, and the Contacts list filter finds the contact by the new tags; adding a tag the contact already carries, or removing one it no longer carries (for example when two members act at the same moment), changes nothing and writes no history entry; the tag control always shows one line saying that tags are visible to the whole team and should not record health, religion or other sensitive traits; no tag change is ever sent to the end customer
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — error

> **Given** an operator creating a tag in "Acme Flowers"
> **When** the name is empty or only spaces, or longer than 32 characters once its ends are trimmed and inner spaces collapsed (an emoji counts as one character)
> **Then** no tag is created and nothing changes on the contact, and the tag control says that a tag name must be 1 to 32 characters
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Zod schemas for every listed shape, each contract example parsed in a test — `packages/shared/src/contacts.ts`, `packages/shared/src/contacts.test.ts`, `packages/shared/src/index.ts`
- [ ] Eight codes in `ErrorCode` — `packages/shared/src/errors.ts` (+ test)
- [ ] Eight `AppError` subclasses; `TagChangeLimitReachedError` sets `Retry-After`, after `ChangeLimitReachedError` — `apps/api/src/platform/errors.ts` (+ test)
- [ ] `ContactChangedFrame`, `TagsChangedFrame` in `LiveFrame` — `packages/shared/src/inbox.ts` (+ test)
- [ ] `contact.changed` and `tags.changed` in `realtimeSignalSchema` (≤ 1000 bytes) — `apps/api/src/platform/realtime.ts` (+ test)
- [ ] The hub maps both signals to their frames for every socket of the workspace, like `bot.changed` — `apps/api/src/modules/inbox/infra/hub.ts` (+ test)
- [ ] The inbox store's frame switch ignores the two new frames (no behaviour yet; T18 subscribes) so the web still type-checks — `apps/web/src/features/inbox/store.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `ContactTagAdd` with both `tag_id` and `name`, or neither | rejected by the schema (`VALIDATION_ERROR`) |
| `source: "settings"` on a member route | rejected by `MemberTagSource` |
| `mode=none` with a `tag` | rejected with `details.field = tag` |
| `TagRename.merge_into_tag_id` equal to the path tag | `VALIDATION_ERROR` (checked at the route, T16) |
| a `contact.changed` frame of another workspace | the hub delivers it only to that workspace's sockets |
| an older bundle receives a new frame | `safeParse` fails, `onInvalidFrame` ignores it |

## Definition of Done

- [ ] packages/shared and platform unit tests pass for every new schema and every contract example, each of the eight codes maps to its AppError subclass and status (Retry-After on TAG_CHANGE_LIMIT_REACHED), contact.changed and tags.changed parse as signals and frames while malformed ones are rejected, and the hub test proves both reach every socket of their workspace and no other.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
