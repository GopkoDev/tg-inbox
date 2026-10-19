---
id: T29
title: "Add browser end-to-end notification flows against the real API and the fake Bot API"
layer: "tests"
deps: ["T21", "T23", "T25", "T27", "T28"]
blocks: []
acs: ["AC-01", "AC-04", "AC-07", "AC-12"]
files_hint: ["apps/web/e2e/notifications.spec.ts", "apps/web/e2e/support/world.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T29 — Add browser end-to-end notification flows against the real API and the fake Bot API

## Place in the sequence

- **Blocked by:** T21 — Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames, T23 — Build the attention store and SCR-15's count: the (N) title prefix, the Inbox SidebarMenuBadge, the phone header badge, the collapsed tooltip and Settings for operators, T25 — Build SCR-17, the ConnectTelegramDialog: the link with Copy and Open in Telegram, its expiry, waiting for Start, the live turn to Connected, new-link refusals and the bot-stopped state, T27 — Add the desktop notifier and the notifications-only service worker: candidates from the tabs, focus check, tag replace, dedupe and the click to the most recently focused tab (OS-02), T28 — Add the «Telegram pings» column to Settings — Team (SCR-13) and the pings sentence to the deactivate confirmation (SCR-14) · **Blocks:** — · **Wave:** 7 — after T21, T23, T25, T27, T28.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** the browser tab and the navigation to show how many conversations need me
> **So that** I notice new customer messages while I work on another page or another tab
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It proves the count, the connect dialog and a ping's landing through a real browser.

## Inlined context

> - Integration: `*.int.test.ts` — real Postgres via Testcontainers (`apps/api/src/test/postgres.ts` applies migrations), HTTP via `app.inject()`. Needs Docker.
>
> — `CLAUDE.md §Tests, Integration, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | In-web latency: customer message captured → attention count / desktop notification updated in an open tab, p95 | ≤ 3 s (shared-inbox live-update target) | server-side timing from capture to push, logged per event; CI integration test asserts the push |
>
> — `spec.md §6, In-web latency, verbatim` · full text: [spec.md](../spec.md)

> | default: lens from a combined ping | a TG-03 link `/w/<id>/inbox?assignee=mine`, `?assignee=unassigned` or `/w/<id>/inbox` (open · all) — the existing «lens from the address» state opens that lens (AC-08; flow 14) | extended: InboxList, ConversationList | — |
> | default: from a single-conversation ping | a TG-03 link `/w/<id>/inbox/<conversationId>` — the thread opens (the existing «opened outside the lens» state when it is not in the default lens) (AC-07, AC-09; flow 14) | Thread, InboxList | — |
>
> — `screens.md §SCR-01 / SCR-02, ping landings, verbatim` · full text: [screens.md](../screens.md)

> web tests (Testing Library): the title and badge update on a frame. […] Service-worker unit tests with mocked `clients` check the focus skip, the tag replacement, the dedupe across two tabs and the click to the first client;
>
> — `sad.md §10, QG-3 How verify, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Drives the panel against the real API (all four new operations, the live socket) and the fake Bot API (webhook `/start tgi_…`, pings).

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" with the inbox open: 2 open conversations assigned to them and 1 unassigned open conversation have customer messages they have not read, while a teammate's conversation and a closed one also have unread messages
> **When** they look at the browser tab or move to Settings or Contacts
> **Then** the tab title starts with "(3)" and the Inbox item in the side navigation shows 3: the **attention count** includes only open conversations that are theirs or unassigned and have unread messages for them. It changes without reloading within the live-update target of §6 as messages arrive, as they read conversations and as conversations are assigned, closed or reopened. At 0 the title has no count and the navigation shows no number. Each tab shows the count of its own workspace. A business owner sees the same.
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — happy path

> **Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
> **When** they choose "Connect Telegram" in the panel, open the link it shows on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
> **Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — happy path

> **Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
> **When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
> **Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping at that point. If they become away later while the customer is still waiting and the message is still unread for them, the ping goes out as soon as they are counted away. The 5 minutes always run from the start of the wait. For a waiting period that began when a conversation reopened (AC-08), the clock starts at the reopen. Having read the earlier messages does not hold such a ping back, because the customer's message was read and the team's reply did not reach them.
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Flow: a customer writes in an unassigned conversation while the member is on Contacts → title `(1) tg-inbox` and the Inbox badge within 3 s; reading it → no prefix (AC-01) — `apps/web/e2e/notifications.spec.ts`
- [ ] Flow: Settings — Notifications → Connect Telegram → dialog with Copy and Open in Telegram → test posts `/start tgi_…` to the webhook → dialog turns Connected live; Disconnect → Not connected (AC-04)
- [ ] Flow: a ping's single-conversation link and the `?assignee=mine` link open the thread / lens; signed out → sign-in and back; another workspace's account → not found (AC-07, AC-12)
- [ ] Flow: an operator sees Settings with Notifications only; the owner sees the Team column On after a connect (reload) — world helpers for links and recorded updates — `apps/web/e2e/support/world.ts`
- [ ] Desktop notifications stay covered by the T27 unit tests (headless browsers do not show OS notifications); the e2e only checks the card's not-available / off state

## Edge cases

| Case | Behaviour |
|---|---|
| Headless Chromium without notification support | desktop card shows Off or Not available; flow still passes |
| Clipboard denied in the browser context | Copy hidden, link selectable |

## Definition of Done

- [ ] The browser flows pass locally and in CI with pnpm test:e2e: the live attention count across pages, connect via a webhook start turning the dialog Connected and Disconnect, ping links landing on the thread and the mine lens through sign-in, a foreign account getting not found, and the role-filtered Settings with the Team mark.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
