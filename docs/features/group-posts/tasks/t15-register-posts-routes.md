---
id: T15
title: "Register the posts routes (registerPosts): the 18 operations with zod schemas, guards and error mapping"
layer: "ports"
deps: ["T11", "T13", "T14"]
blocks: ["T16", "T24"]
acs: ["AC-03", "AC-04", "AC-05", "AC-06", "AC-07", "AC-09", "AC-10", "AC-15", "AC-16", "AC-18"]
files_hint: ["apps/api/src/modules/posts/http/routes.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T15 — Register the posts routes (registerPosts): the 18 operations with zod schemas, guards and error mapping

## Place in the sequence

- **Blocked by:** T11 — Add the publish confirmation, publish now and schedule / cha, T13 — Add delete from Telegram within 48 hours and the deactivatio, T14 — Wire posts in buildDeps and buildApp: ChatEventsPort, onMemb · **Blocks:** T16 — Add the API end-to-end posts stories, the tenancy and secrec, T24 — Update CLAUDE.md, the architecture map and the design-system · **Wave:** 8 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
> **So that** the team can post there through the business bot, and no other chat can be posted to by mistake
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to write a post for one of the workspace's destinations and save it as a draft the team can see and edit
> **So that** posts are prepared together before an owner sends them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to check the destination and the exact text one last time and publish the post right away
> **So that** the announcement appears in the business's channel or group from its bot, once
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to choose when a post goes out, in the business's time zone, and change or cancel that until it goes out
> **So that** posts appear at the right moment without anyone being online then
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
> **So that** the team notices at once when a post did not go out and can act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to delete a post the bot published, shortly after it went out
> **So that** a mistake does not stay in front of the business's audience
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task delivers: register the posts routes (registerPosts): the 18 operations with zod schemas, guards and error mapping.

## Inlined context

> 18 paths, 19 operations under `/api/workspaces/{workspaceId}/posts…` (+ `receiveTelegramUpdate` changed in T5)
>
> — `contracts/api-sync-report.md, abridged` · full text: [contracts/api-sync-report.md](../contracts/api-sync-report.md)

> Every route sits behind the workspace-access guard: a caller who was never a member gets `404 NOT_FOUND` with no hint, a deactivated member `403 ACCESS_REMOVED`, a signed-out caller `401 UNAUTHENTICATED` (AC-04).
>
> — `contracts/openapi.yaml info.description, verbatim` · full text: [contracts/openapi.yaml](../contracts/openapi.yaml)

> each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`
>
> — `CLAUDE.md §Rules «Module wiring», verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Every operation in `contracts/openapi.yaml` (operationIds: listDestinations, createDestinationCode, getDestinationCode, removeDestination, setPostingTimeZone, listPosts, createPost, getPostAttention, getPost, savePost, duplicatePost, deletePostDraft, getPublishConfirmation, publishPost, schedulePost, movePostBackToDraft, deletePostFromTelegram, markPostSeen).

## Acceptance criteria

### AC-03 — authorization

> **Given** an operator of "Acme Flowers"
> **When** they look at destinations, a draft or a published post
> **Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

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

### AC-07 — happy path

> **Given** a business owner with a draft for "Acme Flowers News" and a working bot
> **When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
> **Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — error

> **Given** a business owner scheduling a post or changing a scheduled post's time
> **When** at the moment they confirm, the chosen time is less than 2 minutes ahead, more than 90 days ahead, the destination is unavailable, or a local time the daylight-saving change skips in the workspace's time zone
> **Then** the post is not scheduled and the owner is told the allowed range, that this time does not exist on that day, or what right the bot is missing in that chat
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
> **When** a business owner deletes it from Telegram and confirms
> **Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** a workspace that sent 30 posts to Telegram in the last 24 hours, or holds 100 scheduled posts waiting
> **When** a business owner publishes another post now, or schedules one more while 100 are waiting
> **Then** the system refuses and says the daily posting limit (and when posting is possible again) or the scheduled-post limit was reached; a scheduled post whose time comes while the daily limit is reached fails with that reason
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — authorization

> **Given** a draft created by an operator
> **When** another operator tries to delete it
> **Then** they are refused and told only its author or a business owner can delete it; a scheduled post must be moved back to a draft first, and a published, failed or missed post is kept as a record and cannot be deleted from the panel
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `http/routes.ts` with `fastify-type-provider-zod` schemas from T2
- [ ] owner-only checks surface `OWNER_ONLY`; ids looked up with the workspace
- [ ] route tests via `app.inject()` per operation (happy + main error)

## Edge cases

| Case | Behaviour |
|---|---|
| foreign id | 404 |
| operator on owner route | 403 OWNER_ONLY |

## Definition of Done

- [ ] `app.inject()` tests per operation pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
