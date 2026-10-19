---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 7 — contacts"
---

# 0005 — Keep first and last customer send times on the contact, written by capture

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

The Contacts list is ordered by "last wrote" (the send time of the contact's newest own message), shows "first wrote", pages 50 at a time from the last contact shown, and must answer with search, tag filter and the matching count within 500 ms at 10 000 contacts (AC-01, AC-02, §6). Those times live in `conversations` / `messages`, which `contacts` cannot query (`CLAUDE.md`) or call (it would create a cycle, ADR-0001). `conversations.last_message_received_at` is the arrival time, not the send time. Capture already calls `contacts.upsertFromProfile(workspaceId, sender, m.sentAt, tx)` once per captured message inside its transaction; edits do not call it.

## Decision drivers

- Spec §6 contacts list p95 ≤ 500 ms with filter and count; AC-01 keyset paging with no duplicates or skips.
- Clarification: "last/first wrote" = Telegram send times of customer messages; replies and edits never move them.
- `CLAUDE.md`: no cross-module table access; one-way dependencies.

## Considered options

1. **Columns `first_wrote_at` / `last_wrote_at` on `contacts`, set with `LEAST` / `GREATEST` of the send time already passed to `upsertFromProfile`; backfilled once from messages.** The list is a one-module keyset query.
2. **`inbox` orchestrates: `conversations` returns contact ids ordered by latest customer send time, `contacts` filters and decorates.** No new columns, but paging across two modules with a tag filter and a count means either fetching all ids of the workspace per page or duplicating the filter on both sides; hard to keep within 500 ms and exact keyset semantics.
3. **A read model refreshed by a job** (materialised contact list). Decoupled, but stale by the job interval and a new moving part for a value capture already has in hand.

## Decision outcome

**Chosen:** Option 1. The value is already delivered to `contacts` in the right transaction; storing it makes ordering, paging, filtering and counting one indexed query on `(workspace_id, last_wrote_at DESC, id DESC)`.

## Consequences

**Positive**
- Exact and immediately consistent with capture; duplicates are idempotent (same send time), edits never move it.
- Broadcasts can reuse the same segment query.

**Negative**
- A one-time backfill reads another module's tables (SAD §1 override, §11).
- The capture upsert does slightly more work per message.

**Neutral**
- A contact with no surviving messages has null times and sorts last.

## Links

- Spec: [[../spec.md]] AC-01, AC-02, §1 clarifications, §6
- SAD: [[../sad.md]] §4 choice 5, §4 Contacts list query, §1 Decision overrides
- Related ADR: [[0001-own-tags-in-the-contacts-module-with-its-own-routes-and-compose-the-profile-conversation-from-inbox-reads]]
