---
id: T14
title: "Wire posts in buildDeps and buildApp: ChatEventsPort, onMembershipDeactivated, the posts.send queue + DLQ workers, the hub forwarding the two new frames"
layer: "wiring"
deps: ["T9", "T12", "T13"]
blocks: ["T15"]
acs: ["AC-01", "AC-12", "AC-17"]
files_hint: ["apps/api/src/deps.ts", "apps/api/src/app.ts", "apps/api/src/modules/posts/infra/jobs.ts", "apps/api/src/modules/inbox/infra/hub.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T14 — Wire posts in buildDeps and buildApp: ChatEventsPort, onMembershipDeactivated, the posts.send queue + DLQ workers, the hub forwarding the two new frames

## Place in the sequence

- **Blocked by:** T9 — Add the destination use cases: create and read a connect cod, T12 — Add the posts.send job body: re-check owner and limits, per-, T13 — Add delete from Telegram within 48 hours and the deactivatio · **Blocks:** T15 — Register the posts routes (registerPosts): the 18 operations · **Wave:** 7 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
> **So that** the team can post there through the business bot, and no other chat can be posted to by mistake
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to choose when a post goes out, in the business's time zone, and change or cancel that until it goes out
> **So that** posts appear at the right moment without anyone being online then
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** replies to customers to go out and customer messages to arrive as fast as ever, whatever is being posted or written in the business's groups
> **So that** posting never makes support slower
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

This task delivers: wire posts in buildDeps and buildApp: ChatEventsPort, onMembershipDeactivated, the posts.send queue + DLQ workers, the hub forwarding the two new frames.

## Inlined context

> Queue `posts.send`: Policy `standard`, no `singletonKey` … `retryLimit: 2`, `retryBackoff: true`, `expireInSeconds: 60` … Dead letter `posts.send-dlq` (`retryLimit: 0`)
>
> — `contracts/events.md §Queue, abridged` · full text: [contracts/events.md](../contracts/events.md)

> `workspaces.onMembershipDeactivated` gains a third call, `posts.returnScheduledOfDeactivated`, inside the deactivation transaction
>
> — `sad.md §4 Supporting choices, verbatim` · full text: [sad.md](../sad.md)

> Only `buildDeps()` constructs module dependencies … and only `buildApp()` registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules «Module wiring», abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — cross-context

> **Given** a post scheduled for 09:00
> **When** it cannot go out by 09:15 because the service was down, the bot was paused by Telegram or Telegram limited posting to that chat
> **Then** it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, paced, and the rest are missed
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** a destination group where customers chat busily and a broadcast and replies are being sent
> **When** posts go out and people write in the group
> **Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `deps.ts`: build posts after bots + workspaces; bind ChatEventsPort; deactivation port; `bindPostJobs(boss)`
- [ ] `posts/infra/jobs.ts`: create queues, workers
- [ ] `app.ts`: queues + workers; hub forwards `post.changed` / `destinations.changed` to every socket of the workspace
- [ ] app smoke test still boots

## Edge cases

| Case | Behaviour |
|---|---|
| ChatEventsPort before binding | no-op, update still accepted |

## Definition of Done

- [ ] `app.int.test.ts` boots; a posts.send job runs end to end in an integration test
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
