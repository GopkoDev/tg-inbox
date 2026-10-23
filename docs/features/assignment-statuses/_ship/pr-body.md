## Summary

Roadmap step 5: assignment and statuses. Every conversation in the shared inbox now has an assignee (or none) and an open/closed status; the team assigns, closes and reopens from the thread, closing warns about a waiting customer, a new customer message or a failed reply reopens a closed conversation, and deactivating a member unassigns their conversations. Spec: [`docs/features/assignment-statuses/spec.md`](docs/features/assignment-statuses/spec.md) · changelog: [`_ship/changelog.md`](docs/features/assignment-statuses/_ship/changelog.md).

## Acceptance criteria

- AC-01 — Open/Closed and All/Mine/Unassigned lenses in the address; rows show the assignee; changes never become a row's preview or time ✓
- AC-02 — assign, reassign, unassign from the thread; live for the whole team; one activity line per change ✓
- AC-03 — stale view: nothing changes until the operator confirms over the current state; two members at once = one recorded change ✓
- AC-04 — only active members of this workspace can be assignees; the chooser lists only them ✓
- AC-05 — close with nothing outstanding: leaves the open lenses, keeps the assignee, no unread change ✓
- AC-06 — close over a waiting customer / unread message / failed reply asks first, re-checked under the row lock ✓
- AC-07 — a newly captured customer message (also a late redelivery) reopens; edits do not ✓
- AC-08 — a reply ending not delivered / not confirmed reopens the conversation ✓
- AC-09 — every change is an activity line in the thread at its position time, live ✓
- AC-10 — deactivation unassigns all the member's conversations inside the deactivation; races refused or undone ✓
- AC-11 — non-members, deactivated and signed-out callers are refused (404 / access-removed / sign-in) ✓
- AC-12 — 60 recorded changes per minute per member per workspace; then refused with the retry time ✓

## Design

- Spec: `docs/features/assignment-statuses/spec.md` · UX: `ux-flows.md`, `screens.md`
- Architecture: `docs/features/assignment-statuses/sad.md`
- Decisions: `docs/features/assignment-statuses/adr/` (0001–0007)
- Data model + migrations: `docs/features/assignment-statuses/data-model.md` (migrations `1791681109993`–`1791681109997`)
- API: `docs/features/assignment-statuses/contracts/openapi.yaml` + `contracts/events.md`
- Review: `docs/features/assignment-statuses/_review/review-2026-10-19.md` — 4 parallel clean-context reviewers, 13 findings + 7 re-review findings, all fixed; final verdict **PASS**

## Stacked PR

This branch is based on `main` after PR #4 (shared-inbox). Later feature branches (operator-notifications, contacts) will stack on it.

## Tasks (SDD-Task trailers)

- `e369f7c` [T1] feat(assignment-statuses): promote the expand, backfill, activity-table and lens-index migrations 01–04, regenerate DB types and extend the test fixtures
- `c0a3a0a` [T2] feat(assignment-statuses): add the assignment zod contracts, the four error codes and the activity item type on the live frame and the realtime signal
- `46da508` [T3] feat(assignment-statuses): add the conversations domain change rules: no-op, stale and close-reason decision, snapshot equality, activity kinds and causes, position rule and the change-limit window
- `c730474` [T4] feat(assignment-statuses): extend the thread domain with the activity kind: merge order message < reply < activity and a three-kind cursor that still decodes old cursors
- `d683d26` [T5] feat(assignment-statuses): give workspaces lockActiveMembers, activeMembers and the onMembershipDeactivated port called inside the deactivation transaction
- `26ff043` [T6] feat(assignment-statuses): build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads
- `845c9cb` [T7] feat(assignment-statuses): add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal
- `afd7155` [T8] feat(assignment-statuses): reopen a closed conversation on a newly captured customer message, raise the customer message counter under the row lock, and promote contract migration 05
- `cacdfdc` [T9] feat(assignment-statuses): reopen a closed conversation in settle() when a reply ends not delivered or not confirmed
- `62ea2e7` [T10] feat(assignment-statuses): unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps
- `112df33` [T11] feat(assignment-statuses): teach the conversations read side lenses, per-row state and version, the summary's close snapshot, the thread's activity half and the single activity item
- `abb9248` [T12] feat(assignment-statuses): serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers
- `b3d68d2` [T13] feat(assignment-statuses): add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract
- `0b67d3b` [T14] feat(assignment-statuses): add the close and reopen routes with the close snapshot and confirm, and prove the change limit across all four change routes
- `23da5a3` [T15] test(assignment-statuses): add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames
- `d312dfa` [T16] feat(assignment-statuses): teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames
- `95bb7dc` [T17] feat(assignment-statuses): build the SCR-01 lenses: status tabs and assignee select, the assignee line and closed mark on rows, per-lens empty states and live join and leave
- `d34a73a` [T18] feat(assignment-statuses): build the SCR-02 actions bar (ConversationActions) and the activity line in the thread: status badge, assignee button, close and reopen, pending lock, limit countdown and live changes
- `babfb38` [T19] feat(assignment-statuses): build SCR-10, the assignee chooser: me first, active teammates, unassign, current check, per-row pending and the in-place not-active refusal
- `5cd5242` [T20] feat(assignment-statuses): build SCR-11, the confirm-over-a-recent-change dialog: current state, who or what changed it and when, go ahead or leave it, asks again
- `6fb6354` [T21] feat(assignment-statuses): build SCR-12, the close confirmation: every close reason, close anyway with the refusal's version and snapshot, asks again
- `381790c` [T22] feat(assignment-statuses): add the unassign sentence to the deactivate confirmation (SCR-14) and keep the lenses in the sign-in return address (SCR-09)
- `0cbaa35` [T23] test(assignment-statuses): add browser end-to-end assignment flows against the real API and the fake Bot API
- `d6d0db2` [T24] docs(assignment-statuses): update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components
- `7c8ab19` review(assignment-statuses): independent review — 13 findings, CHANGES REQUESTED
- `1b62ba1` [review B1 B2 B3 B4] fix(assignment-statuses): close the backend review findings B1–B4
- `5e70516` [review W1 W2 W3 W4 W5 W6 W7 W8 W9] fix(assignment-statuses): close the web review findings W1–W9
- `6a7ef9b` [review R1 R2 R3] fix(assignment-statuses): close the re-review regressions R1–R3
- `55d1564` [review RR1 RR2 RR3] fix(assignment-statuses): simplify live search results (re-review RR1–RR3)
- `7e590b3` [review RR-note] fix(assignment-statuses): a search resync keeps rows that arrived live after its read
- `04729b0` review(assignment-statuses): re-review rounds closed — PASS

## Verification

- Unit + integration (Testcontainers Postgres, real pg-boss, fake Bot API): `pnpm test` — 187 files, 2327 tests passed
- Lint + typecheck: `pnpm lint` clean
- Browser e2e: 24/24 passed, including 5 assignment flows in `apps/web/e2e/assignment.spec.ts`
- Review: PASS — 4 parallel reviewers, 13 findings + 7 re-review findings all fixed; record `docs/features/assignment-statuses/_review/review-2026-10-19.md`
- Not verified: a real Telegram bot — real-bot verification still needs a public HTTPS host (as for bot-connection).

## Operational notes

- Migrations: five reversible migrations (`1791681109993`–`1791681109997`) — run `pnpm db:migrate` before the new API starts. Rollback: revert the deploy, then `pnpm db:rollback` x5 (drops assignments, statuses and activity).
- Locking: the workspace row lock on deactivation is now `FOR NO KEY UPDATE`.
- Run-book integrity queries (architecture map): assignees who are not active members of the workspace; closed conversations with a later customer arrival than their latest `closed` activity — both expect 0 rows.
- Config / feature flag / new jobs: none.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
