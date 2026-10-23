---
id: T26
title: "Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp"
layer: "ports"
deps: ["T9", "T11", "T12", "T18", "T23", "T24", "T25"]
blocks: ["T27", "T28", "T40"]
acs: ["AC-07", "AC-08"]
files_hint: ["apps/api/src/modules/broadcasts/http/routes.ts", "apps/api/src/modules/broadcasts/http/routes.int.test.ts", "apps/api/src/deps.ts", "apps/api/src/app.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp

## Place in the sequence

- **Blocked by:** T9 — Show "blocked the bot" on Contacts reads: list rows and the profile gain blocked_since for the current Telegram bot through a late-bound currentBot port, T11 — Re-register outdated webhooks in the bots health check: a webhook that is ours but lacks my_chat_member is set again with the same URL and secret, keeping pending updates, T12 — Add bots.sendBroadcastMessage and launchReadiness: a per-bot broadcast pacer at 40 ms start slots, refusal while the send pause runs, when the bot is not working or is not the launch Telegram bot, plain-text sendMessage, and every Telegram answer classified (blocked recorded in contacts), T18 — Add the broadcast group use cases: add one contact, count the matching contacts not yet in the group, add all matching as a whole or not at all, remove one, the group page with cards and breakdown, and the membership of a picker page, T23 — Add duplicate: any member copies any broadcast into a new draft named "Copy of …" within 80, a draft with its audience, a launched one as the same tags, all recipients or only the recipients it did not reach once ended, T24 — Add the broadcasts queues and workers: broadcasts.send (stately per workspace, retry 3, expire 60 s, 16 links per instance) with its dead letter that restarts the chain 60 s later, and broadcasts.measure-blocked-share logging the 48-hour blocked share, T25 — Enrich the inbox thread with broadcast items: listThreadItems returns broadcast entries with the broadcast name, text and launching owner from broadcasts.itemDetails, and getThreadBroadcastItem reads one · **Blocks:** T27 — Add the API end-to-end broadcasts stories, the cross-workspace and secrecy suite, the broadcastIntegrity run-book queries and the live-push assertions, T28 — Add the seeded sending and timing checks: pace per 1 s window with two broadcasts, 1 000 recipients within 90 s, replies during a broadcast, a reply's 429 pausing broadcasts, the stop within 2 s, the 10 000-contact draft count and launch, and blocked freshness, T40 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components · **Wave:** 8 — after T9, T11, T12, T18, T23, T24, T25.
- **Lane:** shares `apps/api/src/app.ts` with T24 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to see the final number of recipients and the text one last time, then launch the broadcast
> **So that** the message goes out once, to the customers I confirmed, from the workspace's bot
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It puts the whole broadcasts module behind its HTTP routes and wires it to the real contacts, bots, conversations, workspaces and inbox modules, so a business owner can actually launch from the panel.

## Inlined context

> Build order in `buildDeps()`: … `contacts` → `conversations` → `bots` core (now with `sendBroadcastMessage`) → `notifications` → `team` → **`broadcasts`** (needs contacts, conversations, bots, workspaces) → `inbox` (now given `broadcasts.itemDetails` for the thread). `contacts` gets its `currentBot` port from the `bots` core, late-bound like the existing ports (a runtime edge, no import).
>
> — `sad.md §5, build order, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. It keeps the graph acyclic: nothing calls `broadcasts` back (blocks are learned in `bots` → `contacts`, tag deletes are detected at read time per ADR-0004, bot changes are detected by the sender per ADR-0008), so `broadcasts` needs no inbound port. Telegram stays inside `bots` (`sendBroadcastMessage`, ADR-0008) and the thread stays inside `conversations` (ADR-0010). The sender is a pg-boss job in the same process, so no separate `worker` surface.
>
> — `adr/0001 §Decision outcome, ADR-0001, verbatim` · full text: [ADR-0001](../adr/0001-add-a-broadcasts-module-that-owns-drafts-groups-and-recipients-and-reaches-other-modules-through-their-app-layers.md)

> **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildDeps()` constructs module dependencies (shared by `buildApp()` and the CLI) and only `buildApp()` registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules, Module wiring, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | Authentication / authorization | session + workspace membership guard on every route. Roles: any active member lists, reads, creates, edits, duplicates, adds to / removes from groups; the draft author or a business owner deletes a draft; only a business owner launches and stops, re-checked under `workspaces.lockActiveMembers` (`FOR SHARE`) inside the action's transaction. Foreign ids answer 404 (`NotFoundError`) with no hint | workspaces guard; ADR-0006, ADR-0009 |
>
> — `sad.md §8, Authentication / authorization, verbatim` · full text: [sad.md](../sad.md)

> | Logging | pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only. The group picker's search text is masked in request logs, like the Contacts search | CLAUDE.md, contacts SAD §8, here |
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

> - **F-1 · sad.md §5/§8 route names are intent** — the SAD's indicative routes become this contract's action POSTs and the two save routes (assumptions 1, 2). Same guards, same semantics. **Accepted**; the SAD says "`api` fixes the names". Owner: `tasks` (route names come from this contract).
>
> — `contracts/api-sync-report.md §Flags, F-1, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

All under `/api/workspaces/{workspaceId}`, behind the workspace-access guard (`401 UNAUTHENTICATED`, `403 ACCESS_REMOVED`, `404 NOT_FOUND` with no hint):

| Method | Path | operationId | Success | Who |
|---|---|---|---|---|
| GET | `/broadcasts` | `listBroadcasts` | 200 | member |
| POST | `/broadcasts` | `createBroadcast` | 201 | member |
| GET | `/broadcasts/{broadcastId}` | `getBroadcast` | 200 | member |
| POST | `/broadcasts/{broadcastId}/save` | `saveBroadcastFields` | 200 | member |
| POST | `/broadcasts/{broadcastId}/audience` | `saveBroadcastAudience` | 200 | member |
| GET | `/broadcasts/{broadcastId}/group` | `listBroadcastGroup` | 200 | member |
| GET | `/broadcasts/{broadcastId}/group/membership` | `getBroadcastGroupMembership` | 200 | member |
| POST | `/broadcasts/{broadcastId}/group/contacts` | `addBroadcastGroupContact` | 200 | member |
| POST | `/broadcasts/{broadcastId}/group/contacts/{contactId}/remove` | `removeBroadcastGroupContact` | 200 | member |
| GET | `/broadcasts/{broadcastId}/group/matching` | `countBroadcastGroupMatching` | 200 | member (q masked) |
| POST | `/broadcasts/{broadcastId}/group/add-matching` | `addBroadcastGroupMatching` | 200 | member |
| POST | `/broadcasts/{broadcastId}/delete` | `deleteBroadcast` | 200 | author or owner (in the use case) |
| POST | `/broadcasts/{broadcastId}/duplicate` | `duplicateBroadcast` | 201 | member |
| GET | `/broadcasts/{broadcastId}/launch-confirmation` | `getLaunchConfirmation` | 200 | **owner only** |
| POST | `/broadcasts/{broadcastId}/launch` | `launchBroadcast` | 200 | **owner only** |
| POST | `/broadcasts/{broadcastId}/stop` | `stopBroadcast` | 200 | **owner only** |
| GET | `/broadcasts/{broadcastId}/recipients` | `listBroadcastRecipients` | 200 | member |

Every `BROADCAST_*` refusal, `OWNER_ONLY` (`BroadcastOwnerRouteForbidden`: operator on the launch confirmation, the launch or the stop), `FORBIDDEN` (delete by a non-author operator), `TAG_NOT_FOUND`, `VALIDATION_ERROR` and `429 BROADCAST_LAUNCH_LIMIT_REACHED` with `Retry-After` are mapped exactly as the operations list them.

— `contracts/openapi.yaml §paths (broadcasts), abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-07 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they open a draft they could launch if they were an owner, or try to launch it in any other way (for example from a saved link to the confirmation), or try to delete a draft that a teammate created
> **Then** the draft shows no launch action and says that only a business owner launches broadcasts; the attempt sends nothing and changes nothing; the delete is refused with the explanation that a draft is deleted by its author or a business owner; the operator can still edit, duplicate and delete their own drafts
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `registerBroadcasts(app, deps)`: the seventeen operations with their zod schemas from `packages/shared/src/broadcasts.ts`, `member` / `[...member, ownerOnly(...)]` guard chains after the contacts precedent — `apps/api/src/modules/broadcasts/http/routes.ts`
- [ ] Map `already_launched`, `unchanged`, `recorded` outcomes and every refusal to the contract status and body; set `Retry-After` on the launch limit — same file
- [ ] `buildDeps()`: construct `broadcasts` after `team` with `ContactsApi` (audiences, isBlocked, cards), `ConversationsApi` (`recordBroadcastItem`), `BotsApi` (`sendBroadcastMessage`, `launchReadiness`), `WorkspacesApi` (`lockActiveMembers`, display names); late-bind `contacts.currentBot` from the `bots` core and `bots`' `recordBlockChange` port from `contacts`; give `inbox` `broadcasts.itemDetails` — `apps/api/src/deps.ts`
- [ ] `buildApp()`: `registerBroadcasts` under `/api`, the broadcasts queues and workers (T24) — `apps/api/src/app.ts`
- [ ] Route integration tests per operation and per listed error code, the owner-only trio, foreign ids, deactivated / signed-out callers, `q` masked in the request log, boot with three queues — `apps/api/src/modules/broadcasts/http/routes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| operator opens the launch confirmation, launches or stops | `403 OWNER_ONLY`, nothing changes (AC-07, AC-18) |
| deactivated member calls the launch | `403 ACCESS_REMOVED`, nothing launched (AC-08) |
| broadcast id of another workspace | `404` with no hint (AC-08) |
| contact id of another workspace in a group add | `404`, no row (AC-08) |
| non-author operator deletes a teammate's draft | `403 FORBIDDEN` (AC-07) |
| picker search `q` in the URL | masked as `q=[redacted]` in the request log |
| contacts ⇄ bots ports wired in a cycle | late-bound at runtime; no static import between the modules |

## Definition of Done

- [ ] Route integration tests prove every broadcasts operation answers its contract shape and every listed error code through the real modules, an operator gets 403 OWNER_ONLY on the launch confirmation, the launch and the stop, a foreign broadcast or contact id is 404 with no hint, a deactivated member gets 403 ACCESS_REMOVED and a signed-out caller 401, the group picker's q is masked in request logs, and buildApp boots with the three new queues registered.
- [ ] `pnpm -r build` and the smoke test `apps/api/src/app.int.test.ts` stay green with the new module registered.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
