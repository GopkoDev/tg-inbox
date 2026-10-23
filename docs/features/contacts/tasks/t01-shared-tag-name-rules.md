---
id: T1
title: "Add the shared tag-name rules: tidy, name key, 1–32 grapheme length and tag-list order"
layer: "domain"
deps: []
blocks: ["T3", "T4", "T5"]
acs: ["AC-07", "AC-08"]
files_hint: ["packages/shared/src/tag-name.ts", "packages/shared/src/tag-name.test.ts", "packages/shared/src/index.ts", "apps/api/src/modules/contacts/domain/tag-name.ts", "apps/api/src/modules/contacts/domain/tag-name.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T1 — Add the shared tag-name rules: tidy, name key, 1–32 grapheme length and tag-list order

## Place in the sequence

- **Blocked by:** — · **Blocks:** T3 — Promote migrations 04–06 (tags, contact_tags, contact_tag_history), regenerate DB types and add the tag fixtures, T4 — Add the contacts zod contracts, the eight tag error codes, and the contact.changed / tags.changed frames and signals with their hub mapping, T5 — Add the tags domain: the limits (100 per workspace, 20 per contact, 60 per 60 s, 50 per page), the history kinds and sources, the merge link rule and the rate-limit retry time · **Wave:** 1 — no upstream; starts at once.
- **Lane:** Shares `packages/shared/src/index.ts` with T4 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
> **So that** the team builds a grouped customer base as a side effect of support
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It gives the server, the picker and the rename dialog one function that decides what a tag name is and when two names are the same tag.

## Inlined context

> **Chosen:** Option 1. One function decides "same tag" everywhere (server, picker, rename), the unique index enforces it under races, and the id makes renames cheap and links stable.
>
> — `adr/0002-identify-tags-by-a-stable-id-and-keep-them-unique-by-a-normalised-name-key-computed-in-the-domain.md §Decision outcome, ADR-0002, verbatim` · full text: [ADR-0002](../adr/0002-identify-tags-by-a-stable-id-and-keep-them-unique-by-a-normalised-name-key-computed-in-the-domain.md)

> - `contacts/domain/tag-name.ts` (shared with the web through `packages/shared`) produces the **tidied name**: NFC, zero-width characters removed, every run of Unicode white space collapsed to one space, ends trimmed. Length is counted in grapheme clusters (`Intl.Segmenter`), 1–32.
> - The **name key** is the tidied name case-folded (`toUpperCase()` then `toLowerCase()`, so ß/SS and final sigma fold together). The table holds `name` (tidied, case as typed) and `name_key`, with a unique `(workspace_id, name_key)`.
>
> — `sad.md §4, strategic choice 2, tidied name, verbatim` · full text: [sad.md](../sad.md)

> - **A tag's name is stored in its tidied form.** Spaces at the ends are dropped. Every run of spaces inside, of any kind (non-breaking spaces and line breaks included), becomes one ordinary space. Invisible zero-width characters are removed. The tidied name is what is stored, shown and measured. Letter case stays as typed. Length counts characters as a person sees them, so an emoji is one character. Two names are the same tag when their tidied forms differ only in letter case, in any alphabet (AC-07, AC-08).
>
> — `spec.md §1, Clarifications, tidied form, verbatim` · full text: [spec.md](../spec.md)

> - **Tag-list order** is dictionary order ignoring letter case, each alphabet in its own order. It is used in Settings → Tags, in the picker groups and on a contact (list row, profile, conversation header).
>
> — `spec.md §1, Clarifications, tag-list order, verbatim` · full text: [spec.md](../spec.md)

> - **Tag-list order.** Dictionary order ignoring case, per alphabet: `ORDER BY name COLLATE "und-x-icu"` with `name_key` as tiebreak, the same order in the picker, on contacts and in Settings. The web sorts with `Intl.Collator(undefined, { sensitivity: 'base' })` for lists it holds.
>
> — `sad.md §4, Supporting choices, Tag-list order, verbatim` · full text: [sad.md](../sad.md)

> 4. **No DB check ties `name_key` to `name`.** The key is folded in the shared package (`toUpperCase().toLowerCase()`), and Postgres `lower` / `upper` fold some letters differently (ß). The DB only enforces that both are non-empty and that `name` has no surrounding space.
>
> — `data-model.md §Assumptions, 4, verbatim` · full text: [data-model.md](../data-model.md)

> Decision override: "vip", " VIP " and "VIP" followed by extra spaces are the same tag; "V  I P" tidies to "V I P", a different tag from "VIP" (inner white-space runs collapse, they are not removed). The chosen reading is pinned by a domain test.
>
> — `sad.md §1, Decision overrides, AC-08 reading, abridged` · full text: [sad.md](../sad.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. These functions back `400 TAG_NAME_INVALID` (`details { field: name, min_length: 1, max_length: 32 }`) on `addContactTag` and `renameTag`, which later tasks wire.

## Acceptance criteria

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

## Checklist

- [ ] `tidyTagName(raw)`: NFC, remove zero-width characters (U+200B–U+200D, U+2060, U+FEFF), collapse every run of Unicode white space (non-breaking spaces and line breaks included) to one space, trim — `packages/shared/src/tag-name.ts`
- [ ] `tagNameLength(tidied)` in grapheme clusters with `Intl.Segmenter`; `checkTagName(raw)` → `{ ok: true, name, key }` or `{ ok: false }` for 0 or > 32 graphemes; export `TAG_NAME_MAX = 32` — `packages/shared/src/tag-name.ts`
- [ ] `tagNameKey(tidied)` = `toUpperCase().toLowerCase()` (ß / SS and final sigma fold together) — `packages/shared/src/tag-name.ts`
- [ ] `compareTagListOrder(a, b)` with `Intl.Collator(undefined, { sensitivity: 'base' })`, the key as tiebreak, for lists the web holds — `packages/shared/src/tag-name.ts`
- [ ] Export from `packages/shared/src/index.ts`; re-export for the server domain from `apps/api/src/modules/contacts/domain/tag-name.ts`
- [ ] Unit tests (both packages) for every edge case below — `packages/shared/src/tag-name.test.ts`, `apps/api/src/modules/contacts/domain/tag-name.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `""`, `"   "`, only zero-width characters | `{ ok: false }` (AC-07) |
| `"vip"`, `" VIP "`, `"VIP  "` | same key as `"VIP"`; the tidied name keeps the letter case as typed (AC-08) |
| `"V  I P"` | tidies to `"V I P"`, a different key from `"VIP"` (sad §1 override) |
| `"New\u00A0York"`, `"New\nYork"` | tidy to `"New York"` |
| 32 emoji (each one grapheme) / 33 graphemes | valid / `{ ok: false }` |
| `"Straße"` vs `"STRASSE"`; Cyrillic `"Ёлка"` vs `"ёлка"` | same key |
| a decomposed `é` vs a precomposed `é` | same tidied name after NFC |

## Definition of Done

- [ ] Unit tests prove the tidy rule (NFC, zero-width removed, every white-space run collapsed to one space, ends trimmed), the 1–32 grapheme check with an emoji counted as one, the case-folded key ("vip", " VIP " and "VIP  " share the key of "VIP"; "V  I P" tidies to "V I P" with another key; ß / SS fold together) and the tag-list order comparator, in packages/shared and through the contacts domain re-export.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
