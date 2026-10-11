---
id: T9
title: "Implement create-workspace and re-issue-owner-invitation use cases"
layer: "app"
deps: ["T6"]
blocks: ["T18"]
acs: ["AC-01", "AC-01b", "AC-02"]
files_hint: ["apps/api/src/modules/workspaces/app/admin.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T9 — Implement create-workspace and re-issue-owner-invitation use cases

## Place in the sequence

- **Blocked by:** T6 — Build the workspaces repositories with cross-workspace isolation tests · **Blocks:** T18 — Build the admin CLI with its three commands · **Wave:** 3 — needs only the workspaces repository ports; runs in parallel with T7.
- **Lane:** own lane (`workspaces/app/admin.ts`); reads T6's `workspaces/app/ports.ts`.

## Why (user story)

> **As a** Platform admin
> **I want** to create a workspace for a pilot business together with an invitation for its first business owner
> **So that** the business can start using tg-inbox without a self-serve signup
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

This task delivers the two platform-admin use cases the CLI (T18) calls; there is no HTTP route for them.

## Inlined context

> C->>Ws: create workspace with first-owner invitation
> alt name empty or owner email not a valid email → validation error naming the field and the reason
> else valid input → Ws->>D: begin, insert the workspace → insert invitation with the business owner role, normalised email, token hash, 7-day expiry, commit → workspace id and the invitation link
>
> — `sad.md §6, flow 4 «Create a workspace with its first-owner invitation», abridged` · full text: [sad.md](../sad.md)

> Ws->>D: begin, lock the workspace row → read the workspace memberships and its owner invitation
> alt no such workspace → workspace not found
> else the workspace already has members → first business owner already joined
> else awaiting its first business owner → mark the earlier pending invitation superseded → insert a new owner invitation for the same email with a 7-day expiry, commit → new invitation link
>
> — `sad.md §6, flow 5 «Re-issue the first-owner invitation», abridged` · full text: [sad.md](../sad.md)

> A workspace has no status column in v1: "awaiting its first business owner" means it has no memberships yet
>
> — `sad.md §5, Building block view, abridged` · full text: [sad.md](../sad.md)

> Re-issues […] a new 7-day one with the business owner role is issued for the **same email** as the workspace's latest invitation. […] `error OWNER_ALREADY_JOINED: the first business owner already joined — business owners invite from the web panel`
>
> — `contracts/cli.md §workspace:reissue-owner-invitation, abridged` · full text: [cli.md](../contracts/cli.md)

> Validation is the same as the API's (`packages/shared` zod schemas): emails are trimmed and lower-cased, a workspace name is 1–200 characters after trimming.
>
> — `contracts/cli.md §Invocation, verbatim` · full text: [cli.md](../contracts/cli.md)

> **Hard rule:** IDs: UUIDv7 from `newId()` (`src/platform/ids.ts`), never DB defaults. / Every timestamp […] comes from the application's clock port and is passed into SQL as `now`
>
> — `CLAUDE.md §Rules, IDs, verbatim` + `sad.md §8, Invitation and reset links, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[cli.md](../contracts/cli.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. Writes through T6's ports:

| Column | Type | Constraints | Change |
|---|---|---|---|
| `workspaces.name` | text | NOT NULL, CHECK 1–200 chars after trim | insert |
| `invitations.email` / `role` | text | normalised; role `owner` here | insert |
| `invitations.token_hash` / `expires_at` | bytea / timestamptz | UNIQUE 32 bytes / `created_at` + 7 days | insert |
| `invitations.state` / `closed_at` | text / timestamptz | earlier pending → `superseded` | updated on re-issue |

Partial UNIQUE `invitations_workspace_id_email_pending_key` — at most one pending per (workspace, email); `invitations_workspace_id_idx` serves "latest invitation of the workspace in any state".

— `data-model.md §Entities, workspaces + invitations, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-01 — happy path

> **Given** a platform admin and a pilot business named "Acme Flowers" together with its owner's email address
> **When** the platform admin creates the workspace with that name and owner email
> **Then** the workspace exists, awaiting its first business owner, with an invitation carrying the business owner role issued for that email, and the platform admin sees the invitation link once, right after creation, to pass on; until that invitation is accepted nobody can see or act in the workspace
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-01b — happy path

> **Given** a workspace still awaiting its first business owner, whose owner invitation has expired or whose link was lost
> **When** a platform admin re-issues the first business owner invitation for that workspace
> **Then** the earlier invitation stops working, a new 7-day invitation with the business owner role is issued for the same email, and the platform admin sees its link once, right after issuing it
>
> — `spec.md §5, AC-01b, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** a platform admin creating a workspace
> **When** the workspace name is empty or the owner email is not a valid email address
> **Then** the system creates nothing and tells the platform admin which field is wrong and why
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `apps/api/src/modules/workspaces/app/admin.ts` — `createWorkspaceWithOwnerInvitation({ name, ownerEmail })`: trim name (1–200) and normalise email (T4); invalid → `ValidationError` with `details.field` (`name` / `ownerEmail`) before any write; one transaction: insert workspace, insert `owner` invitation (`issueLinkToken()`, `expires_at = now + 7 days`); return `{ workspaceId, invitationId, email, expiresAt, link: PUBLIC_WEB_URL + '/invite/' + token }`.
- [ ] `reissueOwnerInvitation(workspaceId)`: one transaction, lock the workspace row; missing → `NotFoundError`; any membership → `OwnerAlreadyJoinedError`; else supersede the pending invitation (if any), insert a new `owner` invitation for the latest invitation's email; return `{ invitationId, supersededInvitationId, email, expiresAt, link }`.
- [ ] Unit tests `admin.test.ts` with port fakes + controllable clock: AC-01 role/expiry/link, AC-02 each invalid field writes nothing, AC-01b supersede + same email, already-joined refusal.
- [ ] Integration test `admin.int.test.ts`: after re-issue the old token's invitation is `superseded`, the new one `pending`; a created workspace has zero memberships.

## Edge cases

| Case | Behaviour |
|---|---|
| Name `"   "` or 201 chars | `ValidationError` field `name`; nothing created |
| Owner email `" Ana@Acme.test "` | Stored as `ana@acme.test` |
| Owner email `not-an-email` | `ValidationError` field `ownerEmail`; nothing created |
| Re-issue on unknown workspace id | `NotFoundError` |
| Re-issue after the owner joined | `OwnerAlreadyJoinedError` (CLI exit 4) |
| Re-issue when the old invitation already expired (still `pending`) | Superseded and replaced with a fresh 7-day one |

## Definition of Done

- [ ] Unit + integration tests pass, asserting AC-01, AC-01b, AC-02
- [ ] The link is returned only from these calls; only its SHA-256 hash is stored
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
