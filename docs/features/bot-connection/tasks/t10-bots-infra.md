---
id: T10
title: "Build the bot repository, the AES-GCM token cipher and webhook secrets, with isolation tests incl. the two controlled exceptions"
layer: "infra"
deps: ["T1", "T2", "T5"]
blocks: ["T12", "T14", "T15"]
acs: ["AC-04", "AC-05", "AC-13", "AC-14", "AC-18"]
files_hint: ["apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/infra/bot-repo.ts", "apps/api/src/modules/bots/infra/bot-repo.int.test.ts", "apps/api/src/modules/bots/infra/token-cipher.ts", "apps/api/src/modules/bots/infra/webhook-secret.ts", "apps/api/src/test/fixtures/bots.ts"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "todo"
---

# T10 — Build the bot repository, the AES-GCM token cipher and webhook secrets, with isolation tests incl. the two controlled exceptions

## Place in the sequence

- **Blocked by:** T1 — migrations, T2 — config key, T5 — bots domain states · **Blocks:** T12 — Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation), T14 — Implement the bots use case accept-webhook-update: secret check, inbound filter, capture epoch, hand-off to conversations, T15 — Implement the scheduled health check: run-health-check use case and the bots.schedule-health-checks / bots.check-health jobs · **Wave:** 2.
- **Lane:** shares `modules/bots/app/ports.ts` with T11–T15 — serialized; this task creates the file.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task builds the one store that binds a bot to a workspace and keeps its token unreadable at rest.

## Inlined context

> *bot by webhook id* (`bots`) — scoped by possession of the matching webhook secret: the lookup returns the row only when the secret's hash matches, and produces the workspace id for the capture; *bots due for a health check* (`bots`) — used only by the scheduled job; returns bot ids and workspace ids of connected or taken-over bots whose last check is at least 3 minutes old […]; each check then runs scoped by that workspace id. Every other method of the three modules takes `workspaceId`. The AC-04 "belongs to another workspace" refusal comes from the unique constraint on `telegram_bot_id`, not from a read.
>
> — `sad.md §5, Controlled exceptions to the tenancy rule, abridged` · full text: [sad.md](../sad.md)

> Secrets: Bot tokens: AES-256-GCM with a key id, decrypted only in the `bots` infra layer right before a Bot API call, dropped on disconnect, never in any response schema. Webhook secrets: 32 random bytes in Telegram's allowed alphabet, only a SHA-256 hash stored
>
> — `sad.md §8, Secrets, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1 [application key, Node's built-in `crypto`]. […] the key-id prefix lets a later move re-encrypt or migrate tokens without a schema change.
>
> — `adr/0006, Decision outcome, abridged` · full text: [ADR-0006](../adr/0006-encrypt-bot-tokens-at-rest-with-an-application-key.md)

> `insertBot(db, { workspaceId, telegramBotId?, state?, name?, username?, connectedAt?, lastCheckedAt? })` encrypts a fake token with the test key and returns `{ bot, token, webhookSecret }` […] The fake token is `<telegramBotId>:TEST-<random>` […]. `state: 'disconnected'` builds the kept-after-disconnect row. `twoWorkspacesWithBots(db)` extends `twoWorkspaces` with one connected bot each.
>
> — `data-model.md §Test fixtures, abridged` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Column | Type | Constraints | Use here |
|---|---|---|---|
| `id` | uuid | PK | webhook id |
| `workspace_id` | uuid | UNIQUE, FK | read this workspace's bot |
| `telegram_bot_id` | bigint | UNIQUE | violation → `BotBelongsToAnotherWorkspace` signal |
| `name`, `username`, `state` | text | state CHECK | write |
| `token_encrypted` | bytea | `> 28` bytes; null iff disconnected | `keyId ‖ nonce(12) ‖ ciphertext ‖ tag(16)` |
| `webhook_secret_hash` | bytea | `= 32` bytes; null iff disconnected | SHA-256 |
| `connected_at`, `last_checked_at`, `created_at` | timestamptz | per state CHECKs | write |

Indexes used: `bots_workspace_id_key`, `bots_telegram_bot_id_key`, PK, `bots_due_for_check_idx` (`WHERE state IN ('connected','taken_over') AND last_checked_at <= $now - 3 min`).

— `data-model.md §Entities, bots, abridged` · full text: [data-model.md](../data-model.md)

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

### AC-13 — cross-context

> **Given** "Acme Flowers" and "Bolt Bikes" each have a connected bot, and one person writes to both bots
> **When** both messages are captured
> **Then** each workspace has its own contact and conversation for that person, holding only the messages sent to its own bot, and neither workspace can see that the other one knows the person
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — authorization

> **Given** a connected bot of "Acme Flowers"
> **When** someone who is not Telegram sends the system a message pretending to come from that bot
> **Then** the system ignores it — nothing is captured and no contact or conversation is created
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot
> **When** they disconnect it and confirm
> **Then** the bot settings show "not connected", the bot stops delivering its messages to tg-inbox, its token is no longer kept by tg-inbox, messages sent to the bot afterwards are never captured (not even if the bot is connected again later), and every contact and conversation captured so far stays in the workspace
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Port `BotRepo` — `findByWorkspace(w)`, `insert(w, row, tx?)` / `update(w, id, patch, tx?)` mapping a `bots_telegram_bot_id_key` violation to a typed `BoundElsewhere` result, `setState(w, id, state, checkedAt, identity?)`, `clearOnDisconnect(w, id)`, `delete(w, id)`, `findForCheck(w, id)`, and the two exceptions `findByWebhookId(id, secret)` (constant-time hash compare) and `listDueForCheck(now)` — `bots/app/ports.ts`
- [ ] Kysely implementation; `token_encrypted` / `webhook_secret_hash` are never selected into anything returned except the decrypt path — `bots/infra/bot-repo.ts`
- [ ] `TokenCipher` (AES-256-GCM, random 12-byte nonce, key-id prefix) — `bots/infra/token-cipher.ts`; `newWebhookSecret()` (32 bytes → `[A-Za-z0-9_-]`) + `hashSecret` — `bots/infra/webhook-secret.ts`
- [ ] Fixtures `insertBot`, `twoWorkspacesWithBots` (extends `twoWorkspaces` from `fixtures/workspaces.ts`) — `apps/api/src/test/fixtures/bots.ts`
- [ ] Integration tests: every method on `twoWorkspacesWithBots` never reads/changes the other's row; `findByWebhookId` returns only on a matching secret and yields exactly that workspace id; `listDueForCheck` returns only connected/taken-over bots ≥ 3 min since last check, never disconnected; the AC-04 refusal reads no row of the other workspace; cipher round-trip and stored bytes do not contain the token — `bots/infra/*.int.test.ts`, `token-cipher.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `findByWebhookId` with a non-UUID id | `null` (no throw) |
| Disconnected row (hash null) | `findByWebhookId` → `null` |
| Ciphertext with a wrong key id / tampered tag | decrypt throws a typed error; no token in its message |
| Two workspaces inserting the same `telegram_bot_id` concurrently | one succeeds, the other gets `BoundElsewhere` |

## Definition of Done

- [ ] every repository method, plus each controlled exception, has a passing two-workspace isolation test
- [ ] cipher and secret unit tests pass; no log line or thrown message contains a token or secret
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
