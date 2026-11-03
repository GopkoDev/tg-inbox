---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0003 — Classify group and channel updates in bots and hand only codes, membership, upgrades and renames to posts

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

Today `bots` drops every non-private update in a pure classifier (`not_private`). Posts need four facts from group and channel chats: a connect code, the bot's own membership and rights (`my_chat_member`), a group's upgrade to a supergroup (`migrate_to_chat_id`) and a chat's rename. An admin bot in a busy group receives every message there, through the same webhook that captures customers.

## Decision drivers

- Spec AC-17, §6: nothing written in a destination is captured; private capture p95 unchanged (± 1 s) while a group receives 10 messages per second.
- bot-connection AC-12 stays true.
- Only `bots` parses Telegram updates; secrets checked before the body is parsed.

## Considered options

1. **Classify in `bots`, hand typed facts to `posts`** — the pure classifier gains `destination_code`, `chat_membership`, `chat_migrated`, `chat_renamed` for group / supergroup / channel chats and `ignored` for everything else; `accept` forwards the four to a `ChatEventsPort` filled by `posts`; ignored updates cost one bot lookup and no write.
2. **Pass raw non-private updates to `posts`** and let it parse them.
3. **Fetch state on demand** (`getChatMember` before each post) instead of reading membership updates.

## Decision outcome

**Chosen:** Option 1. It keeps Telegram parsing in `bots`, keeps group noise out of every other path, and gives `posts` a narrow, testable contract. Option 2 spreads Telegram knowledge into a second module. Option 3 adds a Telegram call per post and cannot mark a destination unavailable live (spec Clarifications: "available or not, live").

## Consequences

**Positive**
- Group traffic is dropped before any write; capture is untouched.
- `posts` never sees message content, only chat ids, kind, title, username and the bot's status.

**Negative**
- The classifier's non-private branch grows; tests must cover each chat type and update kind.

**Neutral**
- A membership update for a chat that is not a destination of the workspace is ignored by `posts` (no candidate list is kept).

## Links

- Spec: [[../spec.md]] AC-13, AC-14, AC-17, §6
- SAD: [[../sad.md]] §3, §4, §5
- Related ADR: [[0002-connect-a-destination-by-a-hashed-single-use-code-received-as-a-bot-command-or-channel-post]]
