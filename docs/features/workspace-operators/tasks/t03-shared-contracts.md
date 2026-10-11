---
id: T3
title: "Define the auth and workspaces zod contracts in packages/shared"
layer: "ports"
deps: []
blocks: ["T13", "T19"]
acs: ["AC-02", "AC-05", "AC-20"]
files_hint: ["packages/shared/src/auth.ts", "packages/shared/src/workspaces.ts", "packages/shared/src/index.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T3 — Define the auth and workspaces zod contracts in packages/shared

## Place in the sequence

- **Blocked by:** — · **Blocks:** T13 — Expose the auth routes with the session cookie and resolver, T19 — Lay the web foundation · **Wave:** 1 — the contract has no upstream; the API routes and the web client both import it, so the UI branch can start without waiting for the backend. (T14–T16 and T18 reach it transitively through T13.)
- **Lane:** own lane.

## Why (user story)

> **As a** Platform admin
> **I want** to create a workspace for a pilot business together with an invitation for its first business owner
> **So that** the business can start using tg-inbox without a self-serve signup
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to accept an invitation link and set up my access
> **So that** I become a member of the business's workspace with the role I was invited for
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to see every member and every pending invitation of my workspace and revoke an invitation
> **So that** I always know who has or is about to get access
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

This task fixes, once, the request/response shapes and field rules (email normalisation, name and password bounds, the team list without links) that the API, the CLI and the web panel all validate with.

## Inlined context

> **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
>
> — `CLAUDE.md §Rules, Contracts, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> Email identity: an email is compared ignoring letter case and surrounding spaces everywhere (accounts, invitations, membership checks, sign-in lockout) — `Bob@x.com` and ` bob@x.com` are the same account.
>
> — `spec.md §6.1, Email identity, verbatim` · full text: [spec.md](../spec.md)

> Validation is the same as the API's (`packages/shared` zod schemas): emails are trimmed and lower-cased, a workspace name is 1–200 characters after trimming.
>
> — `contracts/cli.md §Invocation, verbatim` · full text: [cli.md](../contracts/cli.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Schemas to define (snake_case wire names, `additionalProperties: false` → `z.strictObject`):

| Schema | Fields / rule |
|---|---|
| `EmailInput` | string ≤ 320; **trim + lower-case first**, then a valid email of 3–254 chars (no `format` before trimming) |
| `Email` | normalised email, 3–254 |
| `Password` | 10–1024 chars; `SignIn.password` is 1–1024 only (no policy hint) |
| `DisplayName` | trimmed, 1–200, not blank |
| `WorkspaceName` | trimmed, 1–200 (CLI `--name`) |
| `Role` / `MembershipState` | `owner \| operator` / `active \| deactivated` |
| `LinkToken` | `^[A-Za-z0-9_-]{43}$` |
| auth: `SignIn`, `LinkTokenBody`, `PasswordResetRedeem` | `{email, password}` · `{token}` · `{token, password}` |
| workspaces: `Account`, `Me` | `{id, email, display_name}` · `{account, last_used_workspace_id: uuid \| null}` |
| `WorkspaceSummary`, `InvitationPreview`, `InvitationAccept`, `InvitationCreate` | `{id, name, role}` · `{workspace_name, email, role, account_exists}` · `{token, password, display_name?}` · `{email: EmailInput, role}` |
| `PendingInvitation`, `IssuedInvitation` | `{id, email, role, created_at, expires_at}` (never a link) · `{invitation, link: uri}` |
| `Membership` | `{id, display_name, email, role, state, created_at, deactivated_at: date-time \| null}` |
| `*Page` (`WorkspaceSummaryPage`, `MembershipPage`, `PendingInvitationPage`) + `PageQuery` | `{items, has_next, has_prev, next_cursor: uuid \| null}`; query `after?`, `before?` (uuid), `limit` 1–100 default 20 |

— `contracts/openapi.yaml, components.schemas + parameters.After/Before/Limit, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-02 — error

> **Given** a platform admin creating a workspace
> **When** the workspace name is empty or the owner email is not a valid email address
> **Then** the system creates nothing and tells the platform admin which field is wrong and why
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-05 — error

> **Given** a person accepting a valid invitation
> **When** they choose a password shorter than 10 characters
> **Then** the system does not create the account and tells them the password must be at least 10 characters long
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-20 — happy path

> **Given** a business owner of "Acme Flowers" with three members and one pending invitation
> **When** they open the team list and revoke the pending invitation
> **Then** they see each member's name, email, role and state and each pending invitation's email, role and expiry (but not its link), the revoked invitation disappears from the pending list, and its link stops working
>
> — `spec.md §5, AC-20, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Shared value types (`EmailInput`, `Email`, `Password`, `DisplayName`, `WorkspaceName`, `Role`, `MembershipState`, `LinkToken`, page + `PageQuery` helpers) — `packages/shared/src/workspaces.ts` (or a local helper inside it)
- [ ] Auth schemas `SignIn`, `LinkTokenBody`, `PasswordResetRedeem` — `packages/shared/src/auth.ts`
- [ ] Workspaces schemas `Account`, `Me`, `WorkspaceSummary(Page)`, `InvitationPreview`, `InvitationAccept`, `InvitationCreate`, `PendingInvitation(Page)`, `IssuedInvitation`, `Membership(Page)` — `packages/shared/src/workspaces.ts`
- [ ] Password-length message «The password must be at least 10 characters long»; email message «Enter a valid email address» — so the 400 `details.field` + text match the contract examples
- [ ] Re-export from `packages/shared/src/index.ts`
- [ ] Unit tests for the rules in the edge-case table — `packages/shared/src/auth.test.ts`, `packages/shared/src/workspaces.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `EmailInput` = `"  Bob@X.com "` | parses to `bob@x.com` |
| `EmailInput` = `"not-an-email"` | fails with the email message |
| `WorkspaceName` = `"   "` | fails (blank after trim) — AC-02 |
| `Password` of 9 chars / 1025 chars | fails with the 10-character message / max-length failure — AC-05 |
| `SignIn.password` of 3 chars | passes (no policy hint on sign-in) |
| `PendingInvitation` / `Membership` with an extra `link` or `token` key | rejected by the strict object — no link ever leaves the team list (AC-20) |
| `limit` = 0 or 101 | fails; omitted → 20 |

## Definition of Done

- [ ] unit tests for every schema rule above pass
- [ ] `pnpm --filter @tg/shared build` succeeds and both `apps/api` and `apps/web` typecheck against the exports
- [ ] field names match `openapi.yaml` exactly (snake_case)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
