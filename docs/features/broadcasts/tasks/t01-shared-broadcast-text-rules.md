---
id: T1
title: "Add the shared broadcast text and name rules: trim both ends, 1–4096 UTF-16 code units for the text, 1–80 graphemes for the name, and the \"Copy of …\" cut"
layer: "domain"
deps: []
blocks: ["T4", "T5", "T6"]
acs: ["AC-02", "AC-17"]
files_hint: ["packages/shared/src/broadcast-text.ts", "packages/shared/src/broadcast-text.test.ts", "packages/shared/src/index.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
step: ""
---

# T1 — Add the shared broadcast text and name rules: trim both ends, 1–4096 UTF-16 code units for the text, 1–80 graphemes for the name, and the "Copy of …" cut

## Place in the sequence

- **Blocked by:** — · **Blocks:** T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet, T5 — Add the broadcasts domain for drafts and launches: the status machine, the version rule, who may delete, launch and stop, the tag audience shape with the dropped-tag notice, the 10 000 limit and the audience fingerprint, T6 — Add the broadcasts domain for sending and copies: recipient states and failure reasons, the bots answer → outcome map with its abort kinds, the fixable set, the pace constants and the round-robin turn picker, and the duplicate audience choices · **Wave:** 1 — no upstream task, starts at once.
- **Lane:** shares `packages/shared/src/index.ts` with T4 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As an** End customer
> **I want** to get the business's broadcast once, in my chat with its bot, as the text the business wrote
> **So that** I read one message, not duplicates, and see nothing about other customers or the team
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

It gives the editor and the API one function pair that decides what text and name a draft may hold, so the count the member sees is the count Telegram applies and the customer gets exactly the trimmed text.

## Inlined context

> 12. **The text is trimmed and counted in UTF-16 code units by one shared rule.** `packages/shared/src/broadcast-text.ts` holds the tidy (trim both ends) and the measure (1–4096 UTF-16 code units, Telegram's count), and the name rule (1–80 characters as a person sees them, measured like tag names). The web editor and the API use the same functions (AC-02, AC-17): [ADR-0012](../adr/0012-count-broadcast-text-in-utf-16-code-units-after-trimming-with-one-shared-rule.md).
>
> — `sad.md §4, choice 12, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. It counts what Telegram counts, and it is the cheapest measure (no segmenter). Any residual mismatch is caught by the sender: a `400` about the text aborts the broadcast with "Telegram refused the text" (ADR-0009), which the owner can fix and relaunch through a duplicate.
>
> - One function pair for the editor counter, the request schema and the launch check.
> - The counter can surprise a person (an emoji takes 2), so the editor shows the remaining length rather than "characters typed".
>
> — `adr/0012 §Decision outcome + §Consequences, ADR-0012, abridged` · full text: [ADR-0012](../adr/0012-count-broadcast-text-in-utf-16-code-units-after-trimming-with-one-shared-rule.md)

> - **Text.** Spaces and line breaks at both ends of the text are removed before it is saved, and the length is measured on what is left. That trimmed text is what the customer gets (AC-02, AC-17).
> - **Duplicates.** "Copy of …" is shortened to fit the 80-character name.
>
> — `spec.md §1, Clarifications "Text" and "Duplicates", abridged` · full text: [spec.md](../spec.md)

> | Text and names | one shared rule in `packages/shared/src/broadcast-text.ts`: text trimmed at both ends, 1–4096 UTF-16 code units; name 1–80 characters as a person sees them. Sent with no `parse_mode` (plain text, AC-17), link previews at Telegram's default. Shown as plain text everywhere | ADR-0012 |
>
> — `sad.md §8, Text and names, verbatim` · full text: [sad.md](../sad.md)

> `broadcasts.name` — internal, never sent. Tidied like a tag name and 1–80 graphemes (an emoji is one) by the shared rule (`packages/shared/src/broadcast-text.ts`, ADR-0012); JSON Schema counts code points, so no `maxLength` is stated.
>
> — `contracts/openapi.yaml, schema BroadcastName, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

> | Telegram's length count is assumed to be UTF-16 code units (ADR-0012); a mismatch would let the editor accept a text Telegram refuses | Medium | verify against the real Bot API during `implement` (4096 emoji-heavy text); a refused text aborts the broadcast cleanly (ADR-0009) and the owner fixes it through a duplicate | Backend |
>
> — `sad.md §11, risk row 3, verbatim` · full text: [sad.md](../sad.md)

**Precedent:** the name tidy reuses the contacts tag-name rule (`packages/shared/src/tag-name.ts`: NFC, zero-width removed, white-space runs collapsed, ends trimmed, graphemes via `Intl.Segmenter`); import it rather than re-implementing it.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes. (The rule is mirrored as bounds only by `broadcasts_name_check` / `broadcasts_text_check` in T3: `name <> ''`, `text = btrim(text)`, `char_length(text) <= 4096`.)

## API contract

> - `BroadcastText`: trimmed, 1–4096 UTF-16 code units; `RawBroadcastText` (request, `maxLength` 20000) and `RawBroadcastName` (request, `maxLength` 1000) are tidied by the server.
> - Errors decided by this rule (raised in T16 / T19): `400 BROADCAST_NAME_INVALID`, `400 BROADCAST_TEXT_INVALID`.
>
> — `contracts/openapi.yaml, schemas BroadcastText / RawBroadcastText / RawBroadcastName, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-02 — error

> **Given** an operator editing a draft broadcast of "Acme Flowers"
> **When** they leave the name empty or make it longer than 80 characters, leave the text empty or only spaces, or make it longer than Telegram allows for one message
> **Then** the draft keeps its last valid content, nothing is sent, and the editor says next to the field that a name must be 1 to 80 characters, or that the text must be 1 to 4096 characters as Telegram counts them; the remaining length is shown while typing, counted the way Telegram counts it, so an emoji-heavy text is never accepted by the editor and then refused by Telegram for its length
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** an end customer who wrote to the bot of "Acme Flowers" and is a recipient of "Spring prices"
> **When** the broadcast is sent
> **Then** they receive exactly one message from the business bot in their private chat with it, with the text exactly as the owner confirmed it (spaces and line breaks at its ends were removed when it was saved), shown as plain text (nothing in it is turned into formatting); the message names no member and shows nothing about other recipients, the audience or the workspace's tags
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Red: tests for `tidyBroadcastText` (spaces, `\n`, `\t` at both ends removed; inner line breaks kept), `broadcastTextLength` (UTF-16 `.length` of the tidied text), `checkBroadcastText` (ok / empty / too long with the excess) — `packages/shared/src/broadcast-text.test.ts`
- [ ] Red: tests for `tidyBroadcastName` / `checkBroadcastName` (1–80 graphemes, emoji = 1) and `copyName(source)` → "Copy of …" cut to 80 graphemes at a grapheme boundary — same file
- [ ] Green: implement the functions and constants (`BROADCAST_TEXT_MAX = 4096`, `BROADCAST_NAME_MAX = 80`), reusing the tag-name tidy and grapheme count — `packages/shared/src/broadcast-text.ts`
- [ ] Export from the package index — `packages/shared/src/index.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| text of only spaces and line breaks | tidies to `""` → invalid "1 to 4096 characters" (AC-02) |
| 2 048 emoji (4 096 UTF-16 units) | valid; one more emoji → invalid, 2 over |
| text with inner blank lines | inner line breaks kept; only the ends are trimmed (AC-17) |
| name of 81 graphemes, or empty after tidy | invalid "1 to 80 characters" (AC-02) |
| "Copy of " + an 80-grapheme name | cut to 80 graphemes, never inside a grapheme (AC-13) |

## Definition of Done

- [ ] Unit tests prove the text is trimmed at both ends (spaces and line breaks) before it is measured, that 4096 UTF-16 code units pass and 4097 fail (an emoji counts 2, a 2 048-emoji text passes), that an empty or whitespace-only text fails, that a name of 1–80 graphemes passes and 0 or 81 fail (an emoji counts 1), and that "Copy of …" is cut to 80 graphemes without splitting a grapheme.
- [ ] The web editor's counter and the API's checks import these same functions (no second implementation is added anywhere).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
