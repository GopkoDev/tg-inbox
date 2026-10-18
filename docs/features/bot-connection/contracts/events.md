---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: M
---

# Events — bot-connection

This is the async contract for the flows drawn in `sad.md` §6. It is **derived** from the sequences. The feature has two kinds of async work:

- **Inbound Telegram updates (flows 2 and 8).** Telegram pushes these to the webhook. The webhook is an HTTP operation (`receiveTelegramUpdate` in [`openapi.yaml`](openapi.yaml)), so it is not described again here. Telegram owns delivery and retries (at-least-once, up to 24 h). tg-inbox has no inbound queue ([ADR-0003](../adr/0003-capture-each-update-inside-the-webhook-request-with-idempotent-writes.md)).
- **Scheduled health checks (flow 3).** These are two pg-boss queues inside the API process ([ADR-0008](../adr/0008-check-bot-health-with-a-scheduled-job-and-show-the-stored-state.md)). They are described below.

Capture publishes no domain event in this step (sad.md §8 "Events / jobs"). Later steps, such as the inbox live updates, add their own.

## Channel: pg-boss (`DATABASE_URL`, schema `pgboss`)

- **Producer:** the `bots` module (`modules/bots/infra/jobs.ts`).
- **Consumers:** the `bots` module only. Both queues are internal to the module, and no other module subscribes.
- **Delivery:** at-least-once (pg-boss).
- **Ordering:** none. At most one check per bot is queued or running at a time, through `singletonKey`.

## Event: `bots.schedule-health-checks`

A cron job, every minute (`* * * * *`). It has no payload.

```json
{}
```

- **Origin:** sad.md §6 flow 3 → "every minute, schedule health checks".
- **Work:** it runs the controlled tenancy exception *bots due for a health check*: `state IN ('connected','taken_over') AND last_checked_at <= now − 3 min`, served by `bots_due_for_check_idx`. It enqueues one `bots.check-health` per due bot.
- **Idempotency:** a duplicate tick only re-enqueues bots that are still due. The per-bot `singletonKey` absorbs those duplicates.
- **Retry:** none. A failed tick is replaced by the next tick a minute later.

## Event: `bots.check-health`

```json
{
  "bot_id": "<uuid — bots.id>",
  "workspace_id": "<uuid — bots.workspace_id>"
}
```

- **Required fields:** `bot_id`, `workspace_id`. The payload is validated with a zod schema in `modules/bots/infra/jobs.ts` (`BotHealthCheckJob`), because it never crosses the HTTP boundary. It carries no token and no secret.
- **Origin:** sad.md §6 flow 3 → "enqueue one check per due bot, singleton per bot" → "check one bot of a workspace".
- **Options:** `singletonKey = bot_id`. `expireInSeconds = 30` covers two Bot API calls of at most 10 s each (sad.md §8 freshness budget).
- **Work:** the job reads the bot by `(id, workspace_id)`. A bot that is gone or `disconnected` is a no-op. The job decrypts the token and calls `getMe`, then `getWebhookInfo`, and writes the outcome at once — only if `last_checked_at` is unchanged since the read, so an owner action committed meanwhile (a new token, a reconnect) is never overwritten:

| Telegram outcome | Write |
|---|---|
| the stored token cannot be decrypted (key lost or changed, ADR-0006) — no Telegram call | `state = needs_token`, `last_checked_at = now` (AC-16) |
| `getMe` unauthorized (token revoked, bot deleted) | `state = needs_token`, `last_checked_at = now` (AC-16) |
| network error, Telegram 5xx or 429 | nothing. The state is kept, and the next tick retries (ADR-0008) |
| registered webhook URL is not ours (another service's, tg-inbox's own stale URL for another row id, or none) | `state = taken_over`, refresh `name` and `username`, `last_checked_at = now` (AC-16b) |
| registered webhook URL is ours | `state = connected`, refresh `name` and `username`, `last_checked_at = now` (AC-15) |

- **Backwards-compat policy:** additive only. A new optional field is fine. Removing or renaming a field needs a new queue name (`bots.check-health.v2`). Workers ignore unknown fields.

## Idempotency & retry

- **Idempotency:** a check is a read of Telegram plus a state write conditional on the row being unchanged since the read, so running it twice gives the same row. `singletonKey = bot_id` keeps it to one check per bot at a time.
- **Retry:** `retryLimit = 0`. A failed check stays due, because `last_checked_at` is unchanged, so the next cron tick (≤ 1 min) re-enqueues it. The 5-minute freshness budget of AC-15 already includes that tick.
- **Dead-letter:** none. A bot whose checks keep failing transiently keeps its last stored state and its old `last_checked_at`, which the settings page shows (sad.md §1 ¶4 override). The webhook server-error alert and the job-failure logs (sad.md §7) are the operational signal.

## Schema registry

- Registry: this file. The job payload schema lives next to the worker (`apps/api/src/modules/bots/infra/jobs.ts`). It is not in `packages/shared`, because the web panel never sees it.
- Validator: zod, as everywhere in the repo.
