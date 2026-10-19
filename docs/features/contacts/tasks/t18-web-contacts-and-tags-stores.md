---
id: T18
title: "Add the web contacts and tags API sources and stores, with the live subscriptions to contact.changed, tags.changed, conversation.changed (never mark read) and resync"
layer: "ui"
deps: ["T4"]
blocks: ["T19", "T20", "T22", "T23"]
acs: ["AC-05", "AC-06"]
files_hint: ["apps/web/src/features/contacts/api.ts", "apps/web/src/features/contacts/store.ts", "apps/web/src/features/contacts/store.test.ts", "apps/web/src/features/tags/api.ts", "apps/web/src/features/tags/store.ts", "apps/web/src/features/tags/store.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T18 — Add the web contacts and tags API sources and stores, with the live subscriptions to contact.changed, tags.changed, conversation.changed (never mark read) and resync

## Place in the sequence

- **Blocked by:** T4 — Add the contacts zod contracts, the eight tag error codes, and the contact.changed / tags.changed frames and signals with their hub mapping · **Blocks:** T19 — Build SCR-18, the Contacts list: ContactsTable and TagFilter with the address state, Show more, the counts, the missing-tag notice and the empty and error states, replacing ContactsPreview, T20 — Build SCR-19, the contact profile: the header card with facts and tags, the conversation card, the Conversation / Tag history tabs with TagHistoryList and ContactCrumb, and remove the contacts sample source and SampleDataBadge, T22 — Build SCR-20, the TagControl, and mount it on the profile and on the inbox conversation header (SCR-02) with the contact's tags and the name linking to the profile, T23 — Build Settings — Tags (SCR-21) with the counts as links and the DeleteTagDialog (SCR-23), the owner-only Tags section in SettingsLayout and its route · **Wave:** 3 — after T4.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It holds what every contacts screen shows and keeps it current from the live connection, without a single mark-read call.

## Inlined context

> - **Stores:** `features/contacts/store.ts` (keyed by workspace) holds the list page, the open profile (facts, tags, tag history pages) and the profile's conversation (summary + thread pages). `features/tags/store.ts` holds the workspace tag list (with counts) used by the picker, the filter and Settings → Tags. The ui-redesign sample source is replaced by an API source and the sample data and "Sample data" label are removed.
>
> — `sad.md §4, UI architecture, Stores, verbatim` · full text: [sad.md](../sad.md)

> - **Live:** the profile and the conversation header subscribe to the workspace's existing live connection. `contact.changed` for their contact and `tags.changed` refetch the contact's tags (and the tag history on the profile); `conversation.changed` for the profile's conversation refetches its summary and items exactly as the inbox does, minus the mark-read (ADR-0007).
>
> — `sad.md §4, UI architecture, Live, verbatim` · full text: [sad.md](../sad.md)

> - **Profile history without reading:** the profile's conversation part uses the inbox reads only (summary + thread pages) and **never calls the mark-read route**; it has no composer (ADR-0006).
>
> — `sad.md §4, UI architecture, Profile history without reading, verbatim` · full text: [sad.md](../sad.md)

> | Trigger | What the panel does | Source |
> | --- | --- | --- |
> | `contact.changed` (`change: tags`) for the shown contact | SCR-02's header and SCR-19 re-read `getContact`; SCR-19 also re-reads `listContactTagHistory` from the top; an open SCR-20 re-renders (the typed text is kept); other contacts' frames are ignored | AC-06; flow 11; events.md |
> | `tags.changed` | the tag store re-reads `listTags` (picker, filter labels); SCR-02's header and SCR-19 re-read their contact's tags (and SCR-19 its tag history); a merged or deleted tag disappears, a renamed one shows its new name | AC-06, AC-09, AC-14; flow 11; events.md |
> | `conversation.changed` for SCR-19's conversation | SCR-19 re-reads `getContactConversation`, the new thread items and `getContact` (a new Telegram name) — never `markConversationRead` | AC-05, AC-13; flow 7; events.md |
> | `resync` / reconnect | the same re-reads as the three rows above for whatever is open | AC-05, AC-06; flow 11 |
> | a frame that fails to parse | dropped; reconnect + resync (inherited rule; an old bundle ignores the two new frames) | events.md «Old bundles» |
> | a background re-read fails (network / `500`) | what is shown stays; the next frame or resync asks again; no error shown | flow 7 «keeps what it shows» |
> | workspace switched | the outlet remounts keyed on the workspace (inherited); SCR-18 starts with no search and no filter; the tag store is reloaded for the new workspace | AC-02; flow 4 |
>
> — `screens.md §Screens, Shared states, verbatim` · full text: [screens.md](../screens.md)

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

Calls, each response parsed with its `@tg/shared` schema: `listContacts`, `getContact`, `listContactTagHistory`, `addContactTag`, `removeContactTag`, `listTags`, `renameTag`, `deleteTag`, `getContactConversation`, and the unchanged `listThreadItems`. **Never** `markConversationRead` from the contacts features. Frames: `contact.changed`, `tags.changed`, `conversation.changed`, `resync` via `subscribeLive`.

— `contracts/events.md §Frames, panel reaction, abridged` · full text: [events.md](../contracts/events.md)

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

## Checklist

- [ ] API functions over `shared/api/client.ts` — `apps/web/src/features/contacts/api.ts`, `apps/web/src/features/tags/api.ts`
- [ ] Contacts store keyed by workspace: list page + next pages, open profile (facts, tags, tag-history pages), the profile's conversation (summary + thread pages), the header's contact tags — `apps/web/src/features/contacts/store.ts`
- [ ] Tags store: `listTags` once per workspace, refetch on `tags.changed` / `resync`, reload on workspace switch — `apps/web/src/features/tags/store.ts`
- [ ] Live: `contact.changed` for a shown contact → re-read `getContact` (+ history from the top on a profile); `tags.changed` → tag store + shown contacts' tags; `conversation.changed` for the profile's conversation → summary, new items, `getContact`; frames of another workspace dropped; a failed background re-read keeps what is shown — same files
- [ ] Store tests incl. an assertion that no contacts / tags store path ever calls the mark-read API — `store.test.ts` (both)

## Edge cases

| Case | Behaviour |
|---|---|
| `contact.changed` for another contact | ignored |
| a frame of another workspace | dropped |
| a background re-read fails | what is shown stays; the next frame or resync asks again |
| the list (SCR-18) and Settings — Tags (SCR-21) | do not subscribe — not live |

## Definition of Done

- [ ] Store unit tests prove each live frame triggers exactly the re-reads screens.md lists (contact.changed for the shown contact, tags.changed, conversation.changed for the profile's conversation, resync), frames of another workspace or contact are ignored, a failed re-read keeps the shown state, and no contacts or tags code path issues the mark-read request.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
