---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0008 — Serve the attention count from a conversations query refetched on change signals

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

AC-01: the tab title and the Inbox item show the member's **attention count**: open conversations that are theirs or unassigned and hold customer messages unread by them. It changes live as messages arrive, as the member reads (in any tab), and as conversations are assigned, closed or reopened. It shows on every workspace page. assignment-statuses kept counts off the lenses as a reliability risk, and the spec reverses that for this one number. Unread is computed server-side per row today (`list-queries.ts`, unread floor = max of the read mark and `active_since`). The web store holds only the loaded page of the list.

## Decision drivers

- Spec §6 in-web latency "≤ 3 s (shared-inbox live-update target)"
- Correctness across all conversations, not just the loaded page
- Shared-inbox ADR-0002: frames carry ids only, and clients refetch through reads
- Existing signals: `conversation.changed` (message, activity, `read` for the same account), `membership.deactivated`, `resync`

## Considered options

1. **Server-computed and refetched.** `conversations.attentionCount(workspaceId, accountId, activeSince)` reuses the unread predicate and the lens indexes, and `inbox` serves it. The frame's attention store refetches it, debounced, on message, activity and own-read frames and on resync.
2. **Client-derived** from the list store. No new read. But the store has only the first page and one lens, so the count would be wrong for any workspace with more conversations than one page, and wrong on non-inbox pages.
3. **Pushed in the frame**: the server computes each affected member's count and sends it. No refetch. But it breaks the ids-only frame contract, puts a per-member query inside every writing transaction or every dispatch, and multiplies work by the members of the workspace.

## Decision outcome

**Chosen:** Option 1. It is the only option that is always correct. It follows the decided "signal, then refetch" pattern, and its cost is one indexed count per tab per burst of frames (debounced 300 ms). That fits the 3 s target with room to spare. Own-read updates already arrive account-scoped (`change: read` with `account_id`), so a read in one tab updates the count in the others.

## Consequences

**Positive**
- One definition of "attention", tested in SQL with the cross-workspace isolation test.
- No change to the frame schema for the count.

**Negative**
- A busy workspace causes a count refetch in every open tab for each burst of message frames.
- A new route and query to keep within the list's latency budget at pilot scale.

**Neutral**
- Pushing counts later would be an additive frame type.

## Links

- Spec: [[../spec.md]] AC-01, §1 (reversal of assignment-statuses §3), §6 in-web latency
- SAD: [[../sad.md]] §4 supporting choices, §6 flow 3
- Related ADR: shared-inbox ADR-0002, ADR-0005
