---
id: T12
title: "Add removeContactTag: the contact lock, the no-op for a tag no longer carried (foreign ids included), the member rate limit, the link delete, one removed entry and contact.changed"
layer: "app"
deps: ["T11"]
blocks: ["T16"]
acs: ["AC-06", "AC-12", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/app/tags.ts", "apps/api/src/modules/contacts/app/tags.test.ts", "apps/api/src/modules/contacts/app/tags.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T12 — Add removeContactTag: the contact lock, the no-op for a tag no longer carried (foreign ids included), the member rate limit, the link delete, one removed entry and contact.changed

## Place in the sequence

- **Blocked by:** T11 — Add addContactTag: by id or by name with find-or-create under the workspace tag lock, the contact lock, the no-op, the 20 and 100 limits, the member rate limit, the tag row key-share, the link, one added entry and the signals · **Blocks:** T16 — Register the contacts routes (registerContacts): the eight operations with their zod schemas, the ownerOnly guard on rename and delete, and the wiring in buildDeps and buildApp · **Wave:** 5 — after T11.
- **Lane:** Shares `apps/api/src/modules/contacts/app/tags.ts`, `apps/api/src/modules/contacts/app/tags.test.ts`, `apps/api/src/modules/contacts/app/tags.int.test.ts` with T11 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It is the one write behind removing a tag from a contact, recorded so a shrunk segment can be explained.

## Inlined context

> • Member remove: (2) contact row; (3) no-op; (4) limit; (5) delete the link; (6) history; (7) publish.
>
> — `sad.md §8, Concurrency, member remove, abridged` · full text: [sad.md](../sad.md)

> 8. **`TAG_NOT_FOUND` is a code of its own (404)**, so the tag control can tell "this tag no longer exists" (AC-14) from a contact that is not found (`NOT_FOUND`). A remove never answers it: a tag the contact does not carry — deleted, merged, foreign or never carried — is `200 unchanged`, so a remove gives no hint about foreign ids.
>
> — `contracts/api-sync-report.md §Assumptions, 8, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> A removal touches no tag row, so it never waits on an owner's operation (§8).
>
> — `sad.md §6, Flow 10, prose, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `POST …/contacts/{contactId}/tags/{tagId}/remove` body `{ source }` → `200 ContactTagRemoved { outcome: recorded | unchanged, tags }` · `404 NOT_FOUND` (contact) · `429 TAG_CHANGE_LIMIT_REACHED`. Never `TAG_NOT_FOUND`.

— `contracts/openapi.yaml, operationId removeContactTag, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-06 — happy path

> **Given** an operator answering a conversation of "Acme Flowers" in the inbox, or on its contact's profile, while "Acme Flowers" has the tags "VIP" and "Wholesale"
> **When** they open the tag control on the contact and type "vi", pick "VIP", then type "Kyiv" (which no tag matches) and confirm creating it, then remove "Wholesale"
> **Then** while typing, existing tags that contain the text are offered first (those that start with it before the others; tags the contact already carries are shown as carried, not offered) and creating a new tag is a separate, named choice ("Create tag "Kyiv"") that appears only when no existing tag has that name ignoring letter case and spacing; the contact now carries "VIP" and "Kyiv" and not "Wholesale", "Kyiv" exists in the workspace's tag list for everyone, each added tag records the member who added it and when, the contact's tag history shows the two additions and the removal with the member and time, the change shows for every member who has that conversation header or profile open without reloading, and the Contacts list filter finds the contact by the new tags; adding a tag the contact already carries, or removing one it no longer carries (for example when two members act at the same moment), changes nothing and writes no history entry; the tag control always shows one line saying that tags are visible to the whole team and should not record health, religion or other sensitive traits; no tag change is ever sent to the end customer
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `removeContactTag(ws, actor, contactId, tagId, source)`: lock contact → not carried = `unchanged` → rate limit → delete link → `removed` entry with the current name → `contact.changed` — `apps/api/src/modules/contacts/app/tags.ts`
- [ ] Unit tests per branch — `apps/api/src/modules/contacts/app/tags.test.ts`
- [ ] Integration tests: two members remove at once → one entry; a foreign tag id → `unchanged`; removals count toward the same 60 as adds — `apps/api/src/modules/contacts/app/tags.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a teammate removed it a moment earlier | `200 unchanged`, no entry, not counted (AC-06) |
| a tag id of another workspace, or deleted | `200 unchanged` — no hint about foreign ids (AC-12) |
| 30 adds + 30 removes in 60 s, then one more remove | `429` (AC-15) |

## Definition of Done

- [ ] Unit and integration tests prove a recorded remove deletes the link, writes one removed entry with the tag's current name and publishes contact.changed, that a tag no longer carried — or foreign — answers unchanged without recording or counting, and that removals share the 60-per-minute budget with adds.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
