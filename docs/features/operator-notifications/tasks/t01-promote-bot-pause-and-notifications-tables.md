---
id: T1
title: "Promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures"
layer: "migration"
deps: []
blocks: ["T5", "T7", "T8", "T9"]
acs: ["AC-06", "AC-08", "AC-12"]
files_hint: ["docs/features/operator-notifications/migrations/04_add_bots_send_paused_until.up.sql", "docs/features/operator-notifications/migrations/05_create_telegram_links.up.sql", "docs/features/operator-notifications/migrations/06_create_connect_links.up.sql", "docs/features/operator-notifications/migrations/07_create_tab_presences.up.sql", "docs/features/operator-notifications/migrations/08_create_pings.up.sql", "apps/api/migrations/", "apps/api/src/platform/db.types.gen.ts", "apps/api/src/test/migrations.int.test.ts", "apps/api/src/test/fixtures/bots.ts", "apps/api/src/test/fixtures/notifications.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T1 — Promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures

## Place in the sequence

- **Blocked by:** — · **Blocks:** T5 — Record the waiting period in conversations — set by capture, cleared by a sent reply and a close, restarted by a reopen while waiting — and promote migrations 01–03, T7 — Give bots sendMemberMessage (paced, behind the send pause, with a blocked outcome) and pingReadiness, and store the send pause on any 429, T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link, T9 — Build the presence-lease and ping-ledger repositories with cross-workspace isolation tests · **Wave:** 1 — no upstream task.
- **Lane:** shares `apps/api/migrations/`, `apps/api/src/platform/db.types.gen.ts`, `apps/api/src/test/migrations.int.test.ts` with T5 — serialized. `layer: migration` is serialized by `implement`.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It lays the storage every notifications task writes: Telegram links, connect links, presence leases, the ping ledger, and the bot's send pause.

## Inlined context

> The repo uses Kysely Migrator via kysely-ctl, with files named `<timestamp>_<name>.ts`.
> - The latest file is `1791681109997_contract_conversations_state_columns.ts`, so the next timestamp is ≈ `1791681109998`. `implement` assigns the real values at promotion, because another feature may promote first.
> - Put the SQL inline in `` sql`…`.execute(db) ``, with the header comment `// Promoted from docs/features/operator-notifications/migrations/NN_….{up,down}.sql.` (precedent: `1791681109995_create_conversation_activities.ts`).
> 1. Run `pnpm db:migrate` → `pnpm db:codegen` and commit `db.types.gen.ts`. […] `Bots` gains `send_paused_until`. The new interfaces are `TelegramLinks`, `ConnectLinks`, `TabPresences`, `Pings` and `PingItems` (Telegram ids map to `Int8`).
> 2. Add an `operator-notifications migrations` block to `apps/api/src/test/migrations.int.test.ts`, like assignment-statuses'. It should cover the backfill shapes, a constraint smoke test, and a revert and re-apply.
>
> — `_audit/data-model-2026-10-19.md §Staged migrations, promote-time hint, next timestamp and form, abridged` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - `04` goes with `bots.sendMemberMessage` and the `429` mapping. `05`–`08` go with the `notifications` module.
> - No production deployment exists yet (architecture map: deferred until the first pilot), so all eight can promote in one release. The interceptor and the connect routes must ship together (SAD §11).
>
> — `_audit/data-model-2026-10-19.md §Ordering with code, 04 and 05–08, verbatim` · full text: [data-model-2026-10-19.md](../_audit/data-model-2026-10-19.md)

> - **Values:** the application supplies every value and timestamp. There is no `DEFAULT` and no generic `updated_at`.
> - **Telegram ids:** `bigint` columns, never keys.
> - **Cross-module FKs** are constraints only. Every account column is a **composite** FK `(workspace_id, account_id) → memberships (workspace_id, account_id)`, as in assignment-statuses, so every link, connect link, lease and ping belongs to a member of its own workspace. `notifications` never reads `memberships`. It goes through the `workspaces` app layer.
>
> — `data-model.md §Conventions applied, values, telegram ids, cross-module FKs, verbatim` · full text: [data-model.md](../data-model.md)

> - **Migrations:** reversible — every migration exports a working `up` **and** `down`. After migrating, run `pnpm db:codegen` and commit the regenerated types. Destructive changes still go expand → migrate → contract.
>
> — `CLAUDE.md §Rules, Migrations, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

Staged pairs promoted by this task, in ordinal order (`01`–`03` are **not** promoted here — they land with the `conversations` code that maintains the period, in T5, because `conversations_waiting_open_check` would refuse today's close path on a backfilled waiting row):

- `docs/features/operator-notifications/migrations/04_add_bots_send_paused_until.{up,down}.sql` — 1 nullable column
- `…/05_create_telegram_links.{up,down}.sql` — 7 `CHECK`s, composite FK, 2 live partial uniques, 1 index
- `…/06_create_connect_links.{up,down}.sql` — 6 `CHECK`s, composite FK, unique hash per workspace, 1 index
- `…/07_create_tab_presences.{up,down}.sql` — 2 `CHECK`s, composite FK, 1 index
- `…/08_create_pings.{up,down}.sql` — `pings` + `ping_items`, composite FKs, `ON DELETE CASCADE`, the ledger unique, 4 indexes

| Table · column | Type | Constraints | Change |
|---|---|---|---|
| `bots.send_paused_until` | timestamptz | NULL | added |
| `telegram_links` | id, workspace_id, account_id, telegram_bot_id, telegram_user_id, display_name, linked_at, blocked_at, last_notice_at, removed_at, removed_reason | live partial uniques `(workspace_id, account_id)` and `(workspace_id, telegram_user_id)`; `removed_reason IN ('member','deactivated','bot_replaced')` ⇔ `removed_at`; id kept after removal only for `member` | new |
| `connect_links` | id, workspace_id, account_id, token_hash (bytea, 32), created_at, expires_at, used_at, replaced_at | UNIQUE `(workspace_id, token_hash)`; `expires_at > created_at`; never used and replaced together | new |
| `tab_presences` | id (connection id), workspace_id, account_id, live_until, on_screen, last_on_screen_at, opened_at | `live_until > opened_at` | new |
| `pings` | id, workspace_id, account_id, telegram_link_id, outcome, created_at, opened_at | `outcome IN ('sending','accepted','blocked','failed')`; UNIQUE `(id, workspace_id, account_id)` | new |
| `ping_items` | id, ping_id, workspace_id, account_id, conversation_id, waiting_since | UNIQUE `(conversation_id, waiting_since, account_id)` (the ledger); composite FK to `pings` `ON DELETE CASCADE` | new |

Fixtures (data-model §Test fixtures): `insertBot(db, { …, sendPausedUntil? })`; `insertTelegramLink`, `insertConnectLink` (returns the token for `/start tgi_<token>`), `insertPresence`, `insertPing` (with `items`), and `twoWorkspacesWithLinks(db)` — two workspaces sharing one account and one Telegram user id, the base of every cross-workspace isolation test.

— `data-model.md §Entities + §Indexes + §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
> **When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
> **Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently. A connected member who opens a new connect link from the Telegram account they are already connected with is told "you are already connected", and the link is used up. While a member is connected, the panel offers "Disconnect" and no connect link. Connecting another Telegram account means disconnecting first.
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — domain invariant

> **Given** a conversation of "Acme Flowers" for which a linked away member has been pinged
> **When** the customer writes more messages in the same waiting period, or other conversations become due for the same member within 10 minutes
> **Then** that member is pinged at most once per conversation per waiting period. Pings to one member from one workspace are at most one per 10 minutes. Conversations that become due in between are combined into the next ping, sent at the member's next allowed moment. A ping counts only the conversations not yet pinged to this member in their current waiting period, and the longest wait among them. If all of them are the member's own, it reads "Acme Flowers: 4 customers are waiting for your reply, the longest 12 min" and links to the inbox's "mine" lens. If all are unassigned, it says so and links to the "unassigned" lens. A mixed set reads "Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 12 min" and links to the inbox's open conversations. A waiting period ends when a reply is marked sent or the conversation is closed. The next customer message after that starts a new one. A conversation that is reopened while its customer is still waiting for a reply also starts a new one at the moment it reopens, for example after a reply ends "not delivered" (assignment-statuses AC-08). A member who reads the waiting message before their ping is sent is not pinged for that period. A reassignment does not restart the clock. A new assignee who is away, linked and has not read the message becomes due at once if the customer has already waited 5 minutes. Unassigning a waiting conversation makes it due at once for the away members as an unassigned one. Each member still gets at most one ping per conversation per waiting period.
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Promote `04`–`08` as five TS migrations in ordinal order (next timestamps after the latest live file), SQL inline, header comment naming the staged pair — `apps/api/migrations/`
- [ ] `pnpm db:migrate` → `pnpm db:codegen`; commit `Bots.send_paused_until` and the five new interfaces — `apps/api/src/platform/db.types.gen.ts`
- [ ] Add the `operator-notifications migrations` block for `04`–`08`: every rejection the audit lists for `telegram_links`, `connect_links`, `tab_presences`, `pings`, `ping_items`, the accepted rows (re-link after removal, same Telegram user in another workspace, cascade on rollout), revert `08`→`04` and re-apply — `apps/api/src/test/migrations.int.test.ts`
- [ ] Add `sendPausedUntil` to `insertBot` — `apps/api/src/test/fixtures/bots.ts`
- [ ] Add the five builders and `twoWorkspacesWithLinks` (synthetic ids, `Test User`, Telegram ids like `5001n`) — `apps/api/src/test/fixtures/notifications.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Up applied twice | no-op (`IF NOT EXISTS`, constraints dropped and re-added) |
| A second live link for one membership / one Telegram user for two members | rejected by the live partial uniques (AC-06 backstop) |
| A second ledger item for the same member, conversation and period | rejected by `ping_items_conversation_id_waiting_since_account_id_key` |
| Down `08` → `04` | schema back to the live shape exactly (empty `pg_dump -s` diff) |

## Definition of Done

- [ ] Migrations 04–08 are promoted to live apps/api/migrations/, apply and revert cleanly on a fresh Postgres 16, the regenerated db.types.gen.ts is committed, the migrations integration test rejects every constraint violation the audit lists for the five tables, and the new fixtures plus twoWorkspacesWithLinks exist.
- [ ] staged migrations 04–08 are promoted to live `apps/api/migrations/`, then apply and revert cleanly
- [ ] `pnpm test` stays green (no existing insert changes: every new column is nullable or in a new table)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
