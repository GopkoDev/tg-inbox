---
slug: broadcasts
date: 2026-10-24
triage: spec-bug
acs: [AC-14]
commit: b52fa6a
recurrence_of: none
---

# Fix: a customer who unblocks and writes in the second of a refused send stays blocked

## Symptom

A broadcast send is refused as blocked at 10:00:20.700 (our clock); the customer unblocks and writes
at 10:00:20 (Telegram's whole-second date). Expected the mark cleared, got "blocked" kept until the
customer writes again in a later second.

## Root cause

`contacts` applies reach facts newest-first by `changed_at`. A refused send stored our clock at ms
precision, Telegram's message dates are whole seconds, so the message counted as older than the
block. Data-model assumption 11 accepted "the ≤ 1 s skew" without deciding the tie.

## The pinning test

Unit `contacts/app/reach.test.ts` › "a refused send blocks at whole-second precision: a message of
the same second (Telegram dates are whole seconds) clears it". RED: `blockedAt`
`2026-10-20T10:00:20.700Z` where `2026-10-20T10:00:20.000Z` was expected.

## Spec patch

Data-model assumption 11, before: "Reach rows of a refused send use our clock for `changed_at` and
`blocked_at`. … The ≤ 1 s skew between the two clocks is accepted." After: "… use our clock …, kept
to the whole second as Telegram's times are. … a fact of the same second applies in arrival order: a
customer who unblocks and writes in the second of a refused send is unblocked (a wrong unblock costs
one refused send, which marks the block again)." Decided in the autonomous run: an unblock error
costs one refused send; a block error silently drops a customer from every broadcast.

## Follow-ups

None.
