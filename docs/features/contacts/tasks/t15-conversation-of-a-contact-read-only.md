---
id: T15
title: "Add conversations.findByContact and the inbox read getContactConversation, and pin with integration tests that the profile's reads never change read state"
layer: "app"
deps: []
blocks: ["T17"]
acs: ["AC-04", "AC-05", "AC-12"]
files_hint: ["apps/api/src/modules/conversations/app/inbox-reads.ts", "apps/api/src/modules/conversations/app/inbox-reads.int.test.ts", "apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/conversations/infra/conversation-repo.ts", "apps/api/src/modules/inbox/app/reads.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/reads.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T15 — Add conversations.findByContact and the inbox read getContactConversation, and pin with integration tests that the profile's reads never change read state

## Place in the sequence

- **Blocked by:** — · **Blocks:** T17 — Add the API end-to-end contacts stories, the integrity queries, the cross-workspace and secrecy suite, the live-push assertions and the seeded 10 000-contact timing checks · **Wave:** 1 — no upstream; starts at once.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** a contact's profile with what Telegram tells us, their tags, where their conversation stands and its history
> **So that** I understand the customer before I answer and can jump into the conversation
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It gives the profile its conversation's status, assignee and waiting marker through reads that write nothing.

## Inlined context

> **Chosen:** Option 1. The read side already has the required property; adding a route or a flag adds surface without adding safety. The property is pinned by tests so a future change that makes the thread read mark read breaks the build.
>
> — `adr/0006-read-the-profile-conversation-through-the-existing-inbox-reads-that-never-mark-read.md §Decision outcome, ADR-0006, verbatim` · full text: [ADR-0006](../adr/0006-read-the-profile-conversation-through-the-existing-inbox-reads-that-never-mark-read.md)

> - `threadPage` and the conversation summary already have no write side effect. The profile uses them plus the new "conversation of a contact" read, and the web profile store has no call to the mark-read route and no composer.
> - No `markRead` flag or separate history route is added, so there is one thread read for both screens. The guarantee is pinned by an integration test that reads the profile history with unread messages and asserts `read_marks`, unread counts and the attention count are unchanged, and by a web test that the profile never issues the mark-read call.
>
> — `sad.md §4, strategic choice 6, verbatim` · full text: [sad.md](../sad.md)

> - Thread and read marks: `conversations.threadPage` merges messages, replies and activity entries by `(positionAt, kind, id)` and **does not mark read**; `markRead` is a separate use case behind `POST …/inbox/read`, which writes `read_marks` and publishes `conversation.changed` with change `read` (explorer: `conversations/app/inbox-reads.ts:156`, `:190`). The attention count and pings read `read_marks`.
>
> — `sad.md §2, Technical constraints, thread and read marks, verbatim` · full text: [sad.md](../sad.md)

> - **How verify:** integration test: seed unread messages, call the profile, the conversation-of-contact and thread routes, capture a new message, assert `read_marks`, the unread count and the attention read are identical before and after; web test: the profile screen never issues the mark-read request and renders no composer.
>
> — `sad.md §10, QG-2, How verify, verbatim` · full text: [sad.md](../sad.md)

> | Read state untouched by profile | 0 changes to any member's read state caused by opening or reading a profile | integration test: open profile history with unread messages → unread and attention counts unchanged |
>
> — `spec.md §6, NFR, read state, verbatim` · full text: [spec.md](../spec.md)

> 12. **`getContactConversation` answers 404 for a contact with no conversation**, defensively. Capture creates the two together and nothing deletes either, so the case should not occur. See flag F-3.
>
> — `contracts/api-sync-report.md §Assumptions, 12, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. `findByContact` uses the existing `conversations_contact_id_key`.

## API contract

- `GET …/inbox/contacts/{contactId}/conversation` → `200 ConversationSummary` (as `getConversation`: `status`, `assignee`, `waiting_for_reply`, `unread_count` of the caller, `state_version`, …) · `401` · `403 ACCESS_REMOVED` · `404 NOT_FOUND` (contact not of this workspace, or no conversation). Writes nothing.

— `contracts/openapi.yaml, operationId getContactConversation, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-04 — happy path

> **Given** a contact of "Acme Flowers" whose conversation is open, assigned to a teammate and waiting for a reply
> **When** an operator opens the contact's profile (from the list, from the contact's name in the inbox conversation header, or by a saved link)
> **Then** the profile shows the contact's name, username, language, when they first wrote and when they last wrote, their tags with who added each one and when, the contact's tag history (each tag added, removed, merged or removed by a delete, by whom and when, under the name the tag had then, newest first, older entries loaded on scrolling), and their conversation: its status, its assignee (or "unassigned"), the "waiting for a reply" marker when it applies, and a way to open it in the inbox; a history section shows the conversation's messages, the team's replies with their authors and its activity entries in the same order as in the inbox, latest first part loaded and older ones on scrolling, with media opened through the panel as in the inbox; the profile can be reopened by reload, the back button or a saved link, and a link to a contact that does not exist shows the not-found card inside the frame
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — cross-context

> **Given** a conversation of "Acme Flowers" holding customer messages the operator has not read
> **When** the operator reads its history on the contact's profile, including while new customer messages arrive
> **Then** nothing counts as read for the operator: the conversation's unread count, the operator's attention count and the pings they would get stay exactly as if the profile had not been opened, and the profile has no reply box; only opening the conversation in the inbox marks it read, as before; new messages, replies and activity entries appear in the open history without reloading, and the conversation's status, assignee and "waiting for a reply" marker at the top of the profile change with them
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `findByContact(ws, contactId)` → summary or null — `apps/api/src/modules/conversations/infra/conversation-repo.ts`, `apps/api/src/modules/conversations/app/inbox-reads.ts`, `ports.ts`
- [ ] Inbox read `contactConversation(ws, viewer, contactId)` reusing the summary projection — `apps/api/src/modules/inbox/app/reads.ts`
- [ ] Route `GET /api/workspaces/:workspaceId/inbox/contacts/:contactId/conversation` behind the workspace guard — `apps/api/src/modules/inbox/http/routes.ts`
- [ ] Integration test (QG-2): seed unread customer messages; call this route and `listThreadItems` pages; capture a new message; assert `read_marks`, the conversation's unread count and the member's attention count are identical before and after — `apps/api/src/modules/inbox/http/reads.int.test.ts`
- [ ] Isolation test: a contact of another workspace → `404` — `apps/api/src/modules/conversations/app/inbox-reads.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a contact id of another workspace | `404 NOT_FOUND`, no hint (AC-12) |
| a new customer message while the profile reads | the next summary shows it; still nothing marked read (AC-05) |
| a contact with no conversation (should not occur) | `404` (contract F-3) |

## Definition of Done

- [ ] Integration tests prove getContactConversation returns the contact's ConversationSummary for either role and 404 for a foreign contact, and that reading it plus the thread pages — including while a new customer message is captured — leaves read_marks, the unread count and the attention count exactly unchanged.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
