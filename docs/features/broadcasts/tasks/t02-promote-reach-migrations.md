---
id: T2
title: "Promote migrations 01–02 (contact_bot_reach and its backfill for the workspace's current Telegram bot), regenerate DB types and add the reach fixtures"
layer: "migration"
deps: []
blocks: ["T3", "T7", "T8"]
acs: ["AC-10", "AC-14"]
files_hint: ["docs/features/broadcasts/migrations/01_create_contact_bot_reach.up.sql", "docs/features/broadcasts/migrations/02_backfill_contact_bot_reach.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/contacts.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T2 — Promote migrations 01–02 (contact_bot_reach and its backfill for the workspace's current Telegram bot), regenerate DB types and add the reach fixtures

## Place in the sequence

- **Blocked by:** — · **Blocks:** T3 — Promote migrations 03–08 (the conversations (workspace_id, id) key, broadcasts, broadcast_audience_tags, broadcast_group_contacts, broadcast_recipients, broadcast_items), regenerate DB types and add the broadcast fixtures, T7 — Record reachability in contacts: capture's upsertFromProfile takes the receiving bot's Telegram id and writes "wrote" (clearing an older block), recordBlockChange applies a block or unblock only when newer, and contact.changed reach fires only when a mark changed, T8 — Evaluate audiences in contacts with the Contacts filter rules: the breakdown for a tag audience or a list of ids against a Telegram bot, the reachable set sorted by id, existing tags, contacts matching a search and filter, contact cards and the blocked check at a recipient's turn · **Wave:** 1 — no upstream task, starts at once.
- **Lane:** shares `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`, `apps/api/src/test/migrations.int.test.ts` with T3; `layer: migration` is serialized with the other migration task — serialized.

## Why (user story)

> **As an** Operator
> **I want** to see on a contact that they have blocked the bot, and have such contacts left out of broadcasts
> **So that** the team does not count on reaching customers the bot cannot reach
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It creates where tg-inbox remembers, per contact and Telegram bot, who wrote and who blocked the bot, and seeds it for the bot each workspace has today, so blocked marks and "never wrote to the current bot" have somewhere to live.

## Inlined context

> **Chosen:** Option 1. Keying by the Telegram bot id makes "same bot keeps, different bot resets" true by construction, with no reset job. A fact is applied only when its Telegram time is not older than `changed_at`, so an out-of-order block or message cannot flip the mark back. Migration backfills a "wrote" row for every contact that has written, for the workspace's current Telegram bot (an approximation for workspaces that changed bots, SAD §11).
>
> — `adr/0002 §Decision outcome, ADR-0002, verbatim` · full text: [ADR-0002](../adr/0002-keep-per-bot-reachability-of-contacts-in-contacts-keyed-by-the-telegram-bot-id.md)

> 12. **The backfill covers every bot row, whatever its state.** A workspace has at most one bot row, and a `needs_token`, `taken_over` or `disconnected` row keeps its Telegram bot id. Reconnecting that same Telegram bot keeps the rows (AC-10). A workspace with no bot row gets none, and its contacts count as never wrote once a bot is connected. That is the honest reading for a workspace that never had one.
>
> — `data-model.md §Assumptions, 12, verbatim` · full text: [data-model.md](../data-model.md)

> **Promote-time hint.** The repo uses the Kysely Migrator via kysely-ctl, with files named `<timestamp>_<name>.ts`.
> - The latest live file is `1791681110011_create_contact_tag_history.ts`, so the next timestamp is ≈ `1791681110012`. `implement` assigns the real values at promotion, because another feature may promote first.
> - Promote one TS migration per ordinal, in order (8 files), with the SQL inline in `` sql`…`.execute(db) `` and the header comment `// Promoted from docs/features/broadcasts/migrations/NN_….{up,down}.sql.` (precedent: `1791681110011_create_contact_tag_history.ts`).
> - The staged SQL holds no backtick, no `${` and no backslash, so no template-literal escaping is needed.
>
> **Ordering with code (expand → backfill).**
> - `01`–`02` go with capture's `upsertFromProfile(…, telegramBotId)` writing reach rows (ADR-0002). `02` is re-runnable: run after that deploy, it keeps the rows capture wrote and fills the rest.
>
> — `_audit/data-model-2026-10-23.md §Staged migrations, promote-time hint + ordering, abridged` · full text: [audit](../_audit/data-model-2026-10-23.md)

> - **Tenancy:** every new table has a non-null `workspace_id → workspaces(id)`. Every cross-entity reference is a **composite** FK that includes `workspace_id`, so the database refuses a group row, recipient, item or reach row that names a contact, broadcast or conversation of another workspace (AC-05, AC-08). No new controlled tenancy exception (SAD §8: the six stay six).
> - **Values:** the application supplies every value and timestamp. There is no `DEFAULT` and no generic `updated_at`. Telegram ids (user, bot, message) are `bigint` and never keys of their own.
>
> — `data-model.md §Conventions applied, Tenancy + Values, verbatim` · full text: [data-model.md](../data-model.md)

> | Reach backfill treats every existing contact as having written to the current Telegram bot; a workspace that changed bots before this feature has contacts who in fact never wrote to the new one | Low | they fail with "chat not found" (not copied by "did not reach"); pilots have not changed bots; the backfill is logged per workspace | Backend |
>
> — `sad.md §11, reach backfill row, verbatim` · full text: [sad.md](../sad.md)

> **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. Destructive changes still go expand → migrate → contract.
>
> — `CLAUDE.md §Rules, Migrations, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs: `docs/features/broadcasts/migrations/01_create_contact_bot_reach.up.sql` / `.down.sql` and `02_backfill_contact_bot_reach.up.sql` / `.down.sql` (the `02` down is a deliberate no-op: the rows leave with the table when `01` is reverted).

| Column (`contact_bot_reach`, new) | Type | Constraints | Change |
|---|---|---|---|
| `workspace_id` | uuid | NOT NULL, FK → `workspaces(id)`; PK part | added |
| `contact_id` | uuid | NOT NULL, FK `(workspace_id, contact_id) → contacts (workspace_id, id)` (`contact_bot_reach_contact_fkey`); PK part | added |
| `telegram_bot_id` | bigint | NOT NULL, **no FK**; PK part | added |
| `wrote_at` | timestamptz | NULL, `contact_bot_reach_wrote_at_check (wrote_at <= changed_at)` | added |
| `blocked_at` | timestamptz | NULL, `contact_bot_reach_blocked_at_check (blocked_at <= changed_at)` | added |
| `changed_at` | timestamptz | NOT NULL | added |

PK `contact_bot_reach_pkey (workspace_id, contact_id, telegram_bot_id)`. Backfill: `INSERT … SELECT c.workspace_id, c.id, b.telegram_bot_id, c.first_wrote_at, NULL, c.last_wrote_at FROM contacts c JOIN bots b ON b.workspace_id = c.workspace_id WHERE c.first_wrote_at IS NOT NULL ON CONFLICT DO NOTHING`.

— `data-model.md §Entities, contact_bot_reach, abridged`; `migrations/02_backfill_contact_bot_reach.up.sql, abridged` · full text: [data-model.md](../data-model.md)

Fixtures: `insertReach(db, { workspaceId, contactId, telegramBotId, wroteAt?, blockedAt?, changedAt? })` (`changedAt` defaults to the latest of the other two, or now); `insertContact` gains opt-in `reachForBot?: bigint` that also writes a "wrote" row.

— `data-model.md §Test fixtures, fixtures/contacts.ts, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

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

- [ ] Red: a `broadcasts migrations — reach` block: backfill of a workspace with a `connected` bot, one with a `needs_token` bot, one with no bot row (no rows), a contact that never wrote (no row); a re-run adds nothing — `apps/api/src/test/migrations.int.test.ts`
- [ ] Red: constraint smoke — a reach row naming another workspace's contact fails on `contact_bot_reach_contact_fkey`; `blocked_at > changed_at` fails on `contact_bot_reach_blocked_at_check` — same file
- [ ] Promote `01` and `02` as `<timestamp>_create_contact_bot_reach.ts` / `<timestamp>_backfill_contact_bot_reach.ts` with the header comment and the SQL inline — `apps/api/migrations/`
- [ ] `pnpm db:migrate` → `pnpm db:codegen`; commit `ContactBotReach` — `apps/api/src/platform/db.types.gen.ts`
- [ ] `insertReach` and `insertContact({ reachForBot })` — `apps/api/src/test/fixtures/contacts.ts`
- [ ] Revert both and re-apply in the test (down → up clean)

## Edge cases

| Case | Behaviour |
|---|---|
| workspace with no bot row | no reach rows; its contacts count as never wrote once a bot is connected (data-model assumption 12) |
| bot row `disconnected` / `needs_token` / `taken_over` | backfilled for its Telegram bot id (reconnecting the same bot keeps them, AC-10) |
| `02` run after capture already wrote rows | `ON CONFLICT DO NOTHING` keeps capture's rows |
| revert `02` alone | no-op; revert `01` drops the table |
| contact of workspace A with bot of workspace B | impossible: the join is on `workspace_id`, and the composite FK refuses it |

## Definition of Done

- [ ] Migrations 01–02 are promoted as TypeScript migrations, apply, backfill one "wrote" row per contact that wrote for its workspace's bot row in any state (none for a workspace with no bot row), re-run without duplicates and revert cleanly; db.types.gen.ts is regenerated with ContactBotReach; the migrations integration test refuses a reach row naming another workspace's contact and a blocked_at or wrote_at later than changed_at; insertReach and insertContact({ reachForBot }) exist.
- [ ] `pnpm db:migrate` then `pnpm db:rollback` twice and `pnpm db:migrate` again leaves the schema identical to `db.types.gen.ts`.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
