---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-11"
feature_size: M
---

# API sync report — workspace-operators

Derived from `data-model.md` (+ the staged `migrations/`), `sad.md` §6 flows 1–12, `spec.md` §4/§5 and feature ADR-0001…0005. Size **M**, route **standard** (from `.size` / `.route`).

**Contract forms** (from `sad.md` `target_surfaces: [backend-service, web-frontend, cli]`):

- `backend-service` → [`openapi.yaml`](openapi.yaml): 15 operations, OpenAPI 3.1. `redocly lint` is valid, with 2 warnings: no `info.license`, and `signOut` has no 4xx response. Both are accepted: sign-out always answers 204 by design (flow 6).
- `cli` → [`cli.md`](cli.md): 3 admin commands.
- `web-frontend` consumes `openapi.yaml`; it does not author a contract.
- No `events.md`: the feature has no async flows (sad.md §6 last note, §8 "Events / jobs: none"), so no operation needs `Idempotency-Key`.

## Deviations from the api-skill defaults

| Default | Contract | Authority |
|---|---|---|
| `BearerAuth` global | `SessionCookie` (apiKey in cookie `session`) global; public routes `security: []`; sign-out, invitation lookup and acceptance accept an optional session (`[{SessionCookie: []}, {}]`) | feature ADR-0002 |
| `/api/v1/…` URL versioning | `/api/…`, workspace routes under `/api/workspaces/{workspaceId}/…` | feature ADR-0003, ADR-0004 |
| Envelope `{code, message, details?}`, code `module.error_name` | `{ "error": { code, message, details? } }`, code UPPER_SNAKE in the existing `ErrorCode` | repo convention (`CLAUDE.md`, `packages/shared/src/errors.ts`); code form confirmed with the owner 2026-10-11 |
| Cursor pagination on lists | kept (owner's choice 2026-10-11): `listMyWorkspaces`, `listMemberships`, `listPendingInvitations` page by item id (UUIDv7, so creation / join order) | default |
| Link tokens anywhere | invitation and reset tokens travel in the JSON **body** (`…/lookup`, `…/accept`, `…/redeem`), never in an API path or query, so they never reach request logs | sad.md §8 (tokens never logged) |

## A. Field origins

Confidence: **high** = a column (or a sad.md/ADR rule) with a matching type and constraint; **medium** = a contract decision with no column, derived from a spec/ADR statement; **low** = inferred from a message name only.

| schema_path | origin | confidence |
|---|---|---|
| signIn.email | data-model.md → `accounts.email` (normalised, 3–254) via `EmailInput` | high |
| signIn.password | sad.md §8 (passwords ≤ 1024); min 1 on purpose (no policy hint at sign-in) | high |
| signIn → Set-Cookie `session` | feature ADR-0002 (cookie flags); cookie **name** `session` is this contract's choice | medium |
| lookUpPasswordResetLink.token | sad.md §8 (32 random bytes) + ADR-0002 (base64url) → `password_reset_links.token_hash` (SHA-256, 32 B) | high |
| redeemPasswordResetLink.token | same as above | high |
| redeemPasswordResetLink.password | sad.md §8 (10–1024) + AC-05 / AC-21 | high |
| getMe.account.id | data-model.md → `accounts.id` | high |
| getMe.account.email | data-model.md → `accounts.email` | high |
| getMe.account.display_name | data-model.md → `accounts.display_name` (1–200) | high |
| getMe.last_used_workspace_id | data-model.md → `memberships.workspace_id` of the active row with max `memberships.last_used_at` (AC-07) | high |
| listMyWorkspaces.items[].id | data-model.md → `workspaces.id` | high |
| listMyWorkspaces.items[].name | data-model.md → `workspaces.name` (1–200) | high |
| listMyWorkspaces.items[].role | data-model.md → `memberships.role` | high |
| *Page.has_next / has_prev / next_cursor | derived (cursor wrapper convention) | high |
| *.parameters.after / before / limit | derived (cursor wrapper convention) | high |
| lookUpInvitation.token | sad.md §8 → `invitations.token_hash` | high |
| lookUpInvitation → workspace_name | data-model.md → `workspaces.name` (sad.md §5 exception "invitation by token hash returns its workspace's name") | high |
| lookUpInvitation → email | data-model.md → `invitations.email` | high |
| lookUpInvitation → role | data-model.md → `invitations.role` | high |
| lookUpInvitation → account_exists | derived: an `accounts` row with `email = invitations.email` (flow 2 "whether an account exists") | high |
| InvitationInvalid.details.ask | derived: workspace has no memberships ⇒ first-owner invitation (data-model.md "First-owner invitation") → AC-06 hint | medium |
| acceptInvitation.token | sad.md §8 → `invitations.token_hash` | high |
| acceptInvitation.password | sad.md §8 (10–1024) + AC-05 | high |
| acceptInvitation.display_name | data-model.md → `accounts.display_name` (1–200 after trim) | high |
| acceptInvitation → WorkspaceSummary | data-model.md → `workspaces.id`, `workspaces.name`, `memberships.role` | high |
| enterWorkspace.workspaceId | data-model.md → `workspaces.id`; writes `memberships.last_used_at` (flow 7) | high |
| listMemberships.items[].id | data-model.md → `memberships.id` | high |
| listMemberships.items[].display_name | data-model.md → `accounts.display_name` (via `auth` app layer, flow 10) | high |
| listMemberships.items[].email | data-model.md → `accounts.email` (via `auth` app layer) | high |
| listMemberships.items[].role | data-model.md → `memberships.role` | high |
| listMemberships.items[].state | data-model.md → `memberships.state` | high |
| listMemberships.items[].created_at | data-model.md → `memberships.created_at` ("when the person joined") | high |
| listMemberships.items[].deactivated_at | data-model.md → `memberships.deactivated_at` (nullable) | high |
| deactivateMembership / reactivateMembership.membershipId | data-model.md → `memberships.id`; writes `state`, `deactivated_at` | high |
| listPendingInvitations.items[].id / email / role / created_at / expires_at | data-model.md → `invitations.*` (filtered `state = 'pending' AND expires_at > now`) | high |
| createInvitation.email | data-model.md → `invitations.email` via `EmailInput` | high |
| createInvitation.role | data-model.md → `invitations.role` | high |
| createInvitation → link | sad.md §7 `PUBLIC_WEB_URL` + SPA route `/invite/:token` (ADR-0004) | high |
| ALREADY_A_MEMBER.details.membership_id / state | data-model.md → `memberships.id`, `memberships.state` (lets SCR-08 offer "reactivate", AC-16) | medium |
| revokeInvitation.invitationId | data-model.md → `invitations.id`; writes `state = 'revoked'`, `closed_at` | high |
| X-Background-Request header | ADR-0002 / sad.md §8 ("the web client marks automatic requests with a header"); the **name** is this contract's choice | medium |
| cli `workspace:create --name` | data-model.md → `workspaces.name` (1–200) | high |
| cli `--owner-email`, `--email` | data-model.md → `invitations.email` / `accounts.email` | high |
| cli `--workspace` | data-model.md → `workspaces.id` | high |

No `low` rows and no field without an origin.

**Bound fixed by this stage:** `display_name` and `workspaces.name` max **200**. data-model.md left the upper bound "TBD — api fixes the limit, the CHECK follows". The staged CHECKs already say 1–200, so the contract adopts 200 and the source needs no change. The `TBD` comments in data-model.md can now be removed.

## B. Drift checklist

1. **Endpoint ↔ data-model** *(core)*: ✓. Every operation reads or writes at least one data-model entity: sign-in → `accounts`, `sign_in_failures`, `sessions`; sign-out → `sessions`; reset lookup/redeem → `password_reset_links`, `accounts`, `sessions`, `sign_in_failures`; me / my workspaces → `accounts`, `memberships`, `workspaces`; invitation lookup/accept → `invitations`, `workspaces`, `accounts`, `memberships`, `sessions`; enter → `memberships`; team ops → `memberships`, `invitations`. Every entity is reachable; `sign_in_failures` stays internal on purpose.
2. **Error code ↔ repo error definition** *(core)*: ✓ (proposal). The repo registry is `ErrorCode` in `packages/shared/src/errors.ts`. Five codes exist (`VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INTERNAL_ERROR`). sad.md §8 assigns this stage to fix the rest, so 11 are **added by this contract** and must be registered during implement: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOO_MANY_ATTEMPTS`, `ACCESS_REMOVED`, `OWNER_ONLY`, `INVITATION_INVALID`, `INVITATION_FOR_ANOTHER_EMAIL`, `RESET_LINK_INVALID`, `ALREADY_A_MEMBER`, `LAST_ACTIVE_OWNER`, `OWNER_ALREADY_JOINED`. Status classes: two new `AppError` subclasses (`UnauthenticatedError` 401, `TooManyRequestsError` 429, as sad.md §8 says); the rest are the existing classes carrying a specific code. That requires `code` to become overridable per instance (it is a fixed `readonly` field today). `FORBIDDEN` and `CONFLICT` remain unused by this feature.
3. **Validation ↔ constraint** *(core)*: ✓. Emails 3–254 normalised = `accounts_email_length_check` / `invitations_email_length_check` + the normalised CHECK. Request emails use `EmailInput`, which trims and lower-cases before format validation; otherwise ` bob@x.com` would be refused against spec §6.1. `display_name` 1–200 after trim = `accounts_display_name_length_check`. Workspace name 1–200 = `workspaces_name_length_check`. Roles `owner|operator` and states `active|deactivated` = the CHECK lists. Link token 43 base64url chars = 32 bytes, hashed into the 32-byte `token_hash` CHECK. Password 10–1024 = sad.md §8 (no column; only the hash is stored). The contract's `format: email` is stricter than the DB, which has only a length CHECK; this is intended.
4. **OpenAPI ↔ sequence** *(supporting)*: ✓, with 3 notes below. Every `alt` branch of flows 1–3 and 6–12 maps to a response:

| Flow · branch | Operation → response |
|---|---|
| 1 · email locked out | signIn → 429 `TOO_MANY_ATTEMPTS` |
| 1 · unknown email or wrong password | signIn → 401 `INVALID_CREDENTIALS` |
| 1 · credentials correct (+ "who am I") | signIn → 204; getMe + listMyWorkspaces → 200 |
| 2 · expired, used, revoked or replaced | lookUpInvitation / acceptInvitation → 404 `INVITATION_INVALID` |
| 2 · signed in with a different email | lookUpInvitation / acceptInvitation → 403 `INVITATION_FOR_ANOTHER_EMAIL` |
| 2 · valid | lookUpInvitation → 200; acceptInvitation → 200 |
| 2 · prose: wrong existing password / locked out | acceptInvitation → 401 `INVALID_CREDENTIALS` |
| 2 · prose: password < 10 (AC-05) | acceptInvitation → 400 `VALIDATION_ERROR` |
| 3 · no session or idle > 30 days | every session route → 401 `UNAUTHENTICATED` |
| 3 · never a member or no such workspace | every workspace route → 404 `NOT_FOUND` |
| 3 · membership deactivated | every workspace route → 403 `ACCESS_REMOVED` |
| 6 · no session / session found | signOut → 204 (both) |
| 7 · not an active member / active | enterWorkspace → 404 / 403 / 200 |
| 8 · caller is an operator | createInvitation → 403 `OWNER_ONLY` |
| 8 · email invalid or role unknown | createInvitation → 400 `VALIDATION_ERROR` |
| 8 · already a member | createInvitation → 409 `ALREADY_A_MEMBER` |
| 8 · not a member | createInvitation → 201 |
| 9 · membership not in this workspace | deactivate / reactivate → 404 `NOT_FOUND` |
| 9 · would leave no active business owner | deactivateMembership → 409 `LAST_ACTIVE_OWNER` |
| 9 · allowed / deactivated member | deactivate / reactivate → 200 |
| 10 · operator refused | listMemberships / listPendingInvitations / revokeInvitation → 403 `OWNER_ONLY` |
| 10 · not pending or not in this workspace / revoked | revokeInvitation → 404 / 204 |
| 11 · no account / found | cli `account:issue-reset-link` → exit 3 / 0 |
| 12 · unknown, old, used, superseded | lookUp / redeem → 404 `RESET_LINK_INVALID` |
| 12 · password < 10 | redeem → 400 `VALIDATION_ERROR` |
| 12 · consumed or expired in the meantime | redeem → 404 `RESET_LINK_INVALID` |
| 12 · consumed | redeem → 204 + cookie |
| 4 · validation / valid | cli `workspace:create` → exit 2 / 0 |
| 5 · no such workspace / has members / awaiting | cli `workspace:reissue-owner-invitation` → exit 3 / 4 / 0 |

**Supporting notes** (follow-ups, not blockers):

- **N1. Flow 1 "who am I" is two calls.** Because lists are paginated, the account (`getMe`) and the workspace list (`listMyWorkspaces`) are separate operations. Flow 1, the last steps of flow 12 and the switcher in flow 7 draw one call. The panel makes both calls; the AC-07 resolution is unchanged. A `sequences` touch-up can split the message later; it is cosmetic.
- **N2. Idempotent repeat of deactivate / reactivate is not drawn.** Flow 9 has no branch for deactivating an already-deactivated member or reactivating an active one. The contract answers 200 with the unchanged member. A repeat cannot break AC-18, because an already-deactivated owner is not counted as active. This is accepted as a contract decision.
- **N3. Route-level guard order.** On owner-only routes the guard runs first, so a deactivated owner gets `ACCESS_REMOVED`, not `OWNER_ONLY`. An operator gets `OWNER_ONLY`. This matches flow 3 → flow 8.

## Back-feed (coverage cross-check)

- **Every §5 AC → ≥1 operation / response:** ✓.
  - AC-01, AC-01b, AC-02 → cli.md.
  - AC-03, AC-04, AC-04b, AC-05, AC-06 → lookUpInvitation / acceptInvitation.
  - AC-07, AC-10 → signIn + getMe + listMyWorkspaces.
  - AC-08 → 401 `INVALID_CREDENTIALS`; AC-09 → 429.
  - AC-11 → signOut; AC-12 → enterWorkspace.
  - AC-13 → 404 `NOT_FOUND`.
  - AC-14 → createInvitation 201; AC-15 → 403 `OWNER_ONLY`; AC-16 → 409 `ALREADY_A_MEMBER`.
  - AC-17 → 403 `ACCESS_REMOVED` + listMyWorkspaces for "move to another workspace".
  - AC-18 → 409 `LAST_ACTIVE_OWNER`; AC-19 → reactivateMembership.
  - AC-20 → listMemberships + listPendingInvitations + revokeInvitation.
  - AC-21 → cli `account:issue-reset-link` + redeemPasswordResetLink.
  - AC-22 → 404 `RESET_LINK_INVALID`.
- **Every operation → a §4 story + ≥1 AC:** ✓ (each operation's `summary` names its US, and its `description` names its AC).
- **Every §6 `alt` branch → a response:** ✓ (table above).
- **Responses the contract needs but no §6 flow shows:** only cross-cutting schema errors (`400 VALIDATION_ERROR` on malformed tokens and cursors, `security` on lists) and N2. None is an authorization branch, so no sequence gap is raised and no Open Question is added.

## Notes for `tasks` / `implement`

- Register the 11 new codes in `ErrorCode` and add `UnauthenticatedError` / `TooManyRequestsError`. Let `AppError` subclasses carry a specific code (point 2).
- The error handler maps every non-`AppError`, non-validation error to 500 today. Mutating routes accept only `application/json` (ADR-0004), so Fastify's own 4xx errors (415 unsupported media type, 400 malformed JSON) must keep their status instead of becoming `INTERNAL_ERROR`.
- Paginate `listMyWorkspaces` by workspace id, `listMemberships` by membership id and `listPendingInvitations` by invitation id. Compute `last_used_workspace_id` separately (max `last_used_at` among active memberships).
- `signIn` for an unknown email must still run one hash verification (sad.md §8) so timing stays identical. The same applies to the 429 answer.
- Remove the two `<!-- TBD: … api fixes the limit -->` comments from data-model.md: the limit is 200 (section A).
- Update `CLAUDE.md` / `docs/architecture-map.md` with the cookie auth, the `/api` prefix and the new error classes (sad.md §11 item).


## Change log

- 2026-10-11 (T39, review R2): added `UNSUPPORTED_MEDIA_TYPE` (415) to `ErrorCode`, a shared `UnsupportedMediaType` response referenced by every mutating (POST) operation, and the code in the status table. Fastify's own 4xx (malformed or empty JSON body → 400 `VALIDATION_ERROR`) now keep their status instead of 500; a body with no content-type is refused with 415.
- 2026-10-11 (T47, review R3 B1): added `PAYLOAD_TOO_LARGE` (413) to `ErrorCode`, a shared `PayloadTooLarge` response referenced by every body-taking (POST) operation, and the code in the status table. The error handler now maps framework 4xx explicitly (400 -> `VALIDATION_ERROR`, 413 -> `PAYLOAD_TOO_LARGE`, 415 -> `UNSUPPORTED_MEDIA_TYPE`, any other -> 400 `VALIDATION_ERROR`), so every status/code pair it emits is in the contract.
- 2026-10-11 (T47 follow-up, per-task review): the body-less POST operations (`signOut`, `enterWorkspace`, `deactivateMembership`, `reactivateMembership`, `revokeInvitation`) now declare a shared `MalformedBody` 400 `VALIDATION_ERROR` response — Fastify answers it for a malformed or empty JSON body on any POST, and the error handler maps any other framework 4xx to it.
