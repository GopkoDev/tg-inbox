---
id: T40
title: "Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components"
layer: "docs"
deps: ["T26", "T33", "T34", "T36", "T37", "T38"]
blocks: []
acs: ["AC-08"]
files_hint: ["CLAUDE.md", "docs/architecture-map.md", "docs/design-system.md", "CONTEXT.md", "docs/features/broadcasts/sad.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
step: ""
---

# T40 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components

## Place in the sequence

- **Blocked by:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp, T33 — Build the broadcast group on SCR-25 and SCR-26: BroadcastGroupList with tags, blocked markers and Remove, and GroupPicker over the Contacts read with membership marks, Add, and the two-step Add all matching, T34 — Build SCR-27, the LaunchConfirmDialog on the /launch address: the exact text, the count, who is left out and why, the risk warning, launch with the version and fingerprint, the re-ask on a changed draft or audience, and the operator redirect, T36 — Build SCR-30, the DuplicateBroadcastDialog from the list, the draft and the broadcast page: the audience choice with per-option counts, "did not reach" disabled until the broadcast ends, and the not-confirmed warning, T37 — Render the broadcast item in the inbox thread (SCR-02): BroadcastItem as a new ThreadItemView kind with the name linking to the broadcast, the launching owner, the text and the delivered or not-confirmed time, inserted live without touching read state or attention, T38 — Show the blocked mark on Contacts (SCR-18) and the profile (SCR-19), re-read live on contact.changed reach · **Blocks:** — · **Wave:** 9 — after T26, T33, T34, T36, T37, T38.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It keeps the project's short rules, the architecture map, the design-system canon and the glossary true after broadcasts ship, so the next feature builds on the real picture.

## Inlined context

> After promotion: […] 3. Update `CLAUDE.md` and `docs/architecture-map.md` with the new module, its tables, `contact_bot_reach` under `contacts` and `broadcast_items` under `conversations`.
>
> — `_audit/data-model-2026-10-23.md §Staged migrations, After promotion, 3, abridged` · full text: [audit](../_audit/data-model-2026-10-23.md)

> | Table | Owner | Holds |
> |---|---|---|
> | `broadcasts` | broadcasts | name, text, status (`draft` / `sending` / `sent` / `stopped`), `version`, audience kind, tag mode, author, last changed by / at; after launch: launched by / at, the launch Telegram bot id, the frozen audience definition (tag names at launch), stopped by / at, finished at, end reason |
> | `broadcast_audience_tags` | broadcasts | per draft (and frozen per launched broadcast): tag id, include / exclude, tag name when chosen (no foreign key to `tags`: a delete is detected at read, ADR-0004) |
> | `broadcast_group_contacts` | broadcasts | per draft: contact id (composite FK to `contacts`), added by, added at; primary key (workspace, broadcast, contact) |
> | `broadcast_recipients` | broadcasts | per launched broadcast: contact id (composite FK), Telegram user id (the chat), turn order, state (…), reason, claimed at, outcome at, Telegram message id; unique (workspace, broadcast, contact) |
> | `contact_bot_reach` | contacts | per contact and Telegram bot id: wrote at, blocked at (null = not blocked), changed at (Telegram time of the newest fact) — ADR-0002 |
> | `broadcast_items` | conversations | per broadcast and recipient conversation: state `delivered` / `not_confirmed`, position time, Telegram message id — ADR-0010 |
>
> — `sad.md §5, Tables at a glance, abridged` · full text: [sad.md](../sad.md)

> Static edges added: `broadcasts → {contacts, conversations, bots, workspaces}` and `inbox → broadcasts`. No module calls `broadcasts` back, so it needs no port, and the graph stays acyclic. `bots` stays the only module that talks to Telegram. `inbox` keeps owning no tables. `broadcasts` registers its own routes under `/api/workspaces/:workspaceId/broadcasts…`, like `contacts`
>
> — `sad.md §4, choice 1, abridged` · full text: [sad.md](../sad.md)

> broadcasts adds three queues, created and registered by `buildApp()`: `broadcasts.send` (`stately`, `singletonKey` = workspace id, retry limit 3 with back-off, expire 60 s) · `broadcasts.send-dlq` · `broadcasts.measure-blocked-share` (`singletonKey` = broadcast id, retry limit 2)
>
> — `sad.md §7, queue table, abridged` · full text: [sad.md](../sad.md)

> - **F-2 · `BROADCAST_NOT_ENDED` is not in sad.md §8's code list** — flow 15 draws "refused, not ended yet" without naming a code; reusing `BROADCAST_NOT_A_DRAFT` would mislead (the source is not a draft either way). **Accepted** as the contract's proposal; a one-line §8 addition can follow at the next `design` touch.
>
> — `contracts/api-sync-report.md §Flags, F-2, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> | Component | Why no existing primitive fits | Registered in design-system |
> |---|---|---|
> | BroadcastsTable · BroadcastEditor · AudienceBreakdown · BroadcastGroupList · GroupPicker · LaunchConfirmDialog · BroadcastPage · BroadcastReport · StopBroadcastDialog · DuplicateBroadcastDialog · DeleteDraftDialog · SwitchAudienceDialog · BroadcastItem · BroadcastCrumb | (new) | pending |
> | TagFilter · ThreadItemView · ContactsTable · ContactProfile · AppShell (extended) | canon row updated, not duplicated | pending |
>
> — `screens.md §New components, table, abridged` · full text: [screens.md](../screens.md)

> - A launched broadcast's text and recipient list never change, and the business bot sends it to each recipient at most once.
>
> — `CONTEXT.md §Invariants, broadcast invariant (already present), verbatim` · full text: [CONTEXT.md](../../../../CONTEXT.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (documents the tables of T2 / T3).

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `CLAUDE.md` Layout: the `broadcasts` module (routes, four tables, three queues, `broadcast.changed`), `contact_bot_reach` under `contacts`, `broadcast_items` and the thread kind under `conversations`, `my_chat_member` / `sendBroadcastMessage` / the broadcast pacer under `bots`, the `buildDeps()` order, the new edges; a **Broadcasts** rule (owner-only launch / stop, lock order, at-most-once claim, codes); tenancy exceptions unchanged — `CLAUDE.md`
- [ ] Architecture map: module inventory row, datastores, edges, queues, signals, the `broadcastIntegrity` queries, closest precedents, `reflects_commit` — `docs/architecture-map.md`
- [ ] Design-system canon: register the fourteen new components and update the five extended rows (`pending` → registered) — `docs/design-system.md`
- [ ] `CONTEXT.md`: confirm every broadcasts term used by the built screens is in the Glossary (Audience, Broadcast, Broadcast group, Broadcast item, Blocked the bot, Count breakdown, Draft author, Recipient list, Tag audience, …) and the invariant stands; add only what the build introduced — `CONTEXT.md`
- [ ] `sad.md` §8 Error handling: add `BROADCAST_NOT_ENDED` (409, duplicate "did not reach" before the end) and name `OWNER_ONLY` for an operator's launch / stop as the contract fixed it (api F-2) — `docs/features/broadcasts/sad.md`

## Edge cases

| Case | Behaviour |
|---|---|
| a technical SAD term (fingerprint, sending link, claim, reach row, position) | stays out of CONTEXT.md (glossary 2026-10-23 kept them in the SAD) |
| a component built under another name than screens.md | the canon uses the built name and notes the screens.md name |
| the map's tenancy exceptions list | still six; broadcasts adds none |

## Definition of Done

- [ ] CLAUDE.md and the architecture map name the broadcasts module with its routes, four tables, three queues and the broadcast.changed signal, the edges broadcasts → {contacts, conversations, bots, workspaces} and inbox → broadcasts, contact_bot_reach under contacts and broadcast_items under conversations, with the tenancy exceptions unchanged; the design-system canon registers every new and extended component of screens.md; and sad.md §8 lists BROADCAST_NOT_ENDED (api flag F-2).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
