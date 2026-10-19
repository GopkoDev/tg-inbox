---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0005 — Decide pings in a per-workspace sweep every 20 s with a per-period ledger written before the send

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

A conversation stays due for a member as long as the wait lasts (spec §1 clarifications). A member is pinged when the wait reaches 5 minutes (own or unassigned), 30 minutes (the team), or 5 minutes when the assignee is away, has not read the waiting message and cannot be pinged (no link, or "Not reachable"). A member also becomes due later on other events:
- becoming away;
- becoming the assignee;
- an unassign;
- the assignee's link turning "Not reachable";
- the bot working again.

Pings to one member are combined, at most one per 10 minutes per workspace and one per conversation per waiting period. Everything is re-checked at send time: open, waiting, unread, away, membership active, bot able to send. Nothing is queued while the bot is broken.

## Decision drivers

- Spec §6 ping timeliness "≤ 60 s" p95; ping volume "≤ 1 ping per 10 min per member per workspace; ≤ 1 per conversation per waiting period"; "0 pings reach a Telegram account whose membership is not active at send time"
- Correct under several API instances, restarts and concurrent job runs
- `CLAUDE.md`: async work through pg-boss `<module>.<job>`; tenancy exceptions only through a SAD change
- Precedent: `bots.schedule-health-checks` (cron) → `bots.check-health` (exclusive per bot); the drain's in-flight mark (at most once)

## Considered options

1. **A periodic sweep per workspace with a ledger.** `notifications.send-pings` (exclusive, `singletonKey` = workspace id) runs, computes each member's due set from conversations, presence, links and the ledger, sends, and re-enqueues itself 20 s later while the workspace has a live link. A cron `notifications.schedule-pings` every minute restarts missing chains. Per member, one transaction share-locks the membership, recomputes the due set from fresh reads and inserts `pings` + `ping_items` (unique per member, conversation and period start). It commits before the Telegram call. A short outcome transaction afterwards records the result: `rate_limited` and `bot_unavailable` remove the ping and its items, so the conversations stay due; `blocked` and `transient` count. It publishes `telegram_link.changed` when reachability flips.
2. **One delayed pg-boss job per conversation and threshold** (`startAfter` 5 min and 30 min at wait start). Exact due times. But six other events also make a conversation due, and each would need an enqueue hook in the module that causes it: presence in the hub, assignment in conversations, bot recovery in bots, reachability in notifications. Combining per member then needs a second, per-member job anyway.
3. **One delayed job per member** (`singletonKey` = member, `startAfter` = the next allowed moment), enqueued whenever something might make them due. Natural combining. But it needs the same enqueue hooks as option 2, and a missed hook means a silently missed ping.

## Decision outcome

**Chosen:** Option 1. A sweep sees every trigger as a change in state, with no hook in the modules that cause it. It is idempotent, so a lost or duplicated run cannot double-ping: the unique ledger and the exclusive key make "at most once per period" hold across instances. The 20 s period plus send time stays well inside the 60 s p95. The send-time re-check is the recomputation inside the per-member transaction. A due set that empties sends nothing.

**Tenancy exception (the sixth):** *workspaces with a live Telegram link*, a read by the cron backstop only. It returns workspace ids, and every read after it is scoped. This is recorded here and in SAD §8, to be added to CLAUDE.md and the architecture map.

## Consequences

**Positive**
- All due rules are one pure function over a snapshot, unit-testable for every AC-07…AC-10 case.
- Bot recovery needs nothing special: still-waiting conversations are simply due again, combined.

**Negative**
- Constant background load: one small sweep per workspace with links every 20 s, even when nothing is due (§7 threshold).
- Due moments are quantised to the sweep period (up to 20 s late).
- At-most-once: a Telegram timeout after the commit loses that ping (§11 accepted debt).

**Neutral**
- Narrowing the read to "conversations whose period crossed a threshold since the last run" is an optimisation for later, with no schema change.

## Links

- Spec: [[../spec.md]] §1 clarifications, AC-07, AC-08, AC-09, AC-10, §6
- SAD: [[../sad.md]] §4 choice 5, §6 flow 1, §7, §8 Tenancy, Concurrency
- Related ADR: [[0002-track-presence-as-per-tab-leases-in-postgres-refreshed-by-the-workspace-live-socket]], [[0006-pace-pings-below-a-per-bot-share-of-the-telegram-limit-and-pause-them-on-any-rate-limit-answer]], [[0007-record-the-waiting-period-start-on-the-conversation-in-the-writing-transactions]], bot-connection ADR-0007, ADR-0008
