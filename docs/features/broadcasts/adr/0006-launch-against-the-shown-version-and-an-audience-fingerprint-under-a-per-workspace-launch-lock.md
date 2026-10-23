---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0006 — Launch against the shown version and an audience fingerprint under a per-workspace launch lock

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

The launch accepts exactly the text and the set of reachable contacts the confirmation showed. If the text, the audience or the set changed since it opened, even with the same number, nothing is launched and the owner confirms again (AC-06). A double click or two owners launch once (AC-06). Only an active business owner launches, re-checked at the moment of the action (§6.1, AC-08). A workspace launches at most 10 in any 24 h, counting every confirmed launch (AC-09). A launch needs a working current bot, an audience of at most 10 000 and at least one reachable contact (AC-05, AC-09, AC-10). Spec §6: launch p95 ≤ 2 s for 10 000 recipients.

## Decision drivers

- AC-05, AC-06, AC-07, AC-08, AC-09, AC-10; spec §6 at most once, frozen recipients, launch p95
- Do not send 10 000 ids back and forth through the browser
- Existing patterns: the close snapshot (assignment-statuses), `lockActiveMembers`, advisory limit locks

## Considered options

1. **Version + fingerprint, one transaction.** The confirmation read returns the draft version, the breakdown and a fingerprint (SHA-256 over the sorted reachable contact ids). The launch transaction: memberships `FOR SHARE` (`workspaces.lockActiveMembers`, owner role) → advisory `broadcast-launches:<ws>` → broadcast row `FOR NO KEY UPDATE` (already launched → return it; not the shown version → 409 with the current draft) → bot readiness from `bots` (`connected`, its Telegram id) → the cap (launches since now − 24 h) → `contacts.reachableContacts` in the transaction (size, at least one, same fingerprint, else 409 with the current breakdown) → insert the recipients, freeze text, audience definition and Telegram bot id, status `sending` → enqueue the first send link → signal.
2. **Send the id list back.** The confirmation returns the reachable ids and the launch posts them; exact, but up to 10 000 ids (≈ 370 kB) per confirmation and a large request body, for the same guarantee.
3. **A pending launch snapshot.** Opening the confirmation freezes the reachable set into a short-lived pending row (10 minutes); confirming launches that row if the draft version is unchanged and every pending contact is still reachable. Exact and cheap at confirm time, but it writes up to 10 000 rows on every confirmation opened (and cancelled), and needs expiry cleanup.

## Decision outcome

**Chosen:** Option 1. The fingerprint proves "the same set" without shipping the set or writing a pending snapshot for every confirmation opened. Everything that decides the launch is re-read inside one transaction, behind the owner's share-locked membership (so a deactivation in flight serialises with it) and the per-workspace launch lock (so two launches of different drafts cannot both be the 10th). The broadcast row lock makes the second of two concurrent launches see `sending` and return the launched broadcast, so it launches once.

## Consequences

**Positive**
- The cap, the frozen set and the first send link commit together; a crash leaves either a draft or a launched broadcast with its link queued.
- Refusals are specific and carry what the owner needs to confirm again.

**Negative**
- The reachable set is computed twice (confirmation and launch); both are bounded by the 10 000 limit.
- The launch lock serialises launches of one workspace (rare by design).

**Neutral**
- The fingerprint changes when any reachable contact changes, including a block that would have been skipped at its turn anyway; the owner then confirms again.

## Links

- Spec: [[../spec.md]] AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, §6 launch, at most once, frozen recipients, launch cap
- SAD: [[../sad.md]] §4 choice 6, §6 flow 1, §8 lock order
- Related ADR: [[0004-evaluate-audiences-in-contacts-with-the-contacts-filter-rules-and-return-the-breakdown-and-the-reachable-set]], [[0007-send-through-a-per-workspace-pg-boss-chain-that-claims-each-recipient-before-its-send]]
