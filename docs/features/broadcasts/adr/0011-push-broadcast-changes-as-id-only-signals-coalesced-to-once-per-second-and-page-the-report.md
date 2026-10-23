---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0011 — Push broadcast changes as id-only signals coalesced to once per second, and page the report

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

The Broadcasts list's statuses, a launched broadcast's status, totals and recipient outcomes, and the broadcast item in an open conversation update without reloading (ux-flows). A report has up to 10 000 recipients and changes up to 25 times per second while sending. Spec §6: outcome recorded → shown in an open report p95 ≤ 3 s; blocked marks show on Contacts. The live channel carries id-only change signals published inside the writing transaction (`platform/realtime`); clients refetch through read routes.

## Decision drivers

- Spec §6 report live update ≤ 3 s; AC-11, AC-14, AC-16
- The existing signal contract: ids only, under 1000 bytes, zod-validated, published in the writing transaction
- No refetch storm: 25 outcomes per second must not mean 25 refetches per second per tab

## Considered options

1. **New `broadcast.changed` signal, report changes coalesced, report paged.** `broadcast.changed { workspace_id, broadcast_id, change: 'draft' | 'group' | 'status' | 'report' | 'deleted' }` reaches every socket of the workspace. Draft and group writes, launch, stop, abort, finish and delete publish it once per transaction. The sender publishes `report` in an outcome transaction only when at least 1 s has passed since its last `report` publish for that broadcast, and always in the finishing transaction. The report page refetches totals (a grouped count) and its current 50-recipient page, with one fetch in flight at a time. `contact.changed` gains `change: 'reach'`; `conversation.changed` gains item type `broadcast` (created only).
2. **Push totals inside the frame.** Saves a refetch, but breaks the ids-only contract (frames carry no content) and the totals could disagree with a page read a moment later.
3. **A signal per outcome, no coalescing.** Simplest publisher, but 25 frames and 25 refetches per second per open report tab for up to seven minutes.

## Decision outcome

**Chosen:** Option 1. At most one report signal per broadcast per second plus a refetch of about 50 ms keeps the shown report within ~1.5 s of the newest outcome, inside the 3 s target, at a fixed cost per tab. Paging keeps every read small at 10 000 recipients. The contract stays ids-only.

## Consequences

**Positive**
- One signal type for every broadcast change; the list and the report share it.
- The 50-recipient page with an outcome filter is a keyset read on an index by (broadcast, state).

**Negative**
- The broadcast item still produces one `conversation.changed` per recipient (needed for an open thread), filtered client-side by the inbox and attention stores.
- The coalescing clock lives in the sender's memory; a new link starts with "publish now", which at most adds one extra signal.

**Neutral**
- A tab that missed frames gets `resync` from the listener's gap handling and refetches everything, as today.

## Links

- Spec: [[../spec.md]] AC-11, AC-14, AC-16, §6 report live update
- SAD: [[../sad.md]] §4 choice 11, §8 events
- Related ADR: [[0010-store-broadcast-items-as-a-conversations-thread-entry-that-never-touches-conversation-state]], shared-inbox ADR-0002, ADR-0003, contacts ADR-0007
