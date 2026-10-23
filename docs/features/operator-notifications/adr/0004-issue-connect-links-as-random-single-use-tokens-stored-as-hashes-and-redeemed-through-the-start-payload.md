---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0004 — Issue connect links as random single-use tokens stored as hashes and redeemed through the start payload

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

A member connects their personal Telegram to the workspace's bot from the panel (AC-04). The spec's sharpest abuse case is a connect link that leaks or is replayed and binds a stranger's Telegram account to an operator (spec §1, §6.1). The link must be:
- single-use;
- valid for 10 minutes;
- bound to one membership;
- replaced by a newer one;
- refused for a since-deactivated member;
- limited to 5 per 10 minutes.

Linking must never silently replace an existing link (AC-06). Telegram's deep link `t.me/<bot>?start=<payload>` delivers `/start <payload>` to the bot. The payload is at most 64 characters from `A–Z a–z 0–9 _ -`.

## Decision drivers

- Spec §6 "Connect link — single use, expires in 10 min, ≤ 5 requests per 10 min per member"; §6.1 abuse case "connect-link leak or replay"
- AC-05 (expired, used, replaced, deactivated) and AC-06 (one link per member, one member per Telegram account, per workspace)
- Precedent: invitations and password-reset links store only a token hash (workspace-operators)
- No new tenancy exception: the redeem knows the workspace from the webhook's bot

## Considered options

1. **Random 32-byte token, base64url, payload `tgi_<token>`; only the SHA-256 hash stored, with membership, expiry, used and replaced marks.** Redeem runs in one transaction:
   - read the row by `(workspace_id, token_hash)` to learn its membership;
   - share-lock the membership first, the same order as deactivation, so the two cannot deadlock;
   - lock the row and check it is unused, unexpired and not replaced;
   - check the two uniqueness rules, backed by partial unique indexes on live links;
   - insert the link, mark the connect link used, publish the signal and enqueue the bot's answer.

   Every outcome uses the link up.
2. **A stateless signed token** (HMAC of membership + expiry under an app key). No table. But it cannot be single-use or "replaced by a newer one" without storing state anyway, and a leaked token stays valid until expiry.
3. **A short code the member types into the bot** (for example 6 digits). Friendlier on a phone without a camera. But it can be guessed within 10 minutes without per-chat attempt limits, it needs a typed-message flow instead of a Start button, and a typed code would itself be a message to intercept.

## Decision outcome

**Chosen:** Option 1. 256 bits of randomness cannot be guessed, the stored hash is useless if the database leaks, and the row gives single use, replacement and the 5-per-10-minutes count (under the `connect-links:<ws>:<account>` advisory lock, the reply-limit precedent). The 47-character payload fits Telegram's limit. The link records the bot's **Telegram bot id**, so a token rotation keeps it and a different bot removes it (ADR-0003). A deactivated member's unused connect links are marked replaced in the deactivation transaction, and the membership check at redeem is the second line.

## Consequences

**Positive**
- Every AC-05 / AC-06 outcome is one branch of one transaction, answered in the chat by an enqueued bot message.
- The bot confirms every new link in the linked chat, so a member notices a link they did not make (§6.1).

**Negative**
- The token is visible in the panel, the QR code and the browser history for 10 minutes. This is mitigated by single use and the confirmation message.
- A business campaign payload beginning with `tgi_` is reserved (§11).

**Neutral**
- Switching to a typed code later adds a second redeem entry point. The table shape stays the same.

## Links

- Spec: [[../spec.md]] AC-04, AC-05, AC-06, AC-12, AC-13, §6.1
- SAD: [[../sad.md]] §4 choice 4, §6 flow 2, §8 Secrets, Concurrency
- Related ADR: [[0003-intercept-connect-link-starts-and-linked-members-messages-in-bots-before-capture-through-a-port]], [[0010-signal-telegram-link-changes-on-an-account-scoped-frame-delivered-only-to-that-members-sockets]]
