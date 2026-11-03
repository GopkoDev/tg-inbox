---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0005 — Publish and schedule against the shown version and re-check the scheduling owner at the send

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

A schedule turns the moment of an owner's decision and the moment of the send into two moments, possibly weeks apart. Between them a member could change the text, the owner could leave, or the destination could change (spec devil's-advocate: context drift).

## Decision drivers

- Spec AC-08, AC-11: what goes out is exactly what an owner confirmed; a changed scheduled post returns to a draft; a deactivated scheduling owner's posts return to drafts.
- Spec §6: 0 posts whose sent text or destination differs from the confirmed version.
- Precedent: broadcasts launch against the shown version (broadcasts ADR-0006).

## Considered options

1. **Version guard + owner re-check** — every draft save bumps `version`; publish and schedule carry the version the dialog showed and are refused if it changed; a scheduled post refuses edits until moved back to a draft (which bumps the version); the send job share-locks the scheduling owner's membership and sends only if they are still an active business owner, else returns the post to a draft; deactivation also returns their scheduled posts inside its transaction.
2. **Scheduled copy** — scheduling copies the confirmed text and destination into a separate scheduled row; any draft edit deletes that copy (same outcome, two rows).
3. **Hard lock** — a scheduled post cannot be edited at all until a member explicitly moves it back to a draft; the owner is re-checked only by the deactivation hook, not again at the send.

## Decision outcome

**Chosen:** Option 1. It makes "exactly what was confirmed" a property of one row and keeps the owner-only gate meaningful for weeks-ahead sends. Option 2 keeps two copies of one post in step and doubles the integrity checks. Option 3 is close, but relying on the hook alone misses a role change from owner to operator, and the spec's edit flow asks to confirm the move back to a draft rather than refuse the edit.

## Consequences

**Positive**
- One source of truth per post; the integrity check is a simple comparison.

**Negative**
- An owner's deactivation can quietly cancel planned posts (shown with a notice on the draft; not counted in attention, which the spec limits to failed, missed and not confirmed posts).

**Neutral**
- Changing only the time is scheduling again by an owner: the version is the same, the moment and `scheduled_by` change.

## Links

- Spec: [[../spec.md]] AC-08, AC-09, AC-11
- SAD: [[../sad.md]] §4, §8
- Related ADR: [[0004-send-each-post-through-its-own-pg-boss-job-that-claims-the-post-before-the-send]]
