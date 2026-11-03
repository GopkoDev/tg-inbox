---
id: T9
title: "Add the destination use cases: create and read a connect code, redeem it from ChatEventsPort, membership / upgrade / rename updates, remove, list, set the time zone"
layer: "app"
deps: ["T5", "T6", "T7", "T8"]
blocks: ["T11", "T14"]
acs: ["AC-01", "AC-02", "AC-03", "AC-13", "AC-14"]
files_hint: ["apps/api/src/modules/posts/app/destinations.ts", "apps/api/src/modules/posts/app/chat-events.ts", "apps/api/src/modules/posts/app/time-zone.ts", "apps/api/src/modules/posts/app/destination-reads.ts"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "todo"
step: ""
---

# T9 — Add the destination use cases: create and read a connect code, redeem it from ChatEventsPort, membership / upgrade / rename updates, remove, list, set the time zone

## Place in the sequence

- **Blocked by:** T5 — Classify group and channel updates in bots into four facts, , T6 — Add bots.sendPost, bots.deletePost and postReadiness with a , T7 — Add workspaces.timeZone and setTimeZone in the workspaces ap, T8 — Build the posts repositories for destinations, destination c · **Blocks:** T11 — Add the publish confirmation, publish now and schedule / cha, T14 — Wire posts in buildDeps and buildApp: ChatEventsPort, onMemb · **Wave:** 4 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
> **So that** the team can post there through the business bot, and no other chat can be posted to by mistake
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add the destination use cases: create and read a connect code, redeem it from ChatEventsPort, membership / upgrade / rename updates, remove, list, set the time zone.

## Inlined context

> Flow 1: Posts->>Posts: match the hash, unused and unexpired, same bot … alt the bot can post there → destination created or revived, code used, signal; Posts->>Bots: remove the code message … else the bot lacks the right → code result names the missing right, signal
>
> — `sad.md §6 Critical flow 1, abridged` · full text: [sad.md](../sad.md)

> A destination is the chat, once per workspace. A code posted in a chat that is already a destination of the workspace — available, unavailable or removed — revives that same destination … The destination's name follows renames
>
> — `spec.md §1 Clarifications, abridged` · full text: [spec.md](../spec.md)

> Available or not, live. Telegram's notices that the bot lost or regained its right to post, or left or rejoined the chat, mark the destination unavailable or available again at once; a send refused for missing rights marks it too.
>
> — `spec.md §1 Clarifications, verbatim` · full text: [spec.md](../spec.md)

> Removing a destination … those return to drafts with a notice
>
> — `spec.md §1 Clarifications, abridged` · full text: [spec.md](../spec.md)

> a destination connected with a different Telegram bot than the one connected now reads `unavailable` with problem `not_current_bot`
>
> — `contracts/openapi.yaml listDestinations, abridged` · full text: [contracts/openapi.yaml](../contracts/openapi.yaml)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

`destinations` (all), `destination_codes` (all), `posts.state/draft_notice/version` on removal, `workspaces.time_zone` via T7.

— `data-model.md §Entities, abridged` · full text: [data-model.md](../data-model.md)

## API contract

`listDestinations`, `createDestinationCode` (201; 403 OWNER_ONLY; 409 POSTS_NEED_WORKING_BOT / DESTINATION_LIMIT_REACHED), `getDestinationCode`, `removeDestination`, `setPostingTimeZone` (400 TIME_ZONE_INVALID) — app layer only (routes in T15).

— `contracts/openapi.yaml`, abridged

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — domain invariant

> **Given** a business owner whose bot is in a group but may not send messages there, or in a channel without the right to post
> **When** the owner posts a valid connect code there
> **Then** the chat is not connected, and Settings tells the owner which right the bot needs in that chat; a chat the bot was added to without a code never becomes a destination; an expired or already used code connects nothing, and Settings shows the code as expired
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — authorization

> **Given** an operator of "Acme Flowers"
> **When** they look at destinations, a draft or a published post
> **Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a workspace with destinations and scheduled posts
> **When** its bot stops working or is disconnected, or a different Telegram bot is connected
> **Then** while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different working bot, only the old bot's destinations are unavailable until connected again with a code, and posts due to them fail with "this chat is not connected to the current bot"; while reconnecting the same bot keeps them; a group that Telegram upgraded keeps working as the same destination
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] createCode: memberships FOR SHARE → `posts:<ws>` → replace previous → insert hash
- [ ] redeem (ChatEventsPort.onDestinationCode): hash in the bot's workspace, same bot, unexpired; bot rights from the update or `getChatMember`; upsert/revive; mark used; `bots.deletePost` of the code message best-effort; publish `destinations.changed`
- [ ] onChatMembership / onChatMigrated / onChatRenamed with `membership_changed_at` ordering
- [ ] remove: returns scheduled posts to draft (`destination_removed`)
- [ ] list with `not_current_bot` and scheduled counts; setTimeZone with relabel count
- [ ] unit tests with in-memory fakes + integration for redeem

## Edge cases

| Case | Behaviour |
|---|---|
| expired / used / replaced code | nothing connected; result shown |
| code from another workspace's owner | no match (hash scoped by workspace) |
| bot is member without post right | `no_post_right`, code stays usable |
| membership update older than stored | ignored |
| 21st destination | DESTINATION_LIMIT_REACHED |

## Definition of Done

- [ ] unit + integration tests for AC-01, AC-02, AC-13, AC-14 branches pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
