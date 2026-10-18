---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
ticket: "roadmap step 4 — shared-inbox"
---

# 0002 — Push change signals over a per-tab, workspace-bound WebSocket and refetch through the reads

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk (recommended options accepted under delegated autonomy)

## Context

Every open inbox must show new customer messages, edits, teammates' replies, delivery-state changes and bot-state changes without reloading (AC-13, AC-14, AC-15), within 3 s at p95. The list's unread counts are per member (AC-01), a tab follows the workspace in its address (workspace-operators ADR-0003) and a switch affects only that tab (AC-09), and a deactivated member's stream must stop within 5 s (AC-09, spec §6). The architecture map already reserved `@fastify/websocket` and one client socket (`shared/api/realtime.ts`) for the live inbox, so the transport is settled; what remains is what flows over it and how access is enforced on it.

## Decision drivers

- Spec §6: live update p95 ≤ 3 s; access revocation — live stream of a deactivated or switched-away member stops ≤ 5 s.
- Spec §6.1: every inbox capability requires an active membership; the live stream re-checks membership; confidential data.
- AC-01/AC-15: unread counts and "read when visible" are per member; AC-18: no cross-workspace mixing.
- Architecture map: WebSocket via `@fastify/websocket`, Zustand stores updated from live events.

## Considered options

1. **Signals + refetch** — the server pushes small "changed" signals (conversation id, item kind and id, or "bot state changed"); the client re-reads the changed list row / thread item through the same guarded REST reads.
2. **Full per-member payloads** — the server renders, for each connected member, the changed list row (with that member's unread count) and the full item, and pushes them.
3. **Full shared payloads + client-side unread** — the server pushes the item with its text once per workspace; each client computes its own unread counts and ordering.

## Decision outcome

**Chosen:** Option 1. Per-member data (unread counts, "waiting" markers, authorship names) and authorisation keep exactly one implementation — the reads — instead of a second rendering path inside the socket fan-out (option 2) or a client-side copy of the unread rules that drifts from the server (option 3). Signals carry no message text or names, so a socket that outlives its access for a moment leaks only ids, and the next refetch is refused by the guard. One extra round-trip per change fits easily in the 3 s budget.

Rules that come with it: the socket is opened per tab for one workspace (`/api/workspaces/:workspaceId/…`), authenticated at the upgrade by the session cookie and the workspace guard, with the `Origin` header required to be the panel's own origin; switching workspace closes it and opens another. A deactivation signal closes the member's sockets of that workspace at once with an "access removed" close reason; independently, each instance re-validates all its open sockets every 5 s in one query per workspace (session still valid, membership still active) and closes any that fail — the guarantee does not depend on a signal arriving. On (re)connect the client refetches the first list page and the open thread, so missed signals heal.

## Consequences

**Positive**
- Live and pull paths can never disagree; the guard is the single access check.
- No personal data in the fan-out; easy to reason about for the security review.

**Negative**
- Each change costs one extra read per open tab that cares; at pilot scale (5–10 workspaces, a few members each) this is negligible, but a busy workspace multiplies reads by its open tabs.
- The 5 s re-validation is a periodic query per instance, even when nothing changes.

**Neutral**
- Moving a hot signal (e.g. a new message) to carry its item later is additive: the client already handles the refetch path.

## Links

- Spec: [[../spec.md]] AC-01, AC-09, AC-13, AC-14, AC-15, AC-18; §6; §6.1
- UX flows: [[../ux-flows.md]] platform decisions ("live, not refreshed")
- SAD: [[../sad.md]] §4, §6, §8
- Related ADR: [[0003-fan-out-live-signals-through-postgres-listen-notify-published-in-the-writing-transaction]], [[0005-track-read-state-as-a-per-member-arrival-watermark-per-conversation]]
