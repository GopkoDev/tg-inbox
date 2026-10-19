---
id: T22
title: "Build SCR-20, the TagControl, and mount it on the profile and on the inbox conversation header (SCR-02) with the contact's tags and the name linking to the profile"
layer: "ui"
deps: ["T18", "T20"]
blocks: ["T25", "T26"]
acs: ["AC-06", "AC-07", "AC-08", "AC-14", "AC-15"]
files_hint: ["apps/web/src/features/tags/TagControl.tsx", "apps/web/src/features/tags/TagControl.test.tsx", "apps/web/src/features/tags/match.ts", "apps/web/src/features/tags/match.test.ts", "apps/web/src/features/inbox/Thread.tsx", "apps/web/src/features/inbox/Thread.test.tsx", "apps/web/src/features/contacts/ContactProfile.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T22 — Build SCR-20, the TagControl, and mount it on the profile and on the inbox conversation header (SCR-02) with the contact's tags and the name linking to the profile

## Place in the sequence

- **Blocked by:** T18 — Add the web contacts and tags API sources and stores, with the live subscriptions to contact.changed, tags.changed, conversation.changed (never mark read) and resync, T20 — Build SCR-19, the contact profile: the header card with facts and tags, the conversation card, the Conversation / Tag history tabs with TagHistoryList and ContactCrumb, and remove the contacts sample source and SampleDataBadge · **Blocks:** T25 — Add browser end-to-end contacts flows against the real API: list and filter, profile reading without marking read, tagging live between two members, owner rename / merge / delete, the operator refusal, T26 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the contacts routes and tables, the contacts → workspaces edge, the new signals and the new components · **Wave:** 6 — after T18, T20.
- **Lane:** Shares `apps/web/src/features/contacts/ContactProfile.tsx` with T20; shares `apps/web/src/features/contacts/ContactProfile.tsx` with T21 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It makes tagging part of answering: one control, in the conversation and on the profile, that reuses the team's tags first.

## Inlined context

> 3. **The tag control (SCR-20) is a `Popover`** opened from an **Add tag** button next to the contact's tags, on SCR-02's header and on SCR-19. It holds a search `Input` (the combobox, `role="combobox"` with `aria-controls` the list), the contact's carried tags as `Badge`s with a remove button, the suggestion rows as ghost `Button`s (`role="option"`, Up / Down moves, Enter picks, Esc closes and returns focus to **Add tag**) and the guidance line. It stays open after each add or remove, so a member can make several changes, and shows every refusal inside itself (AC-06). Matching runs in the browser over `listTags` with the shared tidy and fold functions; the server decides again.
> - **No new npm dependency.** The SAD's «popover + command list» for the tag control (sad.md §4) is **not** the shadcn `command` primitive: `pnpm dlx shadcn@latest add command` pulls in the `cmdk` package, which `apps/web/package.json` does not have (checked 2026-10-19; the dependencies are `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `zustand`, `zod`, `react-router`). The tag control is composed from the existing `Popover` + `Input` + `Button` rows, as `AssigneeChooser` already is (Decision 3). No primitive from the canon's _Not yet in the repo_ list is needed (no toast: every outcome is shown in place).
>
> — `screens.md §Decisions, 3, verbatim` · full text: [screens.md](../screens.md)

> - **The tag picker never offers to create a name that already exists.** When the typed text is an existing tag after tidying and ignoring case, only that tag is offered. Tags the contact already carries are shown as carried, not offered again. Suggestions that start with the typed text come first, then those that contain it, each group in tag-list order (AC-06, AC-08).
>
> — `spec.md §1, Clarifications, picker, verbatim` · full text: [spec.md](../spec.md)

> | State | Trigger / condition | Components (from the inventory) | Source-ref |
> | --- | --- | --- | --- |
> | default | opened — focus in the search `Input` («Add a tag…»); above it the carried tags as `Badge`s, each with a remove button (`aria-label` «Remove tag Kyiv») and «Added by Test User, 19 Oct» in its `title`; below it, with the field empty, every workspace tag in tag-list order (carried ones marked «✓ On this contact», not selectable); at the bottom, always, the guidance line «Tags are visible to your whole team. Don't use them for health, religion or other sensitive traits.» (AC-06; flow 8) | NEW: TagControl (Popover, Input, Badge, Button, ScrollArea, Separator) | wireframe «tag control» |
> | typing: matches | text typed — tidied and case-folded with the shared functions; tags whose tidied name **starts with** it first, then those that **contain** it, each group in tag-list order; carried ones stay marked and unselectable (AC-06; flow 8) | NEW: TagControl | wireframe «tag control» |
> | typing: exact match | the text equals a tag's name ignoring case and spacing («vip», « VIP », «VIP  ») — only that tag is offered (or shown as carried), **no** create row (AC-06, AC-08; flow 8) | NEW: TagControl | — |
> | typing: new name | no tag has that name — the matches (if any) and, last, the separate row **Create tag "Kyiv"** (the tidied text, quoted) (AC-06; flow 9) | NEW: TagControl | wireframe «tag control» |
> | validation: name rules | **Create tag** with a text that tidies to empty or to more than 32 characters (graphemes) — checked in the browser first, nothing sent; `FieldError` under the input «A tag name must be 1 to 32 characters», input `aria-invalid`; the same text for a server `400 TAG_NAME_INVALID` (AC-07; flow 9) | NEW: TagControl, Field (`FieldError`) | — |
> | pending | a tag picked, created or removed — a spinner on that row or badge; every add / remove control is disabled until the answer; the input stays editable (flow 8, flow 9, flow 10) | NEW: TagControl | — |
> | success: added | `200` `outcome: recorded` — the tag moves into the carried badges under its current name (a tag renamed meanwhile shows its new name), the input clears and keeps focus; the host's tags update from the answer's `tags`; with `tag_created: true` the tag store re-reads `listTags`. Teammates see it through `contact.changed` (AC-06, AC-14; flow 8, flow 9; S1) | NEW: TagControl | — |
> | success: removed | `200` `outcome: recorded` on remove — the badge goes; the host updates (AC-06; flow 10) | NEW: TagControl | — |
> | unchanged | `200` `outcome: unchanged` (a teammate added or removed the same tag a moment earlier) — the control shows the answer's `tags`, no message (AC-06; flow 8, flow 10) | NEW: TagControl | — |
> | limit: contact carries 20 | 20 badges carried (on open, or `409 CONTACT_TAG_LIMIT_REACHED`) — the suggestion and create rows are disabled and an `Alert` reads «A contact can carry at most 20 tags. Remove one to add another.»; remove still works (AC-08; flow 8) | NEW: TagControl, Alert | — |
> | limit: workspace has 100 | `409 TAG_LIMIT_REACHED` on **Create tag** — `Alert` «A workspace can have at most 100 tags. A business owner can merge or delete some in Settings → Tags.»; nothing created; picking existing tags still works (AC-08; flow 9) | NEW: TagControl, Alert | — |
> | refused: tag no longer exists | `404 TAG_NOT_FOUND` — `Alert` «This tag no longer exists.»; the tag store re-reads `listTags` and the host re-reads `getContact`, so the control shows the current tags (AC-14; flow 8; S1) | NEW: TagControl, Alert | — |
> | limit: rate | `429 TAG_CHANGE_LIMIT_REACHED` — `Alert` «Tag changes are limited to 60 a minute. You can continue in 14 s.» counting down to `details.retry_at`; add and remove disabled until then, then the alert goes (AC-15; flow 8, flow 10) | NEW: TagControl, Alert | — |
> | error: action failed | network / `500` — destructive `Alert` «Couldn't change the tags — try again.»; controls enabled again; nothing shown changed (flow 8) | NEW: TagControl, Alert (destructive) | — |
> | empty: no tags yet | the workspace has no tags and the field is empty — «Type a name to create the first tag» above the guidance line (assumption) | NEW: TagControl | — |
> | loading | the tag store has not loaded `listTags` yet — 3 row `Skeleton`s in the suggestion list; the carried badges (from the host) show at once (flow 8) | NEW: TagControl, Skeleton | — |
> | live | `contact.changed` / `tags.changed` while open — carried badges and suggestions re-render; the typed text stays; a tag merged or deleted meanwhile disappears from the suggestions (AC-06, AC-14; flow 11) | NEW: TagControl | — |
> | closed | Esc, a click outside, or the trigger again — focus returns to **Add tag**; the host shows the updated tags (flow 8) | — | — |
> | not found | `404 NOT_FOUND` for the contact (contact not of this workspace) — the control closes and the host re-reads (SCR-19 → not found) (AC-12; flow 8) | — | — |
> | phone (< md) | the popover takes the viewport width minus the 16 px gutters and opens below the trigger; rows are 44 px tall | NEW: TagControl | — |
> | guard states | → §Shared states | — | §Shared states |
>
> — `screens.md §SCR-20, state table, verbatim` · full text: [screens.md](../screens.md)

> | State | Trigger / condition | Components (from the inventory) | Source-ref |
> | --- | --- | --- | --- |
> | default: tags | the header shows, under the name and `@username`, the contact's tags as `Badge`s in tag-list order and **Add tag** (SCR-20, `source: inbox`); a contact with no tags shows only **Add tag** (AC-06; flow 8) | extended: Thread, NEW: TagControl | wireframe «thread header» |
> | default: name links to the profile | the contact's name (and avatar) in the header is a link to SCR-19 `/w/<id>/contacts/<contactId>` (AC-04; flow 6) | extended: Thread | wireframe «thread header» |
> | loading: tags | `getContact` in flight — a short `Skeleton` in the tags row; the rest of the header as before (flow 8) | extended: Thread, Skeleton | — |
> | error: tags | `getContact` fails (network / `500`) — the tags row reads «Couldn't load tags» (muted) + a **Retry** link button; replying and the actions are unaffected (flow 8) | extended: Thread, Button (`link`) | — |
> | live: tags | `contact.changed` for this contact / `tags.changed` — the tags row re-reads and updates in place for every member with this header open (AC-06, AC-09; flow 11) | extended: Thread | — |
> | tagging | **Add tag** → SCR-20 over the thread; the member stays in the conversation, the composer keeps its draft (AC-06; flow 8) | NEW: TagControl | §SCR-20 |
>
> — `screens.md §SCR-02, header extension rows, verbatim` · full text: [screens.md](../screens.md)

> **Hard rule:** **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `addContactTag` `{ tag_id | name, source: inbox | profile }` → `ContactTagAdded`; `removeContactTag` `{ source }` → `ContactTagRemoved`.
- Refusals shown in place: `TAG_NAME_INVALID`, `TAG_LIMIT_REACHED`, `CONTACT_TAG_LIMIT_REACHED`, `TAG_NOT_FOUND` (re-read tags + contact), `TAG_CHANGE_LIMIT_REACHED` (count down to `details.retry_at`); `404 NOT_FOUND` closes the control.

— `contracts/openapi.yaml, operationIds addContactTag, removeContactTag, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-06 — happy path

> **Given** an operator answering a conversation of "Acme Flowers" in the inbox, or on its contact's profile, while "Acme Flowers" has the tags "VIP" and "Wholesale"
> **When** they open the tag control on the contact and type "vi", pick "VIP", then type "Kyiv" (which no tag matches) and confirm creating it, then remove "Wholesale"
> **Then** while typing, existing tags that contain the text are offered first (those that start with it before the others; tags the contact already carries are shown as carried, not offered) and creating a new tag is a separate, named choice ("Create tag "Kyiv"") that appears only when no existing tag has that name ignoring letter case and spacing; the contact now carries "VIP" and "Kyiv" and not "Wholesale", "Kyiv" exists in the workspace's tag list for everyone, each added tag records the member who added it and when, the contact's tag history shows the two additions and the removal with the member and time, the change shows for every member who has that conversation header or profile open without reloading, and the Contacts list filter finds the contact by the new tags; adding a tag the contact already carries, or removing one it no longer carries (for example when two members act at the same moment), changes nothing and writes no history entry; the tag control always shows one line saying that tags are visible to the whole team and should not record health, religion or other sensitive traits; no tag change is ever sent to the end customer
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — error

> **Given** an operator creating a tag in "Acme Flowers"
> **When** the name is empty or only spaces, or longer than 32 characters once its ends are trimmed and inner spaces collapsed (an emoji counts as one character)
> **Then** no tag is created and nothing changes on the contact, and the tag control says that a tag name must be 1 to 32 characters
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — domain invariant

> **Given** "Acme Flowers" has the tag "VIP" and 100 tags in total, and a contact that carries 20 tags
> **When** an operator types "vip", " VIP " or "VIP  " (other letter case, or spaces around the name) for a contact, or two members create "Kyiv" for different contacts at the same moment, or someone tries to create a 101st tag or add a 21st tag to that contact
> **Then** a name that differs from an existing tag only in letter case or spacing is the existing tag ("vip" applies "VIP"), and two members creating the same new name at the same moment end up with one tag applied to both contacts — a workspace never holds two tags with the same name; the 101st tag is not created and the tag control says a workspace can have at most 100 tags and a business owner can merge or delete some in Settings; the 21st tag is not added (and a new name typed for it is not created either) and the control says a contact can carry at most 20 tags; both limits hold when members act at the same moment
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — domain invariant

> **Given** an operator whose tag control on a contact of "Acme Flowers" still offers the tag "Old promo"
> **When** a business owner deletes "Old promo" (or merges it into another tag) before the operator picks it
> **Then** the tag is not added, the operator is told that this tag no longer exists, and the control shows the current tags; when the owner only renamed the tag, picking it adds the renamed tag under its new name and no tag with the old name is created; a contact never carries a tag that is not in the workspace's tag list
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — error

> **Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
> **When** they try another tag change
> **Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count: each addition and each removal counts as one, creating a new tag together with putting it on the contact counts as one, and adding a tag the contact already carries counts as none; a business owner's rename, merge and delete are not counted and not limited; the limit is per workspace, so changes in another workspace of the same account are not affected
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `matchTags(tags, typed, carried)` with the shared tidy / key: starts-with group then contains group, each in tag-list order, carried marked, an exact key match hides create — `apps/web/src/features/tags/match.ts` (+ test)
- [ ] `TagControl` (Popover, Input combobox, Badge, Button rows, Field, Alert, ScrollArea, Separator, Skeleton) with every SCR-20 state and the always-on guidance line; stays open after each change — `apps/web/src/features/tags/TagControl.tsx` (+ test)
- [ ] SCR-02 header: the contact's tags row + **Add tag** (`source: inbox`), the name and avatar link to SCR-19, loading / error / live states; the composer keeps its draft — `apps/web/src/features/inbox/Thread.tsx` (+ test)
- [ ] SCR-19 header: **Add tag** (`source: profile`) — `apps/web/src/features/contacts/ContactProfile.tsx`

## Edge cases

| Case | Behaviour |
|---|---|
| typed «vip», « VIP » or «VIP  » while «VIP» exists | only «VIP» offered, no create row (AC-06, AC-08) |
| **Create tag** with an empty or 33-grapheme name | «A tag name must be 1 to 32 characters», nothing sent (AC-07) |
| 20 tags carried | suggestions and create disabled, remove still works (AC-08) |
| `404 TAG_NOT_FOUND` | «This tag no longer exists.», current tags shown (AC-14) |
| `429` | countdown to `retry_at`, add / remove disabled until then (AC-15) |

## Definition of Done

- [ ] Testing Library and unit tests cover every SCR-20 state in screens.md (suggestion order, exact match without create, the create row, name rules in place, pending, recorded / unchanged, both limits, tag gone, rate limit with its countdown, error, empty, loading, live, keyboard and focus return) and the SCR-02 header's tags row, profile link, loading, error and live states, with the guidance line always visible.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
