---
id: T8
title: "Register the new components in the canon and remove the reference markup"
layer: "docs"
deps: ["T2", "T5", "T6", "T7"]
blocks: []
acs: []
files_hint: ["docs/design-system.md", "docs/design-refs/", ".gitignore"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
---

# T8 — Register the new components in the canon and remove the reference markup

## Place in the sequence

- **Blocked by:** T2 — Move the entry screens onto the centred auth layout, T5 — Move the team page into the Settings Team section with search and filters, T6 — Build the inbox preview on a swappable sample-data source, T7 — Build the contacts and contact-profile previews on a sample-data source · **Blocks:** — · **Wave:** 5 — last, once every screen exists.
- **Lane:** own lane (docs).

## Why (user story)

> **As an** Operator
> **I want** every workspace screen inside one frame with a side navigation, a workspace switcher and my account menu
> **So that** I always know where I am and reach any section in one step, on a desktop or a phone
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

This task closes the feature: the canon lists everything that was built, the local reference markup is gone, and the size budget is checked.

## Inlined context

> When the screens are done, every component added on the way — each newly added library primitive and each reusable screen part built for these screens (the workspace frame, the settings layout, the conversation list, the message bubble, the sample-data label) — is registered in the canon's component inventory, the local reference markup is deleted and the canon no longer points at it; feature work continues on the new frame.
>
> — `spec.md §1, committed approach, abridged` · full text: [spec.md](../spec.md)

> | Reference markup left | 0 reference files in the repository's reference folder and 0 mentions of it in the design canon at ship; 100% of library primitives and reusable screen parts added by this feature listed in the canon's component inventory | repository check before ship |
> | Initial download size | ≤ +120 KB gzipped, over the `main` baseline, of everything downloaded on the path "a signed-in operator opens the panel and arrives at a workspace's first screen" (the inbox preview here, the home placeholder on `main`) | build output of the files that path loads, compared against `main` in the review |
>
> — `spec.md §6, two NFR rows, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface.

## Acceptance criteria

No spec §5 AC — this task satisfies spec §6 «Reference markup left» and measures «Initial download size» (QG-3, QG-6).

## Checklist

- [ ] `docs/design-system.md` §Component inventory — add a row (file:line, states, notes) per new primitive and per NEW part (AuthLayout, SettingsLayout, SampleDataBadge, ConversationList, MessageBubble, ReplyComposer, DataTableToolbar, EmptyFilterState); update the AppShell row; shrink the «Not yet in the repo» list
- [ ] `docs/design-system.md` §Visual direction — drop the sentence about local reference markup in `docs/design-refs/`
- [ ] Delete `docs/design-refs/` (local, gitignored) and drop its `.gitignore` line
- [ ] Measure the first-load gzipped size vs `main` and record it for the review

## Edge cases

| Case | Behaviour |
|---|---|
| a primitive was added but not used | remove it rather than register it |
| first load over +120 KB gzipped | lazy-load the contacts and Settings routes (sad §11) and re-measure |

## Definition of Done

- [ ] `grep -r design-refs docs .gitignore` finds nothing
- [ ] every file added under `apps/web/src/shared/ui/` and every NEW part appears in the inventory
- [ ] first-load size delta recorded and ≤ +120 KB gzipped
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
