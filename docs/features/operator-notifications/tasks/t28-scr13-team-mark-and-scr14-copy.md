---
id: T28
title: "Add the «Telegram pings» column to Settings — Team (SCR-13) and the pings sentence to the deactivate confirmation (SCR-14)"
layer: "ui"
deps: ["T20"]
blocks: ["T29", "T30"]
acs: ["AC-10", "AC-12"]
files_hint: ["apps/web/src/features/workspaces/team/Team.tsx", "apps/web/src/pages/TeamPage.test.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T28 — Add the «Telegram pings» column to Settings — Team (SCR-13) and the pings sentence to the deactivate confirmation (SCR-14)

## Place in the sequence

- **Blocked by:** T20 — Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes · **Blocks:** T29 — Add browser end-to-end notification flows against the real API and the fake Bot API, T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 5 — after T20.
- **Lane:** shares `apps/web/src/pages/TeamPage.test.tsx` with T20 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** a customer whose assigned member does not answer to reach the rest of the team
> **So that** nobody waits on a teammate who is off for the day
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It shows a business owner who has pings on, and tells them deactivation turns them off.

## Inlined context

> 8. **The Team mark is a column** «Telegram pings» with the plain text «On» / «Off» in the members table (no colour meaning, since off is not an error). It is read when Team opens and taken from every deactivate / reactivate answer; it is **not** live (flow 15, sad.md §6 flag «`screens` should not promise a live mark»).
>
> — `screens.md §Source, Decision 8, verbatim` · full text: [screens.md](../screens.md)

> | default (changed) | owner opens Team — `listMemberships` items carry `telegram_pings`; the members table gains a column «Telegram pings» after «State» with «On» / «Off» as plain muted text per member (Decision 8); a deactivated member always «Off»; no Telegram name or id anywhere, no link / unlink action in the row menu (AC-12; flow 15) | Table, DataTableToolbar, Card, Avatar, Badge, DropdownMenu | wireframe «team members» |
> | success: deactivated / reactivated | the deactivate / reactivate answer `Membership` (`telegram_pings: false`) replaces the row — «Deactivated» / «Active» and «Off»; reactivation never shows «On» again until the member connects (AC-10; flow 15) | Table | — |
> | not live | a member connecting or disconnecting while Team is open changes nothing here until Team is opened again (flow 15; sad.md §6 flag) | — | — |
> | phone (< md) | as before, email moves under the name; «Telegram pings: On / Off» joins it on that line instead of a column (AC-12) | Table | — |
>
> — `screens.md §SCR-13, state table, verbatim` · full text: [screens.md](../screens.md)

> | default: confirm deactivate (changed) | inherited text (assignment-statuses §SCR-14 Decision 8); when the row shows «Telegram pings: On», one sentence is added before «You can reactivate them later.»: «Bob's Telegram pings stop, and reactivating does not turn them back on.» Cancel / Deactivate (AC-10; flow 15) | AlertDialog, Button | — |
>
> — `screens.md §SCR-14, confirm deactivate, verbatim` · full text: [screens.md](../screens.md)

> - SCR-14's deactivate text gains one sentence about Telegram pings **only when that member's row shows «On»** — nothing to say otherwise.
>
> — `screens.md §Assumptions, SCR-14 sentence, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

`listMemberships` / `deactivateMembership` / `reactivateMembership` → `Membership.telegram_pings` (T20). — `contracts/openapi.yaml, Membership, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

- [ ] Column «Telegram pings» after «State» with «On» / «Off» as plain muted text; phone: «Telegram pings: On / Off» under the name; rows replaced from deactivate / reactivate answers — `apps/web/src/features/workspaces/team/Team.tsx`
- [ ] Deactivate confirmation: the sentence «<Name>'s Telegram pings stop, and reactivating does not turn them back on.» only when the row shows On — same file
- [ ] Testing Library tests — `apps/web/src/pages/TeamPage.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Member shows Off | no extra sentence |
| Name with markup | rendered as text |
| Invitations table | unchanged, no column |

## Definition of Done

- [ ] Testing Library tests prove the Team members table shows «Telegram pings» On / Off per member (and on the phone line), rows switch to Off from the deactivate and reactivate answers, the mark is not live, and the deactivate confirmation adds the pings sentence only for a member shown On.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
