---
id: T7
title: "Add workspaces.timeZone and setTimeZone in the workspaces app layer"
layer: "app"
deps: ["T3", "T1"]
blocks: ["T9"]
acs: ["AC-09"]
files_hint: ["apps/api/src/modules/workspaces/"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
step: ""
---

# T7 — Add workspaces.timeZone and setTimeZone in the workspaces app layer

## Place in the sequence

- **Blocked by:** T3 — Promote staged migrations 01–04 (workspaces.time_zone, desti, T1 — Add the shared workspace time-zone rule: IANA validity, loca · **Blocks:** T9 — Add the destination use cases: create and read a connect cod · **Wave:** 2 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to choose when a post goes out, in the business's time zone, and change or cancel that until it goes out
> **So that** posts appear at the right moment without anyone being online then
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add workspaces.timeZone and setTimeZone in the workspaces app layer.

## Inlined context

> `workspaces`: `timeZone(workspaceId)`, `setTimeZone(tx, workspaceId, zone)` (an app-layer call, no route of its own — the owner-only route is in `posts`)
>
> — `sad.md §5 App-layer additions, verbatim` · full text: [sad.md](../sad.md)

> Module rule: only `workspaces` writes its table.
>
> — `adr/0006, Decision drivers, verbatim` · full text: [adr/0006](../adr/)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

`workspaces.time_zone` text NULL, CHECK 1–64 chars, trimmed — read / write.

— `data-model.md §Entities workspaces, verbatim`

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] repo methods `getTimeZone(workspaceId)`, `setTimeZone(tx, workspaceId, zone)`
- [ ] app layer exposes both; validates with `isValidTimeZone` (T1)
- [ ] integration test incl. cross-workspace isolation

## Edge cases

| Case | Behaviour |
|---|---|
| invalid zone | `TimeZoneInvalidError` |
| same zone | no write |

## Definition of Done

- [ ] integration tests pass (isolation included)
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
