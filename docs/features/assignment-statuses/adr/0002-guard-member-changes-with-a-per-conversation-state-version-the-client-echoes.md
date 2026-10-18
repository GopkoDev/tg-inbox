---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 5 — assignment-statuses"
---

# 0002 — Guard member changes with a per-conversation state version the client echoes

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Architect (autonomous pipeline run, 2026-10-18), to be confirmed by the Tech Lead at review

## Context

AC-03 says a member's change must not apply silently when the assignee or status changed since the member last saw it, whether a teammate changed it or an automatic cause did. When two members act at once, the first change is recorded and the second member counts as having seen the old state. When the conversation is already in the requested state, nothing happens. `ux-flows.md` flagged as a design question how the server knows what the member last saw.

## Decision drivers

- Spec AC-03, plus §2 Goals "two members never take or close the same conversation by accident"
- Spec §6: assign / close / reopen p95 "≤ 300 ms server time", so the check must be cheap and done in the change transaction
- Precedent: shared-inbox's stateless teammate-collision check (the client sends what it saw, the server compares inside the transaction)
- Multi-replica readiness: no per-process session memory

## Considered options

1. **A per-conversation integer state version.** Every assignee or status change raises it in the same row update. Reads return it, the client echoes the version it rendered, and the server compares under `FOR UPDATE` on the conversation row. A refusal returns the current state, the latest activity entry and the new version. "Go ahead" resends with that version.
2. **Expected values (assignee + status) echoed by the client.** No new column is needed. But A→B→A changes by teammates (or close→reopen by the customer) compare equal, so a member acts over changes they never saw. That violates "changed since then".
3. **The latest activity entry id echoed by the client.** Equivalent in power to option 1, but ordering ids is weaker than comparing an integer, and the "latest" lookup needs an extra index read on every change.
4. **Server-side per-member "last seen" record**, written whenever the thread is shown. This adds a write on every read, and the server cannot know what the browser actually displayed after a missed live signal.

## Decision outcome

**Chosen:** Option 1. It catches every intervening change, ABA included. It costs one integer column and one comparison under the row lock the change takes anyway, and it serialises concurrent members exactly as AC-03 describes.

## Consequences

**Positive**
- Concurrency is decided by the database row lock, so it is correct across replicas.
- "Go ahead" carrying the refused version means a third change in between asks again.
- Automatic changes (customer reopen, failed-reply reopen, deactivation unassign) raise the version too, so they are covered without special cases.

**Negative**
- Every read the header draws from (summary, list row) must carry the version, and the web store must update it on every live refetch. A tab that missed a signal gets a harmless extra confirmation.
- One more column to keep in step in every writer of status or assignee.

**Neutral**
- The close action folds the stale check into its own confirmation (ADR-0003, SCR-12), so a close is asked once even when several reasons apply.

## Links

- Spec: [[../spec.md]] AC-03, AC-02, AC-05
- SAD: [[../sad.md]] §4 choice 2, §6 flow 1, §8 Concurrency
- Related ADR: [[0003-recheck-close-reasons-under-the-conversation-row-lock-against-an-acknowledged-close-snapshot]]
