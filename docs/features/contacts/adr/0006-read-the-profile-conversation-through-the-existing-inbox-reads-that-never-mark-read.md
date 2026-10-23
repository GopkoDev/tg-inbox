---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 7 — contacts"
---

# 0006 — Read the profile's conversation through the existing inbox reads that never mark read

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

The profile shows the contact's conversation history with live updates, but reading it must not count as reading: unread counts, the attention count and pings must stay as if the profile had not been opened (AC-05, §6 "Read state untouched by profile"). The ux-flows note leaves open "a separate read path, or a flag on the existing one". The explorer found that `conversations.threadPage` and the summary read have no write side effect; marking read is a separate use case behind `POST …/inbox/read`, called by the inbox screen.

## Decision drivers

- Spec §6: 0 read-state changes caused by the profile; AC-05: history in the same order as the inbox, live.
- shared-inbox ADR-0005: read state is a per-member watermark written only by mark-read.
- One thread read keeps both screens' ordering and paging identical (AC-04).

## Considered options

1. **Reuse the existing summary and thread routes plus a new "conversation of a contact" read; the profile never calls mark-read and has no composer.** Guarded by an integration test and a web test.
2. **A separate profile history route in `inbox`** that wraps `threadPage`. Makes the intent visible in the API, but duplicates a route with identical behaviour; the protection is the same (it simply does not call mark-read).
3. **A `markRead` flag on the thread read.** Would only make sense if the thread read marked read today; it does not, so the flag would add a write path to a read route.

## Decision outcome

**Chosen:** Option 1. The read side already has the required property; adding a route or a flag adds surface without adding safety. The property is pinned by tests so a future change that makes the thread read mark read breaks the build.

## Consequences

**Positive**
- Same ordering, paging and media handling as the inbox, no duplicated code.
- No new write path that could touch read marks.

**Negative**
- The guarantee depends on the web profile store never calling mark-read and on the thread read staying side-effect free; both are test-enforced rather than structural.

**Neutral**
- If the inbox later marks read on its thread read, this ADR must be revisited (option 2 then).

## Links

- Spec: [[../spec.md]] AC-04, AC-05, §6
- SAD: [[../sad.md]] §4 choice 6, §6 flow 3, §10 QG-2
- Related ADR: [[0001-own-tags-in-the-contacts-module-with-its-own-routes-and-compose-the-profile-conversation-from-inbox-reads]]; shared-inbox ADR-0005, ADR-0008
