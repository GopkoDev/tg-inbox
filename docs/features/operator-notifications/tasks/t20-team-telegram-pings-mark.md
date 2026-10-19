---
id: T20
title: "Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes"
layer: "ports"
deps: ["T8", "T10", "T18"]
blocks: ["T21", "T28", "T30"]
acs: ["AC-10", "AC-12"]
files_hint: ["packages/shared/src/workspaces.ts", "packages/shared/src/workspaces.test.ts", "apps/api/src/modules/workspaces/app/team.ts", "apps/api/src/modules/workspaces/app/ports.ts", "apps/api/src/modules/notifications/app/settings.ts", "apps/api/src/deps.ts", "apps/api/src/modules/workspaces/http/team-routes.int.test.ts", "apps/web/src/pages/TeamPage.test.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T20 — Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes

## Place in the sequence

- **Blocked by:** T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link, T10 — Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting, T18 — Remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions · **Blocks:** T21 — Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames, T28 — Add the «Telegram pings» column to Settings — Team (SCR-13) and the pings sentence to the deactivate confirmation (SCR-14), T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 4 — after T8, T10, T18.
- **Lane:** shares `apps/api/src/deps.ts` with T7; shares `apps/api/src/modules/notifications/app/settings.ts` with T10; shares `apps/api/src/deps.ts` with T12; shares `apps/api/src/deps.ts` with T14; shares `apps/api/src/deps.ts` with T18; shares `apps/api/src/deps.ts` with T19; shares `apps/web/src/pages/TeamPage.test.tsx` with T28 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** a customer whose assigned member does not answer to reach the rest of the team
> **So that** nobody waits on a teammate who is off for the day
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It lets a business owner see who has Telegram pings on, as a boolean, never the Telegram account.

## Inlined context

> - **F-1 · sad.md §5 vs the Team mark's route** — sad.md §5's `notifications/http` line lists "team on/off for owners", while the same section's construction order gives `team` a port, and the brief asks for the mark on the existing memberships read. The contract follows the port: `listMemberships` gains `telegram_pings`. **Accepted** as the reading that adds no route and keeps `workspaces` free of a `notifications` import. Owner: `tasks` (wire the port in `buildDeps()`); a one-line §5 wording fix can follow at the next `design` touch.
>
> — `contracts/api-sync-report.md §C. Flags, F-1, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> 2. **The Team mark rides the existing `listMemberships`** (dispatch brief; sad.md §5 construction order "notifications → the ports that `bots` and `team` take → team"). `Membership` gains `telegram_pings: boolean`, so `deactivateMembership` and `reactivateMembership`, which answer a `Membership`, change too (always `false` there). sad.md §5's http line "team on/off for owners" under `notifications/http` is therefore served by the `team` read through a port, not by a separate notifications route. See flag F-1.
>
> — `contracts/api-sync-report.md §Assumptions, 2, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> On Settings — Team, a business owner sees "Telegram pings on / off" per member, read from live links as account ids and booleans only. There is never a Telegram account and never a link or unlink action (AC-12).
>
> — `sad.md §6, flow 15 prose, abridged` · full text: [sad.md](../sad.md)

> `telegram_pings: boolean` — true when the member has a live `telegram_links` row in this workspace. Never the Telegram account itself. Always false for a deactivated member.
>
> — `contracts/openapi.yaml §Membership, telegram_pings, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Reads `telegram_links` live rows of the workspace (account ids only) through `telegramLinkRepo.listLive`. No schema change.

## API contract

`listMemberships`, `deactivateMembership`, `reactivateMembership` (changed): every `Membership` carries `telegram_pings`; owner only (`403 OWNER_ONLY` for an operator) unchanged. — `contracts/openapi.yaml, listMemberships / deactivateMembership / reactivateMembership, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-10 — cross-context

> **Given** a conversation of "Acme Flowers" whose ping is due
> **When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
> **Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, no ping is sent and none is queued for later, and the member's panel shows "Pings paused — the bot is not working". Once the bot works again, conversations whose customers are still waiting and that were not pinged to a member in their current waiting period become due for that member again. They go out combined, under the one-per-10-minutes limit (AC-08), and the 30-minute team reach continues from the start of each wait. When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. Pings to that member are still attempted when due. A failed attempt counts as that conversation's ping for this member in the waiting period and is not retried. A deactivated member's link is removed. A link made with the workspace's previous bot is removed when a different bot is connected, and its member sees "Not connected". A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add `telegram_pings` to the shared `Membership` schema (contract change, compile-coupled with the web Team fixtures) — `packages/shared/src/workspaces.ts`, `packages/shared/src/workspaces.test.ts`
- [ ] `team` takes a port `linkedAccounts(workspaceId) → Set<accountId>` and fills `telegram_pings`; deactivate / reactivate answers are always `false` — `apps/api/src/modules/workspaces/app/team.ts`, `apps/api/src/modules/workspaces/app/ports.ts`
- [ ] `notifications.linkedAccounts` and filling the port in `buildDeps()` — `apps/api/src/modules/notifications/app/settings.ts`, `apps/api/src/deps.ts`
- [ ] Update the web Team test fixtures to the new field (no UI change here) — `apps/web/src/pages/TeamPage.test.tsx`
- [ ] Route tests: owner sees on / off, operator `403`, no Telegram id or name in any body — `apps/api/src/modules/workspaces/http/team-routes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Member linked in another workspace only | `false` here |
| Deactivated member | always `false` |
| A member connects while Team is open | not live; seen on the next read |

## Definition of Done

- [ ] Team route tests prove listMemberships, deactivateMembership and reactivateMembership return telegram_pings per member from live links of this workspace only, false for deactivated and reactivated members, with no Telegram id or name in any body, and workspaces imports nothing from notifications (the port is filled in buildDeps).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
