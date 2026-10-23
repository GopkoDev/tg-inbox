---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0004 — Evaluate audiences in contacts with the Contacts filter rules and return the breakdown and the reachable set

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

A tag audience uses the Contacts tag filter's rules ("any of", "all of", "no tags"; no tag = every contact) plus tags to leave out (AC-01). The group picker must match and count exactly as the Contacts list (AC-04). Drafts and the launch confirmation show the same breakdown: audience size, blocked the bot, never wrote to the current bot, would reach (AC-01, AC-06). The launch freezes the reachable set (AC-06), and the 10 000 limit counts the whole audience (AC-05). A renamed tag keeps working; a deleted or merged-away tag drops out with a notice (AC-01). `contacts` owns contacts, tags, contact tags and (ADR-0002) reachability; the filter lives in `contacts/infra/contact-list-query.ts`.

## Decision drivers

- One matching rule, owned where the Contacts filter lives (AC-01, AC-04)
- Spec §6 draft audience count p95 ≤ 500 ms and launch p95 ≤ 2 s on 10 000 contacts
- No query of another module's tables; no hook from tag admin into `broadcasts` (lock-order risk with the tag lock, contacts ADR-0004)

## Considered options

1. **`contacts` evaluates; `broadcasts` stores the definition.** New `contacts` app reads: `audienceBreakdown(workspaceId, audience, telegramBotId)` and `reachableContacts(workspaceId, audience, telegramBotId)`, where `audience` is a tag audience `{mode, tagIds, excludeTagIds}` or a list of contact ids (a group), plus `existingTags(workspaceId, tagIds)` and `matchingContactIds(workspaceId, filter, limit)` for "add all matching". They reuse the list filter's SQL and accept a transaction. `broadcasts` keeps each chosen tag as (tag id, include / exclude, the name when chosen); ids that `existingTags` no longer returns are left out of the evaluation and reported by their stored name.
2. **`broadcasts` re-implements the filter** over a contact snapshot it reads through `contacts` page by page. Two copies of the matching rule that can drift, and paging 10 000 contacts on every draft read misses the 500 ms target.
3. **Tag admin notifies `broadcasts`** through a port when a tag is deleted or merged, so drafts drop it at once. It gives a precise notice, but the port runs inside the owner's tag transaction (advisory `tags:<ws>`, tag rows `FOR UPDATE`) and would lock broadcast rows that draft saves lock first, a deadlock risk, for a notice the read can produce anyway.

## Decision outcome

**Chosen:** Option 1. The matching is the Contacts list's by construction. The breakdown is one aggregate query joined to the reachability rows of the current bot, and the reachable set is at most 10 001 rows (the extra one proves "over the limit"). Groups go to `contacts` as an id array (`= ANY($1)`), which stays inside the targets at 10 000 ids. Detecting a missing tag at read time needs no cross-module hook.

## Consequences

**Positive**
- AC-01 / AC-04 parity with the Contacts list is structural, not tested-in.
- `broadcasts` holds only definitions and ids, never contact data.

**Negative**
- Every draft read runs the breakdown query (not cached), which is acceptable at the spec's sizes.
- A dropped tag's notice shows the name it had when it was chosen, not a later rename before the delete.

**Neutral**
- Saving the draft next time removes the dropped tag rows; until then they are ignored.

## Links

- Spec: [[../spec.md]] AC-01, AC-04, AC-05, AC-06, §6 draft audience count, launch
- SAD: [[../sad.md]] §4 choice 4, §5
- Related ADR: [[0002-keep-per-bot-reachability-of-contacts-in-contacts-keyed-by-the-telegram-bot-id]], [[0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock]], contacts ADR-0004
