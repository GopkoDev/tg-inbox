---
id: T20
title: "Build SCR-19, the contact profile: the header card with facts and tags, the conversation card, the Conversation / Tag history tabs with TagHistoryList and ContactCrumb, and remove the contacts sample source and SampleDataBadge"
layer: "ui"
deps: ["T18", "T19"]
blocks: ["T21", "T22"]
acs: ["AC-04", "AC-09", "AC-12", "AC-13"]
files_hint: ["apps/web/src/features/contacts/ContactProfile.tsx", "apps/web/src/features/contacts/ContactProfile.test.tsx", "apps/web/src/features/contacts/TagHistoryList.tsx", "apps/web/src/features/contacts/TagHistoryList.test.tsx", "apps/web/src/features/contacts/ContactCrumb.tsx", "apps/web/src/pages/ContactProfilePage.tsx", "apps/web/src/features/contacts/ContactProfilePreview.tsx", "apps/web/src/features/contacts/sample-data.ts", "apps/web/src/features/contacts/sample-source.ts", "apps/web/src/features/contacts/sample-source.test.ts", "apps/web/src/shared/ui/sample-data-badge.tsx", "apps/web/src/shared/ui/sample-data-badge.test.tsx", "apps/web/src/app/routes.tsx", "apps/web/src/app/routes.test.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T20 — Build SCR-19, the contact profile: the header card with facts and tags, the conversation card, the Conversation / Tag history tabs with TagHistoryList and ContactCrumb, and remove the contacts sample source and SampleDataBadge

## Place in the sequence

- **Blocked by:** T18 — Add the web contacts and tags API sources and stores, with the live subscriptions to contact.changed, tags.changed, conversation.changed (never mark read) and resync, T19 — Build SCR-18, the Contacts list: ContactsTable and TagFilter with the address state, Show more, the counts, the missing-tag notice and the empty and error states, replacing ContactsPreview · **Blocks:** T21 — Build ContactConversationHistory, the profile's read-only thread: inbox-order items, older pages, media, live items, no read marking and no composer, with ReplyDeliveryState readOnly, T22 — Build SCR-20, the TagControl, and mount it on the profile and on the inbox conversation header (SCR-02) with the contact's tags and the name linking to the profile · **Wave:** 5 — after T18, T19.
- **Lane:** Shares `apps/web/src/app/routes.tsx` with T19; shares `apps/web/src/features/contacts/ContactProfile.tsx` with T21; shares `apps/web/src/features/contacts/ContactProfile.tsx` with T22; shares `apps/web/src/app/routes.tsx` with T23 — serialized.

## Why (user story)

> **As an** Operator
> **I want** a contact's profile with what Telegram tells us, their tags, where their conversation stands and its history
> **So that** I understand the customer before I answer and can jump into the conversation
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It turns the profile preview into the real contact: who they are, what they carry, who tagged them and where their conversation stands.

## Inlined context

> 5. **The profile is a header `Card` + a conversation `Card` + `Tabs`** «Conversation» (the read-only history, default) and «Tag history», following the canon's visual direction for the contact profile. The preview's «Notes» card is removed (spec §3). The breadcrumb shows the contact's name (NEW: ContactCrumb, like `ConversationCrumb`).
> 10. **Missing values are words, not blanks** (AC-01): no username → «no username» (muted); no language → «Unknown»; no first / last wrote (data-model assumption 7) → «Never». A missing last name is simply left out of the name.
>
> — `screens.md §Decisions, 5, verbatim` · full text: [screens.md](../screens.md)

> | State | Trigger / condition | Components (from the inventory) | Source-ref |
> | --- | --- | --- | --- |
> | loading | the page opens — the header card shows a `Skeleton` avatar, name and fact lines; the conversation card a `Skeleton` badge row; the Conversation tab 4 bubble skeletons (flow 6; S3) | NEW: ContactProfile (Card, Skeleton), Tabs | — |
> | default | `getContact` `200` — header card: `Avatar` (initials, `size-16`), name (`h1`), `@username` or «no username», the facts line «Ukrainian · First wrote 2 Sep 2026 · Last wrote 3 min ago», and the tags row: every carried tag as a `Badge` with «Added by Test User, 19 Oct, 10:02» in its `title` and in the tag control, then **Add tag** (SCR-20). Conversation card from `getContactConversation`: status `Badge` («Open» / «Closed»), «Assigned to Test User 2» or «Unassigned», «Waiting for a reply» (the inbox's waiting marker) when `waiting_for_reply`, and **Open in inbox** → SCR-02 `/w/<id>/inbox/<conversationId>`. Tabs: «Conversation» selected (AC-04; flow 6; S3; `getContact`, `getContactConversation` examples) | NEW: ContactProfile (Card, Avatar, Badge, Button, Tabs), NEW: TagControl | wireframe «profile desktop» |
> | default: missing facts | a null username, language or wrote time — «no username», «Unknown», «Never» (Decision 10); a contact with no tags shows «No tags» (muted) before **Add tag** (AC-01, AC-04) | NEW: ContactProfile | — |
> | default: deactivated adder | an adder or history actor who was deactivated — shown by their display name as any member (`MemberRef` keeps the name) (AC-13; flow 6) | NEW: ContactProfile, NEW: TagHistoryList | — |
> | conversation tab | the history in inbox order from `listThreadItems` (newest at the bottom, scrolled to the end on open): customer messages and team replies as `MessageBubble` with `MessageContent`, the reply's author and its delivery state (read-only, Decision 6), activity entries as `ActivityLine`; «Start of the conversation» at the top when `has_prev` is false (AC-04; flow 7; S3) | NEW: ContactConversationHistory (ScrollArea, MessageBubble, MessageContent, ActivityLine, extended: ReplyDeliveryState) | wireframe «profile desktop» |
> | conversation: loading older | scrolled to the top with `has_prev` — the previous page by `before`; a bubble `Skeleton` on top while it loads (AC-04; flow 7) | NEW: ContactConversationHistory, Skeleton | — |
> | conversation: older failed | the older page fails — destructive `Alert` «Couldn't load earlier messages» + **Retry** on top; what is shown stays (flow 7) | Alert, Button | — |
> | conversation: media | a photo or video opened — SCR-03 `MediaViewer` over the profile; other media (file, voice, location…) as in the inbox `MessageContent` (AC-04; flow 7) | MediaViewer, MessageContent | — |
> | conversation: empty | `listThreadItems` returns no item (every message gone) — «No messages to show» in the tab (AC-04) | NEW: ContactConversationHistory | — |
> | conversation: none | `getContactConversation` `404` while the contact is found (contract F-3; assumption) — the conversation card reads «No conversation to show», no **Open in inbox**; the Conversation tab shows the same sentence | NEW: ContactProfile | — |
> | conversation: error | `getContactConversation` or the first `listThreadItems` fails (network / `500`) — destructive `Alert` «Couldn't load the conversation» + **Retry** in the conversation card and tab; the header card stays (flow 7) | Alert, Button | — |
> | live: conversation changed | `conversation.changed` for this conversation (a message, a reply, an assignment, a status change, an edit) — the status, assignee and waiting marker change in place, the new item appears at the bottom (the view follows it only when it was at the bottom), and a new Telegram name shows in the header; **nothing is marked read**: the inbox unread count, the frame's attention count and pings stay as they were (AC-05, AC-13; flow 7; events.md) | NEW: ContactProfile, NEW: ContactConversationHistory | — |
> | tag history tab | «Tag history» chosen — `listContactTagHistory`, newest first, one line per entry composed from `kind` + names + actor + time: «Test User added «Kyiv» · inbox · 19 Oct, 10:02», «Test User removed «Wholesale» · inbox · …», «Test Owner merged «Loyal» into «VIP» · …», ««Old promo» removed by Test Owner's delete · …», each under the name the tag had then (AC-04, AC-09; flow 6) | NEW: TagHistoryList (ScrollArea, Separator) | wireframe «profile tag history» |
> | tag history: loading / more | first page: 5 line `Skeleton`s; scrolled to the end with `has_next` → the next page by `after`, a `Skeleton` line at the bottom (AC-04; flow 6) | NEW: TagHistoryList, Skeleton | — |
> | tag history: empty | no entry — «No tag changes yet» (AC-04) | NEW: TagHistoryList | — |
> | tag history: error | the read fails — destructive `Alert` «Couldn't load the tag history» + **Retry** in the tab (flow 6) | Alert, Button | — |
> | live: tags changed | `contact.changed` for this contact or `tags.changed` — the header's tags and the tag history (from the top) re-read and update in place; a merged or deleted tag disappears, a renamed one shows its new name (AC-06, AC-09; flow 11) | NEW: ContactProfile, NEW: TagHistoryList | — |
> | tagging | **Add tag** → SCR-20 opens over the header card with `source: profile` (AC-06; flow 8) | NEW: TagControl | §SCR-20 |
> | not found | `getContact` `404` (unknown id, a contact of another workspace) — `NotFoundCard` inside the frame, no hint; the conversation part is not shown (AC-04, AC-12; flow 6) | NotFoundCard | — |
> | error | `getContact` fails (network / `500`) — destructive `Alert` «Couldn't load this contact» + **Retry** in place of the header card (flow 6) | Alert, Button | — |
> | open in inbox | **Open in inbox** → SCR-02 of the conversation, where reading counts as before (AC-05; flow 7) | Button | — |
> | validation | N/A: the profile takes no input (the tag control is SCR-20) | — | — |
> | phone (< md) | the header card stacks (avatar above the name, as the preview); **Open in inbox** is full width; the tabs list is full width | NEW: ContactProfile | wireframe «profile phone» |
> | guard states | → §Shared states | — | §Shared states |
>
> — `screens.md §SCR-19, state table, verbatim` · full text: [screens.md](../screens.md)

> 12. **`getContactConversation` answers 404 for a contact with no conversation**, defensively. Capture creates the two together and nothing deletes either, so the case should not occur. See flag F-3.
>
> — `contracts/api-sync-report.md §Assumptions, 12, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> | Internationalisation | UI stays in English. History lines are composed by the web panel from kind + name snapshots + actor names, not stored as text. | — |
>
> — `sad.md §8, Internationalisation, verbatim` · full text: [sad.md](../sad.md)

> | Untrusted content | Tag names, contact names and usernames rendered as plain text (React escaping); no markup interpreted (spec §6.1). | spec §6.1 |
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `getContact` → `ContactProfile` (404 → `NotFoundCard`); `getContactConversation` → `ConversationSummary` (404 → «No conversation to show»); `listContactTagHistory` → `TagHistoryPage` (`after`).
- History lines: `added` «<actor> added «<tag_name>»», `removed` «<actor> removed «<tag_name>»», `merged` «<actor> merged «<tag_name>» into «<merged_into_name>»», `deleted` ««<tag_name>» removed by <actor>'s delete».

— `contracts/openapi.yaml, operationIds getContact, listContactTagHistory, getContactConversation, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-04 — happy path

> **Given** a contact of "Acme Flowers" whose conversation is open, assigned to a teammate and waiting for a reply
> **When** an operator opens the contact's profile (from the list, from the contact's name in the inbox conversation header, or by a saved link)
> **Then** the profile shows the contact's name, username, language, when they first wrote and when they last wrote, their tags with who added each one and when, the contact's tag history (each tag added, removed, merged or removed by a delete, by whom and when, under the name the tag had then, newest first, older entries loaded on scrolling), and their conversation: its status, its assignee (or "unassigned"), the "waiting for a reply" marker when it applies, and a way to open it in the inbox; a history section shows the conversation's messages, the team's replies with their authors and its activity entries in the same order as in the inbox, latest first part loaded and older ones on scrolling, with media opened through the panel as in the inbox; the profile can be reopened by reload, the back button or a saved link, and a link to a contact that does not exist shows the not-found card inside the frame
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

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

- [ ] `ContactProfile` (Card, Avatar, Badge, Button, Tabs, Skeleton, Alert, NotFoundCard) with the header, conversation card (**Open in inbox**), and tabs; the Conversation tab mounts T21's component (placeholder until then) — `apps/web/src/features/contacts/ContactProfile.tsx` (+ test)
- [ ] `TagHistoryList` (ScrollArea, Separator, Skeleton, Alert, Button), paged by `after` — `apps/web/src/features/contacts/TagHistoryList.tsx` (+ test)
- [ ] `ContactCrumb` like `ConversationCrumb` — `apps/web/src/features/contacts/ContactCrumb.tsx`
- [ ] Page + route on the real data; delete `ContactProfilePreview`, `sample-data.ts`, `sample-source.ts` (+ test), `SampleDataBadge` (+ test) and the route's sample crumb; update `routes.test.tsx` — listed files

## Edge cases

| Case | Behaviour |
|---|---|
| `getContact` 404 (unknown or foreign id) | `NotFoundCard` in the frame, no conversation part (AC-04, AC-12) |
| an adder or actor who was deactivated | shown by display name (AC-13) |
| a history entry of a tag renamed since | under the name it had then (AC-04) |
| a merged entry | «Test Owner merged «Loyal» into «VIP»» (AC-09) |
| a contact name with markup | plain text (spec §6.1) |

## Definition of Done

- [ ] Testing Library tests cover every SCR-19 state in screens.md except the Conversation-tab history (T21): loading, default with the facts line, missing facts, deactivated adder, the conversation card with status, assignee or «Unassigned», the waiting marker and Open in inbox, «No conversation to show», tag history with all four line kinds and paging, empty and error, live tag re-reads, not found and phone; and no file of the contacts sample source or SampleDataBadge remains.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
