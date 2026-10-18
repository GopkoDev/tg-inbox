---
id: T15
title: "Add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames"
layer: "tests"
deps: ["T8", "T9", "T14"]
blocks: ["T23"]
acs: ["AC-07", "AC-08", "AC-10", "AC-11"]
files_hint: ["apps/api/src/e2e/assignment-flows.int.test.ts", "apps/api/src/e2e/helpers.ts", "apps/api/src/modules/bots/http/secrecy.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T15 — Add the API end-to-end assignment stories, the integrity checks, and the secrecy and log assertions for the new responses and frames

## Place in the sequence

- **Blocked by:** T8 — Reopen a closed conversation on a newly captured customer message, raise the customer message counter under the row lock, and promote contract migration 05, T9 — Reopen a closed conversation in settle() when a reply ends not delivered or not confirmed, T14 — Add the close and reopen routes with the close snapshot and confirm, and prove the change limit across all four change routes · **Blocks:** T23 — Add browser end-to-end assignment flows against the real API and the fake Bot API · **Wave:** 7 — after T8, T9, T14.
- **Lane:** shares `apps/api/src/e2e/helpers.ts` with nothing else in this epic; `secrecy.int.test.ts` is extended only here.

## Why (user story)

> **As an** End customer
> **I want** my new message to a business to reach the team even if they had closed our conversation
> **So that** I get an answer whenever I write again
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** a deactivated member's conversations to return to the team automatically
> **So that** no customer waits on someone who no longer works here
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It proves the whole loop — webhook, drain, deactivation, socket — for real, so no customer is lost in a closed conversation.

## Inlined context

> - Assignees that are not active members of the conversation's workspace. The query joins `memberships`. It is an ops query, not a repository read.
> - Closed conversations whose last customer arrival is later than their latest close entry.
>
> — `sad.md §7, Integrity checks, verbatim` · full text: [sad.md](../sad.md)

> timing from capture to push is logged, and an integration test asserts the push reaches a connected test socket.
>
> — `sad.md §10, QG-1 How verify, abridged` · full text: [sad.md](../sad.md)

> | Lost customers | 0 closed conversations whose latest customer message arrived after the close | integrity check: closed conversations with a later customer arrival must not exist |
> | Single assignee | 0 conversations with more than one assignee or with an assignee who is not an active member | integrity check in the integration suite and a periodic reconciliation query in the run book |
>
> — `spec.md §6, NFR table, abridged` · full text: [spec.md](../spec.md)

> Change logs carry the workspace, conversation, activity id, kind, cause and outcome code, and never display names or message text.
>
> — `sad.md §7, Tracing, abridged` · full text: [sad.md](../sad.md)

> Bot tokens are secrets — encrypted at rest, never logged, never returned. Tests use the fake Bot API in `src/test/fake-telegram.ts`.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Exercises `listConversations` (lenses), `getConversation`, `listThreadItems`, `getThreadActivity`, `listActiveMembers`, the four change routes and `openLiveSocket`, plus bot-connection's `receiveTelegramUpdate` (capture) and the `inbox.deliver-replies` drain against the fake Bot API.

## Acceptance criteria

### AC-07 — cross-context

> **Given** a closed conversation of "Acme Flowers" assigned to an operator
> **When** its end customer sends a new message to the business bot
> **Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with the same assignee (an assignee is always an active member — AC-10), the thread records "reopened — the customer wrote" with the time, and the message counts as unread and as waiting for a reply exactly as for an open conversation; this holds for a customer message that arrives late and takes an earlier place in the history (a late redelivery) — it reopens by its arrival, the message keeps its earlier place, and the "reopened" line sits at the time it arrived; an edit of an earlier message does not reopen
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — cross-context

> **Given** a closed conversation of "Acme Flowers" holding a reply that is still sending (the conversation was closed right after the reply was sent)
> **When** that reply ends "not delivered" or "not confirmed"
> **Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with its assignee, and the thread records "reopened — a reply was not delivered" with the time, so the team sees it and can try again; closing a conversation whose latest reply is already "not delivered" or "not confirmed" asks first (AC-06) — the "waiting for a reply" marker itself keeps its meaning (the customer wrote after the last reply marked sent)
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — cross-context

> **Given** an operator of "Acme Flowers" who is the assignee of open and closed conversations
> **When** a business owner deactivates their membership
> **Then** every conversation of "Acme Flowers" assigned to them, open and closed, becomes unassigned as part of the deactivation itself — there is no moment when a deactivated member is anyone's assignee, and an assignment to them made at the same moment is either refused (AC-04) or, if it was recorded first, undone by the deactivation itself with its own activity line — open ones appear under "unassigned" for the team without reloading, and each thread records "unassigned — <member> was deactivated"; conversations of another workspace the same account belongs to keep that assignee; reactivating the member later does not give the conversations back
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to assign, unassign, close or reopen a conversation of "Acme Flowers", or to see its assignee, status or activity (for example through a saved link)
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace or the conversation exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Story: close → customer writes via webhook → conversation open with the same assignee, unread + waiting, `reopened — the customer wrote` line, `activity` frame on a teammate's socket — `apps/api/src/e2e/assignment-flows.int.test.ts`
- [ ] Story: close while a reply is sending → fake Bot API blocks → `not_delivered` → reopened with `reply_not_delivered`; same for an unknown outcome → `not_confirmed` (AC-08)
- [ ] Story: owner deactivates an assignee of open and closed conversations → all unassigned with their lines, other workspace untouched, open ones under `?assignee=unassigned` (AC-10)
- [ ] Story: account of another workspace, deactivated member, signed out → 404 / 403 / 401 on every new route and read; nothing changed (AC-11)
- [ ] Run both integrity queries after the stories — `helpers.ts`
- [ ] Secrecy: scan every new JSON body, socket frame and captured log line for the token; assert change logs carry no display name and no message text — `apps/api/src/modules/bots/http/secrecy.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Customer edits a message after the close | stays closed, no line |
| Display name containing a token-like string | not a leak unless it is this bot's token (test uses a distinct token) |
| Socket of another workspace | receives no `activity` frame |

## Definition of Done

- [ ] The e2e stories pass against Postgres and the fake Bot API (webhook reopen, failed-reply reopen, deactivation unassign, cross-workspace refusals, live activity frame on a teammate's socket), the integrity queries return no row after them, and the extended secrecy suite finds no token in the new responses, frames or logs and no display name or message text in change logs.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
