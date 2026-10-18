---
id: T20
title: "Add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync"
layer: "ports"
deps: ["T3", "T16"]
blocks: ["T21", "T22"]
acs: ["AC-09", "AC-15"]
files_hint: ["apps/api/src/modules/inbox/infra/hub.ts", "apps/api/src/modules/inbox/infra/hub.test.ts", "apps/api/src/modules/inbox/http/routes.ts", "apps/api/src/modules/inbox/http/live.int.test.ts", "apps/api/src/app.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T20 — Add the live socket endpoint and hub: guarded upgrade with origin check, per-workspace dispatch, deactivation close, 5 s re-validation, ping and resync

## Place in the sequence

- **Blocked by:** T3 — Build platform/realtime: an in-transaction pg_notify publisher and a dedicated-connection listener with reconnect and gap resync, T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp · **Blocks:** T21 — Add the API end-to-end inbox stories and extend the token-secrecy suite to inbox responses, media, socket frames and logs, T22 — Update CLAUDE.md, the architecture map and the design-system canon for the inbox module, platform/realtime, the delivery queue and the new components · **Wave:** 6 — after T3, T16.
- **Lane:** shares `modules/inbox/http/routes.ts`, `app.ts`, `deps.ts` with T16–T19 — serialized.

## Why (user story)

> **As an** Operator
> **I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
> **So that** our team does not miss messages or give a customer two different answers
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It carries every live change to the open inboxes of one workspace, and cuts a member off within 5 seconds of losing access.

## Inlined context

> Rules that come with it: the socket is opened per tab for one workspace (`/api/workspaces/:workspaceId/…`), authenticated at the upgrade by the session cookie and the workspace guard, with the `Origin` header required to be the panel's own origin; switching workspace closes it and opens another. A deactivation signal closes the member's sockets of that workspace at once with an "access removed" close reason; independently, each instance re-validates all its open sockets every 5 s in one query per workspace (session still valid, membership still active) and closes any that fail — the guarantee does not depend on a signal arriving.
>
> — `adr/0002, Decision outcome, verbatim` · full text: [ADR-0002](../adr/0002-push-change-signals-over-a-per-tab-workspace-bound-websocket-and-refetch-through-the-reads.md)

> | `4403` | Access removed. The membership was deactivated (the signal or the 5 s re-check) | […] |
> | `4401` | The session ended or expired (the 5 s re-check) | […] |
> | `1001` | The server is going away (restart, deploy) | Reconnect with backoff, then resync |
>
> — `contracts/events.md §Close codes, abridged` · full text: [events.md](../contracts/events.md)

> - **Direction:** server → client only. The client sends no data frames, and the server ignores any it receives.
> - **Heartbeat:** the server sends a WebSocket ping every 25 s.
>
> — `contracts/events.md §Channel: live socket, verbatim` · full text: [events.md](../contracts/events.md)

> | Access revocation | live stream of a deactivated or switched-away member stops ≤ 5 s | integration test: deactivate → no further events for that member |
>
> — `spec.md §6, NFR table, verbatim` · full text: [spec.md](../spec.md)

> integration test: deactivate → no further signals for that member within 5 s even with the deactivation signal suppressed (the 5 s re-validation alone must close it)
>
> — `sad.md §10, QG-2 How verify, abridged` · full text: [sad.md](../sad.md)

> pino via `platform/logger.ts`; existing redactions kept; reply text, message text and captions, file names, Telegram file paths and download URLs, the token and NOTIFY payloads are never logged — delivery and media logs carry ids, kinds, states and durations only; gateway errors are mapped to typed outcomes without copying Telegram's text
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET /api/workspaces/{workspaceId}/inbox/live` (`openLiveSocket`, `Upgrade: websocket`, `Origin` = `PUBLIC_WEB_URL`) → `101`; refusals as plain HTTP before the handshake: `401 UNAUTHENTICATED`, `403 ACCESS_REMOVED`, `403 FORBIDDEN` (foreign origin), `404 NOT_FOUND`.
- Frames (`LiveFrame` from T2): `conversation.changed` v1 (a `read` change only to the reading member's sockets), `bot.changed` v1, `resync` v1. `membership.deactivated` is not forwarded — it closes that account's sockets with `4403`.

— `contracts/openapi.yaml, openLiveSocket + contracts/events.md, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-09 — authorization

> **Given** an operator of "Acme Flowers" with the inbox open
> **When** a business owner deactivates their membership, or the operator switches to another workspace in that browser tab
> **Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment; switching affects only that tab — another tab of the same account still showing "Acme Flowers" keeps working; after deactivation, the member's replies still waiting to be retried are not sent and end "not delivered — the author's access was removed"
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — happy path

> **Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
> **When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
> **Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in a thread open in a visible browser tab counts as read for the operator looking at it (a tab in the background does not mark anything read), an edit does not make a message unread again, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Hub: sockets indexed by workspace and account; dispatch realtime signals as frames; `read` only to its account; `membership.deactivated` → close `4403`; listener gap → `resync` to all — `modules/inbox/infra/hub.ts`
- [ ] Re-validation every 5 s: one query per workspace with open sockets (sessions + `activeMembersAmong`), close `4401` / `4403`; ping every 25 s; ignore inbound frames — `modules/inbox/infra/hub.ts`
- [ ] Upgrade route behind session resolver + workspace guard + origin check; register; start the realtime listener in `buildApp()` and stop it in `destroy()` — `modules/inbox/http/routes.ts`, `apps/api/src/app.ts`, `deps.ts`
- [ ] Tests: unit dispatch rules; integration with a real socket client: frame arrives ≤ 3 s after a capture, foreign origin refused, deactivation closes `4403` at once, with the signal suppressed the re-check closes within 5 s, session expiry → `4401`, a frame of workspace B never reaches a socket of A — `modules/inbox/infra/hub.test.ts`, `http/live.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `Origin` of another site | `403 FORBIDDEN` before the handshake |
| Same account, two tabs on two workspaces | each socket gets only its workspace's frames; deactivation in A closes only A's socket |
| Deactivation signal lost | closed by the next 5 s re-check |
| Client sends a frame | ignored |
| Listener reconnect | every socket gets `resync` |

## Definition of Done

- [ ] integration tests prove the guarded upgrade, origin refusal, per-workspace dispatch, read-only-to-self, `4403` on deactivation, ≤ 5 s close with the signal suppressed, `4401` on session end and `resync` after a listener gap
- [ ] push latency from commit to socket write asserted ≤ 3 s in CI
- [ ] frames carry ids only
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
