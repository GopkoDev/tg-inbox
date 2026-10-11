---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: M
---

# CLI contract — workspace-operators

The platform-admin surface ([ADR-0001](../adr/0001-build-an-api-a-spa-and-a-server-side-admin-cli.md)). It has no HTTP endpoint: a tg-inbox team member runs these commands on the server (or from a trusted machine with a tunnel to the database), and access to the server is the authority. Each command calls the same `workspaces` / `auth` app-layer use case the API would. Derived from spec US-01 / US-08 (AC-01, AC-01b, AC-02, AC-21) and sad.md §6 flows 4, 5 and 11.

## Invocation

```
pnpm admin <command> [--flag value]…
```

- Entry: `apps/api/src/cli/admin.ts`. It reads the same configuration as the API (`DATABASE_URL`, `PUBLIC_WEB_URL`, …) through `platform/config.ts` and builds its dependencies with the shared dependency builder that `buildApp()` uses.
- Flags are long-form only. Values with spaces must be quoted by the shell.
- Validation is the same as the API's (`packages/shared` zod schemas): emails are trimmed and lower-cased, a workspace name is 1–200 characters after trimming.

## Output streams

| Stream | Content |
|---|---|
| **stdout** | On success: exactly one line, the issued link (`PUBLIC_WEB_URL/invite/<token>` or `PUBLIC_WEB_URL/reset-password/<token>`), so it can be piped or copied. Nothing else goes to stdout. The link is printed this once and can never be shown again. |
| **stderr** | Human-readable messages: on success one summary line (`Created workspace <id> "<name>"; invitation for <email> expires <iso8601>`); on failure `error <CODE>: <message>`, where `<CODE>` is the API `ErrorCode` (`packages/shared/src/errors.ts`). |
| **audit log** | One structured pino line per **successful** action through `platform/logger.ts`: `event: "admin.<action>"`, `os_user`, target ids (workspace id, invitation id, account id, reset link id). Never the link, its token or the email's password. |

## Exit codes

| Code | Meaning | `ErrorCode` on stderr |
|---|---|---|
| `0` | Success, link printed on stdout | — |
| `1` | Unexpected failure (database unreachable, bug); nothing is printed on stdout | `INTERNAL_ERROR` |
| `2` | Usage or validation error: unknown command, missing flag, invalid value; nothing created | `VALIDATION_ERROR` |
| `3` | Target not found | `NOT_FOUND` |
| `4` | Refused by a domain rule | `OWNER_ALREADY_JOINED` |

## Commands

### `workspace:create`

Creates a workspace together with a 7-day invitation with the business owner role for its first business owner (AC-01, flow 4). The workspace has no members until the invitation is accepted, so nobody can see or act in it.

```
pnpm admin workspace:create --name "<workspace name>" --owner-email <email>
```

| Flag | Required | Constraint (origin) |
|---|---|---|
| `--name` | yes | 1–200 characters after trimming (`workspaces.name`) |
| `--owner-email` | yes | a valid email, 3–254 characters, stored normalised (`invitations.email`) |

| Outcome | Exit | stdout | stderr |
|---|---|---|---|
| Created | `0` | `https://panel.example.test/invite/<token>` | `Created workspace 01920000-…-0000000000a1 "Test Workspace 1"; invitation for owner@example.test expires 2026-10-18T10:00:00Z` |
| Name empty or longer than 200 (AC-02) | `2` | — | `error VALIDATION_ERROR: --name must be 1–200 characters` |
| Owner email not a valid email (AC-02) | `2` | — | `error VALIDATION_ERROR: --owner-email is not a valid email address` |

Audit: `event: "admin.workspace_created"`, `workspace_id`, `invitation_id`.

### `workspace:reissue-owner-invitation`

Re-issues the first business owner's invitation of a workspace still awaiting its first owner (AC-01b, flow 5): the earlier pending invitation is superseded and a new 7-day one with the business owner role is issued for the **same email** as the workspace's latest invitation.

```
pnpm admin workspace:reissue-owner-invitation --workspace <workspace id>
```

| Flag | Required | Constraint (origin) |
|---|---|---|
| `--workspace` | yes | a UUID (`workspaces.id`) |

| Outcome | Exit | stdout | stderr |
|---|---|---|---|
| Re-issued | `0` | `https://panel.example.test/invite/<token>` | `Re-issued the owner invitation of workspace <id> for owner@example.test; expires <iso8601>` |
| Not a UUID | `2` | — | `error VALIDATION_ERROR: --workspace must be a workspace id` |
| No such workspace | `3` | — | `error NOT_FOUND: no workspace with id <id>` |
| The workspace already has members | `4` | — | `error OWNER_ALREADY_JOINED: the first business owner already joined — business owners invite from the web panel` |

Audit: `event: "admin.owner_invitation_reissued"`, `workspace_id`, `invitation_id`, `superseded_invitation_id`.

### `account:issue-reset-link`

Issues a 24-hour, single-use password-reset link for an account (AC-21, flow 11). Any earlier unused reset link of the account stops working. Redeeming it goes through the API (`redeemPasswordResetLink` in [openapi.yaml](openapi.yaml)).

```
pnpm admin account:issue-reset-link --email <email>
```

| Flag | Required | Constraint (origin) |
|---|---|---|
| `--email` | yes | a valid email, 3–254 characters, matched normalised (`accounts.email`) |

| Outcome | Exit | stdout | stderr |
|---|---|---|---|
| Issued | `0` | `https://panel.example.test/reset-password/<token>` | `Issued a reset link for account <id>; expires <iso8601>` |
| Email not valid | `2` | — | `error VALIDATION_ERROR: --email is not a valid email address` |
| No account for the email | `3` | — | `error NOT_FOUND: no account with that email` |

The CLI may say that the account does not exist: only someone with server access sees it, so this is not the account enumeration that spec §6.1 forbids on the public surface.

Audit: `event: "admin.reset_link_issued"`, `account_id`, `reset_link_id`.

## Web panel paths the links point at

The links are part of the contract between the CLI/API and the web panel (served from the same origin, [ADR-0004](../adr/0004-serve-the-spa-and-the-api-from-one-origin-under-api.md)):

| Link | SPA route | Screen | API call the screen makes |
|---|---|---|---|
| `PUBLIC_WEB_URL/invite/<token>` | `/invite/:token` | SCR-02 / SCR-03 | `lookUpInvitation`, then `acceptInvitation` |
| `PUBLIC_WEB_URL/reset-password/<token>` | `/reset-password/:token` | SCR-09 / SCR-03 | `lookUpPasswordResetLink`, then `redeemPasswordResetLink` |
