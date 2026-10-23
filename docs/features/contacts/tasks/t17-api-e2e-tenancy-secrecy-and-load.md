---
id: T17
title: "Add the API end-to-end contacts stories, the integrity queries, the cross-workspace and secrecy suite, the live-push assertions and the seeded 10 000-contact timing checks"
layer: "tests"
deps: ["T15", "T16"]
blocks: ["T25"]
acs: ["AC-05", "AC-06", "AC-09", "AC-12", "AC-13"]
files_hint: ["apps/api/src/e2e/contacts-flows.int.test.ts", "apps/api/src/e2e/contacts-tenancy.int.test.ts", "apps/api/src/e2e/contacts-load.int.test.ts", "apps/api/src/e2e/helpers.ts", "apps/api/src/test/fixtures/tags.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T17 — Add the API end-to-end contacts stories, the integrity queries, the cross-workspace and secrecy suite, the live-push assertions and the seeded 10 000-contact timing checks

## Place in the sequence

- **Blocked by:** T15 — Add conversations.findByContact and the inbox read getContactConversation, and pin with integration tests that the profile's reads never change read state, T16 — Register the contacts routes (registerContacts): the eight operations with their zod schemas, the ownerOnly guard on rename and delete, and the wiring in buildDeps and buildApp · **Blocks:** T25 — Add browser end-to-end contacts flows against the real API: list and filter, profile reading without marking read, tagging live between two members, owner rename / merge / delete, the operator refusal · **Wave:** 8 — after T15, T16.
- **Lane:** Shares `apps/api/src/test/fixtures/tags.ts` with T3 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It proves end to end that a tag is a trustworthy segment and that reading never marks read, at pilot scale.

## Inlined context

> - two tags of a workspace with the same `name_key` (should be impossible by the unique index);
> - workspaces over 100 tags, contacts over 20 tags;
> - `contact_tags` whose tag or contact belongs to another workspace (impossible by the composite FKs);
> - contact tags with no history entry for that contact that is either `added` with the link's `tag_id` or `merged` with `merged_into_tag_id` = the link's `tag_id` (matched on ids, so renames and re-pointed merges never trip it).
>
> — `sad.md §7, Integrity queries, verbatim` · full text: [sad.md](../sad.md)

> | Contacts list p95 — first page with search and any tag filter, including the matching count, workspace with 10 000 contacts and 100 tags | ≤ 500 ms server time | request timing log; seeded integration test per filter mode |
> | Tag live update p95 — change recorded → shown in another member's open profile or conversation header | ≤ 3 s (as shared-inbox §6) | server-side timing from change to push; integration test asserts the push |
> | Owner rename / merge / delete p95, tag on 10 000 contacts | ≤ 2 s server time | request timing log; seeded integration test |
> | Tenant isolation | 0 contacts carrying a tag of another workspace | integrity query; cross-workspace integration test for every contacts and tags read and write |
> | Tag history completeness | 0 tag additions or removals on a contact (by a member, a merge or a delete) without a tag history entry | integration test per change path |
>
> — `spec.md §6, NFR rows, verbatim` · full text: [spec.md](../spec.md)

> - **How verify:** integration tests (Testcontainers) with parallel transactions for (a)–(d), the cross-workspace suite for every contacts and tags read and write (e), one test per change path asserting the history row (f), the rate-limit test (61st change refused); the §7 integrity queries in the run book.
>
> — `sad.md §10, QG-1, How verify, verbatim` · full text: [sad.md](../sad.md)

> - **How verify:** request timing logs (§7 metrics); seeded integration tests per filter mode and for owner ops on 10 000 contacts with `EXPLAIN` checks that the list uses the keyset index; an integration test asserting the `contact.changed` / `tags.changed` push to a connected socket; the existing uptime check.
>
> — `sad.md §10, QG-3, How verify, verbatim` · full text: [sad.md](../sad.md)

> | Logging | pino via `platform/logger.ts`. Ids, kinds and outcome codes only; never tag names, contact names, usernames or NOTIFY payloads. | `CLAUDE.md` + here |
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Seeds: `twoWorkspacesWithTags`; a load seed of 10 000 contacts and 100 tags in one workspace (≈ 30 000 links), built with set-based inserts in the test.

## API contract

Exercises every operation of `registerContacts`, `getContactConversation`, `listThreadItems` and the live socket (`contact.changed`, `tags.changed` frames) through `app.inject()` and a connected socket.

— `contracts/api-sync-report.md §Operations, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

## Acceptance criteria

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

## Checklist

- [ ] Stories: AC-06 tag from the inbox → teammate socket gets `contact.changed` → refetch shows the tags; AC-09 rename → merge → delete on the AC-09 seed with history; AC-13 renamed customer keeps tags, deactivated adder still named, bot disconnected still tags; AC-05 profile reads with unread messages leave unread / attention / ping due unchanged — `apps/api/src/e2e/contacts-flows.int.test.ts`
- [ ] Cross-workspace suite for every contacts and tags read and write: foreign contact id, foreign tag id on own contact, own tag on foreign contact, counts and filters never cross — and the four §7 integrity queries return no row after every story — `apps/api/src/e2e/contacts-tenancy.int.test.ts`
- [ ] Secrecy: no frame, signal payload or log line carries a tag name, contact name or username (capture the logger) — same file
- [ ] Timing on the 10 000 / 100 seed: list first page with search for each mode (`any`, `all` with 2 and 5 tags, `none`) incl. counts ≤ 500 ms; profile + first history ≤ 500 ms; owner merge and delete of a tag on 10 000 contacts ≤ 2 s; tag change ≤ 300 ms; change → push ≤ 3 s — `apps/api/src/e2e/contacts-load.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a tag of workspace B named in an add on a contact of A | `404 TAG_NOT_FOUND`, nothing written (AC-12) |
| a contact of A named on B's routes | `404 NOT_FOUND`, no hint (AC-12) |
| the same Telegram user writes to B's bot | a separate contact with none of A's tags (AC-13) |
| a teammate's socket in another workspace | receives no frame (AC-06) |

## Definition of Done

- [ ] The API e2e stories pass against Postgres and the fake Bot API, the cross-workspace suite refuses every foreign contact or tag on every contacts and tags route with no hint, the four integrity queries return no row, no frame, signal or log line carries a tag or contact name, and on a 10 000-contact, 100-tag seed the list (every filter mode including all-of, with counts) and the profile stay within 500 ms, a tag change within 300 ms, owner merge and delete within 2 s and change-to-push within 3 s.
- [ ] The AC-05 story asserts the unread count, the attention count and the ping sweep's due set are unchanged after the profile reads while a customer message arrives; the AC-06 story asserts the list filter finds the contact by its new tags and the fake Bot API records no send for any tag change; the AC-09 story asserts tags.changed from rename, merge and delete reaches every socket of the workspace; the AC-10 check asserts listTags contact_count equals listContacts mode=any matching_count for every seeded tag; the AC-13 story proves a renamed customer keeps the tags, a deactivated adder stays named, tagging works with the bot disconnected and the same Telegram user in another workspace is a separate contact with none of the tags (test plan).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
