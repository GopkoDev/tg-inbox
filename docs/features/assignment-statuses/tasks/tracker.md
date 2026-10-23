# Tracker — assignment-statuses

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | [Promote the expand, backfill, activity-table and lens-index migrations 01–04, regenerate DB types and extend the test fixtures](./t01-promote-expand-migrations.md) | migration | Dmytro Hopko | M | — | done |
| T2 | [Add the assignment zod contracts, the four error codes and the activity item type on the live frame and the realtime signal](./t02-assignment-contracts.md) | ports | Dmytro Hopko | M | — | done |
| T3 | [Add the conversations domain change rules: no-op, stale and close-reason decision, snapshot equality, activity kinds and causes, position rule and the change-limit window](./t03-conversations-change-rules.md) | domain | Dmytro Hopko | S | — | done |
| T4 | [Extend the thread domain with the activity kind: merge order message < reply < activity and a three-kind cursor that still decodes old cursors](./t04-thread-activity-kind.md) | domain | Dmytro Hopko | S | — | done |
| T5 | [Give workspaces lockActiveMembers, activeMembers and the onMembershipDeactivated port called inside the deactivation transaction](./t05-workspaces-locks-and-port.md) | app | Dmytro Hopko | M | — | done |
| T6 | [Build the conversations persistence for state and activity: locked row read, versioned state update, activity repository and the close-reason reads](./t06-conversations-state-persistence.md) | infra | Dmytro Hopko | M | T1, T3 | done |
| T7 | [Add the changeAssignee and changeStatus use cases in conversations: version guard, close reasons against the snapshot, the per-member change limit, the write, the activity entry and its signal](./t07-conversations-change-use-cases.md) | app | Dmytro Hopko | M | T2, T6 | done |
| T8 | [Reopen a closed conversation on a newly captured customer message, raise the customer message counter under the row lock, and promote contract migration 05](./t08-capture-reopen-and-contract.md) | app | Dmytro Hopko | M | T1, T7 | done |
| T9 | [Reopen a closed conversation in settle() when a reply ends not delivered or not confirmed](./t09-settle-reopen.md) | app | Dmytro Hopko | S | T7 | done |
| T10 | [Unassign a deactivated member's conversations through the port inside the deactivation transaction, and build conversations before team in buildDeps](./t10-deactivation-unassign.md) | app | Dmytro Hopko | M | T5, T7 | done |
| T11 | [Teach the conversations read side lenses, per-row state and version, the summary's close snapshot, the thread's activity half and the single activity item](./t11-conversations-read-side.md) | infra | Dmytro Hopko | M | T4, T6 | done |
| T12 | [Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers](./t12-inbox-reads-for-state.md) | ports | Dmytro Hopko | M | T2, T5, T11 | done |
| T13 | [Add the assign and unassign routes: one transaction that share-locks the memberships, then changes the conversation, with every refusal of the contract](./t13-assign-unassign-routes.md) | ports | Dmytro Hopko | M | T7, T10, T12 | done |
| T14 | [Add the close and reopen routes with the close snapshot and confirm, and prove the change limit across all four change routes](./t14-close-reopen-routes.md) | ports | Dmytro Hopko | M | T13 | done |
| T15 | [Add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames](./t15-api-e2e-and-secrecy.md) | tests | Dmytro Hopko | M | T8, T9, T14 | done |
| T16 | [Teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames](./t16-web-store-lenses-and-state.md) | ui | Dmytro Hopko | M | T12 | done |
| T17 | [Build the SCR-01 lenses: status tabs and assignee select, the assignee line and closed mark on rows, per-lens empty states and live join and leave](./t17-scr01-lenses.md) | ui | Dmytro Hopko | M | T16 | done |
| T18 | [Build the SCR-02 actions bar (ConversationActions) and the activity line in the thread: status badge, assignee button, close and reopen, pending lock, limit countdown and live changes](./t18-scr02-actions-and-activity.md) | ui | Dmytro Hopko | M | T16 | done |
| T19 | [Build SCR-10, the assignee chooser: me first, active teammates, unassign, current check, per-row pending and the in-place not-active refusal](./t19-scr10-assignee-chooser.md) | ui | Dmytro Hopko | S | T18 | done |
| T20 | [Build SCR-11, the confirm-over-a-recent-change dialog: current state, who or what changed it and when, go ahead or leave it, asks again](./t20-scr11-state-changed-dialog.md) | ui | Dmytro Hopko | S | T19 | done |
| T21 | [Build SCR-12, the close confirmation: every close reason, close anyway with the refusal's version and snapshot, asks again](./t21-scr12-close-confirm-dialog.md) | ui | Dmytro Hopko | S | T18 | done |
| T22 | [Add the unassign sentence to the deactivate confirmation (SCR-14) and keep the lenses in the sign-in return address (SCR-09)](./t22-deactivate-copy-and-signin-return.md) | ui | Dmytro Hopko | S | T16 | done |
| T23 | [Add browser end-to-end assignment flows against the real API and the fake Bot API](./t23-browser-e2e.md) | tests | Dmytro Hopko | M | T15, T17, T20, T21, T22 | done |
| T24 | [Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components](./t24-docs-and-canon.md) | docs | Dmytro Hopko | S | T10, T14, T17, T20, T21, T22 | done |

**Total:** 24 tasks, ~20 person-days (S = ½ day, M = 1 day).
