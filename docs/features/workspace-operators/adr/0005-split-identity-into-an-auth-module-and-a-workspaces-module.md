---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 2 — workspace-operators"
---

# 0005 — Split identity into an auth module and a workspaces module

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk

## Context

This is the first feature module of the modular monolith (repo ADR-0002), and it covers two concerns the glossary keeps apart: who a person is (Account — email, password, sessions) and where they work (Workspace, Membership, Invitation). Several use cases cross that line — accepting an invitation creates an account or checks an existing password and then signs the device in — and every later module will import the access guard and the current account from whatever boundary is drawn here. The architecture map already pencils in `auth` and `workspaces` as future modules.

## Decision drivers

- Repo ADR-0002 and `CLAUDE.md`: each table is owned by one module; other modules call its app layer, never its tables; imports flow inward.
- CONTEXT.md: Account is NOT Membership — deactivating a membership leaves the account and its other memberships untouched.
- Spec §3 non-goals: sign-in through Telegram, SSO and two-factor authentication are deferred, not ruled out.
- ADR-0003: one membership guard shared by every workspace-scoped module.

## Considered options

1. **Two modules, `auth` and `workspaces`, with a one-way dependency** — `auth` owns accounts, password hashes, sessions, sign-in lockout and password-reset links and knows nothing about workspaces; `workspaces` owns workspaces, memberships and invitations, the team use cases, the access guard and the "who am I and where can I work" read, and calls `auth`'s app layer.
2. **One `workspaces` module holding everything** — identity and tenancy tables and use cases in one module.

## Decision outcome

**Chosen:** Option 1. The dependency points one way (`workspaces` → `auth`), mirroring the glossary's Account/Membership split, so a future sign-in method changes only `auth` and later modules depend on a small, stable surface: the session resolver from `auth`, the workspace guard from `workspaces`. Option 2 is quicker to wire but makes every later module depend on one large module, and splitting it later means moving tables and rewriting every caller.

To keep accepting an invitation atomic — create the account (or verify the existing password), create the membership, consume the invitation, open the session — `auth`'s app-layer functions accept an optional transaction handle from the caller, so `workspaces` runs the whole acceptance in one database transaction while each module still writes only its own tables.

## Consequences

**Positive**
- Clear ownership: `auth` tables are platform-level (no `workspace_id`), `workspaces` tables are tenant-owned — the tenancy rule applies cleanly to one module.
- A new sign-in method (Telegram, SSO) or a token mechanism for the MCP server touches `auth` only.
- Later modules receive two narrow dependencies through the composition root.

**Negative**
- More wiring in the composition root; cross-module use cases need the transaction-handle convention.
- The workspace resolution after sign-in (AC-07) is assembled by `workspaces` from `auth`'s account, not returned by sign-in itself.

**Neutral**
- Merging the modules later would be mechanical; splitting a merged one would not.

## Links

- Spec: [[../spec.md]] — US-02, US-03, US-06, US-08
- SAD: [[../sad.md]] §5
- Related ADR: [[0003-carry-the-active-workspace-in-the-url-and-check-membership-on-every-request]], [[0001-build-an-api-a-spa-and-a-server-side-admin-cli]]
