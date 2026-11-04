---
id: T20
title: "Build SCR-37 the post editor with autosave, destination picker, sound option and preview, plus SCR-42 delete and SCR-44 back-to-draft dialogs"
layer: "ui"
deps: ["T17"]
blocks: ["T21", "T22"]
acs: ["AC-05", "AC-06", "AC-11", "AC-18"]
files_hint: ["apps/web/src/features/posts/editor/", "apps/web/src/pages/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T20 — Build SCR-37 the post editor with autosave, destination picker, sound option and preview, plus SCR-42 delete and SCR-44 back-to-draft dialogs

## Place in the sequence

- **Blocked by:** T17 — Add the web posts API source, stores (posts, destinations, a · **Blocks:** T21 — Build SCR-38 publish-now and SCR-39 schedule dialogs on thei, T22 — Build SCR-40 the post page for every non-draft state, with S · **Wave:** 3 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to write a post for one of the workspace's destinations and save it as a draft the team can see and edit
> **So that** posts are prepared together before an owner sends them
>
> — `spec.md §4, US-02, verbatim` · full text: [spec.md](../spec.md)

This task delivers: build SCR-37 the post editor with autosave, destination picker, sound option and preview, plus SCR-42 delete and SCR-44 back-to-draft dialogs.

## Inlined context

> SCR-37 states: loading · default (owner) · default (operator) · saving · validation · stale save · destination problem · draft notice · no destination yet · not a draft anymore · delete refused · error; saves 600 ms after the last keystroke and on blur
>
> — `screens.md SCR-37 + Decisions 3, abridged` · full text: [screens.md](../screens.md)

> SCR-44: «It won't go out unless a business owner schedules or publishes it again.»; too late → «It already went out»
>
> — `screens.md SCR-44, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

createPost, savePost, duplicatePost, deletePostDraft, movePostBackToDraft.

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-05 — happy path

> **Given** an operator of "Acme Flowers" with the destination "Acme Flowers News"
> **When** they create a post, pick that destination, type the text and tick "send without sound"
> **Then** the draft is saved as they type, shows how the text will look in the chat and how many characters remain, and appears on the Posts page for every member with its destination and who last changed it
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — error

> **Given** an operator editing a draft
> **When** the text is empty after trimming spaces and line breaks, is longer than Telegram allows for one message, or no destination is picked, or a teammate saved a newer version of the draft meanwhile
> **Then** the draft cannot be published or scheduled, the editor says plainly what is missing or too long, and a stale save is refused with the teammate's current version shown, never overwriting it
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — domain invariant

> **Given** a scheduled post
> **When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
> **Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — authorization

> **Given** a draft created by an operator
> **When** another operator tries to delete it
> **Then** they are refused and told only its author or a business owner can delete it; a scheduled post must be moved back to a draft first, and a published, failed or missed post is kept as a record and cannot be deleted from the panel
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] PostEditor with UTF-16 counter (shared rule)
- [ ] dialogs
- [ ] tests per state incl. stale save

## Edge cases

| Case | Behaviour |
|---|---|
| typing while a save is in flight | next save waits, uses the new version |

## Definition of Done

- [ ] component tests per state pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
