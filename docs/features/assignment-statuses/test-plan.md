---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Implementing engineer", "Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
---

# Test plan — assignment-statuses

Every conversation of a workspace is open or closed and has at most one assignee, always an active member of that workspace, or none. Members assign, reassign, unassign, close and reopen from the thread. The list filters by status (open / closed) and assignee (all / mine / unassigned), and the chosen lenses live in the page address. Each change is written into the thread as an activity line and shown to the team live. A change made against a state the member has not seen, or a close over a waiting, unread or failed-reply customer, waits for confirmation, and the server checks it again when the change is recorded. A customer's new message, or a reply that ends "not delivered" / "not confirmed", reopens a closed conversation. Deactivating a member unassigns their conversations in the same step, and a member can make at most 60 changes per minute per workspace.

> **Assumptions (autonomous run 2026-10-18 — change any row by editing this file before `implement`):**
>
> - Levels were picked per AC with the default heuristic, the same as the shared-inbox plan: pure rule → unit; repository, use case or route against the database → integration; a shape both sides agree on → contract; a full user story → e2e; a screen state → component; a user-facing flow → e2e-through-UI. Where `tasks.json` already names a level for an AC (a task's DoD), the plan follows the task.
> - The **Task** column points at the `tasks.json` id that writes the test. `implement` writes each row's red test inside that task, so no row asks for a test outside the 24 tasks.
> - Visual-regression stays N/A, as in the earlier features' plans.
> - Load scenarios cover only the four latency NFRs. The integrity, single-assignee, deactivation and change-limit NFRs carry numbers too, but they are counts and invariants, so integration tests and integrity queries check them, not load.
> - AC-10 is checked in its revised form: a racing assignment to the member being deactivated is **refused** (deactivation committed first) or **undone by the deactivation** with its own activity line (assignment committed first). Both lock orders are tested, and the integrity query must find no assignment to a deactivated member after either one.
> - US-04 (end customer) has no web screen. Its browser coverage is the panel effect: the customer writes through the webhook and the row comes back (ux-flows §AC coverage).

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure rules in `conversations/domain`: the change decision (already in place before the version check, stale, close reasons with and without confirm, snapshot equality, member reopen without reasons), activity kinds / causes / assignee pairs, the position rule, the 60-per-60-s window and its retry time (T3). The thread merge with the third item kind, ties message < reply < activity, and old cursors still decoding (T4). Shared request / response / frame schemas, the four new error codes and their mapping (T2). App-layer use cases with in-memory port fakes: `changeAssignee` / `changeStatus` check order (T7), the inbox change-state check order (T13), settle reopen (T9), the deactivation port call (T5). The web lens parser (T16). | In-memory, no external dependency; time from a fake clock port; the workspaces port and the realtime publisher behind fakes. |
| Integration | Repositories, use cases and HTTP routes of `conversations`, `inbox`, `workspaces` and `bots` against a real database: the locked row read and versioned update (T6), the activity repository and close-reason reads (T6), the change use cases with concurrency (T7), capture reopen (T8), settle reopen (T9), the deactivation unassign (T10), lens queries and the thread's activity half (T11), the read and change routes (T12–T14), migrations 01–05 up and down (T1, T8). The realtime signal reaching a connected live socket (T7, T15). | An ephemeral real database container per suite with every migration applied, including the promoted 01–05. Routes go through the in-process HTTP entry point of `buildApp()`, the live socket through a real connection to the in-process server, and Telegram through the repo's scriptable fake Bot API. A controllable clock drives the change-limit window. Concurrency tests use real parallel connections and committed transactions. |
| Contract | (a) Every new or changed inbox response — list with lens echo, conversation summary with close snapshot, thread items with activity, the single activity item, active members, the four change routes and their refusals with `details` — against the shared schemas and `contracts/openapi.yaml` (T2, T12–T14). (b) The `conversation.changed` frame with `item.type = activity` and the realtime signal against `contracts/events.md`; the old frame enum rejects it (T2, T15). (c) The web client parses every new response with the same schemas (T16). | Validate real responses and frames from the integration suite against the agreed shapes; no hand-rolled stubs. |
| E2E | One API-level flow per user story: lenses and search (US-01), assign → reassign → unassign with a teammate's live socket (US-02), close with reasons → close anyway → member reopen (US-03), customer webhook reopen and failed-reply reopen (US-04), activity history (US-05), deactivation unassign (US-06), plus cross-workspace refusals (T15). | Multi-step scenario against an ephemeral database and the fake Bot API. Customer messages enter through the real webhook route, and each step uses only what an earlier step returned. The integrity queries run at the end of every flow. |
| Load | Spec §6 latency NFRs: change p95, live update p95, reopen-on-customer-message p95, list p95 per lens. | The load tool already in your repo, or e.g. k6 or Locust, run against a production-like host, not a CI runner. |
| Component | SCR-01 lens states (T17); SCR-02 actions bar, status badge and activity lines (T18); SCR-10 assignee chooser (T19); SCR-11 confirm over a recent change (T20); SCR-12 confirm close (T21); SCR-14 unassign sentence and the SCR-09 sign-in return with lenses (T22); the workspace-keyed inbox store with lenses in the address, state version and close snapshot, and activity frames (T16). Each state row of `screens.md` for these screens is one assertion. | Render in a component harness with a stubbed API client and a stubbed live socket; assert the rendered state, the request sent (incl. the version / snapshot it echoes) and the navigation it triggers. |
| Visual-regression | <!-- N/A: pilot-stage UI still changing; baselines would churn on every layout edit (same decision as shared-inbox, workspace-operators and bot-connection). --> | — |
| E2E-through-UI | The five browser flows of T23, taken from `ux-flows.md`: lenses in the address (US-01), live assign across two members (US-02), confirm over a recent change (US-02/US-03), close over a waiting customer (US-03), customer reopen (US-04 panel effect). | A real browser against the built panel served from the same origin as the API, with an ephemeral database and the fake Bot API. Conversations are seeded through the webhook route or the app layer, never through the UI under test. Two browser contexts stand for two members. |

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Task | Expected outcome |
|---|---|---|---|---|
| AC-01 happy | `default lens shows open conversations of every assignee newest activity first` | integration + contract | T11, T12 | 30 seeded conversations (mine, a teammate's, unassigned, closed) → open ones only, ordered by last activity, each row with status, assignee id and version |
| AC-01 happy | `mine, unassigned and closed lenses filter by assignee and status` | integration | T11, T12 | "mine" = open and assigned to the caller; "unassigned" = open with no assignee; "closed" × all / mine / unassigned = closed ones in that assignee lens, newest activity first |
| AC-01 happy | `assignee or status change never becomes a row's preview or time` | integration | T11 | After assign, close and reopen the row keeps its last message and time and its place in the order |
| AC-01 happy | `search sets the status lens aside within the assignee lens` | integration + component | T11, T17 | Matches of both statuses within the chosen assignee lens; closed rows marked "closed"; status tabs disabled while searching |
| AC-01 happy | `each lens says when it holds nothing` | component | T17 | Per-lens empty text for open · all, mine, unassigned, closed and search |
| AC-01 happy | `lenses live in the address and survive reload, back and a saved link` | unit + component + e2e-through-UI | T16, T17, T23 | Same lenses after a reload, the back button and a saved link; an unknown lens value is rewritten to the default |
| AC-01 happy | `switching workspace starts again at open · all` | component + e2e-through-UI | T16, T23 | The other workspace opens on open · all; no row of the first workspace shown, even briefly |
| AC-01 happy | `a late answer for a lens the member already left is dropped` | component | T16 | The list shows the current lens only |
| AC-01 happy | `business owner sees the lenses and makes changes exactly as an operator` | integration | T12, T13, T14 | Every read and change route answers an owner the same as an operator |
| AC-01 happy | `list lens timing on a 1 000-conversation workspace` | integration | T11 | Each lens (open · all / mine / unassigned, closed · each, search) within the list latency target on the seeded volume |
| AC-02 happy | `assign to self, assign to a teammate, reassign and unassign are recorded` | unit + integration + contract | T3, T7, T13 | Assignee changes, version goes up by one, one activity line of the right kind with the previous / new assignee, response matches the contract |
| AC-02 happy | `assigning does not count as activity` | integration | T7, T11 | Conversation keeps its place in the activity order; no unread change |
| AC-02 happy | `closed conversation can be assigned and unassigned and stays closed` | integration | T13 | Assignee changed, status still closed |
| AC-02 happy | `choosing the current assignee changes and records nothing` | unit + integration + component | T3, T13, T19 | Answered as unchanged; no version bump, no activity line, not counted against the limit; chooser sends nothing for the checked row |
| AC-02 happy | `assignment works in every bot state` | integration | T13, T14 | Assign, close and reopen are recorded with the bot connected, disconnected, needing a token or taken over |
| AC-02 happy | `a change reaches a teammate's open list and thread live` | integration + e2e + component + e2e-through-UI | T7, T15, T16, T17, T18, T23 | One activity signal published only on commit; a teammate's socket gets the frame; their row moves between "mine" and "unassigned"; the header shows the new assignee without reload |
| AC-02 happy | `a teammate reading the thread keeps it when its row leaves their lens` | component + e2e-through-UI | T17, T18, T23 | Thread stays open with the new assignee; only the row leaves their list |
| AC-02 happy | `thread records the assign, reassign and unassign lines` | component | T18 | "<member> assigned this to <assignee>", "<member> reassigned this from <previous> to <assignee>", "<member> unassigned this", each with its time |
| AC-03 invariant | `change against a state changed since the member looked is not applied` | unit + integration + contract | T3, T7, T13, T14 | Refused as state changed, returning the current assignee, status, who or what changed it and when; nothing written |
| AC-03 invariant | `confirming over the recent change applies it with the current version` | integration + component | T13, T20 | Go ahead resends with the refusal's version and is recorded; Leave it sends nothing and shows the current state |
| AC-03 invariant | `an automatic change counts as a change the member has not seen` | integration + component | T13, T20 | After a customer reopen or a deactivation unassign, an assign with the old version is refused; the dialog names the automatic cause |
| AC-03 invariant | `two concurrent changes with one version record exactly one` | integration | T7 | Two parallel assigns with the same version → one recorded, the other refused as state changed; integrity query finds no conversation with two assignees |
| AC-03 invariant | `asks again when the state changes once more before go ahead` | integration + component | T14, T20 | A second change between the dialog and go ahead → refused again with the newer state |
| AC-03 invariant | `a change already in the requested state does nothing` | unit + integration | T3, T13, T14 | Checked before the version: unchanged, no line, no refusal — even with an old version |
| AC-03 e2e | `two members look, one reassigns, the other is asked` | e2e-through-UI | T23 | The second member sees SCR-11; Leave it keeps the teammate's assignee, Go ahead takes it over |
| AC-04 error | `assigning to a deactivated member is refused` | integration + contract | T13 | Refused as assignee not active; nothing changes |
| AC-04 error | `assigning to an account of another workspace is refused` | integration | T13 | Refused the same way as a deactivated pick; no hint about the other workspace |
| AC-04 error | `the member list offers active members of this workspace only` | integration + component | T5, T12, T19 | Active members ordered by display name; deactivated members and other workspaces' accounts absent; "Me" first in the chooser |
| AC-04 error | `a refused pick re-reads the member list in place` | component | T19 | Not-active message shown in the chooser; list refreshed without the gone member |
| AC-04 error | `the database refuses an assignee who is not a member` | integration | T1 | Constraint violation for an assignee without a membership in the conversation's workspace |
| AC-05 happy | `close with no reason is recorded and the conversation leaves the open lenses` | unit + integration + component | T3, T14, T17, T18 | Closed with its assignee kept; "<member> closed this" line; row moves to "closed" for the team live |
| AC-05 happy | `closing does not count as activity or change unread counts` | integration | T14 | Activity order and every member's unread count unchanged |
| AC-05 happy | `any member reopens a closed conversation from the thread` | unit + integration + component | T3, T14, T18 | Reopened with the same assignee, no close reasons asked; "<member> reopened this"; back in the open lenses |
| AC-05 happy | `reopen of an open conversation and close of a closed one change nothing` | integration | T14 | Answered as unchanged; nothing recorded or counted |
| AC-06 invariant | `close over a waiting customer asks first` | unit + integration + contract + component | T3, T6, T14, T21 | Refused as needs confirmation with the waiting reason and the close snapshot; SCR-12 explains it |
| AC-06 invariant | `close over a customer message the closer has not read asks first` | integration + component | T6, T14, T21 | Reason names the newest unread message; a background tab never marks it read |
| AC-06 invariant | `close over a latest reply not delivered or not confirmed asks first` | integration + component | T6, T14, T21 | Reason names the failed reply state |
| AC-06 invariant | `close anyway with the returned snapshot closes` | integration + component | T14, T21 | Confirm with the refusal's version and snapshot → closed |
| AC-06 invariant | `a first close after a message the screen has not shown is refused` | integration | T7 | QG-1 (b2): refused with the new-message reason even without an earlier refusal |
| AC-06 invariant | `a customer message between the question and close anyway asks again` | integration + component | T8, T14, T21 | QG-1 (b): refused again because the customer message count grew, also when the arrival time is not later than before; the dialog shows the new reason |
| AC-06 invariant | `a failed reply between the question and close anyway asks again` | integration | T14 | Refused again with the reply reason |
| AC-06 invariant | `the client never decides close reasons itself` | component | T21 | Close always asks the server; the dialog shows only reasons the server returned |
| AC-06 invariant | `close and capture racing never leave a lost customer` | integration | T8 | QG-1 (c): close and a captured customer message run concurrently many times → the lost-customer integrity query returns no row |
| AC-06 e2e | `close over a waiting customer then close anyway` | e2e-through-UI | T23 | SCR-12 → Close anyway → the row appears under "closed" |
| AC-07 cross-context | `a new customer message reopens a closed conversation with its assignee` | integration + e2e | T8, T15 | Reopened in the capture transaction; same assignee; "reopened — the customer wrote" at the arrival time; message unread and waiting exactly as in an open conversation |
| AC-07 cross-context | `a customer reopen reaches every open inbox live` | integration + component + e2e-through-UI | T8, T15, T17, T23 | Signal on commit; the row returns to the open lenses for every member without reload |
| AC-07 cross-context | `a late redelivery reopens by its arrival and keeps its history place` | unit + integration | T3, T8 | The message keeps its earlier position; the reopened line sits at the arrival time |
| AC-07 cross-context | `a duplicate redelivery and an edit do not reopen` | integration | T8 | QG-1 (f): status stays closed, no activity line, no signal |
| AC-07 cross-context | `capture always writes the state columns after the contract migration` | integration | T8 | Migration 05 applies and reverts; every capture insert writes status, version and message count |
| AC-08 cross-context | `a reply that ends not delivered reopens a closed conversation` | unit + integration + e2e | T9, T15 | Reopened once with its assignee; "reopened — a reply was not delivered"; signal published |
| AC-08 cross-context | `a reply that ends not confirmed reopens a closed conversation` | integration | T9 | QG-1 (e): the stale in-flight resolution and the dead-letter resolution each reopen once |
| AC-08 cross-context | `a skipped reply reopens a closed conversation` | integration | T9 | A reply skipped as not delivered (author removed, bot stopped) reopens once |
| AC-08 cross-context | `a reply accepted by Telegram leaves the conversation closed` | integration | T9 | Status closed, no activity line |
| AC-08 cross-context | `a reply already final never reopens twice` | unit + integration | T9 | A second settle of the same reply changes nothing |
| AC-08 cross-context | `the waiting marker keeps its meaning` | integration | T11 | The marker still follows the last reply marked sent; a failed reply does not clear it |
| AC-09 happy | `activity lines merge into the thread at their position time` | unit + integration + contract | T4, T11, T12 | Three-kind page in history order with ties message < reply < activity; cursors across activity items; old message / reply cursors still decode |
| AC-09 happy | `each activity line names the member or the automatic cause` | component | T18 | Lines for every kind and cause: member name, "the customer wrote", "a reply was not delivered", "the assignee was deactivated", with the time; names shown as plain text |
| AC-09 happy | `activity lines are never sent to the customer and never unread` | integration | T11, T15 | Fake Bot API records no send for any change; unread counts unchanged |
| AC-09 happy | `activity lines appear live in a teammate's open thread` | integration + contract + component | T15, T16, T18 | Activity frame parses; the store fetches the single item and appends it; coalesced refetches |
| AC-09 happy | `the single activity item is readable by id` | integration + contract | T11, T12 | Returns the entry of this conversation; a foreign id is not found |
| AC-09 happy | `the activity table rejects invalid entries` | integration | T1 | Constraint violations for a wrong kind / cause pair, an automatic cause with an actor, or a missing assignee pair |
| AC-10 cross-context | `deactivation unassigns every conversation of that member in the workspace` | integration + e2e | T10, T15 | Open and closed ones become unassigned inside the deactivation transaction; one "unassigned — <member> was deactivated" line and one signal each; open ones appear under "unassigned" live |
| AC-10 cross-context | `deactivation calls the unassign port inside its transaction` | unit + integration | T5 | Called once; a throwing port rolls the deactivation back |
| AC-10 cross-context | `assign racing a deactivation is refused when the deactivation locks first` | integration | T13 | The assign is refused as assignee not active; nothing is assigned |
| AC-10 cross-context | `assign racing a deactivation is undone when the assign locks first` | integration | T13, T10 | The assign commits, then the deactivation clears it with its own activity line; the integrity query finds no assignment to a deactivated member |
| AC-10 cross-context | `another workspace of the same account keeps its assignee` | integration | T10 | The two-workspace fixture: only the deactivating workspace's assignments are cleared |
| AC-10 cross-context | `reactivation does not give conversations back` | integration | T10 | Still unassigned after reactivation |
| AC-10 cross-context | `deactivate confirmation says the member's conversations will be unassigned` | component | T22 | SCR-14 shows the unassign sentence with the name as plain text |
| AC-11 authorization | `member of another workspace gets not found on every read and change route` | integration | T12, T13, T14, T15 | List with lenses, summary, items, single activity, members, assign, unassign, close and reopen of "Acme Flowers" answer the same neutral not-found as an unknown workspace; nothing changes |
| AC-11 authorization | `a foreign or unknown conversation id gets not found` | integration | T12, T13, T14 | Same neutral not-found; no hint the conversation exists |
| AC-11 authorization | `deactivated member is refused with access removed on every route` | integration + component | T12, T13, T14 | Refused as access removed; the panel shows the access-removed landing |
| AC-11 authorization | `a caller deactivated under the lock is refused` | integration | T13 | Caller's membership share-locked first; a caller deactivated at that moment is refused and nothing changes |
| AC-11 authorization | `signed-out visitor is asked to sign in and returns to the same lenses` | integration + component | T12, T22 | Every route refuses as not signed in; after sign-in the same address and lenses open |
| AC-11 authorization | `every new repository method is scoped to its workspace` | integration | T5, T6, T11 | For each new method the two-workspace fixture proves it never reads or changes the other workspace's rows |
| AC-11 authorization | `live activity frames never reach another workspace` | integration + e2e | T15 | A socket of another workspace receives no frame for "Acme Flowers" changes |
| AC-12 error | `the 61st change within a minute is refused with when to continue` | unit + integration + contract + component | T3, T7, T14, T18 | Refused as change limit with the retry time; nothing changes; the actions bar shows a countdown |
| AC-12 error | `61 concurrent changes record at most 60` | integration | T7 | Under 61 parallel requests exactly 60 are recorded |
| AC-12 error | `the limit counts across all four change routes` | integration | T14 | Assign, unassign, close and reopen share one count; a reassignment counts once |
| AC-12 error | `refused, declined and already-in-place requests are not counted` | integration | T7, T14 | Stale refusals, close-needs-confirmation refusals and unchanged answers leave the count unchanged |
| AC-12 error | `the limit is per workspace` | integration | T7 | The same account at its limit in "Acme Flowers" can still change "Bolt Bikes" |
| AC-12 error | `automatic changes are never counted or refused` | integration | T8, T9, T10 | A customer reopen, a failed-reply reopen and a deactivation unassign go through with the member at the limit and do not add to the count |

**E2E-through-UI scope (five flows, T23, from `ux-flows.md`):** (1) open `closed · mine` from the address, reload, back, switch workspace → open · all (AC-01); (2) two members, A assigns to themself → B's list and open thread update live, B on "unassigned" loses the row and keeps the thread (AC-02); (3) A and B both look, B reassigns, A assigns → SCR-11 → Leave it / Go ahead (AC-03); (4) close over a waiting customer → SCR-12 → Close anyway → row under "closed" (AC-06); (5) the customer writes through the fake webhook → row back in open with the same assignee and "reopened — the customer wrote" (AC-07).

## Edge cases / error paths

- Unknown lens value in the address (`status=archived`, `assignee=someone`) → expected: rewritten to the default lens; no request with it reaches the server.
- Malformed lens value sent straight to the list route → expected: refused as invalid.
- Change request without a version, with a malformed version, or with a version from the future → expected: refused as invalid, or as state changed for a version that does not match; nothing written.
- Close anyway with a snapshot that does not match the current reasons → expected: refused again with the current reasons and snapshot.
- Close anyway sent with a reason list the server did not return → expected: the server decides from its own snapshot; the extra reasons are ignored.
- Assign with a malformed account id → expected: refused as invalid; nothing changes.
- Assign while the caller is the member being deactivated at that moment → expected: refused as access removed (caller share-lock), no assignment left.
- Change on a conversation of a disconnected or token-broken bot → expected: recorded normally (AC-02, every bot state).
- Thread cursor tampered with or from another conversation, including an activity cursor → expected: refused as invalid; no rows of another conversation.
- Cursor issued before the deploy (two kinds only) → expected: still decodes and pages correctly.
- Activity frame for an item that no longer parses or an unknown item type → expected: the frame is dropped and the store resyncs in the current lenses.
- Live socket reconnect during a change → expected: resync shows the current state; no row stuck in a lens it left.
- Two tabs of one member changing the same conversation → expected: the second is asked (state changed), the same as two members.
- Change-limit countdown reaching zero → expected: the actions come back without a reload.
- Network failure or server error on any change → expected: the actions bar shows the change-failed state with retry; the conversation keeps the state the server last confirmed.
- Member display name with markup or script, shown in the assignee label, chooser, dialogs and activity lines → expected: shown literally, never interpreted.
- Logs on the change, reopen and deactivation paths → expected: no bot token, no display name, no message or reply text; codes and ids only.
- Database unavailable during a change → expected: the change fails with the generic error and nothing is recorded or published (fail-closed).
- Rollback of migrations 05 → 01 on a database with assigned and closed conversations → expected: every `down` runs cleanly (data-model expand → backfill → contract).

**Cross-workspace isolation (spec §6.1, SAD QG-2):** every new or changed repository method in `conversations` and `workspaces` (`lockActiveMembers`, `activeMembers`, the locked row read, the versioned update, the activity repository, the close-reason reads, the lens queries, the deactivation unassign) gets its own integration test on the extended two-workspace fixture. Every read and change route gets a foreign-workspace and a foreign-conversation test (AC-11), and the assign route gets a foreign-account-as-assignee test (AC-04). No new controlled exception to the tenancy rule is added.

## NFR checks without load (integrity, limit, timing seeds)

- **Single assignee — 0 conversations with more than one assignee or with an assignee who is not an active member:** an integrity query (conversations whose assignee has no active membership in that workspace) runs after every concurrency test (T7, T10, T13) and at the end of every API e2e flow (T15). It must return no row. The single column plus the composite membership foreign key make "more than one assignee" impossible by construction, and the migration test proves that key (T1).
- **Deactivation unassign — 0 conversations assigned to a deactivated member at any moment:** the race test in both lock orders (T13), followed by the same integrity query; the port-in-transaction test (T5) proves there is no window between the two.
- **Lost customers — 0 closed conversations whose latest customer message arrived after the close:** an integrity query (closed conversations whose latest `closed` activity is older than their latest customer message arrival) runs after the close/capture race (T8, QG-1 c), after the settle tests (T9) and at the end of every API e2e flow (T15). It must return no row. The same query goes into the run book as the periodic reconciliation.
- **Change rate per member — ≤ 60 per rolling 60 s per member per workspace:** the 61st-change, 61-concurrent, cross-route, not-counted and per-workspace rows of AC-12 (T7, T14), with the window moved by the controllable clock, not by sleeping.
- **Change p95 ≤ 300 ms, list p95 ≤ 500 ms:** seeded integration timings in CI give an early warning before the load run. Each of the four change routes runs on a workspace with 1 000 conversations (T14), and each lens runs on the 1 000-conversation seed (T11, QG-3). They assert server time against the target with headroom for a shared CI runner.
- **Live update ≤ 3 s, reopen on customer message ≤ 3 s:** an integration test asserts that the signal for a member change, a customer reopen and a deactivation unassign reaches a connected teammate socket (T7, T8, T15). The server logs the time from commit to socket write for each signal.
- **Availability 99.5 % monthly:** verified by the uptime check on the health endpoint (monitoring), not by a test.

## Test data

- Seed strategy: the builders in `apps/api/src/test/fixtures/` extended per `data-model.md` §Test fixtures. `insertConversation` gains `status`, `assigneeAccountId`, `stateVersion` and `customerMessageSeq` (defaults open / none / 0 / 0, changed in T8 together with migration 05). `insertActivity` takes kind, cause, actor, the assignee pair and the position / created times. `twoWorkspacesWithInbox` is extended with one account that is a member of both workspaces, one assigned conversation and one activity entry per workspace; it is the base of every isolation test and of AC-10's other-workspace row. The existing `insertMembership`, `insertReply`, `insertReplyAttempt` and `insertReadMark` build the close reasons (waiting, unread past the watermark, failed latest reply). Synthetic ids, `Test User` and `@example.test` only.
- Volume seeds: 1 000 conversations spread over open / closed × mine / teammate / unassigned (about one third closed, one third unassigned), inserted in bulk once per suite for the lens and change timing tests; read-only.
- Customer messages and failed replies for e2e flows enter through the real webhook route and the delivery drain with the fake Bot API (a scripted "blocked", "unavailable past the window" or "hang past timeout" answer turns a reply "not delivered" / "not confirmed").
- Time: a controllable clock port for the 60-s change window and its retry time, the "how long ago" in refusals and stale in-flight detection. Tests never sleep, except where real socket delivery is the subject, and there with a bounded wait.
- Integration dependency: an ephemeral real database container per suite with all migrations applied — NOT a mocked store. Concurrency tests (two assigns, 61 changes, close/capture race, deactivation race) use separate pooled connections with committed transactions so the row and share locks really contend.
- Cleanup boundary: per-test. Every test truncates the feature's tables (conversations, activities, memberships and the rest of the inbox set, plus the queue's job tables) and resets the fake Bot API script. Volume seeds are per-suite and read-only. API e2e flows reset the database before each flow, and browser flows reset it and close every socket and browser context between flows. Container-backed suites remove their containers and data even on failure (CLAUDE.md §Tests).

## NFR validation (load)

- Assign / close / reopen p95 ≤ 300 ms server time → scenario: 20 members across 5 workspaces of 1 000 conversations each making a mix of assign, reassign, unassign, close (half with close anyway) and reopen at 10 changes/s in total (each member under its 60/min limit) for 5 min; assert p95 server time per change route ≤ 300 ms, zero server errors, and no row from either integrity query afterwards.
- Live update p95 ≤ 3 s → scenario: 50 connected sockets across the same 5 workspaces during the change mix above; assert p95 from commit to socket write ≤ 3 s and no frame delivered to another workspace.
- Reopen on customer message p95 ≤ 3 s → scenario: 5 customer messages/s through the webhook route into closed conversations for 5 min with 50 sockets connected; assert p95 from capture commit to the reopen frame on the socket ≤ 3 s, and no row from the lost-customer query.
- Inbox list p95 ≤ 500 ms server time → scenario: 20 list requests/s for 5 min spread evenly over the six lenses plus search on a workspace with 1 000 conversations, while the change mix runs at 2 changes/s; assert p95 server time ≤ 500 ms per lens and zero server errors.
- Tool: the load tool already in your repo, or e.g. k6 or Locust. Run on a production-like host before each release, not on a shared CI runner.
- Single assignee (0), deactivation unassign (0), lost customers (0) and the change rate (60 / 60 s) are covered by integration tests and integrity queries (section above), not by load. Availability is covered by monitoring.

## CI placement

- On every PR: unit, contract, component, integration (the CI runner already provides a container runtime for the ephemeral database) including the seeded timing assertions and integrity queries, and the API-level e2e flows with the extended token-secrecy suite (T15).
- On every PR, or nightly if PR time grows past budget: e2e-through-UI — the five browser flows of T23.
- Pre-release: the load scenarios on a production-like host, plus a manual two-browser check of AC-03 (concurrent change and confirmation) and AC-10 (deactivation while a teammate has the inbox open).
