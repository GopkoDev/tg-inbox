---
id: T13
title: "Add delete from Telegram within 48 hours and the deactivation return of scheduled posts"
layer: "app"
deps: ["T6", "T10"]
blocks: ["T14", "T15"]
acs: ["AC-11", "AC-15"]
files_hint: ["apps/api/src/modules/posts/app/delete-published.ts", "apps/api/src/modules/posts/app/deactivation.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
step: ""
---

# T13 — Add delete from Telegram within 48 hours and the deactivation return of scheduled posts

## Place in the sequence

- **Blocked by:** T6 — Add bots.sendPost, bots.deletePost and postReadiness with a , T10 — Add the post draft use cases and reads: create, save against · **Blocks:** T14 — Wire posts in buildDeps and buildApp: ChatEventsPort, onMemb, T15 — Register the posts routes (registerPosts): the 18 operations · **Wave:** 5 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to choose when a post goes out, in the business's time zone, and change or cancel that until it goes out
> **So that** posts appear at the right moment without anyone being online then
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to delete a post the bot published, shortly after it went out
> **So that** a mistake does not stay in front of the business's audience
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add delete from Telegram within 48 hours and the deactivation return of scheduled posts.

## Inlined context

> Flow 8: alt operator → refused …; published more than 48 hours ago, or not published → refused …; within 48 hours → delete the message in the chat; alt Telegram deletes it → state deleted, deleted by and at, text kept …; else Telegram refuses or does not answer → the bot could not delete it, the post stays published
>
> — `sad.md §6 Flow 8, abridged` · full text: [sad.md](../sad.md)

> Flow 6: in the deactivation transaction … return every post scheduled by that account to a draft, version plus one, notice
>
> — `sad.md §6 Flow 6, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

`posts.state`, `deleted_at`, `deleted_by_account_id`, `draft_notice`, `version`.

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

`deletePostFromTelegram` (409 POST_NOT_PUBLISHED / POST_DELETE_WINDOW_PASSED / POST_DELETE_REFUSED, 503 TELEGRAM_UNAVAILABLE) — app layer; `returnScheduledOfDeactivated(tx, {workspaceId, accountId})` port.

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-11 — domain invariant

> **Given** a scheduled post
> **When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
> **Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
> **When** a business owner deletes it from Telegram and confirms
> **Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] delete use case with membership share lock and 48 h check before calling `bots.deletePost`
- [ ] `returnScheduledOfDeactivated` for `onMembershipDeactivated`
- [ ] tests incl. 48 h edge and refusal

## Edge cases

| Case | Behaviour |
|---|---|
| 47:59 after publish | deleted |
| already deleted | unchanged |
| Telegram no answer | 503, stays published |

## Definition of Done

- [ ] unit + integration tests pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
