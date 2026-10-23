---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0006 — Pace pings below a per-bot share of the Telegram limit and pause them on any rate-limit answer

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

Pings and the bot's answers in members' chats go out through the same bot as customer replies, and so share its Telegram limit: about 30 messages per second per bot, and 1 per second per chat. Above that, Telegram answers `429` with `retry_after`. AC-10 says pings never delay or crowd out replies, and that at the limit replies go first and pings wait or are combined. Today there is no per-bot budget. The reply drain paces itself per conversation and backs off with a delayed job (`inbox/app/deliver.ts`).

## Decision drivers

- Spec §6 "reply send p95 ≤ 2 s, the shared-inbox target, with 50 pings due at once on one bot"; ping timeliness excludes "time the bot spent at its sending limit with replies queued"
- Keep the reply path unchanged: it is shipped and tested
- Multi-instance: any state the decision needs must be in Postgres
- `bots` is the only module that talks to Telegram

## Considered options

1. **Cap and pause.** A workspace's pings are serialised by its singleton job (ADR-0005) and paced at 10 per second at most, a third of the bot limit. Any `429` on this bot, from a reply or a ping, stores `send_paused_until` on the bot row. `bots.sendMemberMessage` refuses while that time is in the future, and replies never consult it. A ping refused or answered `429` is removed from the ledger, so its conversations stay due and are combined after the pause.
2. **A shared token bucket per bot in Postgres** that both replies and pings draw from, with replies taking priority. This is precise. But it changes the shipped reply path, adds a write per reply, and the priority logic must be right under concurrency across instances.
3. **Pings only when no reply is pending for the workspace** (ask `conversations` for queued or in-flight replies before each ping). Strong priority. But it couples pings to reply state, and a long drain backlog, the very moment customers are waiting, would starve pings indefinitely.

## Decision outcome

**Chosen:** Option 1. With pings capped at 10 per second, 50 due pings take 5 s and use a third of the budget. Replies keep their ~20 per second headroom and their p95, which the load test in SAD §10 verifies. The `429` pause gives AC-10's "replies go first" without touching the reply path. Telegram's own answer is the signal, so no estimate of the true limit is needed. A ping Telegram did not accept is not counted, so nothing is lost. It is combined into the next one.

## Consequences

**Positive**
- The reply drain is unchanged apart from recording the pause on `429` in the shared gateway.
- One column on `bots`, readable by every instance.

**Negative**
- The cap is a constant, not an adaptive share. A workspace with very heavy reply traffic could still be throttled by Telegram, and pings then pause, which is the intended direction.
- A pause caused by pings would also be seen by the reply drain's own `429` handling. That is unchanged behaviour, made rare by the cap.

**Neutral**
- Replacing the cap with a shared bucket (option 2) later needs no schema change beyond a counter.

## Links

- Spec: [[../spec.md]] AC-10, §6 reply delivery under ping load, ping timeliness
- SAD: [[../sad.md]] §4 supporting choices, §6 flow 1, §10 QG-1
- Related ADR: [[0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send]], shared-inbox ADR-0004
