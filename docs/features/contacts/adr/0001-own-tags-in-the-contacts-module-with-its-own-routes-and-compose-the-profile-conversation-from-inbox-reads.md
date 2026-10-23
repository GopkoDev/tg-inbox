---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 7 — contacts"
---

# 0001 — Own tags in the contacts module with its own routes and compose the profile's conversation from inbox reads

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

Tags, contact tags and tag history are new state that belongs to the contact (spec §1: tags are not conversation activity). The Contacts list, the profile and Settings → Tags need HTTP routes, and the `contacts` module has none yet. The profile also shows the contact's conversation (status, assignee, waiting marker, thread), which lives in `conversations`. The existing dependency graph is `bots → conversations → contacts`, `inbox → {conversations, contacts, …}`, so `contacts` cannot call `conversations` without a cycle. The inbox conversation header must show and change the contact's tags. Target surfaces: `backend-service` + `web-frontend` (ux-flows SCR-18…SCR-23).

## Decision drivers

- `CLAUDE.md`: one module per roadmap capability, one-way dependencies, never query another module's tables.
- Spec §6 tenant isolation and tag history completeness: one module must own every write to a contact's tags.
- Spec §6 contacts list p95 ≤ 500 ms: the list should be a single-module query.
- Existing building blocks: `inbox` already depends on `contacts` and `conversations`; the conversation summary already carries the contact.

## Considered options

1. **`contacts` owns the tag tables and gets its own routes; the profile's conversation part comes from `inbox` reads (plus one new "conversation of a contact" read), composed in the browser.** New edge only `contacts → workspaces` for display names.
2. **All contacts and tags HTTP in `inbox`** (the orchestrator that owns no tables), calling `contacts` and `conversations` app layers. One profile endpoint could return contact and conversation together, but `inbox` would grow a second, unrelated product area and Settings → Tags would live under an inbox module.
3. **A new `tags` module** owning tags and history, with `contacts` keeping only profiles. Clean separation, but every tag write needs to lock the contact row and validate the contact, so `tags → contacts` calls on every path, and broadcasts would need both modules for one segment.

## Decision outcome

**Chosen:** Option 1. Tags are a property of the contact, so the module that owns contacts owns their tags and can lock the contact row and enforce the limits locally. Keeping the conversation part in `inbox` reads avoids a cycle and reuses the exact reads the inbox screen already trusts (ADR-0006).

## Consequences

**Positive**
- Contact tag writes, limits and history are one module's transaction; the list, filter and counts are one module's queries.
- No new cycle; the only new edge (`contacts → workspaces`) points at a module with no feature dependencies.
- Broadcasts (step 8) select recipients through one module's app layer.

**Negative**
- The profile makes two groups of requests (contacts + inbox) instead of one.
- `contacts` becomes a larger module (routes, three new tables).

**Neutral**
- Moving the routes into a composite endpoint later is an HTTP-layer change only.

## Links

- Spec: [[../spec.md]] §1, US-01…US-05, §6
- SAD: [[../sad.md]] §4 choice 1, §5
- Related ADR: [[0006-read-the-profile-conversation-through-the-existing-inbox-reads-that-never-mark-read]]; bot-connection ADR-0005; shared-inbox ADR-0007
