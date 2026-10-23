---
id: T14
title: "Teach the inbox hub to read presence frames and report socket lifecycle to notifications, and deliver telegram_link.changed only to that account's sockets"
layer: "ports"
deps: ["T2", "T13"]
blocks: ["T21"]
acs: ["AC-04", "AC-07"]
files_hint: ["apps/api/src/modules/inbox/infra/hub.ts", "apps/api/src/app.ts", "apps/api/src/deps.ts", "apps/api/src/modules/inbox/http/live.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T14 — Teach the inbox hub to read presence frames and report socket lifecycle to notifications, and deliver telegram_link.changed only to that account's sockets

## Place in the sequence

- **Blocked by:** T2 — Add the notifications zod contracts, the three error codes, the presence client frame and the telegram_link.changed frame and signal, T13 — Add the presence use cases opened / alive / screen / closed, with the member's expired-lease cleanup and the ping opened-at mark · **Blocks:** T21 — Add the API end-to-end notification stories, the integrity checks, the reply-under-ping-load test, and the secrecy assertions for pings, answers, logs and frames · **Wave:** 4 — after T2, T13.
- **Lane:** shares `apps/api/src/deps.ts` with T7; shares `apps/api/src/deps.ts` with T12; shares `apps/api/src/app.ts` with T15; shares `apps/api/src/app.ts` with T17; shares `apps/api/src/deps.ts` with T18; shares `apps/api/src/app.ts`, `apps/api/src/deps.ts` with T19; shares `apps/api/src/deps.ts` with T20; shares `apps/api/src/app.ts` with T27 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It makes presence a server-side fact on every instance and lets a member's own tabs see their link change live.

## Inlined context

> - The client sends one small frame `{ type: 'presence', onScreen }` when the socket opens and on every `visibilitychange`. This is the first client frame the socket reads, within the existing 1024-byte limit. `document.visibilityState === 'visible'` is exactly "the selected tab of a window that is not minimised". A covered window may still report visible, which is the spec's safe direction. When a tab leaves the screen, the server stamps `last_on_screen_at = now`.
>
> — `sad.md §4, choice 2, client frame, verbatim` · full text: [sad.md](../sad.md)

> coalesced to one write per second per socket, the last value wins;
> every write is scoped by the socket's workspace id and connection id, so a frame affects only its own member's lease (sad.md §8 *Untrusted content*).
> The server reads only `presence` and ignores anything else without closing the socket.
>
> — `contracts/events.md §Frame: presence, server handling, abridged` · full text: [events.md](../contracts/events.md)

> - **Delivered to:** only the sockets of the signal's `account_id` in that workspace (the hub's existing account filter, as for `read`). No teammate's tab learns about a member's link.
>
> — `contracts/events.md §Frame: telegram_link.changed, Delivered to, verbatim` · full text: [events.md](../contracts/events.md)

> **Chosen:** Option 1. It follows the decided signal pattern and reuses the hub's existing account filter. It discloses nothing to teammates, and it covers every link change wherever it happens, including webhooks and jobs on another instance, through `LISTEN/NOTIFY`.
>
> — `adr/0010-signal-telegram-link-changes-on-an-account-scoped-frame-delivered-only-to-that-members-sockets.md §Decision outcome, ADR-0010, verbatim` · full text: [ADR-0010](../adr/0010-signal-telegram-link-changes-on-an-account-scoped-frame-delivered-only-to-that-members-sockets.md)

> integration test with a test socket that stops answering keep-alive pings (simulated dead connection): away within 60 s on the presence predicate. A closed socket: away at once;
> integration test with a presence frame `onScreen: false`: present at 10 min, away at 10 min + one sweep;
>
> — `sad.md §10, QG-3 How verify, abridged` · full text: [sad.md](../sad.md)

> | The socket starts reading client frames for the first time. A malformed or flooding client could load the hub. | Low | Only `presence` is accepted. It is zod-parsed and limited by the existing 1024-byte cap, and at most one write per frame is coalesced per 1 s per socket. Anything else is ignored. | Tech Lead |
>
> — `sad.md §11, socket reads frames, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (writes go through the T13 use cases).

## API contract

`openLiveSocket` (changed): client → server `presence { v: 1, on_screen }` is the only frame read, within `LIVE_MAX_INBOUND_BYTES` 1024; the open registers a lease, every pong extends it, a clean close (incl. `4403` / `4401`) deletes it; server → client `telegram_link.changed { v: 1, workspace_id }` only to that account. — `contracts/openapi.yaml, openLiveSocket, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

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

## Checklist

- [ ] Generate a UUIDv7 connection id per socket; call `presence.opened` on upgrade, `alive` on each pong, `closed` on close — `apps/api/src/modules/inbox/infra/hub.ts`
- [ ] Read inbound frames: `PresenceFrame.safeParse`, ignore anything else, coalesce to one `screen` write per second per socket — same file
- [ ] Map the `telegram_link.changed` signal to the frame for the signal's account sockets in that workspace (as `read`) — same file
- [ ] Pass the presence use cases into the hub from `buildApp()` / `buildDeps()` — `apps/api/src/app.ts`, `apps/api/src/deps.ts`
- [ ] Integration tests: dead socket away ≤ 60 s, closed socket away at once, hidden tab away after 10 min, junk and oversized frames ignored, frame reaches only the account's sockets — `apps/api/src/modules/inbox/http/live.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| 10 presence frames in one second | one write, last value |
| Frame over 1024 bytes or unknown type | ignored, socket stays open |
| `telegram_link.changed` for a teammate | never reaches my socket |
| Socket closed with `4403` on deactivation | lease deleted |

## Definition of Done

- [ ] Live-socket integration tests prove a lease is registered on open, extended by pongs and deleted on a clean close, a dead socket counts away within 60 s and a hidden one after 10 minutes, invalid or oversized frames are ignored without closing, writes coalesce per second, and telegram_link.changed reaches only that account's sockets in that workspace.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
