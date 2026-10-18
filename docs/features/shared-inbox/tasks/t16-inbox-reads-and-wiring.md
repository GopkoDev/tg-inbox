---
id: T16
title: "Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp"
layer: "ports"
deps: ["T2", "T7", "T9", "T12", "T13"]
blocks: ["T17", "T19", "T20"]
acs: ["AC-01", "AC-02", "AC-03", "AC-08", "AC-18"]
files_hint: ["apps/api/src/modules/inbox/app/", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/reads.int.test.ts", "apps/api/src/deps.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp

## Place in the sequence

- **Blocked by:** T2 — Define the inbox zod contracts, the live-frame schemas and the six new error codes, T7 — Give workspaces an active-since time, a richer guard result, active-member and display-name lookups and a deactivation signal; promote migration 09, T9 — Build the conversations read side: list page with unread counts, summary, thread page, single items, media reference and mark read, T12 — Add contact search ids and contacts by ids to the contacts module, T13 — Expose the inbox bot status to every member and publish bot.changed on every bot state transition · **Blocks:** T17 — Add the sendReply and resendReply use cases and routes with the flow-1 check order and the drain-job hook, T19 — Add the openMessageMedia route that streams a customer's media with forced safe headers and typed unavailability, T20 — Add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync · **Wave:** 5 — after T2, T7, T9, T12, T13.
- **Lane:** shares `modules/inbox/http/routes.ts`, `deps.ts`, `app.ts` with T17–T20 — serialized; this task goes first.

## Why (user story)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
> **So that** I answer with the full context, without asking the customer to repeat themselves
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

It turns the stored conversations into the guarded, per-member, workspace-tagged reads the panel renders and refetches.

## Inlined context

> `inbox` owns the inbox's HTTP routes, the live socket hub, the reply-delivery worker and the inbox use cases (list, search, thread, mark read, send / try again / send again, media), and calls the app layers of `conversations`, `contacts`, `bots` and `workspaces`. It owns no tables
>
> — `sad.md §5, Building block view, abridged` · full text: [sad.md](../sad.md)

> The dependency graph stays acyclic: `inbox → {conversations, contacts, bots, workspaces}`, `bots → conversations → contacts`, `bots → contacts`; nothing depends on `inbox`.
>
> — `sad.md §5, Building block view, verbatim` · full text: [sad.md](../sad.md)

> Everything under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard — another workspace's account → not found with no hint, deactivated → `ACCESS_REMOVED`, signed out → sign in (AC-08); both roles have the same inbox rights
>
> — `sad.md §8, Authorization, abridged` · full text: [sad.md](../sad.md)

> A conversation, message or reply id is always looked up together with the workspace id, so a foreign id is `404 NOT_FOUND` too. Every JSON answer carries the `workspace_id` it belongs to, and the panel drops any answer for another workspace (AC-09, AC-18).
>
> — `contracts/openapi.yaml, info.description, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> automatic live refetches send the background-request marker so they do not extend the idle session
>
> — `sad.md §8, Authentication, abridged` · full text: [sad.md](../sad.md)

> **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildDeps()` constructs module dependencies (shared by `buildApp()` and the CLI) and only `buildApp()` registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules, Module wiring, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> **Cross-module:** call the other module's **app layer** (passed in via the composition root). Never query another module's tables. Async work → pg-boss queue `<module>.<job>`.
>
> — `CLAUDE.md §Rules, Cross-module, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads through the `conversations`, `contacts`, `bots`, `workspaces` app layers only).

## API contract

- `GET /api/workspaces/{workspaceId}/inbox/conversations` (`listConversations`; `q` ≤ 200, `after`, `limit` 1–100 default 50) → `200 ConversationPage`.
- `GET …/inbox/conversations/{conversationId}` (`getConversation`) → `200 Conversation`.
- `GET …/conversations/{conversationId}/items` (`listThreadItems`; `before` xor `after`, `limit`) → `200 ThreadPage`; both cursors or a malformed one → `400 VALIDATION_ERROR`.
- `GET …/messages/{messageId}` (`getThreadMessage`) → `200 ThreadMessage`; `GET …/replies/{replyId}` (`getThreadReply`) → `200 ThreadReply` (author `display_name` from `workspaces`).
- `POST …/conversations/{conversationId}/read` (`markConversationRead`, body `{ read_through_at }`) → `200 ReadState`; `413`, `415`.
- `GET …/inbox/bot` (`getInboxBotStatus`) → `200 InboxBotStatus`.
- Every route: `401 UNAUTHENTICATED`, `403 ACCESS_REMOVED`, `404 NOT_FOUND` (no hint), honours `X-Background-Request: 1`.

— `contracts/openapi.yaml, the seven read operations, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

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

### AC-03 — happy path

> **Given** an operator of "Acme Flowers" and a conversation with 600 messages and replies
> **When** they open it
> **Then** the thread shows the latest part of the history with the contact's name in its header, the customer's messages and the team's replies in the order they happened, each reply marked with the name of the member who wrote it; scrolling up loads older history until the first message; opening the conversation marks every message that has arrived in tg-inbox so far as read for this operator only — teammates' unread counts do not change (unread is counted by arrival in tg-inbox, not by place in the history); the conversation can be reopened by reload, the browser's back button or a saved link, and a link to a conversation that does not exist shows the not-found card; on a phone-width screen the list fills the screen, picking a conversation replaces it with the thread, and a back control returns to the list
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member of "Acme Flowers", or someone not signed in
> **When** they try to open the inbox of "Acme Flowers", one of its conversations or one of its customers' media, or to send a reply in it (for example through a saved link)
> **Then** the system refuses and shows no conversation, message, media or customer of "Acme Flowers"; an account of another workspace gets no hint that the workspace or the conversation exists; a deactivated member gets the access-removed notice they already get elsewhere in the panel (they know the workspace, but see nothing of it); someone not signed in is asked to sign in first; nothing is sent to any end customer
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — cross-context

> **Given** one person writes to the bots of both "Acme Flowers" and "Bolt Bikes", and an account is a member of both workspaces
> **When** that account opens the inbox of each workspace in turn
> **Then** each inbox shows only its own workspace's conversation with that person — only the messages sent to its own bot and the replies sent by its own team — and a reply sent from one workspace goes only through that workspace's bot, to that person's conversation with it; each inbox holds at most one conversation per end customer
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Module skeleton `modules/inbox/{domain,app,infra,http}` (domain from T6); app ports for conversations, contacts, bots, workspaces, clock — `modules/inbox/app/ports.ts`
- [ ] Read use cases: list (search → contact ids → filtered page; names joined from `contacts`), summary, thread page (author names from `workspaces.displayNames`), item, mark read, bot status — `modules/inbox/app/reads.ts`
- [ ] `registerInbox(app, deps)` with zod-typed routes behind the session resolver + workspace guard — `modules/inbox/http/routes.ts`
- [ ] Build inbox deps in `buildDeps()` and register under `/api` in `buildApp()` — `apps/api/src/deps.ts`, `app.ts`
- [ ] `app.inject()` integration tests: each route's happy path, both roles equal, the guard trio (signed out / other workspace / deactivated), foreign conversation / message / reply ids → 404, two-workspace isolation for one Telegram user (AC-18), background marker not extending the session — `modules/inbox/http/reads.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Account of another workspace, guessed conversation id | `404 NOT_FOUND`, same body as an unknown id |
| Deactivated member | `403 ACCESS_REMOVED` on every read |
| `q` empty after trimming | no filter (full list) |
| `before` and `after` together | `400 VALIDATION_ERROR` |
| Operator vs business owner | identical answers |

## Definition of Done

- [ ] route integration tests pass for the seven read operations, the guard trio, foreign ids and the AC-18 two-workspace case
- [ ] every JSON answer carries `workspace_id`; responses validate against the shared schemas
- [ ] `registerInbox` is called only from `buildApp()`; inbox deps built only in `buildDeps()`
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
