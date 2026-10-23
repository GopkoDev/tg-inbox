---
id: T11
title: "Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer"
layer: "app"
deps: ["T2", "T4", "T8"]
blocks: ["T12", "T17"]
acs: ["AC-04", "AC-05", "AC-06", "AC-12"]
files_hint: ["apps/api/src/modules/notifications/app/redeem.ts", "apps/api/src/modules/notifications/app/redeem.test.ts", "apps/api/src/modules/notifications/app/redeem.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T11 — Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer

## Place in the sequence

- **Blocked by:** T2 — Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal, T4 — Add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time, T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link · **Blocks:** T12 — Intercept every private update in bots before capture through a port: redeem connect-link starts, consume linked members' messages with the hourly notice, pass everyone else, T17 — Wire the ping jobs: the notifications.send-pings chain per workspace, the notifications.schedule-pings cron over the sixth tenancy exception, and the QG-1 scenario tests · **Wave:** 3 — after T2, T4, T8.
- **Lane:** shares `apps/api/src/modules/notifications/app/redeem.ts` with T17 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It binds the member's Telegram account to their membership exactly once, for exactly the membership the link was issued to.

## Inlined context

> - the link row is found by `(workspace_id, token_hash)` with a plain read, which gives its membership;
> - the membership is share-locked (`workspaces.lockActiveMembers`) and must be active. It is locked **before** the connect-link row, the same order as deactivation (§8), so the two cannot deadlock;
> - the connect-link row is then locked `FOR UPDATE` and re-checked: it must be unused, unexpired and not replaced;
> - the two uniqueness rules are checked: one live link per membership, one live link per Telegram user per workspace. Partial unique indexes back them up;
> - the link row is written and the connect link is marked used;
> - an account-scoped signal is published (choice 7), and the bot's answer is enqueued.
> Every refusal still uses the link up and answers in the chat (AC-05, AC-06).
>
> — `sad.md §4, choice 4, Redeem, verbatim` · full text: [sad.md](../sad.md)

> missing → enqueue the answer link expired
> expired, used or replaced → enqueue the answer link expired
> membership not active → use the link up, enqueue the answer link expired
> this Telegram user is linked to a teammate, or the member is linked from another account → use the link up, enqueue the answer cannot connect with the reason
> the member is already linked from this account → use the link up, enqueue the answer already connected
> free → insert the Telegram link bound to the bot id, use the link up; telegram link changed for this account, in the transaction; enqueue the answer connected and how to stop
>
> — `sad.md §6, seeded flow 2, redeem branches, abridged` · full text: [sad.md](../sad.md)

> **Redeem:** a plain read of the connect link by hash (to learn its membership) → the membership (`FOR SHARE`) → the connect-link row (`FOR UPDATE`, re-checked) → the link insert, with the partial unique indexes as backstop.
>
> — `sad.md §8, Concurrency, Redeem lock order, abridged` · full text: [sad.md](../sad.md)

> exactly one recipient: `telegram_link_id` for `connected`, `already_connected`, `notifications_off`, `chat_only_notifications`; `telegram_user_id` (bigint as a decimal string) for `link_expired` and `cannot_connect`. `reason` is required for `cannot_connect`.
>
> — `contracts/events.md §Event: notifications.send-bot-message, recipient pairs, abridged` · full text: [events.md](../contracts/events.md)

> **Chosen:** Option 1. 256 bits of randomness cannot be guessed, the stored hash is useless if the database leaks, and the row gives single use, replacement and the 5-per-10-minutes count (under the `connect-links:<ws>:<account>` advisory lock, the reply-limit precedent). The 47-character payload fits Telegram's limit. The link records the bot's **Telegram bot id**, so a token rotation keeps it and a different bot removes it (ADR-0003). A deactivated member's unused connect links are marked replaced in the deactivation transaction, and the membership check at redeem is the second line.
>
> — `adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md §Decision outcome, ADR-0004, verbatim` · full text: [ADR-0004](../adr/0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Change |
|---|---|
| `connect_links` | read by `(workspace_id, token_hash)`, `FOR UPDATE` by PK, `used_at` set on every outcome but «missing» |
| `telegram_links` | insert `{ telegram_bot_id, telegram_user_id, display_name, linked_at }` (live) |

— `data-model.md §Entities telegram_links + connect_links, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. Outcomes are bot answers (`notifications.send-bot-message`), never HTTP errors; the webhook answers `200` (events.md).

## Acceptance criteria

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a member who opens a connect link
> **When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
> **Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
> **When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
> **Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently. A connected member who opens a new connect link from the Telegram account they are already connected with is told "you are already connected", and the link is used up. While a member is connected, the panel offers "Disconnect" and no connect link. Connecting another Telegram account means disconnecting first.
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `redeem({ workspaceId, telegramBotId, from: { id, displayName }, token, at })` → `linked | already_connected | cannot_connect(reason) | link_expired`; one transaction in the lock order above — `apps/api/src/modules/notifications/app/redeem.ts`
- [ ] Display name from the Telegram sender (first + last name, else `@username`), stored as plain text
- [ ] Publish `telegram_link.changed` only on `linked`; enqueue the answer job with the right recipient field in the same transaction
- [ ] Unit tests per branch with fakes; integration test of a concurrent deactivation (both lock orders) and of two concurrent redeems by two Telegram users — `apps/api/src/modules/notifications/app/redeem.test.ts`, `apps/api/src/modules/notifications/app/redeem.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Token for another workspace's bot | not found in this workspace → link expired (no hint) |
| Two members race to link the same Telegram account | one wins, the other gets `cannot_connect / telegram_linked_to_teammate` (partial unique backstop) |
| Deactivation commits first | membership not active → link used up, link expired |
| Replayed after success | used → link expired |
| Telegram user id in logs | only in the redeem outcome at debug level (sad.md §7) |

## Definition of Done

- [ ] Unit and integration tests prove every redeem outcome (missing, expired, used, replaced, membership not active, teammate's account, member linked elsewhere, already connected from this account, free) uses the link up as specified, links only the issued membership with the bot id, signals only on a new link, enqueues the matching answer, and never deadlocks against a deactivation.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
