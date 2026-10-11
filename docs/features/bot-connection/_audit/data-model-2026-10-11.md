# Audit — data-model — bot-connection — 2026-10-11

Mode: brownfield delta, additive only. It adds four new tables after workspace-operators. No existing table changes, and the `bots` / `contacts` / `conversations` modules have no code yet.

## Staged migrations

> The migrations are **staged**: they are not yet in the live `apps/api/migrations/` tree. `implement` promotes them.

| Ordinal | Up | Down |
|---|---|---|
| 01 | `docs/features/bot-connection/migrations/01_create_bots.up.sql` | `01_create_bots.down.sql` |
| 02 | `docs/features/bot-connection/migrations/02_create_contacts.up.sql` | `02_create_contacts.down.sql` |
| 03 | `docs/features/bot-connection/migrations/03_create_conversations.up.sql` | `03_create_conversations.down.sql` |
| 04 | `docs/features/bot-connection/migrations/04_create_messages.up.sql` | `04_create_messages.down.sql` |

**Promote-time hint:** the repo uses kysely-ctl with `apps/api/migrations/<epoch-ms>_<name>.ts`, each wrapping the staged SQL in `` sql`…`.execute(db) `` inside `up` / `down(db: Kysely<any>)`. The header comment is `// Promoted from docs/features/<slug>/migrations/…`, following the precedent `1791681109977_create_memberships.ts`. The latest is `1791681109978_create_invitations.ts`, so the next timestamp is anything later; `implement` assigns it at promotion (`pnpm db:new`). Use one TS migration per ordinal, in order. After promotion, run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts`.

**Verified** on a throwaway `postgres:16-alpine` (tmpfs, removed afterwards), with the workspace-operators staged migrations applied first:

- up ran twice (idempotent through `IF NOT EXISTS`).
- The constraint smoke test rejected all of these:
  - the same `telegram_bot_id` in a second workspace (`bots_telegram_bot_id_key`, AC-04)
  - a second bot in one workspace (`bots_workspace_id_key`, AC-05)
  - `disconnected` while the token or epoch is still held
  - a `text` message with no body
  - `edited_at` without `edit_update_id`
- A duplicate message insert `ON CONFLICT DO NOTHING` kept 1 row.
- `EXPLAIN` uses `messages_workspace_id_received_at_idx` (backward index-only) for the last-message read and `bots_due_for_check_idx` for the due-check read.
- down ran in reverse order (only the 7 workspace-operators tables left), then up again.

## Conventions — sources and decisions

| Topic | Decision | Source |
|---|---|---|
| Naming | `snake_case`, plural tables, `<table>_<cols>_{pkey,key,fkey,check,idx}` | workspace-operators precedent |
| PK | `uuid`, UUIDv7 from `newId()`, no DB default | `CLAUDE.md`, repo ADR-0004 |
| Telegram ids | `bigint`, never PK | `CLAUDE.md`, SAD §2 |
| Timestamps | supplied by the app (clock port); Telegram `date` / `edit_date` stored exactly as sent; no `DEFAULT now()`, no `updated_at` | workspace-operators precedent, SAD §8 Time |
| States / kinds | `text` + `CHECK IN`; state ↔ nullable-column consistency `CHECK`s | workspace-operators precedent |
| Telegram-supplied strings | no length `CHECK` (a rejected capture would be redelivered for 24 h and then lost) | ADR-0003 consequence; auto-decided |
| Cross-module FK | `conversations.contact_id → contacts(id)`, constraint only | `memberships.account_id` precedent |
| Secrets | `token_encrypted bytea` (key-id-prefixed AES-GCM envelope, one column); `webhook_secret_hash bytea(32)` | ADR-0006, ADR-0002 |
| Delete strategy | hard delete only for a `bots` row with no conversations on disconnect; everything else changes state | ADR-0007, SAD flow 7 |
| Triggers | none | `CLAUDE.md` |

## Convention deviations / additions vs SAD §5 (names were "indicative")

- **`conversations.telegram_chat_id`** is a new column, not in SAD §5. Flow 8 must find a conversation from an update without querying the `contacts` table, and replies in step 4 need the chat. It is UNIQUE per workspace.
- **Conversation uniqueness** is enforced as UNIQUE (`contact_id`), not (`workspace_id`, `contact_id`). These are equivalent because a contact belongs to one workspace, and this form also serves as the FK index. The workspace-level uniqueness comes from (`workspace_id`, `telegram_chat_id`).
- **`messages` has no `created_at`.** `received_at` (clock time at capture) is the creation time. This is the one departure from "`created_at` on every table".
- **`bots` state `disconnected`** stands for the SAD's "kept after a disconnect" row. "Not connected" on the page = no row, or `disconnected`.
- **`messages.telegram_message`** is replaced with the edited object when an edit is applied, so the stored object always matches `body`.

There are no conflicts between the architecture and the repo.

## Drift

None. `apps/api/src/modules/` has only `auth`, `health` and `workspaces`; the three new modules do not exist yet. No `_drift/` files.

## Breaking-change decompositions

None. Every migration creates a new table.

## Open items (`<!-- TBD -->`)

- None in `data-model.md`.
- Spec §8 OQs (proactive alerts, operator read-only visibility) need no schema in this step.
- Message retention and partitioning are deferred (SAD §7 scaling note).

## Self-check

| Check | Result |
|---|---|
| Naming matches the repo convention | pass |
| Down reversibility | pass. Every CREATE TABLE / CREATE INDEX has a DROP; verified by running down |
| FK indexes | pass. `bots.workspace_id` (unique); `contacts.workspace_id` (leading column of the unique); `conversations.workspace_id` (leading column of (workspace_id, telegram_chat_id)) and `conversations.contact_id` (unique); `messages.workspace_id` (leading column of the received_at index) and `messages.conversation_id` (leading column of the unique) |
| Convention adherence | pass. Deviations and additions are listed above |
| Mermaid `erDiagram` | structural lint pass (`mmdc` not installed): valid cardinality glyphs (`\|\|--o\|`, `\|\|--o{`); attribute lines are `type name [PK\|FK\|UK] "comment"` |
| PII in seeds / fixtures | pass. No seeds; fixtures use `Test User`, synthetic ids and visibly fake tokens |

## Next stage

`/sdd:api bot-connection`
