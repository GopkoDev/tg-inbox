---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0005 — Version draft fields and keep the group as per-contact rows outside the version

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

Any member edits a draft, and drafts save as the member types (ux-flows). Two members on the same draft must not overwrite each other's text or audience: a stale save is refused and the member sees the current version (AC-03). Group additions and removals by different members must each be kept, and must never make a teammate's text save stale (AC-03, clarify). A group holds at most 10 000 contacts, each once, all of its own workspace (AC-05, AC-08). Switching from a non-empty group to a tag audience drops the group only after a confirmation naming its size (clarify).

## Decision drivers

- AC-03, AC-04, AC-05, AC-08
- The existing optimistic-version pattern (`state_version` on conversations)
- A launched broadcast never changes (spec §6 frozen recipients)

## Considered options

1. **A `version` on the broadcast row for name, text, audience kind and tags; the group as rows outside it.** A field save carries `expected_version`; under the broadcast row lock `FOR NO KEY UPDATE` the server checks status `draft` and the version, writes, raises the version and records who changed it. A group add (one contact or a bulk add) or remove takes the same row lock, checks status `draft` and the 10 000 limit, and inserts or deletes rows of `broadcast_group_contacts` (primary key workspace, broadcast, contact; composite foreign key to `contacts`), without touching the version. Switching kind away from a non-empty group carries `expected_group_size`; a different size is refused with the current size.
2. **A version per field** (name, text, audience each with its own counter), group rows outside as in option 1. Two members editing different fields never conflict, at the cost of three counters, three refusal shapes and a client that tracks which field version it saw.
3. **An edit lease** (the first member to type holds the draft for 2 minutes, others see it read-only with who holds it). No stale saves at all, but a member who walks away blocks teammates, and the lease needs presence-like expiry handling.

## Decision outcome

**Chosen:** Option 1. Field edits get the stale-save protection AC-03 asks for; group edits are commutative set operations (insert on conflict do nothing, delete by key), so concurrent adds and removes by two members both stand. One counter is enough at draft scale (per-field counters buy little for a short form), and a lease would let an absent member block the team. The broadcast row lock is the one point that serialises "still a draft" and the 10 000 limit against a launch (ADR-0006) and a delete.

## Consequences

**Positive**
- Refusals carry the current draft (409 with the draft), as the inbox's state-change refusals do.
- The composite foreign key makes a cross-workspace group member unstorable.

**Negative**
- Every group write briefly locks the broadcast row; a bulk add of up to 10 000 rows holds it for the insert.

**Neutral**
- "Last changed by / at" moves on group edits too (for the list), but the version does not.

## Links

- Spec: [[../spec.md]] AC-03, AC-04, AC-05, AC-08, §1 clarifications ("Which draft edits are versioned")
- SAD: [[../sad.md]] §4 choice 5, §8 lock order
- Related ADR: [[0006-launch-against-the-shown-version-and-an-audience-fingerprint-under-a-per-workspace-launch-lock]]
