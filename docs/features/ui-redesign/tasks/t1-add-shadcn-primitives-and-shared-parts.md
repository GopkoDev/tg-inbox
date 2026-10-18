---
id: T1
title: "Add the canon's shadcn primitives and the shared preview/list parts"
layer: "ui"
deps: []
blocks: ["T2", "T3"]
acs: ["AC-17"]
files_hint: ["apps/web/src/shared/ui/", "apps/web/package.json", "pnpm-lock.yaml", "apps/web/src/shared/hooks/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "S"
status: "todo"
---

# T1 — Add the canon's shadcn primitives and the shared preview/list parts

## Place in the sequence

- **Blocked by:** — · **Blocks:** T2 — Move the entry screens onto the centred auth layout, T3 — Render workspace screens inside one layout route with the sidebar frame · **Wave:** 1 — every other ui task composes these primitives.
- **Lane:** owns `apps/web/src/shared/ui/` primitives; later tasks only import them.

## Why (user story)

> **As an** Operator
> **I want** an inbox screen with a conversation list and a conversation thread, filled with labelled sample data
> **So that** I can see how I will answer customers before the real inbox arrives
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** a contact list and a contact profile screen, filled with labelled sample data
> **So that** I can see how the contact base will look before the contacts step ships
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task lays down every primitive and shared part the other screens compose, including the sample-data label that makes AC-17 visible on every preview screen.

## Inlined context

> **shadcn primitives to install** (from the canon's *Not yet in the repo* list): `sidebar` (+ `separator`, `sheet`, `tooltip`), `breadcrumb`, `avatar`, `scroll-area`, `textarea`, `tabs`, `field`, `checkbox`, `select`, `popover` — each added with `pnpm dlx shadcn@latest add <name>` in `apps/web`, import fixed to `@/shared/lib/utils`, then moved into the canon inventory with its `file:line`.
>
> — `screens.md §New components, shadcn primitives to install, verbatim` · full text: [screens.md](../screens.md)

> | SampleDataBadge | One consistent "Sample data" label on every preview screen (spec AC-12/17); a `Badge` variant with fixed copy so steps 4/7 remove it in one place | pending |
> | DataTableToolbar | Search + filter controls above a card table, shared by Contacts and Team; no single primitive | pending |
> | EmptyFilterState | «Nothing matches» sentence + clear-filters button inside a table card, shared by Contacts and Team | pending |
>
> — `screens.md §New components, rows SampleDataBadge / DataTableToolbar / EmptyFilterState, verbatim` · full text: [screens.md](../screens.md)

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [../../../CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-17 — cross-context

> **Given** "Acme Flowers" whose business bot has already captured real contacts and conversations
> **When** an Operator of "Acme Flowers" opens the inbox, contacts or contact profile preview
> **Then** they see only the labelled sample data — the same in every workspace — and never a real contact or conversation of "Acme Flowers" or of any other workspace mixed into it
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Add `sidebar`, `separator`, `sheet`, `tooltip`, `breadcrumb`, `avatar`, `scroll-area`, `textarea`, `tabs`, `field`, `checkbox`, `select`, `popover` with the shadcn CLI inside `apps/web`; place them in `apps/web/src/shared/ui/` and fix every `cn` import to `@/shared/lib/utils` (the `use-mobile` hook goes to `apps/web/src/shared/hooks/` per `components.json`)
- [ ] `apps/web/src/shared/ui/sample-data-badge.tsx` — `SampleDataBadge`: outline `Badge` reading «Sample data»
- [ ] `apps/web/src/shared/ui/data-table-toolbar.tsx` — `DataTableToolbar`: a search `Input` slot + filter slots row, wraps on phone width
- [ ] `apps/web/src/shared/ui/empty-filter-state.tsx` — `EmptyFilterState`: one sentence + **Clear filters** button (props: message, onClear)
- [ ] Component tests for the three parts (accessible names, clear-filters callback)

## Edge cases

| Case | Behaviour |
|---|---|
| shadcn CLI writes into a different alias | move the file into `apps/web/src/shared/ui/` and fix imports; nothing under `src/components` |
| a primitive pulls a new runtime dependency | only `radix-ui` subpackages already covered by the unified `radix-ui` package; anything else is listed in the commit body |

## Definition of Done

- [ ] `pnpm --filter @tg/web build` passes with the new primitives
- [ ] component tests for SampleDataBadge, DataTableToolbar and EmptyFilterState pass
- [ ] no import of `@/lib/utils` or `@/components/...` remains
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
