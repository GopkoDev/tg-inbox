---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0008 — Pace broadcasts at 25 per second per bot in turns and wait for the send pause

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

Broadcasts share one bot with support. All of a bot's broadcasts together stay at or below 25 messages per second over any 1 s window, leaving room under Telegram's ~30 for replies, pings and the bot's answers. Replies are not counted and never wait. Two broadcasts of a workspace take turns. After any rate-limit answer to any of the bot's sends, broadcasts wait for the bot's send pause and continue where they stopped (AC-15, spec §6). A broadcast stops at once when the bot stops working or is replaced (AC-12). Today `bots` has `sendText` (replies: no pause, no pacer) and `sendMemberMessage` (pings: pause-aware, an in-process per-bot pacer at 10 per second).

## Decision drivers

- AC-12, AC-15; spec §6 broadcast pace, reply latency during a broadcast (p95 ≤ 2 s), broadcast completion (1 000 in 90 s, 10 000 in 10 minutes)
- `bots` owns Telegram, the token and the send pause
- One sender per workspace across instances already (ADR-0007)

## Considered options

1. **`bots.sendBroadcastMessage` + a per-bot pacer at 25 per second + a bounded window + round-robin in the sender.** `sendBroadcastMessage({ workspaceId, telegramBotId, chatId, text })` returns without calling Telegram when the bot is not `connected` / `taken_over` (`bot_unavailable`), when the workspace's bot is a different Telegram bot (`bot_changed`), or while `send_paused_until` is in the future (`rate_limited`). Otherwise it takes the next start slot of the pacer keyed `broadcast:<bot id>` (40 ms apart) and sends. A `429` stores the pause, as today. The sender keeps at most 8 sends in flight and picks the next recipient round-robin across the workspace's sending broadcasts (oldest launch first).
2. **Sequential sends without a window.** Simplest, but at ~150–300 ms per Telegram round trip it reaches 3–7 per second, missing "10 000 within 10 minutes" (≥ 17 per second).
3. **A shared Postgres token bucket for broadcasts, pings and replies.** Precise across all senders, but it changes the shipped reply path and adds a write per reply (rejected for pings in operator-notifications ADR-0006 for the same reasons).

## Decision outcome

**Chosen:** Option 1. With one active sender per workspace (ADR-0007), an in-process pacer is exact for that bot; 40 ms start spacing caps any 1 s window at 25. The spacing is measured from the previous send's actual start, never from a slot booked in advance, so a timer that fires late (an event-loop stall) delays the sends behind it instead of releasing them together; the pause is read again after the pacer wait, so a `429` answered while a send waited for its turn holds it too; and a send is refused as `bot_unavailable` when the bot was connected again after the launch (it stopped working meanwhile, AC-12). <!-- review 2026-10-24: K1, A2, A4 --> Eight in flight cover a Telegram round trip of up to 320 ms at full pace, so 1 000 recipients take about 40 s and 10 000 about 7 minutes. Replies keep their own path. The pause and the bot identity are checked inside `bots` before each call, so a rate limit from any sender pauses broadcasts, and a replaced bot is never used for an old broadcast.

## Consequences

**Positive**
- The reply path is unchanged; replies never wait for broadcasts.
- Turn-taking makes two broadcasts progress together, each at about half the pace.

**Negative**
- Broadcasts (25) plus the ping cap (10) can exceed Telegram's ~30 in the rare second when both are busy; the first `429` then pauses both, which is the intended direction (SAD §11).
- The pacer is per process; correctness relies on the one-active-link rule of ADR-0007.

**Neutral**
- The pace is a constant in `broadcasts/domain` and the pacer in `bots`; tuning needs no schema change.

## Links

- Spec: [[../spec.md]] AC-12, AC-15, §6 broadcast pace, broadcast completion, reply latency, cross-workspace isolation
- SAD: [[../sad.md]] §4 choice 8, §6 flow 2, §10 QG-1
- Related ADR: [[0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send]], operator-notifications ADR-0006
