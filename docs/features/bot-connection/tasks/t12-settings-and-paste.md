---
id: T12
title: "Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation)"
layer: "app"
deps: ["T2", "T7", "T9", "T10", "T11"]
blocks: ["T13", "T16"]
acs: ["AC-01", "AC-02", "AC-04", "AC-05", "AC-06", "AC-15", "AC-17", "AC-19"]
files_hint: ["apps/api/src/modules/bots/app/ports.ts", "apps/api/src/modules/bots/app/settings.ts", "apps/api/src/modules/bots/app/paste-token.ts", "apps/api/src/modules/bots/app/fakes.ts"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "M"
status: "todo"
---

# T12 — Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation)

## Place in the sequence

- **Blocked by:** T2 — error classes, T7 — contacts count, T9 — last message time / has conversations, T10 — bot repo + cipher, T11 — gateway · **Blocks:** T13 — Implement the bots use cases reconnect-with-stored-token and disconnect, T16 — Expose the owner-only bot routes and wire the bots, conversations and contacts modules into buildDeps / buildApp · **Wave:** 4.
- **Lane:** shares `modules/bots/app/ports.ts` with T10, T11, T13–T15 — serialized.

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

This task is the owner's main action: one paste that connects, rotates or refuses with the right reason, and the settings read every action returns.

## Inlined context

> **One paste endpoint decides connect vs rotate:** the API compares the pasted token's bot id with the workspace's bot row — none → connect, same bot → rotate (or reconnect after takeover), different bot → AC-05 refusal
> **Takeover confirmation is stateless:** […] the API answers with a "confirmation required" refusal carrying the bot's name and username; the panel keeps the pasted token in memory and resubmits it with an explicit confirmation flag […]. The server re-checks with Telegram on the confirming request; nothing is stored between the two requests.
>
> — `sad.md §4, Supporting choices, abridged` · full text: [sad.md](../sad.md)

> Refusals are decided in this order: token format, then Telegram rejects the token, then a different bot, then the bot belongs to another workspace, then takeover confirmation. […] **No bot row** → connect (AC-01). A new capture epoch starts, and pending updates are dropped. **A row kept after a disconnect, same bot** → connect again (AC-19). A new capture epoch starts […]. **Same bot, connected, needs a new token or taken over** → rotate (AC-17, AC-16). The capture epoch and the webhook secret are kept, and pending updates are kept.
>
> — `contracts/openapi.yaml, pasteBotToken description, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> The row write is attempted in a transaction that is rolled back when confirmation is still needed, so an owner is never asked to confirm a takeover of a bot that belongs to another workspace; no Telegram call runs inside that transaction.
> Bots->>Db: commit · Bots->>Tg: setWebhook with our URL, secret, allowed updates, drop pending only on a new connection · alt setWebhook fails → Bots->>Db: restore the previous row → Telegram unavailable, try again
>
> — `sad.md §6, Critical flow 1 + note, abridged` · full text: [sad.md](../sad.md)

> A transient failure of `getMe` or `getWebhookInfo` refuses with "Telegram unavailable, try again" and changes nothing.
>
> — `sad.md §6, Flow 5 note, verbatim` · full text: [sad.md](../sad.md)

> The Bot settings page reads the stored state, name, username and last-checked time, plus the last message time from `conversations` and the contacts count from `contacts` — no Telegram call on load.
>
> — `sad.md §6, after Critical flow 3, verbatim` · full text: [sad.md](../sad.md)

> Every Bot API exchange (health check, connect, rotate, reconnect) writes its outcome back at once
>
> — `adr/0008, Decision outcome, abridged` · full text: [ADR-0008](../adr/0008-check-bot-health-with-a-scheduled-job-and-show-the-stored-state.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Branch | `bots` write |
|---|---|
| connect (no row) | insert: new id, encrypted token, new secret hash, `state=connected`, `connected_at=now`, `last_checked_at=now` |
| connect again (row `disconnected`, same bot) | update same row: new token, **new** secret, `connected_at=now` |
| rotate (live row, same bot) | update: new token, `state=connected`, name/username, `last_checked_at=now`; secret hash + `connected_at` **kept** |
| `setWebhook` failed | restore the previous row (delete the inserted one) |

— `data-model.md §Entities, bots (Lifecycle), abridged` · full text: [data-model.md](../data-model.md)

## API contract

- `getBotSettings` → `BotSettings` (`not_connected` for no row or `disconnected`).
- `pasteBotToken({ token, confirm_takeover })` → `BotSettings` · `400 BOT_TOKEN_INVALID` · `409 WORKSPACE_KEEPS_ONE_BOT {reason}` · `409 BOT_BELONGS_TO_ANOTHER_WORKSPACE` · `409 TAKEOVER_CONFIRMATION_REQUIRED {bot}` · `503 TELEGRAM_UNAVAILABLE`.

— `contracts/openapi.yaml, operationIds getBotSettings + pasteBotToken, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** a business owner of "Acme Flowers" connecting a bot or giving the connected bot a new token
> **When** the pasted text is not a bot token, or Telegram does not accept it (mistyped, revoked, or the bot was deleted)
> **Then** the system changes nothing — an existing connection keeps working as before — and tells the owner the token is not valid — copy it again from BotFather
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

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

### AC-06 — cross-context

> **Given** a business owner of "Acme Flowers" pasting a valid token of a bot that, according to Telegram, currently delivers its messages to another address (another service); a service that instead fetches the bot's messages itself is not visible to tg-inbox and gets no warning
> **When** the system checks the token
> **Then** before connecting, it warns the owner that connecting will stop that bot delivering messages to the other service, and connects only after the owner confirms
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
> **When** they open the bot settings
> **Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token; the state, name and username are checked with Telegram in the background and are never more than 5 minutes old, and a failed exchange with Telegram changes the state at once
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** a business owner of "Acme Flowers" whose bot is connected (or not working because its old token was revoked)
> **When** they paste a new token of the same bot
> **Then** the bot is connected with the new token, the old token is no longer used, and new messages from existing end customers continue their existing conversations
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

### AC-19 — cross-context

> **Given** "Acme Flowers" disconnected its bot earlier and its contacts and conversations remain
> **When** a business owner connects the same bot again by pasting its token and an existing end customer writes to it
> **Then** the message continues that customer's existing conversation and no duplicate contact is created
>
> — `spec.md §5, AC-19, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Ports for the injected app-layer calls: `ConversationsApi { lastMessageReceivedAt, hasConversations }`, `ContactsApi { countContacts }` — `bots/app/ports.ts`; in-memory fakes for repo, gateway, cipher, clock — `bots/app/fakes.ts`
- [ ] `getSettings(workspaceId)` — `bots/app/settings.ts` (also the builder every action returns)
- [ ] `pasteToken(workspaceId, raw, confirmTakeover)` in the refusal order above: `parseBotToken` → `getMe` (1 s) → `decidePaste` → `getWebhook` → transaction{insert/update; on `BoundElsewhere` rollback → 409; foreign & !confirm → rollback → 409} → `setWebhook` (drop pending only for connect / connect again) → restore on failure — `bots/app/paste-token.ts`
- [ ] Unit tests with fakes for every branch and the refusal order; Postgres + fake Bot API integration test: two workspaces pasting the same bot concurrently → exactly one connects, the other `BOT_BELONGS_TO_ANOTHER_WORKSPACE`, one webhook set

## Edge cases

| Case | Behaviour |
|---|---|
| Bound elsewhere **and** foreign webhook | ownership refusal, never a confirmation request |
| Confirming request after the token was revoked meanwhile | `BOT_TOKEN_INVALID` |
| Different bot after disconnect with nothing captured | row was deleted → connects (AC-05 boundary) |
| Different bot while `needs_token` / `taken_over` | `WORKSPACE_KEEPS_ONE_BOT` reason `connected` |
| `getMe` / `getWebhook` transient | `TELEGRAM_UNAVAILABLE`, nothing written |
| Rotation `setWebhook` fails | old token, state and secret restored |

## Definition of Done

- [ ] unit tests cover every branch, the refusal order and the restore-on-failure path; the concurrent-paste integration test passes
- [ ] `getSettings` makes no gateway call (asserted on the fake)
- [ ] no token in any returned value, thrown error or log
- [ ] lint + vet clean (`pnpm lint`)
