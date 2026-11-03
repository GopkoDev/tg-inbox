---
slug: broadcasts
date: 2026-10-24
triage: regression
acs: [AC-15]
commit: 0626c8c
recurrence_of: none
---

# Fix: broadcast sends burst above 25 per second after an event-loop stall

## Symptom

Sending two broadcasts of one bot on a loaded machine, expected no 1 s window to hold more than 25
broadcast sends of that bot, got 26–33 (`e2e/broadcasts-load` pace check and
`bots/app/send-broadcast-message.int`). Every workspace, whenever the process stalls (GC, a large
JSON parse, CPU contention).

## Root cause

`createPacer` (`apps/api/src/modules/bots/app/pacer.ts`) booked each caller's start slot in advance
(`nextFree += 40 ms`) and let it sleep until that slot. After a stall every overdue timer fired at
once, so the waiters whose slots had passed started together on top of the slots the window already
held. The unit tests ran on a virtual clock whose `sleep` never fires late, and the load checks
measured arrival times at the fake and passed on the best of three runs.

## The pinning test

- Unit `bots/app/pacer.test.ts` › "ADR-0008: a stall never lets delayed callers start together — no
  1 s window above 25" (a virtual timer queue; a 300 ms stall). RED:
  `AssertionError: expected 33 to be less than or equal to 25`.
- Integration `send-broadcast-message.int.test.ts` and e2e `broadcasts-load` pace check now count the
  starts the pacer released (`test/recording-pacer.ts`, passed to `buildApp` through the new
  `broadcastPacer` override), on every run, with no retry and no jitter allowance.

## Spec patch

None — spec was right; AC-15 ("at most 25 messages per second per bot over any 1 s window")
re-verified. ADR-0008, SAD §4/§6 and the architecture map now say the spacing is measured from the
previous actual start; test-plan records that the pace is counted on pacer starts.

## Follow-ups

- The fake Bot API's arrival times still bunch under load (transport jitter of the shared event
  loop); they are not used for the ceiling any more.
