---
id: T7
title: "Build the contacts and contact-profile previews on a sample-data source"
layer: "ui"
deps: ["T3"]
blocks: ["T8"]
acs: ["AC-15", "AC-16", "AC-17"]
files_hint: ["apps/web/src/features/contacts/", "apps/web/src/pages/ContactsPage.tsx", "apps/web/src/pages/ContactProfilePage.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T7 — Build the contacts and contact-profile previews on a sample-data source

## Place in the sequence

- **Blocked by:** T3 — Render workspace screens inside one layout route with the sidebar frame · **Blocks:** T8 — Register the new components in the canon and remove the reference markup · **Wave:** 3 — after the route tree exists; parallel with T4 and T6.
- **Lane:** own lane (`features/contacts/`).

## Why (user story)

> **As an** Operator
> **I want** a contact list and a contact profile screen, filled with labelled sample data
> **So that** I can see how the contact base will look before the contacts step ships
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

This task builds the contact list and profile previews behind the contacts source seam step 7 will swap.

## Inlined context

> **Chosen:** Option 1. It keeps fixtures out of the API client (no invented contract that steps 4/7 would have to honour or undo, no risk of mixing with real responses), and gives each later step one seam to replace — the source's functions become API calls with the shared contracts those steps define.
>
> — `adr/0002, Decision outcome, verbatim` · full text: [adr/0002-serve-preview-screens-from-a-swappable-per-feature-sample-data-source.md](../adr/0002-serve-preview-screens-from-a-swappable-per-feature-sample-data-source.md)

> SCR-09 default: title «Contacts» + SampleDataBadge; card table with toolbar (search «Search by name or username», tag filter popover with checkboxes, column toggle); columns: contact (avatar + name + `@username`), tags, language, first message date, last message (relative); rows open the profile. filtered: rows narrow, tag button shows a count. empty: «No contacts match» + Clear filters. phone: language and first-message columns hidden; table scrolls inside its card if wider. loading / error: N/A.
>
> — `screens.md §SCR-09, abridged` · full text: [screens.md](../screens.md)

> SCR-10 default: `/w/<id>/contacts/<contactId>` — header card (large avatar, name, `@username`, tags, language, first / last message dates, SampleDataBadge); Tabs: **Overview** (cards: Profile facts, Tags, Notes placeholder «Notes arrive with contacts») and **Conversation history** (table: date, direction, message preview). not found: unknown id → frame NotFoundCard. phone: avatar above facts, tabs full width.
>
> — `screens.md §SCR-10, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) · [ux-flows.md](../ux-flows.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. The previews never call the API client (AC-17).

## Acceptance criteria

### AC-15 — happy path

> **Given** an Operator on the contacts preview
> **When** they search by name and filter by a tag, then open a contact from the table
> **Then** the table narrows to the matching sample contacts, and the contact opens on a profile screen with a header card (avatar, name, username, key facts) and Overview / Conversation history sections, carrying the "Sample data" label; the profile can be reopened by reload, back or a saved link, and a link to a sample contact that does not exist shows the not-found card inside the frame
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — error

> **Given** an Operator on the contacts preview
> **When** their search and tag filter match no sample contact
> **Then** the table is replaced by one sentence saying no contact matches, with a button that clears the search and filter
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — cross-context

> **Given** "Acme Flowers" whose business bot has already captured real contacts and conversations
> **When** an Operator of "Acme Flowers" opens the inbox, contacts or contact profile preview
> **Then** they see only the labelled sample data — the same in every workspace — and never a real contact or conversation of "Acme Flowers" or of any other workspace mixed into it
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `features/contacts/sample-data.ts` + `sample-source.ts` — `listSampleContacts()`, `getSampleContact(id)`; identical for every workspace; unit-tested
- [ ] `features/contacts/ContactsPreview.tsx` — DataTableToolbar (search, tag popover with checkboxes, column toggle), card Table, EmptyFilterState; row click → profile address
- [ ] `features/contacts/ContactProfilePreview.tsx` — header card + Tabs Overview / Conversation history; unknown id → not found
- [ ] `pages/ContactsPage.tsx`, `pages/ContactProfilePage.tsx` render them
- [ ] Component tests: AC-15, AC-16, AC-17

## Edge cases

| Case | Behaviour |
|---|---|
| search + tag match nothing | «No contacts match» + Clear filters |
| unknown contact id | frame NotFoundCard |
| phone width | secondary columns hidden; the table may scroll inside its card, never the page |

## Definition of Done

- [ ] unit test for the contacts sample source passes
- [ ] component tests for AC-15, AC-16, AC-17 pass
- [ ] every Hard Rule inlined above still holds
- [ ] lint + typecheck clean (`pnpm lint`)
