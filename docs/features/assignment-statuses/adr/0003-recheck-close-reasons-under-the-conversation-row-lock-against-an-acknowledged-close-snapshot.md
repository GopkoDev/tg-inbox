---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 5 — assignment-statuses"
---

# 0003 — Re-check close reasons under the conversation row lock against an acknowledged close snapshot

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Architect (autonomous pipeline run, 2026-10-18), to be confirmed by the Tech Lead at review

## Context

AC-06 says that before closing, the inbox asks when the customer is waiting for a reply, when a customer message arrived after the closer's arrival watermark, or when the latest reply is "not delivered" / "not confirmed" (AC-08). The condition is "checked again at the moment the close is recorded", so a customer message recorded between the question and the close asks again. `ux-flows.md` flagged how to make that re-check reliable. The spec's §6 integrity target forbids closed conversations with a later customer arrival.

## Decision drivers

- Spec §6 "Lost customers — 0 closed conversations whose latest customer message arrived after the close"
- Spec AC-06 (re-check at record time), AC-08 (failed latest reply is a reason)
- The arrival-watermark read model of shared-inbox ADR-0005 (unread = arrived after the later of the watermark and active-since)
- Capture's raise of the conversation's arrival is an `UPDATE` that locks the row. Its upsert does not (`ON CONFLICT DO NOTHING` + a plain read), and arrival timestamps are taken before the transaction, so they do not follow commit order.

## Considered options

1. **Server-side evaluation in the close transaction under `FOR UPDATE`, confirmed against a close snapshot.** The snapshot is a per-conversation customer message counter (raised by capture under the row lock) plus the latest reply's id and state. The client sends the version and snapshot it shows with every close. The close is recorded if the version matches and either no reason holds (waiting, unread for this member, counter grew since the snapshot shown, latest reply failed) or `confirm` is set and the current snapshot equals the one sent. Otherwise the server refuses with every reason and the current snapshot and version, and "close anyway" resends them with `confirm`.
2. **A boolean "confirmed" flag on the close request.** Simple. But a message that arrives between the question and the confirmation would be closed over, which violates AC-06 directly.
3. **Client-side evaluation only (the dialog decides, the server just closes).** The browser cannot see a message whose signal has not arrived yet, and a background tab marks nothing read. Fails AC-06 and the §6 integrity target.
4. **Lazy repair: close freely, and a job reopens conversations with later arrivals.** This makes the integrity target "eventually 0", and the close still hides a customer the closer had not seen.

## Decision outcome

**Chosen:** Option 1. A snapshot keyed on the arrival timestamp was rejected during the critic pass. A message with a non-later timestamp can commit between the question and the confirmation, and the timestamp would not show it. The counter is raised under the row lock, so it follows commit order. The row lock that capture also takes means either the close sees the new arrival (and asks again) or the arrival comes after the close and reopens it (ADR-0004). The snapshot ties the confirmation to exactly what the dialog showed.

## Consequences

**Positive**
- The integrity target holds by construction. The integration test can race capture against close, including messages with equal or older arrival timestamps.
- One confirmation (SCR-12) can name every reason, including a stale version (ADR-0002).
- The "unread for me" reason uses the existing per-member watermark, so no new read state is needed.

**Negative**
- The close transaction reads the latest reply and the member's watermark under the row lock. That is a little more work than a plain update (still a handful of indexed reads).
- Two close conflict shapes (stale-only versus reasons) share one error code, so the client must render the details.
- One more counter column on `conversations`, kept by capture.

**Neutral**
- Adding a reason later (for example "an unconfirmed reply in progress") means adding a field to the snapshot and to the domain rule.

## Links

- Spec: [[../spec.md]] AC-06, AC-08, §6 Lost customers
- SAD: [[../sad.md]] §4 choice 3, §6 flow 1
- Related ADR: [[0002-guard-member-changes-with-a-per-conversation-state-version-the-client-echoes]], [[0004-reopen-closed-conversations-inside-the-capture-and-reply-outcome-transactions]]; shared-inbox ADR-0005
