---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0002 — Receive updates through one webhook per bot, authenticated by a per-bot secret

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

Every connected bot must deliver its private messages to tg-inbox (AC-01, AC-07), forged deliveries must be ignored (AC-14), and the system must tell when another service took the bot's messages over (AC-06, AC-16b). Telegram offers two delivery modes per bot: a webhook it pushes to, or long polling (`getUpdates`) the receiver pulls; the two are mutually exclusive for one bot. The architecture map names grammY in webhook mode, but no ADR fixed it, and the ingress shape (path, authentication) is new.

## Decision drivers

- Spec §6: inbound acknowledgement p95 ≤ 300 ms; capture p95 ≤ 2 s; 0 messages lost among those Telegram delivered, with Telegram's 24 h redelivery as the recovery path.
- Spec §6.1 / AC-14: an inbound delivery is accepted only when it proves it comes from Telegram for that specific bot.
- Spec §6 token secrecy: 0 occurrences of a bot token in logs or responses — the token must not travel in the URL.
- AC-06 / AC-16b: the takeover warning relies on Telegram reporting where a bot currently delivers (`getWebhookInfo`).
- One multi-tenant process serves every workspace (architecture map).

## Considered options

1. **One webhook URL per bot, authenticated by a per-bot secret** — `POST /api/telegram/webhook/<bot id>` where `<bot id>` is tg-inbox's own bot row id; `setWebhook` registers a random per-bot `secret_token`, which Telegram echoes in `X-Telegram-Bot-Api-Secret-Token`; only its hash is stored and compared in constant time.
2. **One webhook URL per bot with the bot token in the path** — the classic Bot API pattern; the token itself is the authenticator.
3. **Long polling per bot inside the API process** — one `getUpdates` loop per connected bot; no public endpoint.

## Decision outcome

**Chosen:** Option 1. A public HTTPS endpoint is needed anyway for later steps, and webhooks give push latency without one long-lived loop per tenant in the shared process (option 3 also makes "another service took the messages over" invisible until a poll fails with a conflict, and makes takeover-by-webhook a silent loss). Option 2 puts the token in every request line, proxy log and access log, breaking the token-secrecy target. With option 1 the URL reveals only an opaque id, the secret proves Telegram sent the request for that bot, and `getWebhookInfo` comparing the registered URL with ours detects takeover. `setWebhook` always sets `allowed_updates: ["message", "edited_message"]` and a bounded `max_connections` (sad.md §7).

Responses: unknown bot id or a missing / mismatched secret → `401` with an empty body and nothing recorded (AC-14); a disconnected bot keeps neither token nor secret, so any late delivery for it fails the secret check the same way and nothing is captured (AC-18); a bot in "needs a new token" or "taken over" state still captures anything Telegram delivers with the right secret, since the secret proves origin; a captured or deliberately ignored update → `200`; a server failure → `5xx` so Telegram redelivers.

## Consequences

**Positive**
- Forged deliveries are refused before any parsing touches tenant data; the token never leaves the API ↔ Telegram channel.
- Takeover detection comes from one Bot API call.

**Negative**
- Requires a publicly reachable HTTPS base URL in every environment that connects real bots (development needs a tunnel) — sad.md §11.
- Looking the bot up by its row id is a read that produces the workspace id — a controlled tenancy exception (ADR-0007).

**Neutral**
- The secret is generated on connect and kept across token rotation and reconnect after takeover; it changes only when a disconnected bot is connected again.

## Links

- Spec: [[../spec.md]] AC-01, AC-06, AC-14, AC-16b, AC-18; §6.1
- SAD: [[../sad.md]] §4, §6, §8
- Related ADR: [[0003-capture-each-update-inside-the-webhook-request-with-idempotent-writes]], [[0007-bind-a-bot-to-one-workspace-with-unique-constraints-and-two-controlled-tenancy-exceptions]]
