---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 7 — contacts"
---

# 0003 — Record every contact tag change as an append-only history entry with the tag name at that moment

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

A shrunk segment must be explainable (spec §1, §6.1 segment sabotage): the profile shows every tag added, removed, merged or removed by a delete, by whom and when, under the name the tag had then (AC-04, AC-09). A merge keeps the original adder and time on contacts and writes one "merged into" entry on every contact that carried the merged tag. The §7 KPI needs to know whether a member's change came from the inbox or the profile. The per-member rate limit (AC-15) counts recorded changes.

## Decision drivers

- Spec §6 tag history completeness: 0 additions or removals without an entry, for every path (member, merge, delete).
- AC-04: entries survive renames and deletes of the tag, and deactivation of the member (AC-13).
- Spec §1: tag changes are not conversation activity entries.
- assignment-statuses precedent: count the change log under an advisory lock for the rate limit.

## Considered options

1. **An append-only `contact_tag_history` table in `contacts`** — kind (added / removed / merged / deleted), tag id without FK, tag name snapshot, target tag id and name for merges, actor account, source (inbox / profile / settings), time — written in the same transaction as the change. `contact_tags` keeps the current state (adder, time).
2. **Event-sourced tags: only the history table, current tags derived from it.** One source of truth, but every list filter and count would aggregate history, missing the 500 ms list target, and merges would need replay rules.
3. **Soft-deleted `contact_tags` rows (removed_at, removed_by) instead of a log.** Fewer tables, but merges and renames would need to keep name snapshots per row, a tag re-added after a removal needs a second row, and merge entries have no natural row.

## Decision outcome

**Chosen:** Option 1. Current state stays cheap to filter and count, and the log is written by the same transaction for every path, so completeness holds by construction and is checkable by an integrity query.

## Consequences

**Positive**
- Entries read correctly after renames and deletes (name snapshots) and after deactivations (account ids resolved to display names).
- One table serves the profile, the rate limit and two KPIs.

**Negative**
- An owner's merge or delete writes one row per affected contact (up to 10 000) in one statement.
- Two writes per change (link + entry) to keep consistent; covered by per-path tests.

**Neutral**
- The `source` field is client-reported (member routes accept only `inbox` / `profile`) and only feeds a KPI; the rate limit counts member kinds, not sources.

## Links

- Spec: [[../spec.md]] AC-04, AC-06, AC-09, AC-13, AC-15, §6, §6.1, §7
- SAD: [[../sad.md]] §4 choice 3, §5 table ownership
- Related ADR: [[0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count]]
