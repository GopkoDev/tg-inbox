---
id: T12
title: "Add contact search ids and contacts by ids to the contacts module"
layer: "infra"
deps: []
blocks: ["T16"]
acs: ["AC-02"]
files_hint: ["apps/api/src/modules/contacts/app/contacts.ts", "apps/api/src/modules/contacts/app/ports.ts", "apps/api/src/modules/contacts/app/fakes.ts", "apps/api/src/modules/contacts/infra/contact-repo.ts", "apps/api/src/modules/contacts/infra/contact-repo.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
---

# T12 — Add contact search ids and contacts by ids to the contacts module

## Place in the sequence

- **Blocked by:** — · **Blocks:** T16 — Create the inbox module with its read use cases and routes (list, search, conversation, thread, items, mark read, bot status) and wire it into buildDeps and buildApp · **Wave:** 1 — nothing upstream.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
> **So that** I know at a glance which customers need an answer
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It finds conversations by the contact's name or username, in any alphabet and letter case.

## Inlined context

> `contacts` matches the query (trimmed, a leading "@" dropped, case-insensitive in any alphabet) anywhere in "first name + space + last name" or the username and returns contact ids; the list then filters by those ids. At pilot scale (≤ 1 000 contacts per workspace, spec §6) this is one scan of one workspace's contacts.
>
> — `sad.md §4, Search through contacts, verbatim` · full text: [sad.md](../sad.md)

> search folds case with Postgres' Unicode-aware lower-casing, so Cyrillic and Latin names match case-insensitively; texts are stored and sent as received
>
> — `sad.md §8, Internationalisation, abridged` · full text: [sad.md](../sad.md)

> `inbox` → `contacts`: *search contact ids*, *contacts by ids* (names and usernames for list rows and thread headers).
>
> — `sad.md §5, Cross-module app-layer calls, verbatim` · full text: [sad.md](../sad.md)

> `contacts_workspace_id_telegram_user_id_key` — its leading `workspace_id` bounds the contact-search scan.
>
> — `data-model.md §Indexes, reused, verbatim` · full text: [data-model.md](../data-model.md)

> **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules, Tenancy, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (Reads `contacts.first_name`, `last_name`, `username` by `workspace_id`.)

## API contract

Internal — no API surface. (Behind `listConversations` `q`, max 200 chars; `ContactSummary` fields `id`, `first_name`, `last_name`, `username` without `@`.)

## Acceptance criteria

### AC-02 — happy path

> **Given** an operator in the inbox of "Acme Flowers"
> **When** they type part of a contact's name or username into the search
> **Then** the list shows only the conversations whose contact matches — the text is looked for anywhere in the contact's full name (first and last name together) or username, ignoring letter case in any alphabet, surrounding spaces and a leading "@"; when nothing matches it says so and offers to clear the search; when the workspace has no conversations at all the inbox explains that conversations appear when customers write to the bot — and a business owner whose workspace has no connected bot is offered the way to the bot settings
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `searchContactIds(workspaceId, query)`: trim, drop one leading `@`, empty → no filter; `lower(first_name || ' ' || coalesce(last_name, ''))` or `lower(username)` `LIKE '%' || lower(q) || '%'` with `%`/`_` escaped — `modules/contacts/infra/contact-repo.ts`
- [ ] `contactsByIds(workspaceId, ids)` — same file
- [ ] Expose both through the app layer + fakes — `modules/contacts/app/contacts.ts`, `ports.ts`, `fakes.ts`
- [ ] Integration tests: Cyrillic and Latin case folding, full-name match across the space, username with `@`, `%` in the query, isolation — `modules/contacts/infra/contact-repo.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `q = '  @Olena '` | matches username `olena_k` and name «Olena Kravets» |
| `q = 'олена'` vs name «Олена» | matches (Unicode lower-casing) |
| `q = 'Olena Kr'` | matches across first + last name |
| `q = '%'` | literal `%`, not a wildcard |
| Contact of another workspace with the same name | not returned |

## Definition of Done

- [ ] integration tests prove trimming, `@` dropping, Unicode case folding, full-name matching, wildcard escaping and workspace isolation
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
