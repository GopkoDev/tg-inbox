---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
target_surfaces: [backend-service, web-frontend]
---

# Software Architecture Document — assignment-statuses

## 1. Introduction and goals

**Intent.** assignment-statuses gives the shared inbox an owner and a done-state for every conversation. Each conversation is **open or closed** and has **at most one assignee** (an active member of its workspace) or none. Members assign, reassign, unassign, close and reopen from the thread. The list gets a status lens (open by default, or closed) and an assignee lens (all, mine, unassigned), and both are part of the page address. Each change is written into the thread as an activity entry at the time it happened, and the whole team sees it live. The design is built around one failure, **a customer silently lost in a closed conversation**. A customer's new message always reopens the conversation, and so does a reply that ends "not delivered" or "not confirmed". A close made over a waiting or unread customer message, or over a failed reply, has to be confirmed, and the server checks that condition again when it records the close. A change made against a state the member no longer sees is never applied silently. A deactivated member is never anyone's assignee, not even for a moment. Notifications to the assignee (roadmap step 6) build on this.

**Top-3 quality goals (1-liners; full scenarios in §10):**

1. **No lost customer, no silent overwrite.** No closed conversation ever has a customer message that arrived after the close. A member's change made over a state they had not seen, or over a waiting, unread or failed-reply condition, waits for their confirmation, and this holds even under concurrent changes.
2. **Ownership integrity under concurrency.** A conversation has at most one assignee, and that assignee is always an active member of its workspace. Deactivation unassigns in the same transaction. A racing assignment to the member being deactivated is refused or, if it committed first, cleared by the deactivation itself, so no assignment to a deactivated member ever exists. A member's changes are capped at the spec's rate.
3. **Live, responsive inbox.** Changes, including automatic reopens and unassigns, reach every open list and thread within the live-update target. Change requests and every list lens stay within the spec's latency targets at pilot scale.

**Stakeholders.**

| Role | Interest | Sign-off owner? |
|---|---|---|
| Operator | Sees who handles each conversation; filters by status and assignee; assigns, closes and reopens; reads each conversation's history of changes | No |
| Business owner | Has every operator right in the inbox; deactivating a member returns that member's conversations to the team | No |
| End customer | Their new message always reaches the team, even after a close; never sees assignment, status or activity | No |
| Tech Lead | SAD approval | Yes |
| Security Lead | Security review of the new member-driven state change and the new attributed personal data, i.e. who handles and who changed what (spec §6.1: review required) | Yes |

**Assumptions (autonomous run 2026-10-18)**, each can be vetoed at review:

- Depth = medium, size M and route `standard` (from `.size` / `.route`). The pipeline made every per-section decision itself, and each one is recorded in the section it belongs to.
- `docs/architecture-map.md` records `reflects_commit: b594915`, but its module rows already describe the shipped shared inbox. A fresh explorer scan of HEAD `ffcf639` confirmed the code facts used in this document (§3 brownfield note).
- Wire shapes in this SAD (request fields, error codes, the members read) show intent only. `api` fixes the names. Table and column names are indicative, and `data-model` fixes them.

**Decision overrides:**

- Decision override: an assignment racing a deactivation is either refused or cleared by the deactivation, not always refused. Rationale: an assignment that took its membership lock first commits before the deactivation. No database order can refuse an already committed change, so the deactivation unassigns it in its own transaction, with an activity entry. Spec AC-10 ("refused") and its §6 measurement are met in substance: no assignment to a deactivated member exists at any committed moment. The §10 test asserts both lock orders. Tracked in §11 for spec wording alignment at review. (Critic finding 4, autonomous run 2026-10-18.)

## 2. Constraints

**Technical.**
- TypeScript ~6.0 (strict) on Node.js 26 in a pnpm workspaces monorepo: repo [ADR-0001](../../adr/0001-use-a-typescript-pnpm-monorepo-on-node-26.md)
- Backend: Fastify 5 with `fastify-type-provider-zod` and zod 4, plus `@fastify/websocket` (the live socket `GET …/inbox/live` exists). pg-boss 12 runs on the main database. This feature adds no Telegram calls.
- Datastore: PostgreSQL 16 via Kysely 0.29, reversible migrations through kysely-ctl, types generated by kysely-codegen into `db.types.gen.ts`: repo [ADR-0004](../../adr/0004-use-postgres-with-kysely-reversible-migrations-and-workspace-scoped-tenancy.md). READ COMMITTED isolation is used throughout. Row locks and transaction-level advisory locks are the existing serialisation tools (`hashtextextended('<ws>:<account>', 0)` for the reply limit, `'drain:<ws>:<conv>'` for the drain).
- Architecture: a modular monolith with layers `domain → app → infra → http`, in one process: repo [ADR-0002](../../adr/0002-organize-the-backend-as-a-modular-monolith-with-layered-modules.md). Module dependencies are one-way: `inbox → {conversations, contacts, bots, workspaces}`, `bots → conversations → contacts`, `bots → contacts`. `workspaces` depends on no feature module. A module can pass a transaction across a boundary in two existing ways: conversations calls `contacts.upsertFromProfile(…, tx)`, and `team` receives `publish(tx, …)` from the composition root.
- Live updates: `platform/realtime` `publish(trx, signal)` sends a `pg_notify` inside the writing transaction (payload ids only, ≤ 1000 bytes, zod-validated). The `inbox` hub dispatches to the workspace's sockets, and the web store refetches through the reads: shared-inbox [ADR-0002](../shared-inbox/adr/0002-push-change-signals-over-a-per-tab-workspace-bound-websocket-and-refetch-through-the-reads.md), [ADR-0003](../shared-inbox/adr/0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction.md)
- Thread: messages by Telegram `sent_at` and replies by `position_at`, merged in memory with the cursor `(positionAt, kind, id)` (`conversations/domain/thread.ts`): shared-inbox [ADR-0008](../shared-inbox/adr/0008-store-replies-in-their-own-table-and-page-the-thread-by-position-time.md). The list is keyset-paged by `(last_activity_at, id)` newest first, with read state per member through `read_marks` and `memberships.active_since`: shared-inbox [ADR-0005](../shared-inbox/adr/0005-track-read-state-as-a-per-member-arrival-watermark-per-conversation.md)
- Frontend: a React 19 + Vite SPA with Tailwind + shadcn/ui, Zustand and React Router. The inbox route is `/w/:workspaceId/inbox/:conversationId?` and the store `features/inbox/store.ts` is keyed by workspace.

**Organisational.**
- Effort budget: size M, a separate epic of 5–15 PRs over 1–2 sprints (`.size`), route `standard`
- Deadline: none in the spec. Pilots with several operators start on the shipped inbox, and roadmap step 6 (notifications to the assignee) waits on this step.
- Team composition: not stated. The pipeline assumes one backend + frontend implementer working through `tasks.json`.

**Conventions.**
- [`CLAUDE.md`](../../../CLAUDE.md) and [`docs/architecture-map.md`](../../architecture-map.md) §Conventions are binding. Each module exposes `register<Module>(app, deps)`. Only `buildDeps()` constructs dependencies and only `buildApp()` registers modules. Imports flow inward. Other modules are reached only through their app layer, never through their tables.
- IDs are UUIDv7 from `newId()`, never DB defaults.
- Errors are `AppError` subclasses (`ConflictError`, `ValidationError`, `TooManyRequestsError`, …) with codes declared in `packages/shared/src/errors.ts`, returned in the single error envelope.
- Every tenant-owned table has a non-null `workspace_id`, and every repository method takes `workspaceId`. Each repository gets a cross-workspace isolation test. The five controlled tenancy exceptions stay five: this design adds none.
- No triggers or stored procedures. Constraints are welcome. Migrations are reversible: expand, then migrate, then contract.
- UI composes shadcn/ui primitives from `apps/web/src/shared/ui`, Tailwind only, per `docs/design-system.md` (desktop-first, usable at ≥ 360 px).

**Regulatory / external.**
- Data classification is confidential (spec §6.1). This is part of the private conversation record.
- New personal data: which member is assigned to which customer conversation, and who changed assignee or status and when (attributed to the member's account). No new end-customer data.
- Retention: activity entries are kept as long as the conversation, like messages and replies. Removal is by hand on request (§11).
- No compliance regime is named. A security review is required before release (spec §6.1).

## 3. Context and scope

tg-inbox is a shared Telegram inbox for small businesses. With shared-inbox, a workspace's team reads and answers its customers from one web inbox. This feature adds ownership and a done-state to that inbox. It reacts to two existing inbound events: a customer message captured from the business bot's webhook, and a reply's delivery outcome from the drain. It also reacts to one team event, a business owner deactivating a member. The trust boundary is unchanged. Everything reaching the browser is scoped to one active membership. Activity entries and assignee names are rendered as plain text and never sent to Telegram. The feature adds no external system and no new outbound Telegram call.

<!-- brownfield: HEAD ffcf639 (explorer scan, 2026-10-18) — modules auth, workspaces, bots, conversations (capture in one transaction that publishes `conversation.changed`; replies + attempts + read marks; list keyset on (last_activity_at, id); thread merge of messages + replies by (positionAt, kind, id)), capture upserts the conversation with ON CONFLICT DO NOTHING plus a plain read and first locks the row in the raiseReceived UPDATE after the message insert; every failed reply outcome passes settle() in conversations/app/replies.ts; contacts, inbox (routes under /workspaces/:workspaceId/inbox, live hub, drain via createDeliver, reply limit under pg_advisory_xact_lock(hashtextextended('<ws>:<account>'))); workspaces.deactivateMembership runs in a KyselyUnitOfWork transaction that locks the workspace row FOR UPDATE, reads the membership plainly, UPDATEs its state and publishes `membership.deactivated`, with no hook into other modules; conversations has no status/assignee column; the signal schema's item types are message|reply and its change enum is closed -->

**External systems (in / out):**

| Actor or system | Type | Interaction |
|---|---|---|
| Operator | Person | Filters the list by status and assignee; assigns, reassigns, unassigns, closes and reopens from the thread; reads activity entries; receives changes live |
| Business owner | Person | Everything an operator does, plus deactivating a member in Settings — Team (existing), which now also unassigns |
| End customer | Person | Writes to the business bot. A new message reopens a closed conversation. Never sees tg-inbox. |
| Telegram Bot API | System (external) | In: pushes customer messages to the bot's webhook (unchanged), and a captured new message may now reopen. Out: `sendMessage` for replies (unchanged), and a failed outcome may now reopen. |

**C4 Context (L1):**

```mermaid
C4Context
    title assignment-statuses — System Context

    Person(operator, "Operator", "Takes, hands over, closes and reopens conversations")
    Person(owner, "Business owner", "Does what an operator does and deactivates members")
    Person(customer, "End customer", "Writes to the business bot in Telegram")

    System(tginbox, "tg-inbox", "Shared inbox with assignee, open or closed status and activity history")

    System_Ext(telegram, "Telegram Bot API", "Webhook delivery of customer messages, sendMessage for replies")

    Rel(operator, tginbox, "Filters, assigns, closes, reopens; receives live changes", "HTTPS, WebSocket")
    Rel(owner, tginbox, "Same as an operator; deactivates members", "HTTPS, WebSocket")
    Rel(customer, telegram, "Writes to the business bot", "Telegram app")
    Rel(telegram, tginbox, "Pushes customer messages that may reopen", "HTTPS webhook")
    Rel(tginbox, telegram, "Sends replies whose failure may reopen", "HTTPS Bot API")
```

## 4. Solution strategy

**Target surfaces:** `backend-service` and `web-frontend`. The backend gets new change routes and list lenses in the existing `inbox` module, new state and activity entries in `conversations`, and a deactivation hook in `workspaces`. The frontend extends the existing SPA inbox: lenses in the address, the assignee chooser, two confirmations and activity lines. End customers act only in Telegram (US-04 has no screen, per `ux-flows.md`). No worker surface is added, because reopen and unassign run inside existing transactions and no new job is needed. This follows shared-inbox's surface split. It is recorded with the data-placement decision in [ADR-0001](adr/0001-store-assignee-status-and-activity-in-the-conversations-module-and-serve-them-through-inbox-routes.md).

**UI architecture (web-frontend):** client-side SPA, already fixed by repo ADR-0001. The route stays `/w/:workspaceId/inbox/:conversationId?`, so no new UI ADR is needed.
- **Lenses:** the two lenses are URL search parameters (`status=open|closed`, `assignee=all|mine|unassigned`, defaults omitted). Reload, back and saved links therefore reopen the same lenses (AC-01). The workspace switcher navigates to a new path without them, which resets to open · all.
- **Store:** `features/inbox/store.ts` (keyed by workspace) holds the lens. For each list row it keeps the row's status and assignee. For the open conversation it keeps the **state version** it last rendered (§4 choice 2) and the **close snapshot**, i.e. the one it rendered or the one from the last close refusal (§4 choice 3).
- **Live changes:** a live activity signal refetches the row, the conversation summary (header and version) and the activity item. The store then re-evaluates whether the row still belongs to the current lens, so it inserts, keeps or drops the row (AC-02: an open thread stays open).
- **Components:** the assignee chooser (SCR-10) is a shadcn popover/command list over the thread. The two confirmations (SCR-11, SCR-12) are shadcn `Dialog`s, like shared-inbox's SCR-04/05. `screens` picks the primitives.

**Top strategic choices (the seeds for ADRs):**

1. **The conversations module owns assignee, status, state version and activity entries, and the inbox serves them.** These three are added beside the conversation they describe. `conversations` already writes that conversation in both automatic paths, capture and reply outcome, and already serves the list and the thread. Status and assignee filters therefore stay single-module queries, and the reopen happens in the transaction that already exists. `inbox` owns the change routes and orchestrates the membership checks from `workspaces`. No new module and no new dependency edge (goals 1 and 2): [ADR-0001](adr/0001-store-assignee-status-and-activity-in-the-conversations-module-and-serve-them-through-inbox-routes.md).
2. **Optimistic concurrency through a per-conversation state version echoed by the client (AC-03).** Every change of assignee or status, by a member or automatic, raises an integer version on the conversation in the same row update. Every read the screen draws from returns that version. Each member change carries the version the member last saw, and the server compares it under a `FOR UPDATE` lock on the conversation row:
   - If the conversation is already in the requested state, nothing happens and nothing is recorded.
   - If the version differs, the request is refused with `CONVERSATION_STATE_CHANGED`. The refusal carries the current assignee, the status, the latest activity entry (who or what cause, when) and the current version. "Go ahead" repeats the request with that version, so a third change in between asks again.

   Two concurrent changes serialise on the row lock: the second one sees a newer version and is asked (goal 1): [ADR-0002](adr/0002-guard-member-changes-with-a-per-conversation-state-version-the-client-echoes.md).
3. **The close is decided at record time against a close snapshot the client sends back (AC-06, AC-08).**
   - **The counter.** The conversation carries a **customer message counter**. Capture raises it, under the conversation row lock, for every newly captured customer message. Unlike arrival timestamps, which are taken before the transaction, this counter follows commit order.
   - **The snapshot.** The **close snapshot** is that counter plus the id and state of the latest reply. Every read the header draws from returns it, together with the state version. A close always sends the version and the snapshot the screen shows, plus `confirm` after a refusal.
   - **The rule.** Under the row lock, the server evaluates the reasons:
     - the customer is waiting for a reply;
     - this member has an unread customer message, i.e. one that arrived after the later of their arrival watermark and their active-since;
     - a customer message was recorded after the snapshot the screen shows (the counter grew);
     - the latest reply is "not delivered" or "not confirmed".

     The close is recorded if the version matches and either no reason holds, or `confirm` is set and the current snapshot equals the one sent. Otherwise it is refused with `CLOSE_NEEDS_CONFIRMATION`. The refusal carries every reason, the stale change if there is one, and the current snapshot and version; "close anyway" resends those with `confirm`.
   - **The result.** A customer message or a failed reply recorded between the question and the close changes the snapshot, so the close asks again. Capture takes the same row lock before it decides anything, so either the close sees the message, or the message reopens the close (goal 1): [ADR-0003](adr/0003-recheck-close-reasons-under-the-conversation-row-lock-against-an-acknowledged-close-snapshot.md).
4. **Automatic reopen happens inside the transactions that already record the cause.**
   - **Capture.** `conversations.captureInbound` inserts the message and raises the conversation's arrival in one transaction. Today its upsert is `ON CONFLICT DO NOTHING` plus a plain read, which takes no lock. The raise is an `UPDATE`, and it now also raises the customer message counter. That `UPDATE` **returns the status and assignee under its row lock**, and capture decides on that locked result, never on the earlier read. When the message is newly captured (not a duplicate, not an edit) and the status is closed, the same transaction:
     - reopens the conversation and keeps the assignee;
     - raises the version;
     - inserts the activity entry "reopened — the customer wrote";
     - publishes the signal.
   - **Reply outcomes.** Every reply that becomes "not delivered" or "not confirmed" goes through `settle()` in `conversations/app/replies.ts`. That covers `finishAttempt`, `skipReply`, the stale in-flight resolution `resolveStaleInFlight` and the dead-letter resolution. `settle()` is therefore the single reopen point for failed replies: in a closed conversation it reopens the same way, with the activity entry "reopened — a reply was not delivered".
   - **The guarantee.** The NFR "0 closed conversations whose latest customer message arrived after the close" holds by construction, with no job lag (goals 1 and 3): [ADR-0004](adr/0004-reopen-closed-conversations-inside-the-capture-and-reply-outcome-transactions.md).
5. **Deactivation unassigns through a port that `workspaces` calls inside its own transaction, and member changes share-lock the memberships they rely on (AC-10, AC-04).**
   - `workspaces` declares a port `onMembershipDeactivated(tx, { workspaceId, accountId, at })`. `buildDeps()` wires it to `conversations.unassignDeactivatedMember`, which in the same transaction unassigns every conversation of that workspace assigned to the account, raises each version, records "unassigned — <member> was deactivated" and publishes one signal per conversation. `workspaces` imports nothing from `conversations`, so the dependency direction holds.
   - A member change locks the actor's membership, and for an assignment the target's membership, `FOR SHARE` through `workspaces.lockActiveMembers(tx, workspaceId, accountIds)`, before it locks the conversation.
   - A deactivation, as today, locks the workspace row (`workspaces.lockForUpdate`) and then `UPDATE`s the membership's state. That `UPDATE`'s row lock conflicts with `FOR SHARE`, so the two serialise.
   - A concurrent assignment that serialises after the deactivation is refused. One that took its share lock first commits first and is then unassigned by the deactivation's port in the same transaction. Either way no assignment to a deactivated member ever exists. See the §1 decision override (goal 2): [ADR-0005](adr/0005-unassign-on-deactivation-through-a-workspaces-port-called-inside-the-deactivation-transaction.md).

**Supporting choices:**

- **Activity entries have their own table and become the thread's third branch (AC-09).** An entry records the kind (assigned / reassigned / unassigned / closed / reopened) and the cause (a member, the customer wrote, a reply was not delivered, the member was deactivated). It also records the actor account (null for automatic changes), the previous and new assignee, and the position time. The position time is when the change happened: the server clock read **after** the conversation row lock is taken, and never earlier than the conversation's latest activity entry. A customer reopen therefore sits at the moment its capture is recorded (its arrival, AC-07), and never before the close it undoes. The thread page adds a keyset half over activity entries and merges three halves with the existing cursor, extended with the kind `activity`; at equal positions the order is message < reply < activity. Activity entries never count as unread, never move last activity and are never sent to Telegram. This is an ADR: [ADR-0006](adr/0006-store-activity-entries-in-their-own-table-and-merge-them-into-the-thread-by-position-time.md).
- **The live signal is an activity item on `conversation.changed`.** Every change is exactly one new activity entry, so the existing frame gains item type `activity` (change `created`). There is no new signal type. The client refetches the row, the summary and the item. Automatic changes publish the same item. One signal per conversation, including each conversation a deactivation unassigns, stays under the 1000-byte payload. This is an ADR: [ADR-0007](adr/0007-signal-assignment-and-status-changes-as-activity-items-on-conversation-changed.md).
- **Per-member change limit (AC-12), inline.** The limit is 60 recorded changes per rolling 60 s per member per workspace. It is counted from the activity entries with that actor in that workspace, which is the reply-limit precedent (count the log under an advisory lock). The count runs under `pg_advisory_xact_lock(hashtextextended('changes:<ws>:<account>', 0))`. The `changes:` prefix keeps it apart from the reply limit's `<ws>:<account>` key. The lock is taken and the count run after the conversation row lock and after the no-op, stale and close checks, just before the write, so refused, declined and already-in-place requests never count, and a reassignment is one entry. Automatic entries have no actor, so they are never counted and never refused. The refusal is `TooManyRequestsError` with the code `CHANGE_LIMIT_REACHED` and the time the oldest counted change leaves the window. Below the ADR gate: it reuses a decided pattern inside one module.
- **List lenses, inline.** `conversations.listPage` gains `status` (open / closed, ignored while a search query is present) and `assignee` (all / mine = the caller / unassigned) filters, and each row returns its status, assignee account id and state version. Assignee names come from `workspaces` display names, as reply authors' names already do. New B-tree indexes lead with `(workspace_id, status, last_activity_at DESC, id DESC)` and `(workspace_id, assignee_account_id, status, last_activity_at DESC, id DESC)`. The second index also serves "unassigned" (`IS NULL`) and the deactivation unassign. The existing `(workspace_id, last_activity_at, id)` index stays for search across statuses. `data-model` fixes and verifies the indexes.
- **Assignee choices (AC-04).** A new inbox read returns the active members of the workspace (account id, display name) to any member, for SCR-10. A pick that is not an active member of this workspace is refused with `ASSIGNEE_NOT_ACTIVE`, and that includes an account of another workspace, so the refusal gives no hint about other workspaces. The same refusal covers a member deactivated between the list loading and the pick.
- **Persistence:** the single PostgreSQL 16 store. No cache, no new datastore, no new queue.

Each later tactical decision traces to one of these. Contradictions go to §11.

## 5. Building block view

The backend keeps the modular monolith (`domain → app → infra → http`) and adds no module ([ADR-0001](adr/0001-store-assignee-status-and-activity-in-the-conversations-module-and-serve-them-through-inbox-routes.md)). The pieces divide up as follows:
- **`conversations`** gains the state (status, assignee, state version) and the activity table, the change rules in its domain, and the change, reopen and unassign use cases. Its list and thread queries learn lenses and the third thread branch.
- **`inbox`** owns the new HTTP routes and orchestrates each member change in one transaction: it share-locks memberships through `workspaces`, then calls the `conversations` change use case.
- **`workspaces`** gains `lockActiveMembers` and the `onMembershipDeactivated` port. That port is an interface that `workspaces` declares and `buildDeps()` fills, so no import edge appears.

The graph stays acyclic: `inbox → {conversations, contacts, bots, workspaces}`, `bots → conversations → contacts`, `bots → contacts`. `workspaces` and `conversations` still do not import each other. This changes the construction order in `buildDeps()`: `contacts` and `conversations` are now built before `team`, so `team` can receive the port.

**Table ownership** (names indicative, `data-model` fixes them):

| Module | Tables (new or changed) | Tenancy |
|---|---|---|
| `conversations` | `conversations` **+** `status` (open / closed, not null, existing rows backfilled `open`), `assignee_account_id` (nullable, composite FK `(workspace_id, assignee_account_id)` → `memberships (workspace_id, account_id)`, a cross-module constraint only), `state_version` (integer, not null), `customer_message_seq` (integer, not null, raised by capture under the row lock and backfilled from the message count); **`conversation_activities`**: id, workspace_id, conversation_id, kind, cause, actor account (nullable), previous assignee, new assignee, position time | Tenant-owned, non-null `workspace_id`. Every new repository method takes `workspaceId` |
| `workspaces` | none (reads and locks `memberships` by workspace id + account ids) | unchanged |
| `inbox`, `bots`, `contacts` | none | — |

There is no new controlled tenancy exception. The deactivation unassign is scoped by the deactivated membership's workspace id, and every lock and read takes the workspace id from the URL or from the membership.

**Cross-module app-layer calls (new or changed):**

- `inbox` → `workspaces`:
  - `lockActiveMembers(tx, workspaceId, accountIds)`, which takes `FOR SHARE` and returns the accounts that are active;
  - `activeMembers(workspaceId)`, for the chooser;
  - display names (existing), for assignee and actor names.
- `inbox` → `conversations`:
  - `changeAssignee(tx, …)` and `changeStatus(tx, …)` (version guard, close reasons and snapshot, change limit, write, activity, signal);
  - `listPage` with lenses;
  - the summary with state and version;
  - the thread page with activity items;
  - `activityItem`.
- `workspaces` → (port, wired in `buildDeps()`) `conversations.unassignDeactivatedMember(tx, { workspaceId, accountId, at })`.
- `bots` → `conversations.captureInbound` (existing) now reopens. Every failed reply outcome passes `settle()` in `conversations/app/replies.ts`. That includes the drain's `finishAttempt` / `skipReply`, `resolveStaleInFlight` and the dead-letter handler, and `settle()` now reopens.

**Internal decomposition:**

```
apps/api/src/
├── modules/conversations/
│   ├── domain/       + conversation state (open/closed, assignee, version), change rules (no-op,
│   │                   stale, close reasons, snapshot equality), activity kinds/causes,
│   │                   thread kind order message < reply < activity, change-limit constants (60 / 60 s)
│   ├── app/          + change assignee, change status, reopen on capture / on failed reply,
│   │                   unassign deactivated member; list lenses; thread activity half; activity item
│   └── infra/        + activity repository (insert, latest per conversation, count by actor over 60 s),
│                       conversation state update (lock row, compare version, raise version),
│                       list/thread query changes, signal for activity items
├── modules/inbox/
│   ├── app/          + assign / unassign / close / reopen orchestration in one transaction,
│   │                   active-members read; ports: workspaces.lockActiveMembers, conversations
│   └── http/         + change routes and the members read under /workspaces/:workspaceId/inbox/…,
│                       list lens query parameters, activity item read
├── modules/workspaces/
│   └── app/          + lockActiveMembers, activeMembers; team.deactivateMembership calls the
│                       onMembershipDeactivated port inside its unit of work
├── platform/realtime.ts   conversation.changed item type + 'activity'
└── deps.ts               conversations built before team; port wiring
apps/web/src/features/inbox/
│   store.ts (lens, state version, close snapshot, lens membership on live change), api-source.ts,
│   list lens controls, row assignee / closed mark, thread header state + actions,
│   assignee chooser (SCR-10), change-confirm (SCR-11) and close-confirm (SCR-12) dialogs, activity line
packages/shared/src/  inbox.ts — lens query, row/summary state + version, change requests,
                      activity item, close snapshot, LiveFrame item 'activity';
                      errors.ts — CONVERSATION_STATE_CHANGED, CLOSE_NEEDS_CONFIRMATION,
                      ASSIGNEE_NOT_ACTIVE, CHANGE_LIMIT_REACHED (names fixed by `api`)
```

**C4 Container (L2):**

```mermaid
C4Container
    title assignment-statuses — Containers

    Person(member, "Operator or Business owner")
    Person(customer, "End customer")

    Container_Boundary(tginbox, "tg-inbox") {
        Container(spa, "Web panel", "React 19, Vite, Zustand, shadcn/ui", "Lenses in the address, assignee chooser, confirmations, activity lines")
        Container(http, "API server", "Node 26, Fastify 5, zod, websocket, pg-boss", "Inbox change routes, list lenses, live socket, webhook ingress, drain worker")
        Container(inbox, "inbox module", "TypeScript", "Orchestrates member changes in one transaction, members read, hub")
        Container(ws, "workspaces module", "TypeScript", "Guard, active-member locks, deactivation with its unassign port")
        Container(conv, "conversations module", "TypeScript", "Status, assignee, state version, activity entries, capture and reply outcomes")
        Container(bots, "bots module", "TypeScript, grammY", "Webhook capture, sendText")
        Container(rt, "realtime platform service", "TypeScript, pg", "Publishes signals in transactions, listens on one connection")
    }

    ContainerDb(db, "Database", "PostgreSQL 16", "Conversations with state, activity entries, memberships, pg-boss jobs")
    System_Ext(telegram, "Telegram Bot API", "Webhook delivery, sendMessage")

    Rel(member, spa, "Filters, assigns, closes, reopens", "HTTPS")
    Rel(customer, telegram, "Writes to the business bot", "Telegram app")
    Rel(spa, http, "Lens reads, change requests with the seen version", "JSON over HTTPS, same origin")
    Rel(http, spa, "Pushes activity signals", "WebSocket")
    Rel(telegram, http, "Pushes customer messages", "HTTPS webhook")
    Rel(http, inbox, "Inbox requests, drain jobs")
    Rel(inbox, ws, "Locks active memberships, lists active members, names")
    Rel(inbox, conv, "Changes state, lists with lenses, threads with activity")
    Rel(ws, conv, "Unassigns a deactivated member through the port, same transaction")
    Rel(bots, conv, "Captures messages, which may reopen")
    Rel(bots, telegram, "sendMessage", "HTTPS Bot API")
    Rel(conv, rt, "Publishes activity signals inside the transaction")
    Rel(rt, inbox, "Delivers signals to the hub")
    Rel(conv, db, "Reads and writes", "SQL via Kysely")
    Rel(ws, db, "Locks and updates memberships", "SQL via Kysely")
    Rel(rt, db, "NOTIFY in transactions, LISTEN on a dedicated connection", "pg")
```

The module boxes are logical containers inside the one API process. The precedent is shared-inbox §5: the deployable surfaces are only the web panel and the API server. The `ws → conv` relation is a runtime call through a port that `workspaces` declares and the composition root fills. It is not an import, so the static dependency graph keeps `workspaces` independent of `conversations`.

## 6. Runtime view

These are the seeded critical flows. The `sequences` stage extends this section until every spec §5 AC maps to a flow or a branch. Participants are the §5 containers.

**Critical flow 1: A member changes assignee or status against the state they saw (US-02, US-03 — AC-02, AC-03, AC-04, AC-05, AC-06, AC-11, AC-12)**

```mermaid
sequenceDiagram
    actor Member as Operator or Business owner
    participant Web as Web panel
    participant Http as API server
    participant Inbox as inbox module
    participant Ws as workspaces module
    participant Conv as conversations module
    participant Rt as realtime platform service
    Member->>Web: assigns, unassigns, closes or reopens in the thread
    Web->>Http: change request with the state version on screen and, for a close, the close snapshot on screen
    Http->>Ws: guard, the caller is an active member of this workspace
    Http->>Inbox: change as this member
    Inbox->>Inbox: open one transaction
    Inbox->>Ws: share-lock the memberships of the caller and of the chosen assignee
    alt chosen assignee not an active member of this workspace
        Ws-->>Inbox: not active
        Inbox-->>Web: refused, assignee not active, nothing changed
    else memberships active
        Inbox->>Conv: change state with the seen version
        Conv->>Conv: lock the conversation row
        alt already in the requested state
            Conv-->>Inbox: unchanged, nothing recorded
        else version differs and the request is not a close
            Conv-->>Inbox: refused, state changed, with current state, latest activity and version
        else close with a stale version, or a close reason holds without confirm or with a snapshot unlike the one sent
            Conv-->>Inbox: refused, close needs confirmation, with every reason and the current snapshot
        else 60 recorded changes by this member in the last 60 s
            Conv-->>Inbox: refused, change limit, with the time changes resume
        else allowed
            Conv->>Conv: write status or assignee, raise the version, insert the activity entry
            Conv->>Rt: signal activity item created, inside the transaction
            Conv-->>Inbox: new state and version
        end
        Inbox-->>Web: result or refusal, transaction committed
    end
    Web-->>Member: new state, or the confirmation dialog, or the reason in place
    Rt-->>Inbox: signal after commit
    Inbox-->>Web: change signal to every open tab of the workspace
    Web->>Http: refetch the row, the summary and the activity item
```

**Critical flow 2: A customer message or a failed reply reopens a closed conversation (US-04 — AC-07, AC-08, AC-06)**

```mermaid
sequenceDiagram
    actor Customer as End customer
    participant Tg as Telegram Bot API
    participant Http as API server
    participant Bots as bots module
    participant Conv as conversations module
    participant Inbox as inbox module
    participant Rt as realtime platform service
    Customer->>Tg: writes to the business bot
    Tg->>Http: webhook update
    Http->>Bots: accept update with the per-bot secret
    Bots->>Conv: capture inbound message
    Conv->>Conv: one transaction, upsert contact and conversation without a lock
    Conv->>Conv: insert the message once
    Conv->>Conv: raise arrival and the customer message counter, which locks the row and returns status and assignee
    alt duplicate redelivery or an edit
        Conv-->>Bots: nothing moves, the status stays
    else newly captured and the conversation is closed
        Conv->>Conv: raise arrival, set open, keep the assignee, raise the version
        Conv->>Conv: insert activity entry reopened, the customer wrote, at the arrival time
        Conv->>Rt: signal message created and activity item created, inside the transaction
    else newly captured and open
        Conv->>Rt: signal message created, as today
    end
    Note over Conv: a close waiting on this row lock sees the new arrival and asks again
    Note over Inbox,Conv: later, the drain records a reply outcome
    Inbox->>Conv: finish attempt as not delivered or not confirmed
    Conv->>Conv: settle in one transaction, set the reply state, then lock the conversation row
    opt the conversation is closed
        Conv->>Conv: set open, raise the version, insert activity entry reopened, a reply was not delivered
        Conv->>Rt: signal activity item created, inside the transaction
    end
    Conv->>Rt: signal reply state changed, inside the transaction
```

**Critical flow 3: Deactivation unassigns in the same transaction, and a racing assignment loses (US-06 — AC-10, AC-04)**

```mermaid
sequenceDiagram
    actor Owner as Business owner
    actor Teammate as Operator
    participant Web as Web panel
    participant Inbox as inbox module
    participant Ws as workspaces module
    participant Conv as conversations module
    participant Rt as realtime platform service
    Owner->>Web: confirms deactivating a member
    Web->>Ws: deactivate membership
    Ws->>Ws: one transaction, lock the workspace row for update, check another active owner
    Ws->>Ws: update the membership state to deactivated, which row-locks it
    Ws->>Conv: port onMembershipDeactivated in the same transaction
    Conv->>Conv: unassign every conversation of this workspace assigned to the account, raise each version
    Conv->>Conv: insert activity entry unassigned, the member was deactivated, per conversation
    Conv->>Rt: one activity signal per conversation, inside the transaction
    Ws->>Rt: signal membership deactivated, inside the transaction
    Ws-->>Web: member shown deactivated
    Teammate->>Web: assigns a conversation to that member at the same moment
    Web->>Inbox: assign with the seen version
    Inbox->>Ws: share-lock the target membership
    alt deactivation committed first
        Ws-->>Inbox: waits for the lock, then sees deactivated
        Inbox-->>Web: refused, assignee not active
    else the assignment took the share lock first
        Ws-->>Inbox: active
        Inbox->>Conv: assignment recorded and committed
        Note over Ws,Conv: the deactivation waited on the lock, then its unassign also clears this assignment
    end
```

## 7. Deployment view

Nothing changes in the topology. The feature runs in the one Node 26 process (Fastify API, the built web panel, webhook ingress, the live socket and pg-boss workers) against one PostgreSQL 16 database. No queue, no configuration key and no external dependency is added. The change routes, reopen and unassign run inside existing request or job transactions. A second replica needs no change: the version guard and the limit are enforced in the database (row locks, advisory locks), and signals still fan out through `LISTEN/NOTIFY`.

**Configuration added:** none. The constants 60 changes per 60 s, the activity kinds and causes, and the thread kind order live in `conversations/domain`.

**Monitoring:**
- Metrics (from structured logs):
  - request duration on the change path (assign / unassign / close / reopen), split by outcome: recorded, unchanged, state changed, close needs confirmation, assignee not active, limit;
  - change-to-push latency per activity signal (commit to socket write);
  - capture-to-push latency for customer reopens;
  - list duration per lens;
  - limit refusals per member;
  - the number of conversations unassigned per deactivation.
- Alerts:
  - the existing `/health` uptime check;
  - the integrity checks below returning any row;
  - the spec §7 reopen KPI: more than 30 % of a workspace's closes followed by a customer reopen within 24 h over a rolling 7 days.
- Integrity checks: periodic reconciliation queries in the run book, also asserted in the integration suite.
  - Assignees that are not active members of the conversation's workspace. The query joins `memberships`. It is an ops query, not a repository read.
  - Closed conversations whose last customer arrival is later than their latest close entry.
- KPIs (spec §7) are computed by run-book queries over the stored columns and the activity table:
  - share of open conversations with an assignee, as a snapshot at 18:00 server time;
  - duplicate first answers: "share of customer messages followed, before the customer's next message and within 10 minutes, by "sent" replies from two or more different members; per workspace, rolling 7 days", computed from `replies` and `messages`;
  - closes followed by a customer reopen within 24 h;
  - customer messages still waiting 24 h after the last one.
- Tracing: the Fastify request id is in every log line. Change logs carry the workspace, conversation, activity id, kind, cause and outcome code, and never display names or message text.

**Scaling thresholds:**
- At pilot scale (5–10 workspaces, ≤ 1 000 conversations each, spec §6) the lens indexes in §4 keep every list page an index range scan. Past ~50 000 conversations per workspace, revisit partial indexes for `status = 'open'`.
- A deactivation writes one activity entry and one NOTIFY per conversation assigned to the member, inside one transaction. This is fine up to a few thousand assigned conversations. Above that, batch the inserts and publish a single workspace-level resync signal instead.
- Activity entries grow by a handful per conversation. Comfortable in one table for years at pilot scale.

## 8. Crosscutting concepts

| Concept | Convention | Where defined |
|---|---|---|
| Logging | pino via `platform/logger.ts`. Change logs carry ids, kinds, causes and outcome codes. Display names, message text and NOTIFY payloads are never logged. | `CLAUDE.md` + here |
| Authentication | Session cookie resolved by `auth` on every route and the socket, unchanged. | workspace-operators ADR-0002 |
| Authorization | Every change route and read sits under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard. Another workspace's account gets not found with no hint, a deactivated member gets `ACCESS_REMOVED`, and a signed-out visitor is sent to sign in (AC-11). Both roles have identical rights (spec §1). Inside the change transaction, the caller's membership is share-locked again, so a member deactivated mid-request cannot record a change. | workspace-operators ADR-0003, [ADR-0005](adr/0005-unassign-on-deactivation-through-a-workspaces-port-called-inside-the-deactivation-transaction.md) |
| Tenancy | Conversation ids from the URL are always looked up with the workspace id, and assignee ids are validated as active members of that same workspace. The deactivation unassign filters by the membership's workspace, so another workspace's assignments of the same account stay. No new controlled exception. | `CLAUDE.md`, §5 |
| Concurrency | Lock order per path:<br>• **Member change:** (1) memberships `FOR SHARE`; (2) the conversation row `FOR UPDATE`; (3) the `changes:<ws>:<account>` advisory lock, after the no-op, version and close checks; (4) the activity insert.<br>• **Deactivation:** (1) the workspace row `FOR UPDATE`; (2) the membership `UPDATE`, whose row lock conflicts with `FOR SHARE`; (3) the conversation rows assigned to the member (`UPDATE`); (4) activity inserts.<br>• **Capture:** contact upsert and message insert (unique key), then the conversation row (the raise `UPDATE`, returning status).<br>• **Reply outcome** (`settle()`): the `drain:` advisory lock and the reply / attempt rows, then the conversation row.<br>**Why this is deadlock-free:** no path locks a conversation row and then a reply, attempt, message or membership row. The close only reads the latest reply and the member's read mark. Member changes take memberships before conversation rows, and so does deactivation. Nothing takes a `changes:` lock before a row lock that another path holds while waiting for that `changes:` lock. | [ADR-0002](adr/0002-guard-member-changes-with-a-per-conversation-state-version-the-client-echoes.md), [ADR-0003](adr/0003-recheck-close-reasons-under-the-conversation-row-lock-against-an-acknowledged-close-snapshot.md), [ADR-0005](adr/0005-unassign-on-deactivation-through-a-workspaces-port-called-inside-the-deactivation-transaction.md) |
| Error handling | `AppError` subclasses with codes in `packages/shared/src/errors.ts`:<br>• state changed since seen: `ConflictError`, details = current assignee, status, latest activity (actor or cause, time), version;<br>• close needs confirmation: `ConflictError`, details = reasons, stale change if any, snapshot, version;<br>• assignee not active: `ValidationError`, the same answer for a deactivated or foreign account;<br>• change limit: `TooManyRequestsError` with the resume time.<br>"Already in the requested state" is a success with nothing recorded, not an error. | `CLAUDE.md` + here |
| ID strategy | UUIDv7 from `newId()` for activity entries. The state version is a per-conversation integer counter, not an id. | `CLAUDE.md` |
| Time and order | Server clock (UTC) for activity position time. A customer reopen sits at the message's arrival time, while the message keeps its Telegram send time (AC-07). Thread ties: message < reply < activity. | [ADR-0006](adr/0006-store-activity-entries-in-their-own-table-and-merge-them-into-the-thread-by-position-time.md), shared-inbox ADR-0008 |
| Events | `conversation.changed` with item `{ type: 'activity', id }`, change `created`, one per recorded change, published inside the writing transaction. `membership.deactivated` is unchanged. | [ADR-0007](adr/0007-signal-assignment-and-status-changes-as-activity-items-on-conversation-changed.md), shared-inbox ADR-0003 |
| Rate limiting | 60 recorded member changes per rolling 60 s per member per workspace, counted from activity entries under `hashtextextended('changes:<ws>:<account>', 0)`. Automatic changes are excluded. | §4 |
| Untrusted content | Display names in assignee labels and activity lines are rendered as plain text (React escaping, spec §6.1 abuse case). Activity entries store account ids and resolve names at read time. | spec §6.1 |
| Internationalisation | UI stays in English. Activity lines are composed by the web panel from kind + cause + names, not stored as text. | — |
| Observability | See §7. The activity table doubles as the audit trail of who changed what (spec §6.1 abuse case: mass close attributed). | §7 |

## 9. Architecture decisions

| # | Title | Status | Section |
|---|---|---|---|
| [0001](adr/0001-store-assignee-status-and-activity-in-the-conversations-module-and-serve-them-through-inbox-routes.md) | Store assignee, status and activity in the conversations module and serve them through inbox routes | Accepted | §4, §5 |
| [0002](adr/0002-guard-member-changes-with-a-per-conversation-state-version-the-client-echoes.md) | Guard member changes with a per-conversation state version the client echoes | Accepted | §4 |
| [0003](adr/0003-recheck-close-reasons-under-the-conversation-row-lock-against-an-acknowledged-close-snapshot.md) | Re-check close reasons under the conversation row lock against an acknowledged close snapshot | Accepted | §4 |
| [0004](adr/0004-reopen-closed-conversations-inside-the-capture-and-reply-outcome-transactions.md) | Reopen closed conversations inside the capture and reply-outcome transactions | Accepted | §4 |
| [0005](adr/0005-unassign-on-deactivation-through-a-workspaces-port-called-inside-the-deactivation-transaction.md) | Unassign on deactivation through a workspaces port called inside the deactivation transaction | Accepted | §4, §8 |
| [0006](adr/0006-store-activity-entries-in-their-own-table-and-merge-them-into-the-thread-by-position-time.md) | Store activity entries in their own table and merge them into the thread by position time | Accepted | §4, §5 |
| [0007](adr/0007-signal-assignment-and-status-changes-as-activity-items-on-conversation-changed.md) | Signal assignment and status changes as activity items on conversation.changed | Accepted | §4, §8 |

ADR files live under `docs/features/assignment-statuses/adr/NNNN-<title>.md`. Decisions this design builds on:
- repo [`docs/adr/`](../../adr/) 0001, 0002, 0004;
- workspace-operators ADR-0002, 0003, 0005;
- bot-connection ADR-0003, 0005;
- shared-inbox ADR-0002, 0003, 0004, 0005, 0007, 0008.

## 10. Quality requirements

Each top-3 goal from §1 is expanded into a scenario below. Every number is quoted from spec §6.

**QG-1. No lost customer, no silent overwrite**
- **When:**
  - a member closes a conversation whose customer is waiting, or that has an unread customer message, or whose latest reply failed;
  - a customer message is captured between the close question and "close anyway";
  - two members change the same conversation at once;
  - a customer writes to a closed conversation, or a reply in a closed conversation ends "not delivered" or "not confirmed".
- **Then:**
  - the close happens only after the member confirms against the current snapshot;
  - the second of two concurrent changes is asked, never applied silently;
  - lost customers: "0 closed conversations whose latest customer message arrived after the close";
  - reopen on customer message p95, message captured to conversation shown open to the team: "≤ 3 s".
- **How verify:**
  - integration tests against a real Postgres (Testcontainers):
    - (a) close with each reason, then close-anyway with the returned snapshot: closes;
    - (b) capture a message between the refusal and close-anyway, including one whose arrival timestamp is not later than the current one (concurrent webhook connections): refused again, because the counter grew;
    - (b2) a first close (no refusal yet) after a customer message the screen has not shown: refused with the new-message reason;
    - (c) a close and a capture racing on one conversation, run concurrently many times, then the integrity query returns no row;
    - (d) two concurrent assigns with the same version: one recorded, the other `CONVERSATION_STATE_CHANGED`;
    - (e) a capture into a closed conversation, and a drain outcome "not confirmed" in a closed conversation: each reopens with the right activity entry;
    - (f) a duplicate redelivery and an edit: no reopen;
  - the integrity query runs in the run book;
  - timing from capture to push is logged, and an integration test asserts the push reaches a connected test socket.

**QG-2. Ownership integrity under concurrency**
- **When:**
  - a business owner deactivates an operator who is the assignee of open and closed conversations, while a teammate assigns another conversation to that operator;
  - an operator assigns to a deactivated member or to an account of another workspace;
  - an operator makes a 61st change within a minute.
- **Then:**
  - single assignee: "0 conversations with more than one assignee or with an assignee who is not an active member";
  - deactivation unassign: "0 conversations assigned to a deactivated member at any moment — unassigning is part of the deactivation itself (AC-10)";
  - change rate per member: "≤ 60 assignment/status changes per rolling 60 s per member per workspace (AC-12)";
  - other workspaces' assignments of the same account stay.
- **How verify:**
  - integration test "deactivate during a concurrent assign → the assign is refused, no assignment remains", run in both lock orders. When the assign takes its lock first, it commits and the deactivation then clears it with an activity entry (§1 decision override);
  - integrity check in the integration suite after every concurrency test;
  - integration test "the 61st change within a minute is refused", including 61 concurrent requests, and automatic changes not counted;
  - a cross-workspace isolation test per new repository method, plus a route test with a foreign account id as assignee.

**QG-3. Live, responsive inbox**
- **When:** a member's change, a customer reopen or a deactivation unassign happens while teammates have the list or the thread open, or a member opens any lens of a workspace with 1 000 conversations.
- **Then:**
  - assign / close / reopen p95, member action to recorded: "≤ 300 ms server time";
  - live update p95: "≤ 3 s (as shared-inbox §6)";
  - inbox list p95, first page of any lens: "≤ 500 ms server time (as shared-inbox §6)";
  - availability: "99.5 % monthly (as shared-inbox §6)".
- **How verify:**
  - request timing log on the change path;
  - server-side timing from commit to socket write, logged per signal, and a CI integration test that asserts the activity signal reaches a connected socket of a teammate and that the row moves lens in the web store test;
  - a seeded integration test with 1 000 conversations per lens (open · all, open · mine, open · unassigned, closed · each, search) asserting server time;
  - the uptime check on the health endpoint.

## 11. Risks and technical debt

| Risk / debt | Severity | Mitigation | Owner |
|---|---|---|---|
| Teams close too early, then customers reopen with a "thanks" or a sticker, and the list churns. This is a product risk behind the spec §7 reopen KPI. | Medium | The KPI alert in §7. Spec §8 OQ-2 decides on short acknowledgements after 30 days of pilot data. The reopen point is one place in `conversations` (ADR-0004), so a rule can be added there. | Dmytro Hopko |
| A tab that misses a live signal (listener reconnect) keeps an old version, and its next change is asked as stale even though nothing visible changed. | Low | This is the safe direction: the member sees the current state in the dialog. Resync on gap refetches summaries (shared-inbox ADR-0003). | Tech Lead |
| A tab opened before the deploy runs the old bundle and receives frames with item type `activity`, which its schema does not know. | Low | Check at `tasks` that the web store drops unparseable frames without breaking the socket, and that it resyncs. The SPA is served from the same origin, so a reload picks up the new bundle. | Tech Lead |
| Capture now also takes part in the close race. A capture that waits on a close holding the row lock adds up to that close's duration to webhook latency. | Low | Close transactions are short (one row, a few indexed reads, ≤ 300 ms target). Watch capture duration in §7 metrics. | Tech Lead |
| Deactivating a member with very many assignments writes one activity entry and one NOTIFY per conversation in one transaction. | Low | Fine at pilot scale. The threshold and the fallback (a workspace-level resync signal) are in §7. | Tech Lead |
| `buildDeps()` must build `conversations` before `team` to fill the deactivation port, and a test fake must exist for `workspaces` unit tests. | Low | Covered in `tasks`. The admin CLI builds through `buildDeps()` too, so it gets the same wiring. | Tech Lead |
| The composite FK `conversations (workspace_id, assignee_account_id) → memberships` is a cross-module constraint. It guarantees same-workspace assignees, but not active ones. | Low | The active guarantee comes from the lock protocol (ADR-0005) plus the integrity query. The FK is a constraint only, and no cross-module query reads through it. | Tech Lead |
| `CLAUDE.md` and the architecture map do not yet mention the deactivation port, the new conversation columns, the activity table or the extended signal. | Low | Update both in this feature's tasks (the map's `reflects_commit` is stale too). | Tech Lead |
| Activity entries (who handled and who changed what) are kept indefinitely. Removal is by hand. | Low | Same as messages and replies (shared-inbox §11). Belongs to a later privacy and retention step. | Dmytro Hopko |
| Spec AC-10 and §6 say a racing assignment is "refused". The design refuses it or clears it in the deactivation transaction (§1 decision override). | Low | Align the spec wording at review. The integrity outcome (no assignment to a deactivated member at any committed moment) is unchanged. | Dmytro Hopko |
| Capture's upsert takes no lock today, and the reopen decision must read status only from the locked raise `UPDATE`. Reading it from the upsert would reintroduce the lost-customer race. | Medium | Specified in ADR-0004. Covered by the concurrent close-versus-capture test in §10 QG-1 (c). | Tech Lead |
| Spec §8: should a member's first reply to an unassigned conversation assign it to them? Default now: no. | Open question | Resolve after 30 days of pilot use. It would be one more automatic cause in `conversations.createReply`'s transaction, with no schema change. | Dmytro Hopko |
| Spec §8: should a thank-you or sticker after a close leave the conversation closed? Default now: every new customer message reopens. | Open question | Resolve after 30 days of pilot use (watch the §7 reopen KPI). It would be a rule at the single reopen point (ADR-0004). | Dmytro Hopko |

**Accepted debt (acceptable in v1, plan to fix later):**
- There are no counts on the lenses (spec §3).
- Integrity is guaranteed by the lock protocol and checked by run-book queries, not by a database-level "assignee is active" constraint.
- KPIs are computed by run-book queries rather than a scheduled job.

## 12. Glossary

Terms marked † are not yet in [CONTEXT.md](../../../CONTEXT.md) and are candidates for `/sdd:glossary`.

| Term | Meaning |
|---|---|
| Assignee | The one active member of a workspace a conversation is assigned to. A conversation has at most one, or is unassigned. NOT a lock: teammates still read and reply. |
| Conversation status | Open or closed. A closed conversation leaves the default working list and opens again when its customer writes or one of its replies ends not delivered or not confirmed. |
| Activity entry | A thread line recording a change to assignee or status: who made it and when, or the automatic cause (the customer wrote, a reply was not delivered, the assignee was deactivated; spec AC-09 words the last one "the member was deactivated"). Never sent to the customer, never unread. |
| Position time | Where an item sits in the thread: a message by its Telegram send time, a reply by when it was (re)sent, an activity entry by when the change happened (the server clock after the conversation row lock, never before the conversation's previous activity entry). |
| Arrival watermark | The per-member, per-conversation arrival point up to which the member has read. Used for the close reason "a customer message you have not read". |
| Waiting for a reply | The customer wrote after the last reply marked sent. Still a derived marker, and one of the close reasons. |
| Change signal | A small live notice carrying ids only. Here it is a `conversation.changed` with an activity item. |
| State version † | The per-conversation counter raised by every assignee or status change. The client sends the version it showed, so a change made against an older state is asked first. |
| Customer message counter † | A per-conversation count raised by capture, under the row lock, for every newly captured customer message. Ordered by commit, unlike arrival timestamps. |
| Close snapshot † | The customer message counter plus the latest reply's id and state. The screen sends it with every close, and "close anyway" sends back the one from the refusal. A close over a reason is recorded only if the snapshot is still the same. |
| Lens † | A filter of the inbox list that is part of the page address: status (open / closed) and assignee (all / mine / unassigned). |
| Operator / Business owner | Workspace members with identical rights in the inbox, including assignment and status. Only business owners deactivate members. |
| End customer | Writes to the business bot. Their new message always reopens. |
