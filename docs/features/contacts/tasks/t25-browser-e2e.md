---
id: T25
title: "Add browser end-to-end contacts flows against the real API: list and filter, profile reading without marking read, tagging live between two members, owner rename / merge / delete, the operator refusal"
layer: "tests"
deps: ["T17", "T19", "T21", "T22", "T24"]
blocks: []
acs: ["AC-01", "AC-02", "AC-05", "AC-06", "AC-09", "AC-11"]
files_hint: ["apps/web/e2e/contacts.spec.ts", "apps/web/e2e/support/world.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T25 — Add browser end-to-end contacts flows against the real API: list and filter, profile reading without marking read, tagging live between two members, owner rename / merge / delete, the operator refusal

## Place in the sequence

- **Blocked by:** T17 — Add the API end-to-end contacts stories, the integrity queries, the cross-workspace and secrecy suite, the live-push assertions and the seeded 10 000-contact timing checks, T19 — Build SCR-18, the Contacts list: ContactsTable and TagFilter with the address state, Show more, the counts, the missing-tag notice and the empty and error states, replacing ContactsPreview, T21 — Build ContactConversationHistory, the profile's read-only thread: inbox-order items, older pages, media, live items, no read marking and no composer, with ReplyDeliveryState readOnly, T22 — Build SCR-20, the TagControl, and mount it on the profile and on the inbox conversation header (SCR-02) with the contact's tags and the name linking to the profile, T24 — Build SCR-22, the RenameTagDialog with its merge step: name rules in place, TAG_NAME_TAKEN turned into the merge offer, TAG_MERGE_TARGET_CHANGED re-ask · **Blocks:** — · **Wave:** 9 — after T17, T19, T21, T22, T24.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It proves in a real browser that the screens and the server agree on every flow the ACs describe.

## Inlined context

> | AC-05 | Flow US-02 → `H`, `LIVE`, `T` | no reply box, nothing marked read (prose); read-state proof is an integration test |
> | AC-06 | Flow US-03 → `TC` → `SUG` → `LIST` / `CR` / `ONLY`, `OK`, `RM`, `SEEN` | guidance line always shown; nothing sent to the customer (prose) |
> | AC-09 | Flow US-04 → `RN` → `T1`, `MG` → `T2`, `D` → `DC` → `T3` / `D2`, `SEEN` | history entries per merge / delete (prose) |
>
> — `ux-flows.md §AC coverage, verbatim` · full text: [ux-flows.md](../ux-flows.md)

> | Tag live update p95 — change recorded → shown in another member's open profile or conversation header | ≤ 3 s (as shared-inbox §6) | server-side timing from change to push; integration test asserts the push |
>
> — `spec.md §6, NFR, live update, verbatim` · full text: [spec.md](../spec.md)

> Every UI-touching user story US-01…US-05 has one flowchart with its happy and alt / error branches; the browser flows walk US-01 (list, search, filter, show more, saved link), US-02 (profile, history, Open in inbox), US-03 (two members, one tags, the other sees it), US-04 (rename → merge → delete) and AC-11 (operator).
>
> — `ux-flows.md §Flows, coverage, abridged` · full text: [ux-flows.md](../ux-flows.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Seeds through `World` (admin CLI + HTTP + fake Bot API deliveries), never through the UI under test.

## API contract

Every contacts operation through the real API; the live socket between two browser contexts.

— `contracts/api-sync-report.md §Operations, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose bot has captured 120 contacts, some of them tagged
> **When** they open Contacts
> **Then** the list shows the contacts of "Acme Flowers" and nothing else, with no sample data and no "Sample data" label: each row shows the contact's name and username, their tags in tag-list order, language, when they first wrote and when they last wrote (by the send time of their own messages; the team's replies do not count), ordered by when they last wrote, newest first, 50 at a time with the next ones on request, continuing from the last contact shown so that none is shown twice or skipped, and the page says how many contacts there are in total; a contact with no username or no known language shows that it has none instead of an empty value; choosing a contact opens their profile; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — happy path

> **Given** an operator on the Contacts list of "Acme Flowers"
> **When** they type part of a name or username into the search, and choose tags in the filter with "any of", "all of", or "no tags"
> **Then** the list shows only the contacts that match both: the search follows the inbox search rules (anywhere in the full name or username, ignoring letter case in any alphabet, surrounding spaces and a leading "@"), "any of" keeps contacts carrying at least one chosen tag, "all of" keeps contacts carrying every chosen tag, and "no tags" keeps contacts with no tag at all ("no tags" is a mode of its own: it cannot be combined with chosen tags, and "any of" or "all of" with no tag chosen filters nothing); the page says how many contacts match; the search and filter are part of the page's address, so a reload, the back button or a saved link opens the same view, and switching to another workspace starts with no search and no filter; a saved link still filters by a tag that was renamed since, under its new name, and when a tag in the address no longer exists in this workspace (deleted, merged away, or never one of its tags) it is left out of the filter and the page says that one of the chosen tags no longer exists
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — cross-context

> **Given** a conversation of "Acme Flowers" holding customer messages the operator has not read
> **When** the operator reads its history on the contact's profile, including while new customer messages arrive
> **Then** nothing counts as read for the operator: the conversation's unread count, the operator's attention count and the pings they would get stay exactly as if the profile had not been opened, and the profile has no reply box; only opening the conversation in the inbox marks it read, as before; new messages, replies and activity entries appear in the open history without reloading, and the conversation's status, assignee and "waiting for a reply" marker at the top of the profile change with them
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — happy path

> **Given** an operator answering a conversation of "Acme Flowers" in the inbox, or on its contact's profile, while "Acme Flowers" has the tags "VIP" and "Wholesale"
> **When** they open the tag control on the contact and type "vi", pick "VIP", then type "Kyiv" (which no tag matches) and confirm creating it, then remove "Wholesale"
> **Then** while typing, existing tags that contain the text are offered first (those that start with it before the others; tags the contact already carries are shown as carried, not offered) and creating a new tag is a separate, named choice ("Create tag "Kyiv"") that appears only when no existing tag has that name ignoring letter case and spacing; the contact now carries "VIP" and "Kyiv" and not "Wholesale", "Kyiv" exists in the workspace's tag list for everyone, each added tag records the member who added it and when, the contact's tag history shows the two additions and the removal with the member and time, the change shows for every member who has that conversation header or profile open without reloading, and the Contacts list filter finds the contact by the new tags; adding a tag the contact already carries, or removing one it no longer carries (for example when two members act at the same moment), changes nothing and writes no history entry; the tag control always shows one line saying that tags are visible to the whole team and should not record health, religion or other sensitive traits; no tag change is ever sent to the end customer
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a business owner of "Acme Flowers" in Settings → Tags, where "VIP" is on 12 contacts, "vip-clients" on 3 (one contact carries both) and "Old promo" on 40
> **When** they rename "vip-clients" to "Loyal", then rename "Loyal" to "vip", and delete "Old promo"
> **Then** after the first rename every contact that carried "vip-clients" carries "Loyal"; renaming into the name of an existing tag first says that "VIP" already exists and offers to merge, and on confirmation the 3 contacts carry "VIP" (the contact that had both carries it once), "VIP" now shows 14 contacts and "Loyal" is gone; a contact that carried only "Loyal" keeps who added it and when, the contact that carried both keeps the earlier of its two additions, the tag history of each of the 3 contacts records "Loyal" merged into "VIP" by the owner, and the contacts that carried only "VIP" get no entry; deleting first says that "Old promo" will be removed from 40 contacts and cannot be undone, and only on confirmation the tag disappears from the workspace and from every contact, and each of the 40 contacts' tag history records it removed by the owner's delete; if by then the tag is on a different number of contacts than the confirmation said, nothing is deleted and the owner is asked again with the current number; every change shows for members who have an affected profile or conversation header open without reloading; renaming a tag to a name that differs only in letter case or spacing ("vip" to "VIP") changes only how it is shown, renaming it to exactly the same text changes nothing, and a rename follows the name rules of AC-07
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they look for the Tags section of Settings, or try to rename, merge or delete a tag (for example through a saved link to the section)
> **Then** Settings shows them no Tags section, the attempt changes nothing, and the panel says that only a business owner manages the workspace's tags; the operator can still add and remove tags on contacts and create new tags while doing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `World` helpers: deliver customer messages for N contacts, tag a contact over HTTP — `apps/web/e2e/support/world.ts`
- [ ] Flows: list order + Show more + search + any / all / no tags + reload / back + a saved link with a deleted tag; profile reading with unread messages then the inbox badge unchanged, Open in inbox marks read; two members — one tags from the inbox header, the other's open profile updates without reload; owner rename → merge → delete with the history entries; operator sees no Tags section and gets the owners-only card on the address — `apps/web/e2e/contacts.spec.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| the teammate's tab is in another workspace | sees nothing |
| the delete count changed between dialog and confirm | asked again with the new number |

## Definition of Done

- [ ] The browser flows pass locally and in CI with pnpm test:e2e: the list with search, all three filter modes, show more and a saved link; the profile read leaving the inbox unread badge unchanged until Open in inbox; a teammate's tag change showing live on an open profile; the owner's rename, merge and delete with their history entries; and the operator refusal.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
