---
id: T29
title: "Add browser end-to-end inbox flows against the real API and the fake Bot API"
layer: "tests"
deps: ["T21", "T24", "T28"]
blocks: []
acs: ["AC-01", "AC-06", "AC-09", "AC-13", "AC-15", "AC-16"]
files_hint: ["apps/web/e2e/inbox.spec.ts", "apps/web/e2e/support/", "apps/web/e2e/global-setup.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T29 — Add browser end-to-end inbox flows against the real API and the fake Bot API

## Place in the sequence

- **Blocked by:** T21 — Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs, T24 — Build SCR-01, the conversation list, on real data: rows, search, empty states, the not-receiving notice and live updates, T28 — Build ReplyDeliveryState with Try again and Send again, and SCR-05, the duplicate-risk confirmation · **Blocks:** — · **Wave:** 9 — after T21, T24, T28.
- **Lane:** shares `apps/web/e2e/support/` / `global-setup.ts` with nothing else in this epic.

## Why (user story)

> **As an** Operator
> **I want** to write a text reply in a conversation and send it
> **So that** the customer gets an answer from the business without me touching Telegram
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It proves in a real browser that two teammates see each other live, reply once, and lose access on time.

## Inlined context

> | Live update p95 — customer message captured or teammate reply sent → shown in another member's open inbox | ≤ 3 s | server-side timing from capture/send to push, logged per event; a CI integration test asserts the push |
>
> — `spec.md §6, NFR table, verbatim` · full text: [spec.md](../spec.md)

> | default | `403 ACCESS_REMOVED` on any inbox request or on the socket upgrade, or the next request after socket close `4403`; inherited verbatim: ui-redesign `screens.md` §SCR-05 «access-removed» / §SCR-06 «access-removed» (picker or no-access with the notice naming the workspace); nothing of the workspace is shown (AC-08, AC-09; flow 2, flow 4) |
>
> — `screens.md §SCR-07, default, verbatim` · full text: [screens.md](../screens.md)

> Shared inbox states (SCR-01, SCR-02, SCR-03, SCR-04, SCR-05). Handled once — in the API client, the realtime client (`shared/api/realtime.ts`) and the workspace-keyed store — not per screen.
>
> — `screens.md §Screens, Shared inbox states, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Drives the panel; the fake Bot API receives `sendMessage` and serves files; the webhook (`receiveTelegramUpdate`) injects customer messages.

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" whose business bot has captured conversations with 30 end customers
> **When** they open the inbox
> **Then** the list shows those 30 conversations and nothing else — no sample data and no "Sample data" label — newest activity first (activity = a new customer message or a reply marked "sent"; a customer's edit, and a reply still sending or not delivered, do not move a conversation), each with the contact's name, the last message (a non-text message shown by its kind and caption, for example "Photo · new bouquet?"), how long ago it happened, how many customer messages this operator has not read (teammates' replies never count as unread; messages that arrived before the operator joined or was reactivated count as read), and a "waiting for a reply" marker when the customer wrote after the last reply marked "sent" — a reply that is sending, not confirmed or not delivered does not clear it; a business owner of "Acme Flowers" sees and does in the inbox everything an operator does
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected, in a conversation with an end customer who has not blocked the bot
> **When** they type a reply and press Enter (Shift+Enter starts a new line)
> **Then** the reply appears at once at the end of the thread marked "sending" with the operator's name, then "sent" once Telegram accepts it (within the reply-latency target of §6); the conversation moves to the top of the list for the whole team, its "waiting for a reply" marker disappears, and the reply box is empty and ready for the next reply; the preview's note that nothing is sent to customers is no longer shown
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — authorization

> **Given** an operator of "Acme Flowers" with the inbox open
> **When** a business owner deactivates their membership, or the operator switches to another workspace in that browser tab
> **Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment; switching affects only that tab — another tab of the same account still showing "Acme Flowers" keeps working; after deactivation, the member's replies still waiting to be retried are not sent and end "not delivered — the author's access was removed"
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — cross-context

> **Given** the bot of "Acme Flowers" is not connected, or is in the state "not working — needs a new token"
> **When** an operator or business owner opens the inbox or a conversation
> **Then** every conversation stays readable, the reply box is unavailable and explains that replies cannot be sent until the bot works again — a business owner gets the way to the bot settings, an operator is told to ask a business owner; a reply still "sending" when the bot stops working ends up "not delivered — the bot is not working"; once a business owner fixes the bot — the same bot, since a workspace keeps one business bot once customers have written to it (bot-connection AC-05) — replying works again without reloading
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — domain invariant

> **Given** an operator of "Acme Flowers" writing a reply in a conversation
> **When** a teammate's reply to the same customer appears in the thread after the operator started typing, and the operator sends
> **Then** before anything is sent the inbox shows that the teammate replied and how long ago, and asks whether to send anyway or keep editing; the reply is sent only if the operator confirms — two members do not answer one customer by accident
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Flow: owner + operator in two browser contexts; a customer message appears in both lists and the open thread without reload (AC-15, AC-01) — `apps/web/e2e/inbox.spec.ts`
- [ ] Flow: operator replies → «Sending» → «Sent», row to top, waiting marker gone, fake got one `sendMessage` (AC-06)
- [ ] Flow: teammate replies while the other types → SCR-04 → Send anyway (AC-16)
- [ ] Flow: bot `needs_token` → composer unavailable with role-specific text; owner fixes → available without reload (AC-13)
- [ ] Flow: owner deactivates the operator → operator's tab stops updating within 5 s, next action shows the access-removed landing (AC-09)
- [ ] Seed helpers and the fake wiring — `apps/web/e2e/support/`, `global-setup.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Flaky timing | wait on visible text with a 5 s ceiling, never fixed sleeps |

## Definition of Done

- [ ] the five browser flows pass locally and in CI with `pnpm test:e2e`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
