---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 5 — assignment-statuses"
---

# 0007 — Signal assignment and status changes as activity items on conversation.changed

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Architect (autonomous pipeline run, 2026-10-18), to be confirmed by the Tech Lead at review

## Context

Assignee and status changes, member-made or automatic, must reach every open list and thread of the workspace within the live-update target. Rows move between lenses, headers update (with the new state version), and the activity line appears (AC-02, AC-05, AC-07, AC-08, AC-09, AC-10). The live channel carries id-only signals published in the writing transaction, and clients refetch through the reads (shared-inbox ADR-0002/0003). The `conversation.changed` schema is shared by `platform/realtime`, the `inbox` hub, `packages/shared` `LiveFrame` and the web store. Its item types are `message | reply` and its change enum is closed.

## Decision drivers

- Spec §6 "Live update p95 ≤ 3 s (as shared-inbox §6)", "Reopen on customer message p95 ≤ 3 s"
- shared-inbox ADR-0002: frames carry ids only, and the reads are the single source of truth
- `platform/realtime`: payload ≤ 1000 bytes, zod-validated

## Considered options

1. **Add item type `activity` (change `created`) to `conversation.changed`.** Each recorded change creates exactly one activity entry and publishes one signal for it. The client refetches the row, the summary and the item.
2. **A new signal type `conversation.state_changed` carrying the conversation id.** This is explicit, but the client would still need a second fetch for the activity line, and the hub, the schema union and the store all gain a parallel path for what is the same "new thread item" event.
3. **Reuse `change: 'state'` with `item: null`.** No schema extension for items, but `item: null` today means "read" only. It would blur that rule, and the thread could not fetch the new line without a full reload.

## Decision outcome

**Chosen:** Option 1. Every change already produces exactly one new thread item, and the existing "item created → refetch item + row" path in the store becomes "+ refetch summary". It is the smallest extension of a shared contract.

## Consequences

**Positive**
- Automatic causes (capture, reply outcome, deactivation) publish the same signal from their transactions with no special client logic.
- Payloads stay ids-only and well under 1000 bytes.

**Negative**
- The shared schema changes in `platform/realtime`, `packages/shared` `LiveFrame`, the hub mapping and the web store. Old tabs must tolerate an unknown item type (§11).
- A deactivation with many assignments emits one signal per conversation.

**Neutral**
- A customer reopen emits two signals in one transaction (message created + activity created), and the client coalesces the refetches.

## Links

- Spec: [[../spec.md]] AC-02, AC-05, AC-07–AC-10, §6
- SAD: [[../sad.md]] §4 supporting choices, §8 Events, §6 flows 1–3
- Related ADR: [[0006-store-activity-entries-in-their-own-table-and-merge-them-into-the-thread-by-position-time]]; shared-inbox ADR-0002, ADR-0003
