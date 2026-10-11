---
id: T19
title: "Update CLAUDE.md, the architecture map, the workspace-operators SAD and the design system for the new modules, exceptions and config"
layer: "docs"
deps: ["T16", "T17", "T18"]
blocks: []
acs: ["AC-13", "AC-14"]
files_hint: ["CLAUDE.md", "docs/architecture-map.md", "docs/features/workspace-operators/sad.md", "docs/design-system.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
---

# T19 — Update CLAUDE.md, the architecture map, the workspace-operators SAD and the design system for the new modules, exceptions and config

## Place in the sequence

- **Blocked by:** T16, T17, T18 — the docs describe what is wired · **Blocks:** — · **Wave:** 8.
- **Lane:** own lane (only task touching `CLAUDE.md` and the map).

## Why (user story)

> **As an** End customer
> **I want** what I write to the business's bot to reach the business's team
> **So that** I get an answer without leaving Telegram or knowing who is on shift
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task records the conventions this feature extends, so the next feature does not reintroduce a cross-tenant read by accident.

## Inlined context

> `CLAUDE.md` and the architecture map do not list the new modules, config keys and the two new tenancy exceptions — Update both in this feature's tasks (also the workspace-operators SAD §5 exception list)
>
> — `sad.md §11, Risks table row, verbatim` · full text: [sad.md](../sad.md)

> **Override — deliberate extension:** two new reads without a `workspaceId` (bot by webhook id, bots due for a health check) join the controlled-exception list
>
> — `sad.md §2, Conventions, abridged` · full text: [sad.md](../sad.md)

> When `implement` touches AppShell, its row in `docs/design-system.md` should mention the **Bot** link alongside the owner-only Team link.
>
> — `screens.md §New components, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-13 — cross-context

> **Given** "Acme Flowers" and "Bolt Bikes" each have a connected bot, and one person writes to both bots
> **When** both messages are captured
> **Then** each workspace has its own contact and conversation for that person, holding only the messages sent to its own bot, and neither workspace can see that the other one knows the person
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — authorization

> **Given** a connected bot of "Acme Flowers"
> **When** someone who is not Telegram sends the system a message pretending to come from that bot
> **Then** the system ignores it — nothing is captured and no contact or conversation is created
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `CLAUDE.md` Tenancy rule: five controlled exceptions (three `workspaces` + *bot by webhook id* scoped by the secret hash, *bots due for a health check* used only by the scheduled job); Layout: `modules/bots|conversations|contacts`; Telegram rule: `telegramApi(token, { apiRoot })`, webhook secret header; Errors: first 5xx (`TelegramUnavailableError`)
- [ ] `docs/architecture-map.md`: module list + dependency direction (`bots → conversations → contacts`, `bots → contacts`), the two exceptions in the multi-tenancy risk line, the four config keys, the two pg-boss queues, public HTTPS webhook requirement
- [ ] `docs/features/workspace-operators/sad.md` §5 "Controlled exceptions": append the two bots reads with a pointer to bot-connection ADR-0007
- [ ] `docs/design-system.md` AppShell row: owner-only **Bot** link next to Team

## Edge cases

| Case | Behaviour |
|---|---|
| `CLAUDE.md` and the map disagree after the edit | the map wins — fix `CLAUDE.md` (CLAUDE.md header rule) |

## Definition of Done

- [ ] all four documents list the same five exceptions, the three modules and the four config keys; `.env.example` (T2) matches the map
- [ ] `pnpm lint` (Prettier over Markdown) clean
