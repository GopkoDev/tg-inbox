---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0006 — Encrypt bot tokens at rest with an application key

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

tg-inbox must keep each connected bot's token to call Telegram on the workspace's behalf: health checks (AC-15), reconnect without a paste (AC-16b), and from step 4 on, replies and broadcasts. A bot token gives full control of the business's bot (spec §6.1: secret). It is never shown back, never logged, and is dropped on disconnect (AC-18). The question is how it is stored.

## Decision drivers

- Spec §6 token secrecy: 0 occurrences of a token in logs, error messages or anything the web panel receives; spec §6.1: security review required.
- Architecture map: one PostgreSQL 16 database, no deployment target chosen yet, config only through `platform/config.ts`.
- Database dumps, backups and read replicas are likely to be handled by more people and tools than the application's runtime secrets.

## Considered options

1. **Application-level authenticated encryption** — AES-256-GCM with a 32-byte key from a new config key; each stored token is `key id + nonce + ciphertext + tag`; decrypted only inside the `bots` infra adapter right before a Bot API call.
2. **Plain text in the database** — rely on database access control alone.
3. **An external secret manager** — store a reference in the database, the token in a vault service.

## Decision outcome

**Chosen:** Option 1. It keeps tokens unreadable in dumps, backups and accidental query logs at the cost of one config secret, with Node's built-in `crypto` and no new infrastructure. Option 2 makes every database copy a set of bot-control credentials. Option 3 is the stronger long-term home but needs a deployment target and a provider that do not exist yet; the key-id prefix lets a later move re-encrypt or migrate tokens without a schema change. The token's Telegram bot id (the part before the colon) is stored in clear as `telegram_bot_id` because it is public and is the bot's identity (ADR-0007).

## Consequences

**Positive**
- A leaked database copy does not leak bot control.
- Decryption happens in one place, which is also the only place a token can reach a log line — easy to review.

**Negative**
- Losing the key makes every stored token unusable: owners must paste their tokens again (each bot then moves to "not working — needs a new token" on its next check). Key backup is an operational duty (sad.md §11).
- Key rotation needs a small re-encryption command (not in v1; the key id makes it possible).

**Neutral**
- Webhook secrets are stored only as hashes (they are compared, never sent again), so they need no encryption.

## Links

- Spec: [[../spec.md]] AC-01, AC-15, AC-16b, AC-18; §6; §6.1
- SAD: [[../sad.md]] §8, §11
- Related ADR: [[0007-bind-a-bot-to-one-workspace-with-unique-constraints-and-two-controlled-tenancy-exceptions]]
