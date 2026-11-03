---
id: T38
title: "Show the blocked mark on Contacts (SCR-18) and the profile (SCR-19), re-read live on contact.changed reach"
layer: "ui"
deps: ["T4"]
blocks: ["T39", "T40"]
acs: ["AC-14"]
files_hint: ["apps/web/src/features/contacts/ContactsTable.tsx", "apps/web/src/features/contacts/ContactsTable.test.tsx", "apps/web/src/features/contacts/ContactProfile.tsx", "apps/web/src/features/contacts/ContactProfile.test.tsx", "apps/web/src/features/contacts/store.ts", "apps/web/src/features/contacts/store.test.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T38 — Show the blocked mark on Contacts (SCR-18) and the profile (SCR-19), re-read live on contact.changed reach

## Place in the sequence

- **Blocked by:** T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet · **Blocks:** T39 — Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate "did not reach", the broadcast item in the thread, the blocked marker, and the operator's missing launch, T40 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the broadcasts module, its routes, tables, queues and signals, the new edges, contact_bot_reach and broadcast_items, and the new components · **Wave:** 3 — after T4.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** to see on a contact that they have blocked the bot, and have such contacts left out of broadcasts
> **So that** the team does not count on reaching customers the bot cannot reach
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It makes the bot's blocked mark visible on the Contacts list and the profile, live, so the team sees who cannot be reached outside broadcasts too.

## Inlined context

> | blocked marker | a row with `blocked_since` set — a `Badge` (`outline`, destructive text) «Blocked the bot» after the name, `title` «Blocked the bot since 20 Oct 2026» |
> | no bot | every `blocked_since` null — no markers |
> | live: reach | `contact.changed { change: reach }` for a contact on the current page — the page re-reads in place (contract assumption 7); everything else on SCR-18 stays not live |
> | phone (< md) | the marker wraps under the name with the @username |
>
> — `screens.md §SCR-18, added states (Source-ref column dropped), abridged` · full text: [screens.md](../screens.md)

> | blocked | `blocked_since` set — under the facts line a muted line with a `Badge` «Blocked the bot» and «since 20 Oct 2026» |
> | not blocked | `blocked_since` null — no line |
> | live: reach | `contact.changed { change: reach }` for this contact — `getContact` re-read; the line appears or goes |
> | new entry | picking a recipient on SCR-28 opens this profile; back returns to the report (ux-flows) |
>
> — `screens.md §SCR-19, added states (Source-ref column dropped), abridged` · full text: [screens.md](../screens.md)

> - **Panel reaction** (flow 16): the Contacts list (SCR-18) re-reads its current page when the contact is on it (this one change is live, unlike tags, because the marker is the list's only live field — see assumption 7 of the api-sync-report); an open profile (SCR-19) of `contact_id` re-reads `getContact`; an open draft editor does not refetch (counts are not live). The mark is per Telegram bot, and reads answer for the current bot, so a mark of an old bot changes nothing visible.
>
> — `contracts/events.md §Frame: contact.changed, panel reaction, verbatim` · full text: [events.md](../contracts/events.md)

> - **Thread and Contacts:** … The Contacts list and the profile show a "blocked the bot" marker from the contacts reads and refetch on `contact.changed` with `change: 'reach'`.
>
> — `sad.md §4, UI architecture, Thread and Contacts, abridged` · full text: [sad.md](../sad.md)

> | ContactsTable (extended) | Existing component; gains the «Blocked the bot» row marker and the re-read on `contact.changed reach` — canon row updated | pending |
> | ContactProfile (extended) | Existing component; gains the «Blocked the bot since …» line and its live re-read — canon row updated | pending |
>
> — `screens.md §New components, ContactsTable + ContactProfile, verbatim` · full text: [screens.md](../screens.md)

**Reuse:** `ContactsTable` and `ContactProfile` (extended, no new component), the `contacts` store's `contact.changed` handling (today `change: tags`), `Badge` from `apps/web/src/shared/ui`, `formatBotDay` from `features/bot/settings/format.ts` for «20 Oct 2026». T4 adds `blocked_since` to the shared `ContactRow` / `ContactProfile` schemas and `reach` to the frame. Contact names stay plain text.

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- `GET …/contacts` → `ContactPage` rows `ContactRow` gain `blocked_since: date-time | null` (for the current Telegram bot; null when not blocked, no reach row, or no bot).
- `GET …/contacts/{contactId}` → `ContactProfile` gains `blocked_since` (the profile's «blocked the bot since …» line).
- Live: `contact.changed { workspace_id, contact_id, change: tags | reach }`.

— `contracts/openapi.yaml, operationId listContacts + getContact, schemas ContactRow / ContactProfile, abridged`; `contracts/events.md §Frame: contact.changed, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] `ContactsTable`: the «Blocked the bot» `Badge` (`outline`, destructive text) after the name with the `title` «Blocked the bot since <day>», wrapping under the name below `md` — `apps/web/src/features/contacts/ContactsTable.tsx`
- [x] `ContactProfile`: the muted line under the facts with the badge and «since <day>», absent when null — `apps/web/src/features/contacts/ContactProfile.tsx`
- [x] `contacts` store: on `contact.changed { change: reach }` re-read the list's current page only when that contact is on it, and `getContact` when that profile is open; `tags` handling unchanged; nothing else becomes live — `apps/web/src/features/contacts/store.ts`
- [x] Tests: marker / no marker / no bot, phone wrap, profile line present / absent, the reach re-reads and the non-re-read for a contact off the page — `ContactsTable.test.tsx`, `ContactProfile.test.tsx`, `apps/web/src/features/contacts/store.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| contact blocked only for an earlier bot | `blocked_since` is null; no marker (AC-10) |
| `reach` frame for a contact not on the current page | no re-read (screens.md SCR-18 live: reach) |
| `tags` frame | unchanged contacts behaviour (still not live on the list) |
| unblock or a new message clears the mark | the frame re-reads; the badge and the profile line go (AC-14) |
| workspace without a bot | no markers anywhere (AC-10) |
| frame of another workspace | dropped (inherited) |

## Definition of Done

- [x] Testing Library and store tests cover the SCR-18 and SCR-19 states screens.md adds: the Blocked the bot badge with its since title on a row, the profile line, no marker when blocked_since is null, the list re-reading its current page only when the changed contact is on it, the profile re-reading on its own contact, and nothing else on SCR-18 becoming live.
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T38): the row marker («Blocked the bot», `Badge` outline with destructive text, `title` «Blocked the bot since <day>») sits after the name in a `flex-wrap` line, so it wraps under the name on a phone; the profile shows a muted `blocked-line` under the facts. The day uses `formatFullDay` (contacts/format, «20 Oct 2026») rather than `formatBotDay`, which has no year.
- `implement` (T38): `contact.changed { change: 'reach' }` re-reads the list only when the contact is among the shown rows, reading every page shown so far in the background (so Show-more rows stay), and re-reads `getContact` for that open profile only (no tag-history re-read); `tags` handling is unchanged, and the list still ignores `tags` / `tags.changed`. The store test's `row` helper gained an override argument (test scaffold only).
- `implement` (T38): gate — full `pnpm test` failed only `e2e/contacts-load` (merge timing, known set; T38 is web-only). It failed again in a solo re-run right after the suite (load average ≈ 14) and passed on the next solo run. `pnpm lint` clean.
