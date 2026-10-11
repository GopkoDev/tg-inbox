---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 3 — bot-connection"
---

# 0005 — Split the feature into bots, conversations and contacts modules

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

The feature introduces bots (token, webhook, health), contacts (Telegram profiles per workspace) and conversations with their messages. The architecture map plans `bots`, `conversations` and `contacts` as future modules, and roadmap steps 4 (inbox) and 7 (contacts) will extend conversations and contacts heavily. Each table must be owned by exactly one module; cross-module calls go through the other module's app layer.

## Decision drivers

- Architecture map / repo ADR-0002: one module per capability, single table owner, no cross-module table access.
- AC-07/AC-08: one capture creates or refreshes a contact and appends to a conversation atomically.
- Roadmap: steps 4 and 7 own the inbox and contact editing; moving tables between modules later means rewriting repositories and their isolation tests.

## Considered options

1. **Three modules** — `bots` (bot connection, token, webhook ingress, health checks; owns bots), `conversations` (capture use case, conversations and messages), `contacts` (contacts). `bots` → `conversations` app layer (capture, last message time, has conversations); `conversations` → `contacts` app layer (upsert from profile, within the capture transaction); `bots` → `contacts` app layer (count for the settings page).
2. **One `bots` module owning everything this step creates** — split later when the inbox and contacts steps arrive.

## Decision outcome

**Chosen:** Option 1. The boundaries match the roadmap's capability split, so steps 4 and 7 extend modules that already own their tables instead of carving them out of `bots`. The one atomic cross-module write (contact upsert inside the capture transaction) follows the workspace-operators precedent of passing a transaction into the other module's app layer (its ADR-0005). Dependencies stay acyclic: `bots → conversations → contacts`, `bots → contacts`; none of them calls back into `bots`.

## Consequences

**Positive**
- Each later step lands in an existing module with its own isolation tests.
- Capture logic (`conversations`) does not know about tokens or webhooks; `bots` does not know message shapes beyond the normalised inbound message it hands over.

**Negative**
- Three modules, three sets of repositories and wiring in `buildDeps()` for one roadmap step.
- The capture transaction spans two modules, so `contacts` app functions must accept an optional transaction.

**Neutral**
- The normalised inbound message type (kind, text or caption, Telegram ids, sender profile) is the contract between `bots` and `conversations`.

## Links

- Spec: [[../spec.md]] US-02–US-05
- SAD: [[../sad.md]] §5
- Related ADR: [[0003-capture-each-update-inside-the-webhook-request-with-idempotent-writes]]; workspace-operators [[../../workspace-operators/adr/0005-split-identity-into-an-auth-module-and-a-workspaces-module]]
