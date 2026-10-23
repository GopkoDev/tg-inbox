---
id: T5
title: "Add the tags domain: the limits (100 per workspace, 20 per contact, 60 per 60 s, 50 per page), the history kinds and sources, the merge link rule and the rate-limit retry time"
layer: "domain"
deps: ["T1"]
blocks: ["T10", "T11", "T13"]
acs: ["AC-08", "AC-09", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/domain/tags.ts", "apps/api/src/modules/contacts/domain/tags.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T5 — Add the tags domain: the limits (100 per workspace, 20 per contact, 60 per 60 s, 50 per page), the history kinds and sources, the merge link rule and the rate-limit retry time

## Place in the sequence

- **Blocked by:** T1 — Add the shared tag-name rules: tidy, name key, 1–32 grapheme length and tag-list order · **Blocks:** T10 — Add the contacts read use cases: the list page (normalised search, resolved and missing tag ids, the none-with-tags refusal), the profile with adders' names and the tag-history page with actors' names, through a contacts → workspaces display-name port, T11 — Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals, T13 — Add the owner tag use cases listTags and renameTag: rename, case-only rename, same-text no-op, TAG_NAME_TAKEN with the holder's count, and the confirmed merge with TAG_MERGE_TARGET_CHANGED, tags.changed and the tag.merged log event · **Wave:** 2 — after T1.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It holds, as pure rules, every number and every merge decision the use cases enforce under their locks.

## Inlined context

> **Configuration added:** none. The constants (32 graphemes, 100 tags per workspace, 20 per contact, 60 changes per 60 s, 50 contacts per page) live in `contacts/domain`.
>
> — `sad.md §7, Configuration added, verbatim` · full text: [sad.md](../sad.md)

> - **Per-member tag change limit (AC-15).** 60 recorded member changes per rolling 60 s per member per workspace, counted from tag-history entries with that actor and a member kind (`added` / `removed`); owner `merged` / `deleted` entries never count. The member routes accept `source` only as `inbox` or `profile` (`settings` is written by the server on owner paths only), so `source` never decides whether a change is limited. The count runs under `pg_advisory_xact_lock(hashtextextended('tag-changes:<ws>:<account>', 0))`, taken after the contact row lock and the no-op and per-contact-limit checks, just before the write, so no-ops and refusals never count; create + apply writes one `added` entry, so it counts one. The prefix keeps it apart from the conversation `changes:` limit (a separate budget). Refusal: `TooManyRequestsError`, code `TAG_CHANGE_LIMIT_REACHED`, with the time the oldest counted entry leaves the window. Reuses the decided assignment-statuses pattern inside one module.
>
> — `sad.md §4, Supporting choices, Per-member tag change limit, verbatim` · full text: [sad.md](../sad.md)

> - Entry kinds: `added`, `removed` (member), `merged` (owner merge: "«Loyal» merged into «VIP»"), `deleted` (owner delete). Each carries the actor account, the source (`inbox`, `profile`, `settings`), the time and the tag name snapshot (and the target name for `merged`). `tag_id` is kept for traceability without a foreign key, so entries outlive the tag. A rename writes nothing.
> - Merge keeps the original adder and time on a contact that carried only the merged tag (the `contact_tags` row is re-pointed), and the earlier of the two additions on a contact that carried both. One `merged` entry is written on every contact that carried the merged tag; contacts that carried only the target get none.
>
> — `sad.md §4, strategic choice 3, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. Current state stays cheap to filter and count, and the log is written by the same transaction for every path, so completeness holds by construction and is checkable by an integrity query.
>
> — `adr/0003-record-every-contact-tag-change-as-an-append-only-history-entry-with-the-tag-name-at-that-moment.md §Decision outcome, ADR-0003, verbatim` · full text: [ADR-0003](../adr/0003-record-every-contact-tag-change-as-an-append-only-history-entry-with-the-tag-name-at-that-moment.md)

> - Limits: at most 100 tags per workspace and 20 tags per contact — enough for pilot segmentation, small enough to keep the tag list readable.
>
> — `spec.md §1, Assumptions, limits, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `kind` | text | NOT NULL, `CHECK IN ('added','removed','merged','deleted')` | `added` / `removed` by a member, `merged` by an owner's merge (one per contact that carried the merged tag), `deleted` by an owner's delete (one per contact that lost it). A rename writes none (AC-09) |
| `source` | text | NOT NULL, `CHECK IN ('inbox','profile','settings')`; `inbox` / `profile` ⇔ member kinds, `settings` ⇔ owner kinds | Member routes accept only `inbox` / `profile` (SAD §4). Feeds the "tags added from the inbox" KPI only |

— `data-model.md §Entities, contact_tag_history, verbatim` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. `TAG_LIMIT_REACHED.details.limit = 100`, `CONTACT_TAG_LIMIT_REACHED.details.limit = 20`, `TAG_CHANGE_LIMIT_REACHED.details { limit: 60, window_seconds: 60, retry_at }` take their numbers from here.

## Acceptance criteria

### AC-08 — domain invariant

> **Given** "Acme Flowers" has the tag "VIP" and 100 tags in total, and a contact that carries 20 tags
> **When** an operator types "vip", " VIP " or "VIP  " (other letter case, or spaces around the name) for a contact, or two members create "Kyiv" for different contacts at the same moment, or someone tries to create a 101st tag or add a 21st tag to that contact
> **Then** a name that differs from an existing tag only in letter case or spacing is the existing tag ("vip" applies "VIP"), and two members creating the same new name at the same moment end up with one tag applied to both contacts — a workspace never holds two tags with the same name; the 101st tag is not created and the tag control says a workspace can have at most 100 tags and a business owner can merge or delete some in Settings; the 21st tag is not added (and a new name typed for it is not created either) and the control says a contact can carry at most 20 tags; both limits hold when members act at the same moment
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a business owner of "Acme Flowers" in Settings → Tags, where "VIP" is on 12 contacts, "vip-clients" on 3 (one contact carries both) and "Old promo" on 40
> **When** they rename "vip-clients" to "Loyal", then rename "Loyal" to "vip", and delete "Old promo"
> **Then** after the first rename every contact that carried "vip-clients" carries "Loyal"; renaming into the name of an existing tag first says that "VIP" already exists and offers to merge, and on confirmation the 3 contacts carry "VIP" (the contact that had both carries it once), "VIP" now shows 14 contacts and "Loyal" is gone; a contact that carried only "Loyal" keeps who added it and when, the contact that carried both keeps the earlier of its two additions, the tag history of each of the 3 contacts records "Loyal" merged into "VIP" by the owner, and the contacts that carried only "VIP" get no entry; deleting first says that "Old promo" will be removed from 40 contacts and cannot be undone, and only on confirmation the tag disappears from the workspace and from every contact, and each of the 40 contacts' tag history records it removed by the owner's delete; if by then the tag is on a different number of contacts than the confirmation said, nothing is deleted and the owner is asked again with the current number; every change shows for members who have an affected profile or conversation header open without reloading; renaming a tag to a name that differs only in letter case or spacing ("vip" to "VIP") changes only how it is shown, renaming it to exactly the same text changes nothing, and a rename follows the name rules of AC-07
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Constants `TAGS_PER_WORKSPACE = 100`, `TAGS_PER_CONTACT = 20`, `TAG_CHANGES_PER_WINDOW = 60`, `TAG_CHANGE_WINDOW_MS = 60_000`, `CONTACTS_PAGE_SIZE = 50`, `TAG_HISTORY_PAGE_SIZE = 50` — `apps/api/src/modules/contacts/domain/tags.ts`
- [ ] `canCreateTag(count)`, `canAddToContact(carried)`, `rateLimitDecision(countedInWindow, oldestCountedAt, now)` → allowed or `retryAt` = oldest + 60 s, `retryAfterSeconds` 1–60 — same file
- [ ] History kinds and sources: `MEMBER_KINDS = ['added','removed']`, `OWNER_KINDS = ['merged','deleted']`, `sourceIsValidFor(kind, source)` (member kinds ⇔ `inbox` / `profile`, owner kinds ⇔ `settings`) — same file
- [ ] `mergeLink(mergedLink, targetLink | null)` → keep the earlier `(added_at, added_by)` when the contact carries both, else re-point the merged link unchanged; `mergedEntryFor` / `deletedEntryFor` builders with name snapshots — same file
- [ ] Unit tests — `apps/api/src/modules/contacts/domain/tags.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| 99 tags / 100 tags | create allowed / refused |
| 19 carried / 20 carried | add allowed / refused |
| 59 counted changes / 60 counted | allowed / refused with `retryAt` = oldest + 60 s |
| merge where the contact carries both and the target link is older | keep the target link; the merged link goes |
| merge where the merged link is older | keep the merged link's adder and time on the target |
| an owner kind with source `inbox` | rejected by `sourceIsValidFor` |

## Definition of Done

- [ ] Domain unit tests prove both tag limits at their boundary, the 60-per-60-s decision with its retry time, the kind ↔ source rule, and the merge rule that keeps the original adder and time or the earlier of two links.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
