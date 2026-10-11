---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 2 — workspace-operators"
---

# 0003 — Carry the active workspace in the URL and check membership on every request

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk

## Context

One account can hold memberships in several workspaces and switches between them (US-04), and every later module — bots, inbox, contacts — serves data that belongs to exactly one workspace. Something has to tell each request which workspace it acts in and prove the caller may act there. `ux-flows.md` flagged the open design input: whether the active workspace is part of the page address, which touches AC-12 (switching is per device) and AC-13 (links a colleague shares). AC-17 requires a deactivated member to be refused within 5 s on every open session.

## Decision drivers

- Spec §6 NFR: 0 data reads or writes across workspaces; deactivation takes effect within 5 s on every open session.
- Spec §6.1 abuse case: cross-tenant access by link or identifier must behave as not found, so workspace names and ids cannot be probed.
- AC-12, AC-13, AC-17; CONTEXT.md invariant: a workspace's data can never be seen or changed by anyone who is not an active member.
- Architecture-map tenancy convention: every repository method takes `workspaceId`; no Postgres row-level security in v1.

## Considered options

1. **Workspace id in the URL, membership checked on every request** — SPA paths `/w/<workspaceId>/…`, API paths `/api/workspaces/:workspaceId/…`; a shared guard looks up the caller's membership on each request.
2. **Active workspace stored in the session** — paths carry no workspace; switching updates the session; the guard reads the workspace from the session and checks membership.

## Decision outcome

**Chosen:** Option 1. A link names its workspace, so a shared link opens correctly for any active member and resolves to a neutral not-found for anyone else. The workspace a screen shows can never silently differ from the one its writes go to, which can happen with option 2 when two tabs share one session. The uncached membership lookup makes a deactivation effective on the very next request — well inside the 5 s budget.

The guard is a Fastify `preHandler` exported by the workspaces module and handed to every workspace-scoped module through the composition root:

- no session → the request is unauthenticated;
- no membership of this account in this workspace, or a workspace id that does not exist or is malformed → `NotFoundError` (AC-13, indistinguishable from a missing workspace);
- a deactivated membership → a refusal with its own error code, so the panel can say access to this workspace was removed and move on (AC-17);
- an active membership → the request carries `{ workspaceId, role }`, which repositories receive as their `workspaceId`; owner-only routes add a role check that answers `ForbiddenError` (AC-15).

The last-used workspace for the next sign-in (AC-07, AC-12) is recorded on the membership when the panel opens a workspace, not in the session.

## Consequences

**Positive**
- One visible routing pattern for every later module; a missing guard is easy to spot in review.
- Deactivation needs no push, cache invalidation or session rewrite.
- Shared links work across all of a person's workspaces.

**Negative**
- One indexed membership lookup on every workspace-scoped request.
- The active workspace is per browser tab rather than strictly per device; two tabs can show different workspaces (AC-12 still holds — other places stay where they were).

**Neutral**
- Live channels (the inbox WebSocket, roadmap step 4) must apply the same membership check to each message they push, or re-check within 5 s; that is a constraint on step 4, recorded in sad.md §11.

## Links

- Spec: [[../spec.md]] — US-04, US-06, AC-07, AC-12, AC-13, AC-15, AC-17, §6, §6.1
- SAD: [[../sad.md]] §4
- Related ADR: [[0002-use-opaque-cookie-sessions-stored-in-postgres]]
