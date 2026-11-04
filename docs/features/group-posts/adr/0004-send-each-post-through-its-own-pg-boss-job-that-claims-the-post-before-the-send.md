---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0004 — Send each post through its own pg-boss job that claims the post before the send

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

Telegram has no scheduling for bots (roadmap). A post must go out within a minute of its time, at most once, never more than 15 minutes late, in scheduled order within one chat, and survive restarts. Broadcasts send through a per-workspace `stately` chain (broadcasts ADR-0007), but a stately singleton keeps one queued job per key, so a post scheduled earlier than an already-queued later one could not be queued.

## Decision drivers

- Spec §6: on time p95 ≤ 30 s / max ≤ 60 s; 0 sends started more than 15 min late; at most once, including after a restart.
- Spec Clarifications: posts inside their window after an outage still go out in order; per chat ≤ 1 per 3 s.
- No new tenancy exception (a cross-workspace "due posts" sweep would need one).

## Considered options

1. **One job per post** — `posts.send`, policy `standard` with no singleton key, payload `{postId, moment}`, `startAfter` = the scheduled moment (or now), queued in the same transaction as the schedule; at most once comes from the post row's claim, not from the queue, so a reschedule or a re-queue ("queue again in 3 s") is simply a new job and a job whose `moment` no longer matches the post exits; the job body share-locks the scheduling owner's membership, takes the advisory `posts:<ws>` lock (daily count), locks the post, checks state / version / moment / window and the chat's order, commits the claim (`sending`) before the send, then records the outcome; retry 2, expire 60 s, DLQ `posts.send-dlq` that only settles a stale claim to "not confirmed".
2. **Per-workspace chain** (as broadcasts) woken at the next due time.
3. **A cron sweep every 30 s** over due posts of all workspaces.

## Decision outcome

**Chosen:** Option 1. Each post carries its own durable timer; rescheduling queues a new job and the old one finds a different moment and exits; nothing reads across workspaces. Option 2 cannot queue an earlier wake-up behind a later one without extra bookkeeping. Option 3 adds a controlled tenancy exception and up to 30 s of extra delay.

## Consequences

**Positive**
- At most once by construction: a claimed `sending` post is never sent again; a stale claim becomes "not confirmed".
- The 15-minute rule is a check at the claim, measured at the send start.

**Negative**
- Per-chat order needs a check inside the job (an earlier due post to the same chat still scheduled → queue again in 3 s).
- Many jobs at the same minute across workspaces are bounded only by the limits (100 scheduled per workspace).

**Neutral**
- "Publish now" uses the same job with `startAfter` = now, so one code path sends every post.

## Links

- Spec: [[../spec.md]] AC-08, AC-09, AC-12, §6
- SAD: [[../sad.md]] §4, §6 flow 2, §7
- Related ADR: [[0005-publish-and-schedule-against-the-shown-version-and-re-check-the-scheduling-owner-at-the-send]]
