---
id: T1
title: "Add the shared workspace time-zone rule: IANA validity, local wall time to instant with skipped and repeated hours, display formatting"
layer: "domain"
deps: []
blocks: ["T4", "T7", "T17"]
acs: ["AC-09", "AC-10"]
files_hint: ["packages/shared/src/time-zone.ts", "packages/shared/src/time-zone.test.ts", "packages/shared/src/index.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
step: ""
---

# T1 — Add the shared workspace time-zone rule: IANA validity, local wall time to instant with skipped and repeated hours, display formatting

## Place in the sequence

- **Blocked by:** — · **Blocks:** T4 — Add the posts domain: states and transitions, the schedule w, T7 — Add workspaces.timeZone and setTimeZone in the workspaces ap, T17 — Add the web posts API source, stores (posts, destinations, a · **Wave:** 1 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to choose when a post goes out, in the business's time zone, and change or cancel that until it goes out
> **So that** posts appear at the right moment without anyone being online then
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

This task delivers: add the shared workspace time-zone rule: IANA validity, local wall time to instant with skipped and repeated hours, display formatting.

## Inlined context

> Store the schedule as an instant and one IANA time zone on the workspace … local ↔ instant conversion and validity in one function in `packages/shared/src/time-zone.ts` used by api and web.
>
> — `adr/0006, Decision outcome + Option 1, abridged` · full text: [adr/0006](../adr/)

> A post is scheduled in the workspace's time zone … Times are picked to the minute, at least 2 minutes and at most 90 days ahead. A local time that a daylight-saving change skips cannot be picked; a repeated one means its first occurrence. Every member sees the time in the workspace's zone, with the zone named.
>
> — `spec.md §1, Assumptions «Scheduling», verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface (consumed by `schedulePost` and the web).

## Acceptance criteria

### AC-09 — happy path

> **Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
> **When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
> **Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-10 — error

> **Given** a business owner scheduling a post or changing a scheduled post's time
> **When** at the moment they confirm, the chosen time is less than 2 minutes ahead, more than 90 days ahead, the destination is unavailable, or a local time the daylight-saving change skips in the workspace's time zone
> **Then** the post is not scheduled and the owner is told the allowed range, that this time does not exist on that day, or what right the bot is missing in that chat
>
> — `spec.md §5, AC-10, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `isValidTimeZone(zone)` via `Intl.supportedValuesOf('timeZone')` / `Intl.DateTimeFormat` — `packages/shared/src/time-zone.ts`
- [ ] `localToInstant(localTime 'YYYY-MM-DDTHH:mm', zone)` → `{ok, instant}` | `{error:'does_not_exist'}`; repeated hour → first occurrence
- [ ] `formatInZone(instant, zone)` → «Wed 4 Nov, 09:00 (Europe/Kyiv)» and `instantToLocal` for prefilling
- [ ] export from `packages/shared/src/index.ts`; unit tests incl. Europe/Kyiv 2027-03-28 03:30 (skipped) and 2026-10-25 03:30 (repeated)

## Edge cases

| Case | Behaviour |
|---|---|
| skipped local time (spring forward) | `does_not_exist` |
| repeated local time (fall back) | the first (earlier) instant |
| unknown zone 'Mars/Base' | invalid |
| minute precision | seconds are always 00 |

## Definition of Done

- [ ] unit tests for valid / skipped / repeated / invalid pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
