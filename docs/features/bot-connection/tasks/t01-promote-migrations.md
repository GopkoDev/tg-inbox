---
id: T1
title: "Promote the four staged migrations and regenerate DB types"
layer: "migration"
deps: []
blocks: ["T7", "T8", "T10"]
acs: ["AC-04", "AC-05", "AC-11"]
files_hint: ["docs/features/bot-connection/migrations/", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T1 — Promote the four staged migrations and regenerate DB types

## Place in the sequence

- **Blocked by:** — · **Blocks:** T7 — Build the contacts module: repository with isolation tests, upsert-from-profile and count use cases, T8 — Build the conversation and message repositories with cross-workspace isolation tests, T10 — Build the bot repository, the AES-GCM token cipher and webhook secrets, with isolation tests incl. the two controlled exceptions · **Wave:** 1 — nothing upstream; every repository task needs the tables and the generated `DB` types.
- **Lane:** `layer: migration` is always serialized; owns `apps/api/src/test/migrations.int.test.ts` alone.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** every message from one customer kept in a single conversation, in the order it was sent and up to date with the customer's edits
> **So that** I see the whole history when I answer
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task creates the four tables whose constraints are the bot ↔ workspace binding and the "exactly once" guarantee.

## Inlined context

> Staged under `migrations/`, **not** in `apps/api/migrations/` yet. `implement` promotes them in ordinal order, since the FK dependencies follow that order and every table needs the workspace-operators `workspaces` table.
> 01 `bots` + `bots_due_for_check_idx` · 02 `contacts` · 03 `conversations` (needs 02) · 04 `messages` + `messages_workspace_id_received_at_idx` (needs 03)
>
> — `data-model.md §Migrations (staged), abridged` · full text: [data-model.md](../data-model.md)

> The paired `*.up.sql` / `*.down.sql` that `data-model` stages are promoted by `implement` into one TS migration whose `up`/`down` run that SQL via `sql.raw`
>
> — `docs/architecture-map.md §Conventions, Migrations, abridged` · full text: [architecture-map.md](../../../architecture-map.md)

> **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types.
>
> — `CLAUDE.md §Rules, Migrations, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> PK `id uuid`, UUIDv7 from `newId()`, never a DB default. […] There is no `DEFAULT now()` and no generic `updated_at`. States are `text` + `CHECK (… IN (…))` […] There are no triggers. […] **Strings that come from Telegram get no length `CHECK`s.**
>
> — `data-model.md §Conventions applied, abridged` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs promoted verbatim (constraint and index names unchanged):

| Ordinal | Staged pair | Creates | Key constraints |
|---|---|---|---|
| 01 | `docs/features/bot-connection/migrations/01_create_bots.{up,down}.sql` | `bots` | `bots_workspace_id_key` UNIQUE, `bots_telegram_bot_id_key` UNIQUE, `bots_state_check` IN (`connected`,`needs_token`,`taken_over`,`disconnected`), token/secret/epoch null iff `disconnected`, `last_checked_at` not null unless `disconnected`; partial `bots_due_for_check_idx` |
| 02 | `…/02_create_contacts.{up,down}.sql` | `contacts` | `contacts_workspace_id_telegram_user_id_key` UNIQUE |
| 03 | `…/03_create_conversations.{up,down}.sql` | `conversations` | `conversations_contact_id_key` UNIQUE, `conversations_workspace_id_telegram_chat_id_key` UNIQUE, FK → `contacts` |
| 04 | `…/04_create_messages.{up,down}.sql` | `messages` | `messages_conversation_id_telegram_message_id_key` UNIQUE, `messages_kind_check` (15 kinds), `messages_body_text_check`, `messages_edit_check`; `messages_workspace_id_received_at_idx` |

— `data-model.md §Entities + §Indexes, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-04 — domain invariant

> **Given** a business owner of "Bolt Bikes" and the token of a bot that is connected to another workspace, or through which another workspace has captured conversations
> **When** the owner pastes that token
> **Then** the system refuses and explains that the bot already belongs to another workspace, without revealing which one
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — domain invariant

> **Given** "Acme Flowers" has a connected bot, or has captured conversations through a bot it later disconnected
> **When** a business owner pastes the token of a different bot
> **Then** the system refuses and explains that a workspace keeps one business bot — while connected, disconnect it first; once customers have written to it, the workspace stays with that bot (its customers know only that bot)
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a message from an end customer that has already been captured
> **When** Telegram delivers the same message again (for example after a delivery retry)
> **Then** the conversation still holds it exactly once, and messages keep the order in which the customer sent them (Telegram's order for that chat), not the order in which they reached tg-inbox — a late redelivered message takes its original place
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] For ordinals 01–04 run `pnpm db:new <name>` (`create_bots`, `create_contacts`, `create_conversations`, `create_messages`) so they sort after `1791681109978_create_invitations.ts` — `apps/api/migrations/`
- [ ] Paste each staged `*.up.sql` into `up` and `*.down.sql` into `down` via `sql.raw(...).execute(db)` like the existing migrations; keep every constraint/index name verbatim
- [ ] `docker compose up -d`, `pnpm db:migrate`, `pnpm db:rollback` ×4, `pnpm db:migrate` — every `down` reverts cleanly
- [ ] `pnpm db:codegen`; commit `apps/api/src/platform/db.types.gen.ts` (never hand-edit)
- [ ] Extend `apps/api/src/test/migrations.int.test.ts`: the four tables exist; a second bot for one workspace, a second workspace for one `telegram_bot_id`, a `connected` bot with null token, a duplicate (`conversation_id`, `telegram_message_id`) and an unknown `kind` are each rejected; the four bot-connection migrations revert and re-apply

## Edge cases

| Case | Behaviour |
|---|---|
| Insert a second `bots` row for one workspace | unique violation `bots_workspace_id_key` (AC-05 backstop) |
| Insert the same `telegram_bot_id` for a second workspace | unique violation `bots_telegram_bot_id_key` (AC-04) |
| `state = 'disconnected'` with a token still set | CHECK violation |
| Duplicate (`conversation_id`, `telegram_message_id`) | unique violation — `ON CONFLICT DO NOTHING` target (AC-11) |
| `kind = 'text'` with null `body` | CHECK violation |
| Very long `body` or name | accepted — no length CHECKs on Telegram strings |

## Definition of Done

- [ ] the four migrations apply and revert cleanly on a fresh Postgres 16 (`pnpm db:migrate` / `pnpm db:rollback`)
- [ ] regenerated `db.types.gen.ts` compiles and is committed
- [ ] the extended migrations integration test passes, including every constraint case above
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
