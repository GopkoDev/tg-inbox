---
slug: broadcasts
date: 2026-10-24
triage: regression
acs: [AC-15]
commit: 0626c8c
recurrence_of: none
---

# Fix: a broadcast launched while a link runs waits for the older one to finish

## Symptom

Launching two broadcasts of one workspace back to back, expected them to take turns from the start;
once, the first 150 sends held only one broadcast's recipients (pace run of `broadcasts-load`).

## Root cause

`runSendLink` (`broadcasts/app/send-link.ts`) read the sending broadcasts once, at the link's start,
and served only those for up to 20 s. A broadcast launched after the link started — the worker can
pick up the first launch's job before the second launch commits — joined only the next link, so a
smaller older broadcast finished first. AC-15 says "neither waits for the other to finish".

## The pinning test

Unit `send-link.test.ts` › "AC-15: a broadcast launched while a link runs takes turns in that link,
not after the older one ends". RED: `expected -1 to be greater than -1` (the new broadcast had no
send before the older one's last).

## Spec patch

None — spec was right; AC-15 re-verified. SAD §6 says the link re-reads the sending set every second.

## Follow-ups

None.
