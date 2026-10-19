---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 7 — contacts"
---

# 0007 — Signal tag changes as contact.changed per contact and tags.changed per workspace

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

A teammate's tag change must show in every open profile and inbox conversation header of that contact within 3 s (AC-06, §6). An owner's rename, merge or delete changes every contact carrying the tag — up to 10 000 — and must also show live (AC-09). The live channel carries id-only signals published in the writing transaction (shared-inbox ADR-0002/0003); the payload is ≤ 1000 bytes and the signal union is closed. The glossary's change signal already names "contact's tags". Tags belong to the contact, not to a conversation (spec §1).

## Decision drivers

- Spec §6 tag live update p95 ≤ 3 s; owner ops ≤ 2 s on 10 000 contacts.
- shared-inbox ADR-0002/0003: ids only, refetch through reads, publish in the writing transaction.
- A header knows its contact id (the summary carries the contact); a profile knows its contact id.

## Considered options

1. **Two new signal types: `contact.changed { workspace_id, contact_id, change: 'tags' }` for a member's add/remove, and `tags.changed { workspace_id }` for tag creation, rename, merge and delete.**
2. **Extend `conversation.changed` with a `tags` change for the contact's conversation.** Reuses the inbox path, but ties contact state to a conversation, and an owner op would publish up to 10 000 notifications in one transaction.
3. **One `contact.changed` per affected contact for every path, owner ops included.** Precise, but 10 000 NOTIFYs per merge or delete inflate the transaction and the hub's fan-out to every socket.

## Decision outcome

**Chosen:** Option 1. Member edits stay precise (only that contact's viewers refetch); owner ops publish one workspace-level signal and every open profile or header refetches its own contact's tags, which also refreshes renamed names everywhere.

## Consequences

**Positive**
- Bounded signal volume for owner ops; ids only, small payloads.
- New tags reach open pickers and filters through `tags.changed`.

**Negative**
- The shared schema changes in `platform/realtime`, `packages/shared` `LiveFrame`, the hub and the web; old tabs must tolerate unknown frame types (SAD §11).
- An owner op triggers a refetch in every open profile and header of the workspace, affected or not.

**Neutral**
- The Contacts list and Settings → Tags stay refresh-on-open (spec §1) and ignore these frames.

## Links

- Spec: [[../spec.md]] AC-05, AC-06, AC-09, §6
- SAD: [[../sad.md]] §4 choice 7, §8 Events
- Related ADR: shared-inbox ADR-0002, ADR-0003; assignment-statuses ADR-0007
