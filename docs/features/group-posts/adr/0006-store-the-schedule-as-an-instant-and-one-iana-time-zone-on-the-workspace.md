---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0006 — Store the schedule as an instant and one IANA time zone on the workspace

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

Posts are scheduled in a local time, but a team can sit in several zones and the EU and US daylight-saving changes fall at different dates (spec devil's-advocate: time zone). The workspace has no settings column today; `workspaces` owns the `workspaces` table.

## Decision drivers

- Spec AC-09, AC-10, Clarifications: one workspace time zone, zone named on every time, a skipped local time refused, a repeated one = its first occurrence, changing the zone keeps every scheduled moment.
- Module rule: only `workspaces` writes its table.

## Considered options

1. **Instant + workspace zone** — `posts.scheduled_at` is `timestamptz`; `workspaces.time_zone` is a nullable IANA name set by an owner through a `workspaces` use case; local ↔ instant conversion and validity in one function in `packages/shared/src/time-zone.ts` used by api and web.
2. **Instant + a posts-owned setting** — the same instant, but the zone kept in a `posts` table (`post_settings` per workspace) instead of on the workspace.

## Decision outcome

**Chosen:** Option 1. One instant per post makes the job, the window and the integrity check zone-free; the zone is presentation and input. Option 2 avoids touching `workspaces`, but the zone is a fact about the business that other features (business hours, reports) will read, and a one-row-per-workspace table in `posts` would be read by them across modules.

## Consequences

**Positive**
- The send path never touches time zones.

**Negative**
- The first owner who schedules must confirm the zone (one extra step, once per workspace).
- The validity check depends on the runtime's time zone database (Node and browsers ship one; a stale browser could disagree for a newly changed zone — the server's answer wins).

**Neutral**
- Other future features (business hours) can read the same column.

## Links

- Spec: [[../spec.md]] AC-09, AC-10
- SAD: [[../sad.md]] §4, §8
