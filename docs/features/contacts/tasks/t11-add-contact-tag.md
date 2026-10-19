---
id: T11
title: "Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals"
layer: "app"
deps: ["T4", "T5", "T6", "T7"]
blocks: ["T12", "T14"]
acs: ["AC-06", "AC-07", "AC-08", "AC-12", "AC-13", "AC-14", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/app/tags.ts", "apps/api/src/modules/contacts/app/tags.test.ts", "apps/api/src/modules/contacts/app/tags.int.test.ts", "apps/api/src/modules/contacts/infra/tag-signals.ts", "apps/api/src/modules/contacts/app/ports.ts", "apps/api/src/modules/contacts/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T11 — Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals

## Place in the sequence

- **Blocked by:** T4 — Add the contacts zod contracts, the eight tag error codes, and the contact.changed / tags.changed frames and signals with their hub mapping, T5 — Add the tags domain: the limits (100 per workspace, 20 per contact, 60 per 60 s, 50 per page), the history kinds and sources, the merge link rule and the rate-limit retry time, T6 — Build the tag repository: the workspace tag lock, find by name key, insert, the workspace count, the tag list with counts in tag-list order, id resolution, the row locks and the rename, with cross-workspace isolation tests, T7 — Build the contact-tag and tag-history repositories for member changes: the contact row lock, a contact's tags in tag-list order, link insert and delete, history entries, the history keyset page and the member-kind rate count, with isolation tests · **Blocks:** T12 — Add removeContactTag: the contact lock, the no-op for a tag no longer carried (foreign ids included), the member rate limit, the link delete, one removed entry and contact.changed, T14 — Add deleteTag against the confirmed count: TAG_COUNT_CHANGED with the current count, deleted entries on every contact that lost the tag, tags.changed · **Wave:** 4 — after T4, T5, T6, T7.
- **Lane:** Shares `apps/api/src/modules/contacts/app/ports.ts` with T2; shares `apps/api/src/modules/contacts/app/ports.ts` with T6; shares `apps/api/src/modules/contacts/app/ports.ts` with T7; shares `apps/api/src/modules/contacts/app/ports.ts` with T8; shares `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/app/fakes.ts` with T10; shares `apps/api/src/modules/contacts/app/tags.ts`, `apps/api/src/modules/contacts/app/tags.test.ts`, `apps/api/src/modules/contacts/app/tags.int.test.ts` with T12; shares `apps/api/src/modules/contacts/app/ports.ts` with T13 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It is the one write behind every «add tag» and «Create tag …» a member makes, from the inbox or the profile.

## Inlined context

> • Member add / create-and-add: (1) `tags:<ws>` advisory, only when a name is sent (find-or-create under the 100 limit); (2) contact row `FOR NO KEY UPDATE`; (3) no-op and 20-per-contact checks; (4) `tag-changes:<ws>:<account>` advisory + count; (5) the tag row `FOR KEY SHARE` (explicit; missing = `TAG_NOT_FOUND`); (6) `contact_tags` insert; (7) history insert; (8) publish.
>
> — `sad.md §8, Concurrency, member add, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. The count the owner confirmed is exactly what the spec protects, and comparing the rows actually deleted is exact even with concurrent removals. Find-or-create under `tags:<ws>` plus the unique key gives one tag under a race and an exact 100 limit; the contact row lock gives an exact 20 limit; the explicit `FOR KEY SHARE` on the tag row (taken before the link insert, so before any unique-index entry exists that a merge's re-point could wait on) makes a racing add either land first (then removed or re-pointed with history) or fail as "no longer exists". Relying on the implicit FK check alone would deadlock a merge with an add of the target tag on the same contact.
>
> — `adr/0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count.md §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count.md)

> - **Per-member tag change limit (AC-15).** 60 recorded member changes per rolling 60 s per member per workspace, counted from tag-history entries with that actor and a member kind (`added` / `removed`); owner `merged` / `deleted` entries never count. The member routes accept `source` only as `inbox` or `profile` (`settings` is written by the server on owner paths only), so `source` never decides whether a change is limited. The count runs under `pg_advisory_xact_lock(hashtextextended('tag-changes:<ws>:<account>', 0))`, taken after the contact row lock and the no-op and per-contact-limit checks, just before the write, so no-ops and refusals never count; create + apply writes one `added` entry, so it counts one. The prefix keeps it apart from the conversation `changes:` limit (a separate budget). Refusal: `TooManyRequestsError`, code `TAG_CHANGE_LIMIT_REACHED`, with the time the oldest counted entry leaves the window. Reuses the decided assignment-statuses pattern inside one module.
>
> — `sad.md §4, Supporting choices, Per-member tag change limit, verbatim` · full text: [sad.md](../sad.md)

> 3. **A member's add that also created the tag publishes both signals**, `contact.changed` for the contact and `tags.changed` for the workspace, in that order, in the same transaction (flow 9).
>
> — `contracts/events.md §Assumptions, 3, verbatim` · full text: [events.md](../contracts/events.md)

> 7. **Add answers `200` for both `recorded` and `unchanged`**, with the contact's current tags, after `ConversationStateChange.outcome` (assignment-statuses). A created tag is signalled with `tag_created: true`. Remove answers the same shape without `tag`.
> 8. **`TAG_NOT_FOUND` is a code of its own (404)**, so the tag control can tell "this tag no longer exists" (AC-14) from a contact that is not found (`NOT_FOUND`). A remove never answers it: a tag the contact does not carry — deleted, merged, foreign or never carried — is `200 unchanged`, so a remove gives no hint about foreign ids.
>
> — `contracts/api-sync-report.md §Assumptions, 7, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> - The publisher: `modules/contacts/infra/tag-signals.ts` (sad.md §5), called inside the tag write transactions.
>
> — `contracts/events.md §Schema registry, publisher, verbatim` · full text: [events.md](../contracts/events.md)

> | Logging | pino via `platform/logger.ts`. Ids, kinds and outcome codes only; never tag names, contact names, usernames or NOTIFY payloads. | `CLAUDE.md` + here |
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (writes `tags`, `contact_tags`, `contact_tag_history` through T6 / T7).

## API contract

- `POST …/contacts/{contactId}/tags` body `{ tag_id, source }` or `{ name, source }` (`source` ∈ `inbox` / `profile`) → `200 ContactTagAdded { outcome: recorded | unchanged, tag, tag_created, tags }`.
- Errors: `400 TAG_NAME_INVALID`, `404 NOT_FOUND` (contact), `404 TAG_NOT_FOUND`, `409 TAG_LIMIT_REACHED`, `409 CONTACT_TAG_LIMIT_REACHED`, `429 TAG_CHANGE_LIMIT_REACHED` + `Retry-After`. A refusal rolls back a tag created earlier in the same request.
- Signals on `recorded`: `contact.changed { change: tags }`; plus `tags.changed` when `tag_created`.

— `contracts/openapi.yaml, operationId addContactTag, abridged`; `contracts/events.md §Channel: realtime signals, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-08 — domain invariant

> **Given** "Acme Flowers" has the tag "VIP" and 100 tags in total, and a contact that carries 20 tags
> **When** an operator types "vip", " VIP " or "VIP  " (other letter case, or spaces around the name) for a contact, or two members create "Kyiv" for different contacts at the same moment, or someone tries to create a 101st tag or add a 21st tag to that contact
> **Then** a name that differs from an existing tag only in letter case or spacing is the existing tag ("vip" applies "VIP"), and two members creating the same new name at the same moment end up with one tag applied to both contacts — a workspace never holds two tags with the same name; the 101st tag is not created and the tag control says a workspace can have at most 100 tags and a business owner can merge or delete some in Settings; the 21st tag is not added (and a new name typed for it is not created either) and the control says a contact can carry at most 20 tags; both limits hold when members act at the same moment
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** a contact of "Acme Flowers" carrying the tags "VIP" and "Kyiv", added by an operator who has since been deactivated
> **When** the customer changes their Telegram name and writes again, or the bot of "Acme Flowers" stops working or is disconnected, or the same person writes to the bot of another workspace
> **Then** the contact shows the new name with the same tags; the tags and the tag history still show the deactivated member as the one who added them; tagging, the Contacts list and profiles work in every state of the bot, since nothing about tags goes to Telegram; the same person in another workspace is a separate contact with none of the tags of "Acme Flowers"
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — domain invariant

> **Given** an operator whose tag control on a contact of "Acme Flowers" still offers the tag "Old promo"
> **When** a business owner deletes "Old promo" (or merges it into another tag) before the operator picks it
> **Then** the tag is not added, the operator is told that this tag no longer exists, and the control shows the current tags; when the owner only renamed the tag, picking it adds the renamed tag under its new name and no tag with the old name is created; a contact never carries a tag that is not in the workspace's tag list
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `addContactTag(ws, actor, contactId, { tagId } | { name }, source)` in one transaction, steps 1–8 of the lock order — `apps/api/src/modules/contacts/app/tags.ts`
- [ ] By name: `checkTagName` → `TagNameInvalidError`; under `tags:<ws>`: find by key, else `TagLimitReachedError` at 100, else insert — same file
- [ ] Rate limit under `tag-changes:<ws>:<account>` after the no-op and 20 checks, from `memberChangesSince` and T5's decision → `TagChangeLimitReachedError` with `retry_at` — same file
- [ ] `publishContactChanged`, `publishTagsChanged` inside the transaction — `apps/api/src/modules/contacts/infra/tag-signals.ts`
- [ ] Structured log by outcome (`added`, `unchanged`, `name_invalid`, `workspace_limit`, `contact_limit`, `tag_gone`, `rate_limited`) with ids only — same use case
- [ ] Unit tests with fakes per branch — `apps/api/src/modules/contacts/app/tags.test.ts`
- [ ] Integration tests: two members create "Kyiv" / " kyiv " at once → one tag on both contacts; concurrent creates at 99 tags → exactly 100; concurrent adds at 19 carried → exactly 20; a 21st with a new name creates no tag; the 61st change refused, an `unchanged` add not counted; a tag deleted in a committed transaction → `TAG_NOT_FOUND` — `apps/api/src/modules/contacts/app/tags.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| the contact already carries the tag | `200 unchanged`, no entry, not counted, nothing published (AC-06, AC-15) |
| "vip" typed while "VIP" exists | applies "VIP", `tag_created: false` (AC-08) |
| a 21st tag by a new name | `409 CONTACT_TAG_LIMIT_REACHED`; the new tag is rolled back too (AC-08) |
| a tag renamed meanwhile | added under its new name; the entry carries the current name (AC-14) |
| a tag id of another workspace | `404 TAG_NOT_FOUND`, no hint (AC-12) |
| the bot disconnected | works; no Telegram call (AC-13) |

## Definition of Done

- [ ] Unit and integration tests prove every branch of the add path in the ADR-0004 lock order — name rules, find-or-create by key with one tag under concurrent creation, exact 100 and 20 limits under concurrency with the new tag rolled back on refusal, the no-op that records and counts nothing, the 61st change refused with its retry time, TAG_NOT_FOUND for a deleted or foreign tag — and that a recorded add writes one added entry and publishes contact.changed (plus tags.changed when the tag was created).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
