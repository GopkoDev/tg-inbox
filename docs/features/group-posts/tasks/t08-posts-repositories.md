---
id: T8
title: "Build the posts repositories for destinations, destination codes and posts, with cross-workspace isolation tests"
layer: "infra"
deps: ["T3", "T4"]
blocks: ["T9", "T10"]
acs: ["AC-04"]
files_hint: ["apps/api/src/modules/posts/infra/"]
owner: "Dmytro Hopko"
estimate: "L"
context_budget: "S"
status: "todo"
step: ""
---

# T8 — Build the posts repositories for destinations, destination codes and posts, with cross-workspace isolation tests

## Place in the sequence

- **Blocked by:** T3 — Promote staged migrations 01–04 (workspaces.time_zone, desti, T4 — Add the posts domain: states and transitions, the schedule w · **Blocks:** T9 — Add the destination use cases: create and read a connect cod, T10 — Add the post draft use cases and reads: create, save against · **Wave:** 3 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to write a post for one of the workspace's destinations and save it as a draft the team can see and edit
> **So that** posts are prepared together before an owner sends them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
> **So that** the team notices at once when a post did not go out and can act
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task delivers: build the posts repositories for destinations, destination codes and posts, with cross-workspace isolation tests.

## Inlined context

> Indexes: list by `(workspace_id, last_changed_at DESC, id DESC)` and by state; `posts_scheduled_idx` `(workspace_id, destination_id, scheduled_for)` WHERE scheduled; `posts_sent_idx` for the daily count; `posts_attention_idx`; destinations by `(workspace_id, chat_id)`; codes by `(workspace_id, code_hash)`.
>
> — `data-model.md §Indexes, abridged` · full text: [data-model.md](../data-model.md)

> Lock order: memberships `FOR SHARE` → advisory `posts:<ws>` (limits, codes) → destination row → post row `FOR NO KEY UPDATE`
>
> — `sad.md §8 Concurrency, abridged` · full text: [sad.md](../sad.md)

> Every repository gets an integration test proving cross-workspace isolation.
>
> — `CLAUDE.md §Rules «Tenancy», verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

All columns of `destinations`, `destination_codes`, `posts` (data-model.md §Entities) — read / write.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-04 — authorization

> **Given** members of "Acme Flowers" and of "Bolt Bikes"
> **When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
> **Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `infra/destination-repo.ts` — find by chat, list live, lock, upsert/revive, availability, migrate chat id, rename, remove, pause / next_send_at
- [ ] `infra/code-repo.ts` — insert, replace previous, find by hash, mark used / result
- [ ] `infra/post-repo.ts` — insert, lock, save, transitions, list (filters, 200 cap), counts (sent 24 h, scheduled, attention), scheduled-by-account, earlier-due-in-chat
- [ ] advisory lock helper `posts:<ws>`
- [ ] `*.int.test.ts` incl. isolation for each repo

## Edge cases

| Case | Behaviour |
|---|---|
| id of another workspace | not found |
| two codes same hash different workspaces | isolated by `(workspace_id, code_hash)` |

## Definition of Done

- [ ] integration tests (Testcontainers) pass, isolation proven per repo
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
