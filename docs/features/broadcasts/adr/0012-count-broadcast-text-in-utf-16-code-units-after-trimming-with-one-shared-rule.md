---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-23"
feature_size: "L"
ticket: "roadmap step 8 — broadcasts"
---

# 0012 — Count broadcast text in UTF-16 code units after trimming, with one shared rule

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** Architect (autonomous pipeline run, 2026-10-23), to be confirmed by the Tech Lead at review

## Context

The text is 1 to 4096 characters as Telegram counts them, so the editor never accepts a text Telegram refuses for its length, and the remaining length is shown while typing (AC-02). Spaces and line breaks at both ends are removed before saving, and the length is measured on what is left; the trimmed text is what the customer gets (AC-17, clarify). The name is internal, 1–80 characters (AC-02). Telegram measures message length in UTF-16 code units (the unit of its entity offsets): most emoji count as 2. The tag-name rule (`packages/shared/src/tag-name.ts`) already sets the precedent of one shared rule for web and API.

## Decision drivers

- AC-02, AC-17
- Web and API must agree exactly (the editor's counter and the server's refusal)
- An emoji-heavy text must never pass the editor and then fail at Telegram

## Considered options

1. **UTF-16 code units after trimming, in `packages/shared/src/broadcast-text.ts`.** `tidyBroadcastText` removes white space at both ends; `broadcastTextLength` is the JavaScript string length of the tidied text; valid = 1…4096. The name uses the tag rule's grapheme count, 1…80, since it is never sent. Both are used by the zod schemas and the editor.
2. **Unicode code points.** Matches the Bot API documentation's wording ("characters") and what many people call characters, but undercounts emoji outside the Basic Multilingual Plane relative to Telegram, so a text could pass the editor and be refused.

## Decision outcome

**Chosen:** Option 1. It counts what Telegram counts, and it is the cheapest measure (no segmenter). Any residual mismatch is caught by the sender: a `400` about the text aborts the broadcast with "Telegram refused the text" (ADR-0009), which the owner can fix and relaunch through a duplicate.

## Consequences

**Positive**
- One function pair for the editor counter, the request schema and the launch check.

**Negative**
- The counter can surprise a person (an emoji takes 2), so the editor shows the remaining length rather than "characters typed".

**Neutral**
- If Telegram's counting differs in a corner case, only the shared function changes.

## Links

- Spec: [[../spec.md]] AC-02, AC-17, §1 clarifications ("Text")
- SAD: [[../sad.md]] §4 choice 12, §8
- Related ADR: [[0009-end-stop-or-abort-a-broadcast-by-settling-every-waiting-recipient-in-one-transaction]], contacts ADR-0002
