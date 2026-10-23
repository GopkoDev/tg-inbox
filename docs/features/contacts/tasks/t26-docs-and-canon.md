---
id: T26
title: "Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the contacts routes and tables, the contacts → workspaces edge, the new signals and the new components"
layer: "docs"
deps: ["T16", "T19", "T21", "T22", "T24"]
blocks: []
acs: ["AC-11", "AC-12"]
files_hint: ["CLAUDE.md", "docs/architecture-map.md", "docs/design-system.md", "CONTEXT.md"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T26 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the contacts routes and tables, the contacts → workspaces edge, the new signals and the new components

## Place in the sequence

- **Blocked by:** T16 — Register the contacts routes (registerContacts): the eight operations with their zod schemas, the ownerOnly guard on rename and delete, and the wiring in buildDeps and buildApp, T19 — Build SCR-18, the Contacts list: ContactsTable and TagFilter with the address state, Show more, the counts, the missing-tag notice and the empty and error states, replacing ContactsPreview, T21 — Build ContactConversationHistory, the profile's read-only thread: inbox-order items, older pages, media, live items, no read marking and no composer, with ReplyDeliveryState readOnly, T22 — Build SCR-20, the TagControl, and mount it on the profile and on the inbox conversation header (SCR-02) with the contact's tags and the name linking to the profile, T24 — Build SCR-22, the RenameTagDialog with its merge step: name rules in place, TAG_NAME_TAKEN turned into the merge offer, TAG_MERGE_TARGET_CHANGED re-ask · **Blocks:** — · **Wave:** 8 — after T16, T19, T21, T22, T24.
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to rename, merge and delete the workspace's tags
> **So that** one kind of customer has one tag and the list stays usable
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It keeps the short rules, the map, the canon and the glossary true for whoever builds broadcasts on top of tags next.

## Inlined context

> | `CLAUDE.md` and the architecture map do not yet mention the contacts routes, the new tables, the `contacts → workspaces` edge or the new signal types. | Low | Update both in this feature's tasks. | Tech Lead |
>
> — `sad.md §11, Risks, docs row, verbatim` · full text: [sad.md](../sad.md)

> | ContactsTable | … | pending |
> | TagFilter | … | pending |
> | ContactProfile | … | pending |
> | ContactConversationHistory | … | pending |
> | TagHistoryList | … | pending |
> | TagControl | … | pending |
> | TagsSettings | … | pending |
> | RenameTagDialog | … | pending |
> | DeleteTagDialog | … | pending |
> | ContactCrumb | … | pending |
> | Thread (extended) · ReplyDeliveryState (extended) · SettingsLayout (extended) | … | pending |
> | SampleDataBadge (retired from contacts) | … | pending |
>
> — `screens.md §New components, abridged` · full text: [screens.md](../screens.md)

> Terms marked † are not yet in [CONTEXT.md](../../../CONTEXT.md) and are candidates for `/sdd:glossary`.
> | Tag history † | The per-contact, append-only record of every tag added, removed, merged or removed by a delete, with the member, the time, the source and the tag's name at that moment. |
> | Name key † | A tag's tidied name case-folded; the value that is unique per workspace. |
> | Tidied name † | A tag name with zero-width characters removed, white-space runs collapsed to one space and ends trimmed; what is stored and shown. |
> | First wrote / last wrote † | The Telegram send times of a contact's oldest and newest customer messages; replies and edits never count. |
>
> — `sad.md §12, Glossary note, verbatim` · full text: [sad.md](../sad.md)

> | SampleDataBadge | `apps/web/src/shared/ui/sample-data-badge.tsx:3` | default | NEW: «Sample data» label on screens backed by the swappable sample source (contacts, contact profile). The inbox no longer uses it: it runs on real data. No primitive fits: a fixed-copy Badge. |
>
> — `docs/design-system.md §Inventory, SampleDataBadge, verbatim` · full text: [design-system.md](../../../design-system.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (documents the three new tables and the two new `contacts` columns).

## API contract

Internal — no API surface (documents `registerContacts`'s routes and the `contact.changed` / `tags.changed` frames).

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

## Checklist

- [ ] `CLAUDE.md` Layout: `contacts` gains `http` routes (list, profile, tag history, tags, owner rename / delete); dependencies `bots → conversations → contacts`, `bots → contacts`, `contacts → workspaces`; tenancy exceptions unchanged — `CLAUDE.md`
- [ ] Architecture map: module rows, tables `tags` / `contact_tags` / `contact_tag_history`, the new edge, the two signals, the §7 integrity queries, `reflects_commit` — `docs/architecture-map.md`
- [ ] Design-system canon: register the ten new components and the three extended ones (row per component, `pending` → registered), retire `SampleDataBadge` — `docs/design-system.md`
- [ ] `CONTEXT.md` Glossary: Tag history, Name key, Tidied name, First wrote / last wrote (the † terms of sad §12) and Tag-list order (used everywhere, not yet defined), each with its NOT-reference — `CONTEXT.md`

## Edge cases

| Case | Behaviour |
|---|---|
| a term already in CONTEXT.md (Contact, Tag, Tag filter, Change signal) | left as is; only the missing terms are added |
| SampleDataBadge still used elsewhere | none after T20 — its row is removed |

## Definition of Done

- [ ] CLAUDE.md and the architecture map name the contacts routes, the three tag tables, the contacts → workspaces edge and the contact.changed / tags.changed signals with the tenancy exceptions unchanged, the design-system canon registers every new and extended component from screens.md and retires SampleDataBadge, and CONTEXT.md defines tag history, name key, tidied name, first / last wrote and tag-list order.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
