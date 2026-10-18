---
id: T24
title: "Build SCR-01, the conversation list, on real data: rows, search, empty states, the not-receiving notice and live updates"
layer: "ui"
deps: ["T23"]
blocks: ["T29"]
acs: ["AC-01", "AC-02", "AC-14"]
files_hint: ["apps/web/src/features/inbox/ConversationList.tsx", "apps/web/src/features/inbox/ConversationList.test.tsx", "apps/web/src/features/inbox/InboxList.tsx", "apps/web/src/pages/InboxPage.tsx", "apps/web/src/shared/ui/empty-filter-state.tsx", "apps/web/src/features/inbox/InboxPreview.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T24 — Build SCR-01, the conversation list, on real data: rows, search, empty states, the not-receiving notice and live updates

## Place in the sequence

- **Blocked by:** T23 — Replace the inbox sample source with the API source, a workspace-keyed store and the realtime client · **Blocks:** T29 — Add browser end-to-end inbox flows against the real API and the fake Bot API · **Wave:** 3 — after T23.
- **Lane:** shares `pages/InboxPage.tsx` with T25 — serialized; `features/inbox/store.ts` read-only here.

## Why (user story)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** the inbox to tell the whole team when the bot is not working or not receiving messages, and to point me to the bot settings
> **So that** nobody writes replies that cannot be delivered and I fix the connection quickly
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It is the screen where an operator sees, at a glance, which customers need an answer.

## Inlined context

> | default (desktop ≥ md) | `/w/<id>/inbox`, ≥ 1 conversation — title row «Inbox» (no Sample data label); one full-height `Card` with two panes: left = search `Input` «Search conversations» + the list; right = «Pick a conversation to see it here». Each row: `Avatar` (initials), contact full name, «how long ago» from `last_activity_at`, last item — a message by its kind and caption («Photo · new bouquet?», text as is), a team reply with a reply icon (lucide `CornerUpLeft`) before its text; unread count `Badge` when > 0; «Waiting for a reply» marker when `waiting_for_reply`; newest activity first (AC-01) |
>
> — `screens.md §SCR-01, default, verbatim` · full text: [screens.md](../screens.md)

> States: selected · loading (6 skeleton rows, search disabled) · loading more (2 skeleton rows, `next_cursor`) · live: activity · live: read elsewhere · filtered (previous rows stay while in flight) · empty: no match («No conversations match» + **Clear search**) · empty: no conversations («No conversations yet. They appear here when customers write to your bot.») · empty: no bot, business owner (+ «Connect the bot to start receiving messages.» + **Open bot settings**) · empty: no bot, operator (+ «Ask a business owner to connect the bot.») · notice: not receiving (`taken_over` — «New customer messages are not arriving in tg-inbox. Another service took over the bot's messages.»; owner **Open bot settings**, operator «Ask a business owner to reconnect the bot.») · notice gone · error («Something went wrong» + **Retry**) · error: loading more («Couldn't load more conversations» + **Retry**) · phone: list (< md).
>
> — `screens.md §SCR-01, state table, abridged` · full text: [screens.md](../screens.md)

> Components: Card, Input, extended: ConversationList (Avatar, Badge), ScrollArea, Skeleton, extended: EmptyFilterState (action label «Clear search»), Alert, Button (`link`). Removed by this feature: the `SampleDataBadge` on the Inbox title row (AC-01).
>
> — `screens.md §SCR-01 + §Source, abridged` · full text: [screens.md](../screens.md)

> The "not receiving" notice above the list is shown only for `taken_over` (`receiving: false`, `can_reply: true` — contract `InboxBotStatus`); `not_connected` / `needs_token` surface in the reply area of SCR-02 and in the empty inbox
>
> — `screens.md §Source, Decision 5, abridged` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Customer text, captions, names, file names, poll and venue text and reply texts are rendered as plain text (React escaping, no HTML rendering, links only as plain-text map links built by us from coordinates); replies go to Telegram without `parse_mode`; media served with an allow-listed content type, `nosniff`, a sandboxing CSP and `attachment` for documents
>
> — `sad.md §8, Untrusted content, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Reads `listConversations` (`q`, `after`, `limit`) and `getInboxBotStatus` through the T23 store; role from the workspace store (owner vs operator). — `contracts/openapi.yaml, listConversations + getInboxBotStatus, abridged`

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose business bot has captured conversations with 30 end customers
> **When** they open the inbox
> **Then** the list shows those 30 conversations and nothing else — no sample data and no "Sample data" label — newest activity first (activity = a new customer message or a reply marked "sent"; a customer's edit, and a reply still sending or not delivered, do not move a conversation), each with the contact's name, the last message (a non-text message shown by its kind and caption, for example "Photo · new bouquet?"), how long ago it happened, how many customer messages this operator has not read (teammates' replies never count as unread; messages that arrived before the operator joined or was reactivated count as read), and a "waiting for a reply" marker when the customer wrote after the last reply marked "sent" — a reply that is sending, not confirmed or not delivered does not clear it; a business owner of "Acme Flowers" sees and does in the inbox everything an operator does
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — happy path

> **Given** an operator in the inbox of "Acme Flowers"
> **When** they type part of a contact's name or username into the search
> **Then** the list shows only the conversations whose contact matches — the text is looked for anywhere in the contact's full name (first and last name together) or username, ignoring letter case in any alphabet, surrounding spaces and a leading "@"; when nothing matches it says so and offers to clear the search; when the workspace has no conversations at all the inbox explains that conversations appear when customers write to the bot — and a business owner whose workspace has no connected bot is offered the way to the bot settings
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** the bot of "Acme Flowers" is in the state "not receiving messages — another service took them over"
> **When** any member opens the inbox
> **Then** the inbox shows every member a notice that customers' new messages are not arriving in tg-inbox until a business owner reconnects the bot (with the way to the bot settings for owners); replies can still be sent, and each one shows the same notice next to its delivery state
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Extend `ConversationList` with real `Conversation` rows: last item by kind + caption, reply icon, unread `Badge`, waiting marker, relative time, `aria-current`, loading-more slot — `features/inbox/ConversationList.tsx`
- [ ] List pane with search (`maxLength` 200, debounced), empty states by `q` / bot status / role, the `taken_over` notice, error + retry, infinite scroll by `next_cursor` — `features/inbox/InboxList.tsx`
- [ ] Give `EmptyFilterState` an optional action label (Team / Contacts keep «Clear filters») — `shared/ui/empty-filter-state.tsx`
- [ ] `InboxPage` renders the real list; remove `SampleDataBadge` and the preview list wiring — `pages/InboxPage.tsx`, `features/inbox/InboxPreview.tsx`
- [ ] Testing Library tests for every state above incl. role split and phone width — `features/inbox/ConversationList.test.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| Contact name with `<b>` | rendered as text |
| Photo without caption | «Photo» |
| Search typed while a page is in flight | previous rows stay, no skeleton flash |
| Bot `taken_over` | notice for every member; list usable |
| No conversations, bot `needs_token`, operator | no link, «Ask a business owner to connect the bot.» |

## Definition of Done

- [ ] Testing Library tests cover every SCR-01 state in `screens.md` (except `validation`, N/A) including the owner/operator split
- [ ] no «Sample data» label on the inbox
- [ ] web lint + typecheck clean
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
