---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 7 — contacts"
---

# 0004 — Serialise tag writes under a per-workspace tag lock and re-check a delete against the confirmed count

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

Members add, remove and create tags concurrently while an owner may rename, merge or delete them. The spec requires: one tag when two members create the same name at once; the 100-per-workspace and 20-per-contact limits under concurrency (AC-08); an add of a tag deleted or merged meanwhile refused, a renamed one applied under its new name (AC-14); a contact never carrying another workspace's tag (AC-12); and a delete that removes exactly the number of contacts the owner confirmed, or asks again with the current number (AC-09). The ux-flows note asks for the delete re-check to carry the count the owner saw, like the inbox's close snapshot.

## Decision drivers

- Spec §6: uniqueness, limits and tenant isolation at 0 violations; owner ops ≤ 2 s on 10 000 contacts; tag change ≤ 300 ms.
- Existing tools: row locks, `pg_advisory_xact_lock(hashtextextended(…))`, constraints; READ COMMITTED.
- Precedent: assignment-statuses re-checks a close against an acknowledged snapshot under the row lock (its ADR-0003).

## Considered options

1. **Fixed lock order: `tags:<ws>` advisory (create, rename, merge, delete) → tag rows `FOR UPDATE` (owner ops) or contact row `FOR NO KEY UPDATE` → member limit lock → tag row `FOR KEY SHARE` taken explicitly before the link insert (member adds) → writes; composite FKs `(workspace_id, contact_id)` / `(workspace_id, tag_id)` on `contact_tags`; the delete sends the shown count and is rolled back if `DELETE … RETURNING` returns a different number.**
2. **A per-tag version the client echoes on rename and delete.** Detects any change to the tag itself, but contact counts change through `contact_tags`, not the tag row, so a version would have to be raised on every add/remove (a hot row per popular tag) to catch the count change the spec is about.
3. **SERIALIZABLE transactions with retry** for all tag writes. Correct without explicit locks, but adds retry loops to every path, can fail owner ops on 10 000 rows repeatedly under member traffic, and diverges from the repo's READ COMMITTED + explicit lock convention.

## Decision outcome

**Chosen:** Option 1. The count the owner confirmed is exactly what the spec protects, and comparing the rows actually deleted is exact even with concurrent removals. Find-or-create under `tags:<ws>` plus the unique key gives one tag under a race and an exact 100 limit; the contact row lock gives an exact 20 limit; the explicit `FOR KEY SHARE` on the tag row (taken before the link insert, so before any unique-index entry exists that a merge's re-point could wait on) makes a racing add either land first (then removed or re-pointed with history) or fail as "no longer exists". Relying on the implicit FK check alone would deadlock a merge with an add of the target tag on the same contact.

## Consequences

**Positive**
- Cross-workspace links are impossible by constraint, not only by code.
- Deadlock-free by construction (SAD §8 Concurrency): owner paths never wait for contact rows.

**Negative**
- Tag creation in a workspace is serialised (short critical section; fine at pilot rates).
- During an owner op on a popular tag, members adding that tag wait up to the op's duration (≤ 2 s target).

**Neutral**
- A delete that raced a removal asks the owner again even if the difference is one contact; that is the spec's rule.

## Links

- Spec: [[../spec.md]] AC-08, AC-09, AC-12, AC-14, AC-15, §6
- SAD: [[../sad.md]] §4 choice 4, §6 flows 1–2, §8 Concurrency and Tenancy
- Related ADR: [[0002-identify-tags-by-a-stable-id-and-keep-them-unique-by-a-normalised-name-key-computed-in-the-domain]], [[0003-record-every-contact-tag-change-as-an-append-only-history-entry-with-the-tag-name-at-that-moment]]; assignment-statuses ADR-0003
