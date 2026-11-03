---
id: T7
title: "Record reachability in contacts: capture's upsertFromProfile takes the receiving bot's Telegram id and writes \"wrote\" (clearing an older block), recordBlockChange applies a block or unblock only when newer, and contact.changed reach fires only when a mark changed"
layer: "app"
deps: ["T2", "T4"]
blocks: ["T9", "T10"]
acs: ["AC-10", "AC-14"]
files_hint: ["apps/api/src/modules/contacts/infra/reach-repo.ts", "apps/api/src/modules/contacts/infra/reach-repo.int.test.ts", "apps/api/src/modules/contacts/infra/contact-repo.ts", "apps/api/src/modules/contacts/app/reach.ts", "apps/api/src/modules/contacts/app/reach.test.ts", "apps/api/src/modules/contacts/app/ports.ts", "apps/api/src/modules/contacts/app/fakes.ts", "apps/api/src/modules/contacts/infra/tag-signals.ts", "apps/api/src/modules/conversations/app/conversations.ts", "apps/api/src/modules/conversations/app/ports.ts", "apps/api/src/modules/bots/app/accept-update.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T7 — Record reachability in contacts: capture's upsertFromProfile takes the receiving bot's Telegram id and writes "wrote" (clearing an older block), recordBlockChange applies a block or unblock only when newer, and contact.changed reach fires only when a mark changed

## Place in the sequence

- **Blocked by:** T2 — Promote migrations 01–02 (contact_bot_reach and its backfill for the workspace's current Telegram bot), regenerate DB types and add the reach fixtures, T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet · **Blocks:** T9 — Show "blocked the bot" on Contacts reads: list rows and the profile gain blocked_since for the current Telegram bot through a late-bound currentBot port, T10 — Learn blocks in bots: allowed_updates gains my_chat_member, the classifier turns a private kicked / member update into a reach decision handled before the interceptor and capture, and a reply refused as blocked records the block · **Wave:** 3 — after T2, T4.
- **Lane:** shares `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/app/fakes.ts` with T8; shares `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts` with T9; shares `apps/api/src/modules/bots/app/accept-update.ts` with T10; shares `apps/api/src/modules/conversations/app/ports.ts` with T13 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to see on a contact that they have blocked the bot, and have such contacts left out of broadcasts
> **So that** the team does not count on reaching customers the bot cannot reach
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It makes a contact's reachability follow what actually happened — the bot they wrote through, a block, an unblock — so drafts, launches and Contacts all read one up-to-date mark per Telegram bot.

## Inlined context

> 2. **Reachability belongs to the contact and is kept per Telegram bot in `contacts`.** … Capture writes "wrote" (and clears a block) through the existing `upsertFromProfile`, which now takes the bot's Telegram id. `bots` writes block and unblock. Every read asks about the **current** Telegram bot, so reconnecting the same Telegram bot keeps the marks and connecting a different one starts clean, with no reset job (AC-10, AC-14).
>
> — `sad.md §4, choice 2, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. Keying by the Telegram bot id makes "same bot keeps, different bot resets" true by construction, with no reset job. A fact is applied only when its Telegram time is not older than `changed_at`, so an out-of-order block or message cannot flip the mark back.
>
> — `adr/0002 §Decision outcome, ADR-0002, abridged` · full text: [ADR-0002](../adr/0002-keep-per-bot-reachability-of-contacts-in-contacts-keyed-by-the-telegram-bot-id.md)

> - **`contacts.upsertFromProfile` gains `telegramBotId`** (ADR-0002). `contacts/infra/contact-repo.ts` then upserts `contact_bot_reach` in the same transaction: `wrote_at = LEAST(stored, sentAt)`, and when `sentAt >= changed_at`, clear `blocked_at` and set `changed_at = sentAt`. Capture must pass the receiving bot's Telegram id (the webhook resolves the bot row first, so it is at hand). `contacts/app/fakes.ts` follows.
> - **`recordBlockChange` applies a fact only when `at >= changed_at`** (`INSERT … ON CONFLICT … DO UPDATE … WHERE contact_bot_reach.changed_at <= excluded.changed_at`). A missing contact (a linked member who is not a contact) is a no-op (ADR-0003).
>
> — `_audit/data-model-2026-10-23.md §Code-level findings, first two, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> | contacts | `upsertFromProfile(…, telegramBotId)` writes the reach row (wrote, clears a block when newer) | conversations (capture) | AC-10, AC-14 |
> | contacts | `recordBlockChange(workspaceId, telegramBotId, telegramUserId, blocked, at)` | bots | AC-14 |
>
> — `sad.md §5, App-layer additions, contacts rows 1–2, verbatim` · full text: [sad.md](../sad.md)

> 4. **`contact.changed { change: "reach" }` is published only when a mark actually changed**: a fact older than the reach row's `changed_at`, a block of a contact already blocked, or an unblock of one not blocked publishes nothing. Capture's "wrote" that clears an older block publishes it; a first "wrote" without a block does not (no visible change).
>
> — `contracts/events.md §Assumptions, 4, verbatim` · full text: [events.md](../contracts/events.md)

> 11. **Reach rows of a refused send use our clock** for `changed_at` and `blocked_at`. Telegram updates and messages use Telegram's time. Both are compared with `changed_at`, so an older fact is ignored.
>
> — `data-model.md §Assumptions, 11, abridged` · full text: [data-model.md](../data-model.md)

> Reach writes lock only their reach row (capture: after the contact upsert, as today).
>
> — `sad.md §8, Lock order, abridged` · full text: [sad.md](../sad.md)

> - **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column (`contact_bot_reach`) | Type | Constraints | Change |
|---|---|---|---|
| `wrote_at` | timestamptz | NULL, `<= changed_at` | written by capture (`LEAST(stored, sentAt)`) |
| `blocked_at` | timestamptz | NULL, `<= changed_at` | set / cleared by `recordBlockChange`; cleared by capture when newer |
| `changed_at` | timestamptz | NOT NULL | the newest fact applied; older facts ignored |

Key `contact_bot_reach_pkey (workspace_id, contact_id, telegram_bot_id)`; `recordBlockChange` finds the contact by `contacts_workspace_id_telegram_user_id_key`.

— `data-model.md §Entities, contact_bot_reach, abridged` · full text: [data-model.md](../data-model.md)

## API contract

> - Signal / frame `contact.changed { workspace_id, contact_id, change: "reach" }` — every socket of the workspace; producers: `contacts.recordBlockChange` from `bots` and capture's `upsertFromProfile` when it clears a block — only when a mark changed.
>
> — `contracts/events.md §Channel: realtime signals, contact.changed row, abridged` · full text: [events.md](../contracts/events.md)

## Acceptance criteria

### AC-10 — cross-context

> **Given** a business owner of "Acme Flowers" about to launch a draft
> **When** the workspace has no bot connected, or its bot is not working (the token was revoked), or the workspace connected a different bot since some of the audience last wrote
> **Then** with no bot or a bot that is not working, launch is refused, the draft stays a draft, and the owner is told why and offered the way to the bot settings; contacts who have never written to the bot connected now cannot be reached by it, so they are left out at launch and counted apart in the draft and the confirmation ("never wrote to the current bot"), and blocked marks learned with the old bot do not apply to the new one; reconnecting the same Telegram bot is not a change of bot, so its blocked marks and who wrote to it stay; drafts can be created, edited and duplicated while the bot is missing or not working
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] Red: reach-repo integration tests — `upsertWrote` keeps the earliest `wrote_at`, clears an older block and moves `changed_at` only for a newer message; `applyBlockChange` blocks / unblocks only when `at >= changed_at` and returns whether the mark changed; two bot ids → two rows; isolation over two workspaces — `apps/api/src/modules/contacts/infra/reach-repo.int.test.ts`
- [x] Green: `reach-repo.ts` (`INSERT … ON CONFLICT … DO UPDATE … WHERE changed_at <= excluded.changed_at`, `RETURNING` old/new blocked) — `apps/api/src/modules/contacts/infra/reach-repo.ts`
- [x] `upsertFromProfile(…, telegramBotId)` calls the reach upsert in the same transaction after the contact upsert — `apps/api/src/modules/contacts/infra/contact-repo.ts`, `apps/api/src/modules/contacts/app/ports.ts`, `apps/api/src/modules/contacts/app/fakes.ts`
- [x] `recordBlockChange(workspaceId, telegramBotId, telegramUserId, blocked, at)` use case: unknown user → no-op; publish `contact.changed reach` in the transaction only on a change — `apps/api/src/modules/contacts/app/reach.ts` (+ `reach.test.ts`), publisher in `apps/api/src/modules/contacts/infra/tag-signals.ts`
- [x] Capture passes the receiving bot's Telegram id through — `apps/api/src/modules/conversations/app/conversations.ts`, `apps/api/src/modules/conversations/app/ports.ts`, `apps/api/src/modules/bots/app/accept-update.ts`
- [x] Existing capture tests updated for the new argument; no log line carries a name or chat id

## Edge cases

| Case | Behaviour |
|---|---|
| a block notice older than the last message | ignored; no signal (ADR-0002) |
| block of an already blocked contact | no change, no signal (events assumption 4) |
| first message ever through a bot | reach row with `wrote_at`; no signal (nothing visible changed) |
| a new message after a block | block cleared, `contact.changed reach` published (AC-14) |
| `recordBlockChange` for a member's linked account that is not a contact | no-op (AC-14: a member's own account is never a contact) |
| a different Telegram bot connected | its own rows; the old bot's marks stay but are not read (AC-10) |

## Definition of Done

- [x] Integration tests prove capture writes a reach row for the receiving Telegram bot (wrote_at = the earliest message, a newer message clears an older block, an older one does not), recordBlockChange blocks and unblocks only when its time is not older than changed_at, a fact for an unknown Telegram user is a no-op, a second bot id gets its own row, every write is scoped by workspace with an isolation test, and contact.changed { change: reach } is published in the writing transaction only when the blocked mark actually changed.
- [x] Every new repository method takes `workspaceId` and is covered by the isolation test.
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T7): the reach write sits in its own repository (`contacts/infra/reach-repo.ts`, `ReachRepo.upsertWrote` / `applyBlockChange`), called by the contacts app layer in the capture transaction right after `ContactRepo.upsertFromProfile` — the same transaction and lock order the audit asks for, without widening the contact repo's SQL. `Contacts.upsertFromProfile(workspaceId, profile, seenAt, telegramBotId, tx)` now takes the bot id and a required `tx` (the signal is published in it); `createContacts` takes `reach` + `signals` (`createReachSignals` in `infra/tag-signals.ts`).
- `implement` (T7): Postgres 16 has no `RETURNING old.*`, so each reach write locks its row `FOR UPDATE` (or inserts it with `ON CONFLICT DO NOTHING` and re-reads the winner under the lock) and decides in code whether the blocked mark changed; two concurrent blocks report one change.
- `implement` (T7): a block of an already blocked contact keeps the first `blocked_at` ("since when") and moves `changed_at`; an unblock with no row inserts a row with `changed_at` only (no signal), so an older block notice cannot flip the mark later.
- `implement` (T7): `InboundMessage` (conversations) gains `telegramBotId`; `bots` `ConversationsApi.captureInbound` takes `NormalisedMessage & { telegramBotId }` and `accept-update.ts` adds the receiving bot's id. `deps.ts` (not in files_hint) builds `createContacts` with the reach repo and signals so production capture writes reach.
- `implement` (T7): `createContactReach({ transaction, contacts, reach, signals }).recordBlockChange(...)` (`contacts/app/reach.ts`) runs its own transaction and returns whether the mark changed; it is not wired into `buildDeps` yet — T10 / T26 bind it for `bots`.
- `implement` (T7): gate — full `pnpm test` had 2 failures, both from the known timing set (`e2e/contacts-load` merge, `inbox/http/changes` p95); both passed re-run alone. `pnpm lint` clean.
