---
id: T10
title: "Add the post draft use cases and reads: create, save against version, duplicate, delete draft, back to draft, list, get, attention count, mark seen"
layer: "app"
deps: ["T8"]
blocks: ["T11", "T13"]
acs: ["AC-04", "AC-05", "AC-06", "AC-11", "AC-13", "AC-18"]
files_hint: ["apps/api/src/modules/posts/app/drafts.ts", "apps/api/src/modules/posts/app/post-reads.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T10 — Add the post draft use cases and reads: create, save against version, duplicate, delete draft, back to draft, list, get, attention count, mark seen

## Place in the sequence

- **Blocked by:** T8 — Build the posts repositories for destinations, destination c · **Blocks:** T11 — Add the publish confirmation, publish now and schedule / cha, T13 — Add delete from Telegram within 48 hours and the deactivatio · **Wave:** 4 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to write a post for one of the workspace's destinations and save it as a draft the team can see and edit
> **So that** posts are prepared together before an owner sends them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
> **So that** the team notices at once when a post did not go out and can act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add the post draft use cases and reads: create, save against version, duplicate, delete draft, back to draft, list, get, attention count, mark seen.

## Inlined context

> Flow 3: save draft with the version it shows … alt version matches and the post is a draft → write …, version plus one … else a teammate saved a newer version → refused as draft changed … else the post is scheduled or has gone out → refused as not a draft … Only the author or a business owner deletes a draft, and only while it is a draft.
>
> — `sad.md §6 Flow 3, abridged` · full text: [sad.md](../sad.md)

> Any member moves a scheduled post back to a draft, which bumps its version
>
> — `sad.md §6 Flow 5, abridged` · full text: [sad.md](../sad.md)

> Opening a failed, missed or not confirmed post clears its shared mark for everyone
>
> — `sad.md §6 Flow 9, abridged` · full text: [sad.md](../sad.md)

> Duplicates and authors. A duplicate copies the text, the destination and the sound option into a new draft whose author is the member who duplicated it. A scheduled post that returns to a draft keeps its author
>
> — `spec.md §1 Clarifications, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

`posts` — insert / update draft fields, `version`, `state`, `needs_attention`, `draft_notice`, `last_changed_*`; reads with list filters.

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

`createPost` 201, `savePost` (400 POST_TEXT_INVALID, 409 POST_DRAFT_CHANGED / POST_NOT_A_DRAFT), `duplicatePost` 201, `deletePostDraft` (403 FORBIDDEN, 409 POST_NOT_A_DRAFT), `movePostBackToDraft` (409 POST_NOT_SCHEDULED), `listPosts`, `getPost`, `getPostAttention`, `markPostSeen` — app layer.

— `contracts/openapi.yaml`, abridged

## Acceptance criteria

### AC-04 — authorization

> **Given** members of "Acme Flowers" and of "Bolt Bikes"
> **When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
> **Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — happy path

> **Given** an operator of "Acme Flowers" with the destination "Acme Flowers News"
> **When** they create a post, pick that destination, type the text and tick "send without sound"
> **Then** the draft is saved as they type, shows how the text will look in the chat and how many characters remain, and appears on the Posts page for every member with its destination and who last changed it
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — error

> **Given** an operator editing a draft
> **When** the text is empty after trimming spaces and line breaks, is longer than Telegram allows for one message, or no destination is picked, or a teammate saved a newer version of the draft meanwhile
> **Then** the draft cannot be published or scheduled, the editor says plainly what is missing or too long, and a stale save is refused with the teammate's current version shown, never overwriting it
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a scheduled post
> **When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
> **Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — authorization

> **Given** a draft created by an operator
> **When** another operator tries to delete it
> **Then** they are refused and told only its author or a business owner can delete it; a scheduled post must be moved back to a draft first, and a published, failed or missed post is kept as a record and cannot be deleted from the panel
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] drafts use cases with `post.changed` in the transaction
- [ ] reads with member display names (workspaces), `telegram_link`, `deletable_until`, `not_current_bot` on the destination
- [ ] unit tests with fakes; integration for version races

## Edge cases

| Case | Behaviour |
|---|---|
| save with stale version | 409 + current post |
| destination of another workspace on save | not found |
| operator deletes another's draft | FORBIDDEN |
| back to draft on a sending post | POST_NOT_SCHEDULED |

## Definition of Done

- [ ] unit + integration tests for each AC branch pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
