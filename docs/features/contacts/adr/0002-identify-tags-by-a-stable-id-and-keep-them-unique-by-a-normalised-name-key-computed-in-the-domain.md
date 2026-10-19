---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 7 — contacts"
---

# 0002 — Identify tags by a stable id and keep them unique by a normalised name key computed in the domain

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

The spec requires that two names differing only in letter case (any alphabet) or spacing (any Unicode space, zero-width characters) are the same tag, that the tidied name is stored and shown with case as typed, that length counts graphemes (an emoji is one), and that a tag stays the same tag across renames: filters, pickers and saved links that chose it before still mean it (AC-02, AC-07, AC-08, AC-14, clarifications). The rule must hold under concurrent creation and be reproduced in the picker so "Create tag" is hidden for an existing name.

## Decision drivers

- Spec §6 tag uniqueness: 0 workspaces with two tags equal after normalising case and spacing, under concurrent creation.
- AC-02 / AC-14: renamed tags keep working in saved links and stale pickers; a re-created name is a new tag.
- `CLAUDE.md`: no triggers or stored procedures; UUIDv7 ids from the app.
- The picker must apply the same rule in the browser (shared zod/TS package exists).

## Considered options

1. **A stable UUIDv7 id per tag + a `name_key` column computed by one pure function (NFC, zero-width removed, white-space runs collapsed, trimmed, case-folded), unique `(workspace_id, name_key)`.** The same function lives in `packages/shared` for the picker.
2. **A case-insensitive ICU nondeterministic collation on `name` with a unique index**, after tidying spaces in the app. Case folding moves into the database, but spacing still needs the app, and the browser cannot reproduce the database collation exactly, so the picker and the server could disagree.
3. **The name as the identity** (`(workspace_id, name)` as key, references by name). Simple URLs, but a rename would have to rewrite every reference and saved links would break, contradicting AC-02 and AC-14.

## Decision outcome

**Chosen:** Option 1. One function decides "same tag" everywhere (server, picker, rename), the unique index enforces it under races, and the id makes renames cheap and links stable.

## Consequences

**Positive**
- Uniqueness is a constraint, not a check-then-insert.
- A rename is one row update; contact tags, filters and links follow automatically.

**Negative**
- Case folding by `toUpperCase().toLowerCase()` is an approximation of Unicode case folding; rare characters may fold differently from full CaseFolding.txt. Acceptable for pilot alphabets (Latin, Cyrillic).
- Changing the normalisation later needs a recompute of `name_key` and a merge of any new collisions.

**Neutral**
- Inner white-space runs collapse to one space, not to none, per the spec §1 clarification, so "V  I P" is "V I P", not "VIP" (spec AC-08 example to be aligned at review; SAD §1 override).
- Addresses carry tag ids rather than readable names.

## Links

- Spec: [[../spec.md]] AC-02, AC-07, AC-08, AC-14, §1 clarifications, §6
- SAD: [[../sad.md]] §4 choice 2, §8 Text normalisation
- Related ADR: [[0004-serialise-tag-writes-under-a-per-workspace-tag-lock-and-recheck-a-delete-against-the-confirmed-count]]
