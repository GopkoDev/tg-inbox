---
id: T6
title: "Add the conversations reads waitingForPings (period start, start kind, assignee, per-member read state) and attentionCount"
layer: "infra"
deps: ["T5"]
blocks: ["T16", "T19"]
acs: ["AC-01", "AC-07", "AC-09"]
files_hint: ["apps/api/src/modules/conversations/infra/notification-queries.ts", "apps/api/src/modules/conversations/infra/notification-queries.int.test.ts", "apps/api/src/modules/conversations/app/notification-reads.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T6 — Add the conversations reads waitingForPings (period start, start kind, assignee, per-member read state) and attentionCount

## Place in the sequence

- **Blocked by:** T5 — Record the waiting period in conversations — set by capture, cleared by a sent reply and a close, restarted by a reopen while waiting — and promote migrations 01–03 · **Blocks:** T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction, T19 — Serve the notifications routes (settings, connect link, disconnect) and GET inbox/attention behind the workspace guard, and register the notifications module · **Wave:** 3 — after T5.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** the browser tab and the navigation to show how many conversations need me
> **So that** I notice new customer messages while I work on another page or another tab
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** a customer whose assigned member does not answer to reach the rest of the team
> **So that** nobody waits on a teammate who is off for the day
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

It answers the two questions notifications asks conversations: which open conversations wait and who has read them, and how many need this member.

## Inlined context

> - `waitingForPings(workspaceId, { conversationIds?, accountIds })`, which returns the open waiting conversations with period start, start kind, assignee and per-member "read the waiting message". Ping links need no read of their own, because they land on the existing inbox reads.
>
> — `sad.md §5, notifications → conversations, verbatim` · full text: [sad.md](../sad.md)

> - **The sweep reads read state for unlinked assignees (flow 13).** The 5-minute team reach needs the assignee's presence and watermark whether or not they are linked, as §4 choice 5 says. `waitingForPings` must take the assignees' account ids as well as the linked members'.
>
> — `sad.md §6, flagged by sequences, unlinked assignees, verbatim` · full text: [sad.md](../sad.md)

> `conversations.attentionCount(workspaceId, accountId, activeSince)` counts open conversations that are assigned to the member or unassigned and have a customer arrival after the member's unread floor. It reuses the list's unread predicate and the lens indexes.
>
> — `sad.md §4, attention count, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. It is the only option that is always correct. It follows the decided "signal, then refetch" pattern, and its cost is one indexed count per tab per burst of frames (debounced 300 ms). That fits the 3 s target with room to spare. Own-read updates already arrive account-scoped (`change: read` with `account_id`), so a read in one tab updates the count in the others.
>
> — `adr/0008-serve-the-attention-count-from-a-conversations-query-refetched-on-change-signals.md §Decision outcome, ADR-0008, verbatim` · full text: [ADR-0008](../adr/0008-serve-the-attention-count-from-a-conversations-query-refetched-on-change-signals.md)

> - `conversations.waitingForPings(workspaceId, { conversationIds?, accountIds })`: the open waiting conversations of W with their start, start kind and assignee (flow 13, every 20 s), and the re-read of the due ones in the send transaction (flow 1) → `conversations_workspace_id_waiting_since_idx` (partial). The per-member "read the waiting message" uses the existing `read_marks_conversation_id_account_id_key`.
> - `attentionCount(workspaceId, accountId, activeSince)` (flow 4) → the existing `conversations_workspace_id_assignee_status_idx` and `conversations_workspace_id_status_idx`, with the list's unread predicate (ADR-0008). No new index.
>
> — `data-model.md §Entities conversations, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> - **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Five reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table · column | Change |
|---|---|
| `conversations.waiting_since`, `waiting_started_by`, `status`, `assignee_account_id` | read-only |
| `messages` (arrival of the message that began the wait) | read-only |
| `read_marks.read_through_at` per member (`read_marks_conversation_id_account_id_key`) | read-only |

— `data-model.md §Entities conversations + §Indexes Reused, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface. `attentionCount` is served later as `getAttentionCount` (T19).

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" with the inbox open: 2 open conversations assigned to them and 1 unassigned open conversation have customer messages they have not read, while a teammate's conversation and a closed one also have unread messages
> **When** they look at the browser tab or move to Settings or Contacts
> **Then** the tab title starts with "(3)" and the Inbox item in the side navigation shows 3: the **attention count** includes only open conversations that are theirs or unassigned and have unread messages for them. It changes without reloading within the live-update target of §6 as messages arrive, as they read conversations and as conversations are assigned, closed or reopened. At 0 the title has no count and the navigation shows no number. Each tab shows the count of its own workspace. A business owner sees the same.
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — happy path

> **Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
> **When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
> **Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping at that point. If they become away later while the customer is still waiting and the message is still unread for them, the ping goes out as soon as they are counted away. The 5 minutes always run from the start of the wait. For a waiting period that began when a conversation reopened (AC-08), the clock starts at the reopen. Having read the earlier messages does not hold such a ping back, because the customer's message was read and the team's reply did not reach them.
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — cross-context

> **Given** an open conversation of "Acme Flowers" assigned to an operator, whose customer has been waiting for a reply
> **When** 30 minutes pass since the wait began and it has not ended, or 5 minutes pass while the assignee is away and cannot be pinged
> **Then** every other linked member of "Acme Flowers" who is away and has not read the waiting message gets the ping for it, as for an unassigned conversation (AC-07, AC-08), saying that a teammate's customer is waiting (without the teammate's name). The assignee stays the assignee, since a ping never changes the assignee or the status. "Cannot be pinged" means exactly one of two things: the assignee has no Telegram link, or their link is "Not reachable" (AC-10). That state is either already known from an earlier failed ping or found by the failed attempt at this moment. An assignee who is present on the web, or who has read the waiting message, can be reached. For them the team is pinged only at 30 minutes.
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `waitingForPings(workspaceId, { conversationIds?, accountIds })` → `{ conversationId, assigneeAccountId, waitingSince, startedBy, startingArrival, readBy: Set<accountId> }[]`, open and waiting only, oldest period first — `apps/api/src/modules/conversations/infra/notification-queries.ts`
- [ ] `attentionCount(workspaceId, accountId, activeSince)` reusing the list's unread predicate from `list-queries.ts` — same file
- [ ] Expose both through the conversations app layer — `apps/api/src/modules/conversations/app/notification-reads.ts`
- [ ] Integration tests incl. cross-workspace isolation over `twoWorkspacesWithInbox` — `apps/api/src/modules/conversations/infra/notification-queries.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Teammate's conversation, or a closed one, with unread messages | not counted (AC-01) |
| Unassigned open conversation unread for me | counted |
| Member's watermark exactly at the starting message | counts as read |
| Assignee without a link in `accountIds` | their read state is returned (5-min team reach) |
| Conversation of another workspace with the same account | never returned |

## Definition of Done

- [ ] Integration tests prove waitingForPings returns only open waiting conversations of the workspace with start, start kind, assignee and read state for every given account (linked or not), narrowed by conversationIds, and attentionCount counts exactly the caller's and unassigned open unread conversations, both isolated by workspace.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
