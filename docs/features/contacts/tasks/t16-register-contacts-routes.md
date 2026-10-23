---
id: T16
title: "Register the contacts routes (registerContacts): the eight operations with their zod schemas, the ownerOnly guard on rename and delete, and the wiring in buildDeps and buildApp"
layer: "ports"
deps: ["T10", "T12", "T14"]
blocks: ["T17", "T26"]
acs: ["AC-11", "AC-12", "AC-15"]
files_hint: ["apps/api/src/modules/contacts/http/routes.ts", "apps/api/src/modules/contacts/http/routes.int.test.ts", "apps/api/src/app.ts", "apps/api/src/deps.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T16 — Register the contacts routes (registerContacts): the eight operations with their zod schemas, the ownerOnly guard on rename and delete, and the wiring in buildDeps and buildApp

## Place in the sequence

- **Blocked by:** T10 — Add the contacts read use cases: the list page (normalised search, resolved and missing tag ids, the none-with-tags refusal), the profile with adders' names and the tag-history page with actors' names, through a contacts → workspaces display-name port, T12 — Add removeContactTag: the contact lock, the no-op for a tag no longer carried (foreign ids included), the member rate limit, the link delete, one removed entry and contact.changed, T14 — Add deleteTag against the confirmed count: TAG_COUNT_CHANGED with the current count, deleted entries on every contact that lost the tag, tags.changed · **Blocks:** T17 — Add the API end-to-end contacts stories, the integrity queries, the cross-workspace and secrecy suite, the live-push assertions and the seeded 10 000-contact timing checks, T26 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the contacts routes and tables, the contacts → workspaces edge, the new signals and the new components · **Wave:** 7 — after T10, T12, T14.
- **Lane:** Shares `apps/api/src/deps.ts` with T10 — serialized.

## Why (user story)

> **As a** Business owner
> **I want** to rename, merge and delete the workspace's tags
> **So that** one kind of customer has one tag and the list stays usable
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It opens the contacts module's first HTTP surface, with the owner-only part held by the server.

## Inlined context

> **Hard rule:** **Module wiring:** each module exports `register<Module>(app, deps)` from `modules/<m>/http/routes.ts`; only `buildDeps()` constructs module dependencies (shared by `buildApp()` and the CLI) and only `buildApp()` registers modules. No self-registration, no globals.
>
> — `CLAUDE.md §Rules, Module wiring, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> - **Owner-only management (AC-11).** Rename/merge and delete routes carry the existing `ownerOnly` preHandler (`OWNER_ONLY`). Tag list with counts and contact tag writes need only the membership guard. The web hides the Settings → Tags entry for operators and shows the owners-only refusal on a direct visit.
>
> — `sad.md §4, Supporting choices, Owner-only management, verbatim` · full text: [sad.md](../sad.md)

> 1. **Methods follow the repo, not sad.md §5's indicative table.** The repo uses GET reads and action POSTs only (`/memberships/{id}/deactivate`, `/bot/disconnect`; no PATCH or DELETE route exists). So: `POST …/contacts/{contactId}/tags` (add), `POST …/contacts/{contactId}/tags/{tagId}/remove`, `POST …/tags/{tagId}/rename`, `POST …/tags/{tagId}/delete`. The SAD said "`api` fixes the names". See flag F-1.
> 13. **`listTags` is readable by both roles** (sad.md §5 "member" guard): the picker and the filter need it. Only rename and delete carry `ownerOnly` (`403 OWNER_ONLY`, message "Only a business owner manages the workspace's tags").
>
> — `contracts/api-sync-report.md §Assumptions, 1, verbatim` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> | Authorization | Every route sits under `/api/workspaces/:workspaceId/…` behind the `workspaces` guard: another workspace's account gets not found with no hint, a deactivated member `ACCESS_REMOVED`, a signed-out visitor is sent to sign in (AC-12). Rename/merge/delete add `ownerOnly` (`OWNER_ONLY`, AC-11). Both roles have identical rights over contacts and contact tags (spec §1). | workspace-operators ADR-0003, §4 |
>
> — `sad.md §8, Authorization, verbatim` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

| operationId | Method + path (under `/api/workspaces/{workspaceId}`) | Guard |
|---|---|---|
| `listContacts` | `GET /contacts` | member |
| `getContact` | `GET /contacts/{contactId}` | member |
| `listContactTagHistory` | `GET /contacts/{contactId}/tag-history` | member |
| `addContactTag` | `POST /contacts/{contactId}/tags` | member |
| `removeContactTag` | `POST /contacts/{contactId}/tags/{tagId}/remove` | member |
| `listTags` | `GET /tags` | member |
| `renameTag` | `POST /tags/{tagId}/rename` | owner (`403 OWNER_ONLY` «Only a business owner manages the workspace's tags») |
| `deleteTag` | `POST /tags/{tagId}/delete` | owner |

Guard answers on every route: `401 UNAUTHENTICATED`, `403 ACCESS_REMOVED`, `404 NOT_FOUND` (no hint). `429` carries `Retry-After`.

— `contracts/api-sync-report.md §Operations, abridged`; `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-11 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they look for the Tags section of Settings, or try to rename, merge or delete a tag (for example through a saved link to the section)
> **Then** Settings shows them no Tags section, the attempt changes nothing, and the panel says that only a business owner manages the workspace's tags; the operator can still add and remove tags on contacts and create new tags while doing so
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `registerContacts(app, deps)` with the eight routes, request / response schemas from `@tg/shared` contacts, the merge-into-itself `VALIDATION_ERROR`, `ownerOnly("Only a business owner manages the workspace's tags")` on rename and delete — `apps/api/src/modules/contacts/http/routes.ts`
- [ ] Construct the tag use cases in `buildDeps()` and register under `/api` in `buildApp()` — `apps/api/src/deps.ts`, `apps/api/src/app.ts`
- [ ] Route integration tests via `app.inject()`: each operation's success and every error code, `Retry-After` on `429`, operator → `403 OWNER_ONLY` on rename / delete with nothing changed, operator `200` on list / add / remove / `listTags` — `apps/api/src/modules/contacts/http/routes.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| an operator posts rename or delete (saved link, crafted request) | `403 OWNER_ONLY`, nothing changes (AC-11) |
| an operator lists tags with counts | `200` — the read is a member read (AC-11) |
| an account of another workspace on any route | `404 NOT_FOUND`, no hint (AC-12) |
| a deactivated member | `403 ACCESS_REMOVED` (AC-12) |
| an owner's rename / delete | never `429` (AC-15) |

## Definition of Done

- [ ] Route integration tests prove every contacts operation answers its contract shape and every listed error code, rename and delete refuse an operator with OWNER_ONLY and change nothing while the member routes accept both roles, the guard answers 401 / 403 ACCESS_REMOVED / 404 with no hint, and TAG_CHANGE_LIMIT_REACHED carries Retry-After.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
