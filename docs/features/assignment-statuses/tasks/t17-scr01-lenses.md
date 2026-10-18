---
id: T17
title: "Build the SCR-01 lenses: status tabs and assignee select, the assignee line and closed mark on rows, per-lens empty states and live join and leave"
layer: "ui"
deps: ["T16"]
blocks: ["T23", "T24"]
acs: ["AC-01", "AC-07"]
files_hint: ["apps/web/src/features/inbox/InboxList.tsx", "apps/web/src/features/inbox/InboxList.test.tsx", "apps/web/src/features/inbox/ConversationList.tsx", "apps/web/src/features/inbox/ConversationList.test.tsx", "apps/web/src/pages/InboxPage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T17 — Build the SCR-01 lenses: status tabs and assignee select, the assignee line and closed mark on rows, per-lens empty states and live join and leave

## Place in the sequence

- **Blocked by:** T16 — Teach the web inbox store and API source lenses in the address, the state version and close snapshot, the change actions and activity frames · **Blocks:** T23 — Add browser end-to-end assignment flows against the real API and the fake Bot API, T24 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the conversation state, the activity table, the deactivation port and the new components · **Wave:** 6 — after T16.
- **Lane:** shares `pages/InboxPage.tsx` with T16 — serialized after it; `ConversationList.tsx` / `InboxList.tsx` only here.

## Why (user story)

> **As an** Operator
> **I want** the list to show each conversation's assignee and let me switch between all, mine and unassigned conversations
> **So that** I pick up only what nobody handles or what is mine
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It is the list where an operator sees who handles what and picks only what is theirs or nobody's.

## Inlined context

> | default: open · all | `/w/<id>/inbox` with no lens parameters — under the search: status `Tabs` with **Open** selected and **Closed**, assignee `Select` «All»; rows of open conversations of every assignee, newest activity first; each row as before (Avatar, name, time, last item, unread `Badge`, «Waiting for a reply») plus a muted assignee line — the assignee's display name, or «Unassigned» — with a lucide `UserRound` icon; an assignee or status change never becomes the row's preview or time (AC-01) | Tabs, Select, extended: ConversationList, ScrollArea | wireframe «list desktop» |
>
> — `screens.md §SCR-01, default: open · all, verbatim` · full text: [screens.md](../screens.md)

> States: lens: mine / unassigned (`?assignee=…`) · lens: closed (`?status=closed`, no «closed» mark on rows) · lens from the address · validation (unknown lens → default, address rewritten) · loading: lens switch (6 skeleton rows; answer with another `lens` echo dropped) · empty: lens — open · all «No open conversations. New ones appear here when customers write to your bot.»; open · mine «No open conversations are assigned to you.»; open · unassigned «Every open conversation has an assignee.»; closed · all «No closed conversations.»; closed · mine «No closed conversations are assigned to you.»; closed · unassigned «No closed conversations without an assignee.» · empty: no bot, owner / operator (first sentence replaced by the open · all one) · searching (status tabs disabled + «Searching open and closed»; closed rows get a «Closed» `Badge` (outline) after the name) · empty: no match (unchanged + **Clear search** back to the lenses) · live: row joins / leaves the lens (never moves to the top for a change) · live: reopened by the customer (top, unread + 1, waiting) · selected row left the lens (thread stays open) · opened outside the lens (no row selected) · workspace switched (open · all) · error (Retry in current lenses) · phone (tabs `flex-1`, select `w-36` side by side).
>
> — `screens.md §SCR-01, state table, abridged` · full text: [screens.md](../screens.md)

> 1. **Lens controls:** status = `Tabs` used as a two-segment switch («Open» / «Closed», no tab content); assignee = `Select` («All» / «Mine» / «Unassigned»). Both sit in the list pane between the search and the rows. While a search is present the status tabs are disabled with the hint «Searching open and closed» (AC-01).
>
> — `screens.md §Source, Decision 1, abridged` · full text: [screens.md](../screens.md)

> | ConversationList (extended) | Existing NEW component; gains the assignee line, the «Closed» badge in search results, and (in its `InboxList`) the status `Tabs` + assignee `Select` lenses, lens-aware loading / per-lens empty states and the live join / leave of rows — canon row updated, not duplicated | pending |
>
> — `screens.md §New components, verbatim` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Display names in assignee labels and activity lines are rendered as plain text (React escaping, spec §6.1 abuse case). Activity entries store account ids and resolve names at read time.
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Reads `listConversations` (lenses, `q`, `after`) and `getInboxBotStatus` through the T16 store; role from the workspace store. — `contracts/openapi.yaml, listConversations, abridged`

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose workspace has 30 conversations — some assigned to them, some to a teammate, some unassigned, some closed
> **When** they open the inbox
> **Then** the list shows the open conversations of every assignee, newest activity first as before, each row showing its assignee's name (or "unassigned") and keeping its last message and time — an assignee or status change never becomes a row's preview or time; choosing "mine" shows only open conversations assigned to them, "unassigned" only open conversations with no assignee, and "closed" the closed conversations in the chosen assignee lens, also newest activity first; while searching, the status lens is set aside and matches of both statuses are shown within the chosen assignee lens, each closed row marked "closed"; when a lens holds nothing the inbox says so; the chosen lenses are part of the page's address, so a reload, the back button or a saved link opens the same lenses, and switching to another workspace starts again at open · all; a business owner sees and does the same
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — cross-context

> **Given** a closed conversation of "Acme Flowers" assigned to an operator
> **When** its end customer sends a new message to the business bot
> **Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with the same assignee (an assignee is always an active member — AC-10), the thread records "reopened — the customer wrote" with the time, and the message counts as unread and as waiting for a reply exactly as for an open conversation; this holds for a customer message that arrives late and takes an earlier place in the history (a late redelivery) — it reopens by its arrival, the message keeps its earlier place, and the "reopened" line sits at the time it arrived; an edit of an earlier message does not reopen
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Status `Tabs` + assignee `Select` under the search, bound to the store's lens / address; disabled tabs + hint while searching — `features/inbox/InboxList.tsx`
- [ ] Row: muted `UserRound` assignee line («Unassigned» or name, plain text); «Closed» outline `Badge` only in search results — `features/inbox/ConversationList.tsx`
- [ ] Per-lens empty sentences; no-bot empty states keep their second sentence; error Retry in current lenses — `InboxList.tsx`
- [ ] Phone layout of the controls — `InboxList.tsx`
- [ ] Testing Library tests for every state above — `InboxList.test.tsx`, `ConversationList.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Assignee name `<img onerror>` | rendered as text |
| Search cleared | back to the lenses chosen before |
| Teammate closes the selected conversation while on «Open» | row leaves, thread stays |
| Reassigned row on «All» | updated in place, keeps its position |

## Definition of Done

- [ ] Testing Library tests cover every SCR-01 state this feature adds in screens.md (lenses, lens from the address, unknown lens rewritten, lens loading, per-lens empty texts, searching with disabled tabs and Closed badges, live join / leave, selected row left the lens, phone layout).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
