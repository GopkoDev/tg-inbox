---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0003 — Intercept connect-link starts and linked members' messages in bots before capture through a port

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

`bots/app/accept-update.ts` classifies every webhook update and hands every private message or edit from a human sender to `conversations.captureInbound` / `applyEdit`. A `/start <payload>` is captured like any text today. This feature needs two things. A connect-link start must create a Telegram link and never a contact (AC-04, AC-05). Nothing a linked member sends to that bot may be captured: text, media, edits or starts through any link (AC-11). The links live in `notifications` (ADR-0001), and `bots` must not query its tables. Each workspace can also replace its bot: a different bot removes every link made with the old one (AC-10).

## Decision drivers

- Spec §6: "0 contacts or conversations created from connect-link starts or linked members' messages"
- AC-11: the check covers every kind of inbound update from a linked account, and anyone without a link is captured as before (bot-connection AC-07)
- One-way dependencies: `notifications → bots` already exists for sending, so `bots` cannot import `notifications`
- The webhook must stay fast. Capture runs inside the webhook request (bot-connection ADR-0003)

## Considered options

1. **A port declared by `bots`, filled by `notifications` in `buildDeps()`.** `accept-update` calls `inboundInterceptor.intercept({ workspaceId, telegramBotId, from, kind, text })` before capture. The answer is `consumed` (a connect-link start, or a sender with a live link made with this bot) or `pass`. A second port, `onBotConnected(tx, { workspaceId, telegramBotId })`, is called in the paste-token connect transaction and removes links bound to another bot id.
2. **Check inside `conversations.captureInbound`.** Capture already has the transaction. But `conversations` would need to know about Telegram links, either through a reverse dependency on `notifications` (a cycle) or by owning the links itself, which mixes the team's notification channel into the customer record.
3. **Let `bots` own the Telegram links table** and filter locally, with `notifications` asking `bots` for links. Interception becomes a local query. But the link lifecycle (connect links, deactivation, reachability, pings) then splits across two modules, and `bots` grows member-level state.

## Decision outcome

**Chosen:** Option 1. The check happens before anything is written, in the module that already decides what is captured. It costs one indexed lookup per private update, scoped by the workspace id the authenticated webhook's bot gives. It needs no new tenancy exception and no reverse import. The link stays wholly owned by `notifications`. The bot-connected hook makes "a different bot removes the links" atomic with the connect. Link reads also filter by the current bot's Telegram id, as a second line.

## Consequences

**Positive**
- Capture code in `conversations` is untouched. A consumed update never reaches it, so no unread, waiting marker or reopen can be caused by a member.
- One place answers "is this a customer?" for every update kind.

**Negative**
- Every private update pays one extra query (indexed on `(workspace_id, telegram_user_id)` of live links).
- A business campaign payload starting with the reserved prefix `tgi_` would be consumed (§11, Low).
- `bots` unit tests need an interceptor fake. Its default is `pass`.

**Neutral**
- Messages a person sent before linking stay in their conversation, and after unlinking they are captured again. This is the spec's behaviour, and nothing migrates.

## Links

- Spec: [[../spec.md]] AC-04, AC-05, AC-10, AC-11, §6 "Captured link messages"
- SAD: [[../sad.md]] §4 choice 3, §5, §6 flow 2
- Related ADR: [[0001-add-a-notifications-module-that-owns-telegram-links-presence-and-pings-and-is-reached-through-ports]], [[0004-issue-connect-links-as-random-single-use-tokens-stored-as-hashes-and-redeemed-through-the-start-payload]], bot-connection ADR-0003
