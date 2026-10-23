---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0010 — Signal Telegram link changes on an account-scoped frame delivered only to that member's sockets

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

The connect dialog must turn into "Connected" by itself when the member presses Start in Telegram, with no reload (AC-04). Settings — Notifications must also show "Not reachable", and a removal by deactivation or by a new bot, as they happen (AC-10). These changes happen in a webhook request or a job, not in the member's own request. Signals today are workspace-scoped, except `conversation.changed` with `change: read`, which the hub delivers only to the same account. A link is personal (§6.1: its Telegram account is shown only to the member).

## Decision drivers

- AC-04 "without reloading", spec §6 in-web latency target "≤ 3 s"
- Spec §6.1: link details are the member's own; teammates see at most on/off (owners, in Team)
- Shared-inbox ADR-0002 / 0003: ids-only frames published inside the writing transaction, refetch through reads

## Considered options

1. **A new signal `telegram_link.changed { workspace_id, account_id }`**, published in every transaction that creates, removes or changes the reachability of a link. The hub delivers it only to that account's sockets, as for `read`. SCR-16 / SCR-17 refetch "my notification state".
2. **Reuse a workspace-wide frame** (for example a generic `member.changed`) delivered to every socket of the workspace. No hub change. But it tells every teammate's tab that a given member linked or unlinked, which is more than the Team on/off view grants (owners only). It also makes every tab refetch.
3. **Poll** "my notification state" every few seconds while the connect dialog is open. No signal. But it covers only the dialog, not "Not reachable" or removals while SCR-16 is open, and it adds request load.

## Decision outcome

**Chosen:** Option 1. It follows the decided signal pattern and reuses the hub's existing account filter. It discloses nothing to teammates, and it covers every link change wherever it happens, including webhooks and jobs on another instance, through `LISTEN/NOTIFY`.

## Consequences

**Positive**
- "Connected" appears within the live-update target, with no polling.
- One more union member in the shared `LiveFrame` schema, ids only, far under 1000 bytes.

**Negative**
- Old bundles that do not know the type must drop the frame without breaking the socket (assignment-statuses §11 precedent; checked at `tasks`).

**Neutral**
- The owner's Team view refetches on navigation, not live. Making it live later would be another account-filter rule.

## Links

- Spec: [[../spec.md]] AC-04, AC-06, AC-10, AC-12, §6.1
- SAD: [[../sad.md]] §4 supporting choices, §6 flow 2, §8 Events
- Related ADR: shared-inbox ADR-0002, ADR-0003, [[0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload]]
