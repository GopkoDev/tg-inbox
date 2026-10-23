---
id: T18
title: "Remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions"
layer: "app"
deps: ["T2", "T8"]
blocks: ["T20", "T30"]
acs: ["AC-05", "AC-10"]
files_hint: ["apps/api/src/modules/notifications/app/link-lifecycle.ts", "apps/api/src/modules/notifications/app/link-lifecycle.int.test.ts", "apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/paste-token.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T18 — Remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions

## Place in the sequence

- **Blocked by:** T2 — Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal, T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link · **Blocks:** T20 — Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes, T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 3 — after T2, T8.
- **Lane:** shares `apps/api/src/deps.ts` with T7; shares `apps/api/src/deps.ts`, `apps/api/src/modules/bots/app/ports.ts` with T12; shares `apps/api/src/deps.ts` with T14; shares `apps/api/src/deps.ts` with T19; shares `apps/api/src/deps.ts` with T20 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It makes a former member or a replaced bot lose its links atomically with the change that caused it.

## Inlined context

> - `bots` ⇢ (port) `notifications.intercept(…)` in `accept-update`, and `notifications.onBotConnected(tx, { workspaceId, telegramBotId })` in the paste-token connect transaction.
> - `workspaces` ⇢ (port) `notifications.removeLinkOnDeactivation(tx, { workspaceId, accountId, at })`, called after `conversations.unassignDeactivatedMember` in the same transaction. It also marks the member's unused connect links replaced.
>
> — `sad.md §5, ports, verbatim` · full text: [sad.md](../sad.md)

> **Deactivation:** the workspace row `FOR NO KEY UPDATE` → the membership `UPDATE` → the conversations unassign → the link removal and the connect-link replacement. The link removal locks only notifications rows, so it adds no cycle.
> **Bot connected:** the bots row write → the link removal, in the paste-token transaction.
>
> — `sad.md §8, Concurrency, Deactivation + Bot connected, abridged` · full text: [sad.md](../sad.md)

> A token rotation keeps the same id, so the bot-connected hook keeps every link. Connecting a different bot removes every live link made with another bot id, in the same transaction, as "bot replaced". Each affected member's tabs then show "Not connected" (AC-10). A disconnected bot, or one that needs a new token, keeps the links.
>
> — `sad.md §6, flow 16 prose, abridged` · full text: [sad.md](../sad.md)

> | `onMembershipDeactivated` is a single function today, filled with the unassign. It becomes a composition built in `buildDeps()`. | Low | Composition in `deps.ts`, ordered unassign then link removal. Covered by the deactivation integration test. | Tech Lead |
>
> — `sad.md §11, composed port, verbatim` · full text: [sad.md](../sad.md)

> - deactivation and a different bot send no answer, so they clear the id in the removing transaction;
>
> — `data-model.md §Assumptions, 3, no answer on deactivation, verbatim` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Change |
|---|---|
| `telegram_links` | live link of the member → `removed_reason = 'deactivated'`, id and name cleared; live links with another `telegram_bot_id` → `bot_replaced`, id and name cleared |
| `connect_links` | the member's unused links → `replaced_at` |

— `data-model.md §Entities telegram_links + connect_links, abridged` · full text: [data-model.md](../data-model.md)

## API contract

`deactivateMembership` keeps its contract (the link removal is inside it); `pasteBotToken` keeps its contract and surfaces the removal only as `telegram_link.changed` per affected account. — `contracts/api-sync-report.md §Operations, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

## Acceptance criteria

### AC-05 — error

> **Given** a member who opens a connect link
> **When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
> **Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** a conversation of "Acme Flowers" whose ping is due
> **When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
> **Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, no ping is sent and none is queued for later, and the member's panel shows "Pings paused — the bot is not working". Once the bot works again, conversations whose customers are still waiting and that were not pinged to a member in their current waiting period become due for that member again. They go out combined, under the one-per-10-minutes limit (AC-08), and the 30-minute team reach continues from the start of each wait. When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. Pings to that member are still attempted when due. A failed attempt counts as that conversation's ping for this member in the waiting period and is not retried. A deactivated member's link is removed. A link made with the workspace's previous bot is removed when a different bot is connected, and its member sees "Not connected". A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `removeLinkOnDeactivation(tx, { workspaceId, accountId, at })`: remove the live link as `deactivated`, mark unused connect links replaced, publish `telegram_link.changed` — `apps/api/src/modules/notifications/app/link-lifecycle.ts`
- [ ] `onBotConnected(tx, { workspaceId, telegramBotId })`: remove live links with another bot id as `bot_replaced`, one signal per account — same file
- [ ] Declare the bot-connected port and call it inside the paste-token connect transaction — `apps/api/src/modules/bots/app/ports.ts`, `apps/api/src/modules/bots/app/paste-token.ts`
- [ ] Compose `onMembershipDeactivated` = unassign, then link removal, in `buildDeps()` — `apps/api/src/deps.ts`
- [ ] Integration tests: deactivation in one workspace keeps the other workspace's link; reactivation restores nothing; rotation keeps, different bot removes — `apps/api/src/modules/notifications/app/link-lifecycle.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Member with no link deactivated | no-op, no signal |
| Token rotation (same Telegram bot id) | links kept |
| Bot disconnected or `needs_token` | links kept (pings paused) |
| Connect link issued before deactivation, started after | replaced → link expired (AC-05) |

## Definition of Done

- [ ] Integration tests prove deactivation removes the member's live link as deactivated with Telegram id and name cleared and marks their unused connect links replaced in the deactivation transaction after the unassign, the other workspace's link stays, reactivation restores nothing, and connecting a different bot removes every live link of another bot id while a rotation keeps them, each with its account-scoped signal and no bot answer.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
