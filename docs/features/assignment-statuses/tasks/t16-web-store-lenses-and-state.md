---
id: T16
title: "Teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames"
layer: "ui"
deps: ["T12"]
blocks: ["T17", "T18", "T22"]
acs: ["AC-01", "AC-02"]
files_hint: ["apps/web/src/features/inbox/store.ts", "apps/web/src/features/inbox/store.test.ts", "apps/web/src/features/inbox/api-source.ts", "apps/web/src/features/inbox/lens.ts", "apps/web/src/features/inbox/lens.test.ts", "apps/web/src/pages/InboxPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T16 — Teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames

## Place in the sequence

- **Blocked by:** T12 — Serve lenses, state and activity through the inbox reads: change the list, summary and thread schemas, add getThreadActivity and listActiveMembers · **Blocks:** T17 — Build the SCR-01 lenses: status tabs and assignee select, the assignee line and closed mark on rows, per-lens empty states and live join and leave, T18 — Build the SCR-02 actions bar (ConversationActions) and the activity line in the thread: status badge, assignee button, close and reopen, pending lock, limit countdown and live changes, T22 — Add the unassign sentence to the deactivate confirmation (SCR-14) and keep the lenses in the sign-in return address (SCR-09) · **Wave:** 5 — after T12.
- **Lane:** shares `store.ts` with T2 (which only ignored `activity` frames) and `pages/InboxPage.tsx` with T17 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the list to show each conversation's assignee and let me switch between all, mine and unassigned conversations
> **So that** I pick up only what nobody handles or what is mine
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It is the client-side source of truth every inbox screen of this feature reads from.

## Inlined context

> - **Lenses:** the two lenses are URL search parameters (`status=open|closed`, `assignee=all|mine|unassigned`, defaults omitted). Reload, back and saved links therefore reopen the same lenses (AC-01). The workspace switcher navigates to a new path without them, which resets to open · all.
> - **Store:** `features/inbox/store.ts` (keyed by workspace) holds the lens. For each list row it keeps the row's status and assignee. For the open conversation it keeps the **state version** it last rendered (§4 choice 2) and the **close snapshot**, i.e. the one it rendered or the one from the last close refusal (§4 choice 3).
> - **Live changes:** a live activity signal refetches the row, the conversation summary (header and version) and the activity item. The store then re-evaluates whether the row still belongs to the current lens, so it inserts, keeps or drops the row (AC-02: an open thread stays open).
>
> — `sad.md §4, UI architecture, verbatim` · full text: [sad.md](../sad.md)

> 1. **Lens controls:** […] The panel never sends a lens value outside the enum: an unknown `status` / `assignee` in the address is treated as the default and the address is rewritten in place (so `listConversations` `400` on a lens cannot be produced).
>
> — `screens.md §Source, Decision 1, abridged` · full text: [screens.md](../screens.md)

> | `conversation.changed` with item `activity` (`created`) | coalesced with a same-transaction `message` / `reply` frame; re-read `getConversation`, and `getThreadActivity` if that thread is open; an activity id already shown is ignored; the row is re-evaluated against the current lenses (only the assignee lens while searching) → inserted, updated or dropped; an open thread stays open; unread counts untouched | AC-02, AC-05, AC-07, AC-08, AC-09, AC-10; flow 13; events.md |
> | `403 ACCESS_REMOVED` on `assignConversation` / `unassignConversation` / `closeConversation` / `reopenConversation` (`CallerAccessRemoved` — deactivated at the guard or under the share lock) | any open dialog / chooser closes; as the inherited 403 row → SCR-07 | AC-11; flow 5, flow 12 |
> | `404 NOT_FOUND` on a change route, `getThreadActivity` or `listActiveMembers` | any open dialog / chooser closes; SCR-06 in the thread pane (no hint) | AC-11; flow 5, flow 11 |
>
> — `screens.md §Shared states, abridged` · full text: [screens.md](../screens.md)

> | a frame that fails to parse | dropped; reconnect + resync of the first list page in the current lenses and the open summary | flow 13 dead-letter; events.md «Old bundles» |
> | `resync` / reconnect | re-read the first list page **in the current lenses and `q`** and the open conversation's summary (version + close snapshot replaced) | flow 13; events.md |
>
> — `screens.md §Shared states, verbatim` · full text: [screens.md](../screens.md)

> - **`X-Background-Request: 1`** on the live refetches (`getConversation`, `getThreadActivity`), as for the existing reads.
>
> — `contracts/api-sync-report.md §Notes for tasks / implement, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Calls `listConversations` (`status`, `assignee`, `q`, `after`; drops a page whose `lens` echo is not current), `getConversation` (`ConversationSummary`), `getThreadActivity`, `listActiveMembers`, `assignConversation`, `unassignConversation`, `closeConversation`, `reopenConversation` (bodies built from the summary on screen; `409` / `400` / `429` details surfaced to the screens). Live: `conversation.changed` with `item.type: 'activity'`, `change: 'created'`.

— `contracts/openapi.yaml + contracts/events.md, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose workspace has 30 conversations — some assigned to them, some to a teammate, some unassigned, some closed
> **When** they open the inbox
> **Then** the list shows the open conversations of every assignee, newest activity first as before, each row showing its assignee's name (or "unassigned") and keeping its last message and time — an assignee or status change never becomes a row's preview or time; choosing "mine" shows only open conversations assigned to them, "unassigned" only open conversations with no assignee, and "closed" the closed conversations in the chosen assignee lens, also newest activity first; while searching, the status lens is set aside and matches of both statuses are shown within the chosen assignee lens, each closed row marked "closed"; when a lens holds nothing the inbox says so; the chosen lenses are part of the page's address, so a reload, the back button or a saved link opens the same lenses, and switching to another workspace starts again at open · all; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — happy path

> **Given** an operator with a conversation of "Acme Flowers" open in its thread (assignee, status and their changes are made from the thread; list rows only show them)
> **When** they assign it to themselves or to a teammate who is an active member of "Acme Flowers", reassign it from one member to another, or unassign it
> **Then** the conversation shows the new assignee in its header and in the list for the whole team without reloading (within the live-update target of §6), it moves between the "mine" and "unassigned" lenses accordingly, the thread records one line — "<member> assigned this to <assignee>", "<member> reassigned this from <previous> to <assignee>" or "<member> unassigned this" — with the time, and the conversation keeps its place in the activity order (assigning does not count as activity); a closed conversation can be assigned or unassigned too and stays closed; a teammate reading the thread while it drops out of their current lens keeps it open with the new assignee shown, and only its row leaves their list; choosing the assignee it already has changes nothing and records nothing; assignment, closing and reopening work in every state of the bot
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Lens parse / serialize (defaults omitted, unknown → default + `replace` navigation) — `features/inbox/lens.ts`, `lens.test.ts`
- [ ] Store: lens state, list requests with lenses, drop mismatched `lens` echoes, rows keep `status` / `assignee` / `state_version`, open summary keeps version + snapshot — `features/inbox/store.ts`
- [ ] Change actions (assign, unassign, close with snapshot and confirm, reopen) returning typed outcomes / refusals; one change in flight per conversation — `store.ts`, `api-source.ts`
- [ ] Activity frames: ignore foreign workspace / known ids, coalesce with same-transaction frames, refetch summary (+ item if the thread is open) with `X-Background-Request: 1`, re-evaluate lens membership (assignee lens only while searching); unparseable frame → resync in current lenses — `store.ts`
- [ ] `InboxPage` reads lenses from `useSearchParams`; workspace switch resets — `pages/InboxPage.tsx`
- [ ] Store tests for each behaviour — `store.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `?assignee=everyone` in the address | treated as `all`, address rewritten in place, no request with it |
| Answer for `status=open` arrives after switching to `closed` | dropped |
| Activity frame for the open conversation that left the lens | row dropped, thread kept with the new header |
| Old-format frame or garbage | dropped, resync, socket kept |

## Definition of Done

- [ ] Store tests prove lenses read from and written to the address (unknown values rewritten to the default), late answers for a left lens dropped, the open conversation's version and close snapshot kept and replaced from every answer and refusal, coalesced activity-frame refetches with lens re-evaluation, dropped unparseable frames with resync in the current lenses, and the reset to open · all on a workspace switch.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
