---
id: T4
title: "Add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time"
layer: "domain"
deps: []
blocks: ["T10", "T11", "T15", "T16"]
acs: ["AC-05", "AC-07", "AC-08", "AC-09", "AC-11", "AC-13"]
files_hint: ["apps/api/src/modules/notifications/domain/ping-text.ts", "apps/api/src/modules/notifications/domain/ping-text.test.ts", "apps/api/src/modules/notifications/domain/answers.ts", "apps/api/src/modules/notifications/domain/answers.test.ts", "apps/api/src/modules/notifications/domain/connect-link.ts", "apps/api/src/modules/notifications/domain/connect-link.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T4 — Add the ping text builder (TG-03), the bot answer texts (TG-02) and the connect-link rules: token and start payload, usable, 5 per 10 minutes and its retry time

## Place in the sequence

- **Blocked by:** — · **Blocks:** T10 — Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting, T11 — Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer, T15 — Add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id, T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction · **Wave:** 1 — no upstream task.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
> **So that** no customer waits because I closed my laptop
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It fixes, by type, everything a ping or an answer may say, and the pure rules a connect link obeys.

## Inlined context

> - **Ping text, inline.** `notifications/domain/ping-text.ts` builds the text from the workspace name, the count split into the member's own, unassigned and a teammate's, the longest wait in whole minutes and the link: one conversation, the `mine` lens, the `unassigned` lens or the open lens (AC-07, AC-08, AC-09). Its input type has no field for message text, contact names or teammate names, so the NFR "0 pings containing customer message text or a contact name" holds by construction, and a unit test asserts it.
>
> — `sad.md §4, Ping text, inline, verbatim` · full text: [sad.md](../sad.md)

> | one, mine | «Acme Flowers: 1 customer is waiting for your reply (5 min)» | `/w/<ws>/inbox/<conversationId>` | AC-07; events.md |
> | one, unassigned | «Acme Flowers: an unassigned customer is waiting for a reply (5 min)» | `/w/<ws>/inbox/<conversationId>` | AC-07; events.md |
> | one, a teammate's | «Acme Flowers: a teammate's customer is waiting for a reply (31 min)» | `/w/<ws>/inbox/<conversationId>` | AC-09; events.md |
> | several, all mine | «Acme Flowers: 4 customers are waiting for your reply, the longest 12 min» | `/w/<ws>/inbox?assignee=mine` | AC-08; events.md |
> | several, all unassigned | «Acme Flowers: 4 unassigned customers are waiting, the longest 12 min» | `/w/<ws>/inbox?assignee=unassigned` | AC-08; events.md |
> | several, all teammates' | «Acme Flowers: 3 of your teammates' customers are waiting for a reply, the longest 34 min» | `/w/<ws>/inbox` | AC-09; assumption |
> | mixed | «Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 1 h 5 min» — only the non-zero parts are listed, in that order | `/w/<ws>/inbox` | AC-08; events.md |
>
> — `screens.md §TG-03, text table, abridged` · full text: [screens.md](../screens.md)

> 9. **Telegram texts are plain text** (no Markdown / HTML parse mode), so a workspace name can never inject formatting, and links are bare URLs on their own line with the link preview off. Waits are whole minutes below an hour («12 min») and hours plus minutes from 60 («1 h 5 min», «2 h»).
>
> — `screens.md §Source, Decision 9, verbatim` · full text: [screens.md](../screens.md)

> | `connected` | a valid Start linked the account (AC-04) | «You're connected to Acme Flowers. I'll message you here when customers are waiting for a reply.<br>To stop, disconnect Telegram in the panel:<br>`<panel>/w/<ws>/settings/notifications`» | events.md; seeded flow 2 |
> | `already_connected` | Start from the account the member is already linked with; the link is used up (AC-06) | «You're already connected to Acme Flowers with this Telegram account.» | events.md |
> | `cannot_connect` / `telegram_linked_to_teammate` | this Telegram account is linked to another member of the workspace (AC-06) | «This Telegram account can't be connected: it already receives notifications for another member of Acme Flowers.» | events.md |
> | `cannot_connect` / `member_linked_elsewhere` | the member is linked from another Telegram account (AC-06) | «This Telegram account can't be connected: you're already connected from another Telegram account — disconnect it in the panel first.<br>`<panel>/w/<ws>/settings/notifications`» | events.md |
> | `link_expired` | no such link, older than 10 min, used, replaced, or the membership is not active (AC-05) | «This connect link has expired. Get a new one in the panel, in Settings → Notifications.» (no link and no workspace detail: the sender may not be a member) | events.md; flow 15 |
> | `notifications_off` | Disconnect on SCR-16 (AC-04) | «Notifications from Acme Flowers are off. You can connect again in the panel at any time.» | events.md; flow 9 |
> | `chat_only_notifications` | anything a linked member writes, at most once per hour per link (AC-11) | «This chat only sends notifications from Acme Flowers. Replies to customers are written in the panel:<br>`<panel>/w/<ws>/inbox`» | events.md; flow 11 |
>
> — `screens.md §TG-02, answer kinds, abridged` · full text: [screens.md](../screens.md)

> **Issue.** "Connect Telegram" creates 32 random bytes and shows `https://t.me/<bot username>?start=tgi_<base64url token>` (47 characters of payload, within Telegram's 64). The server stores the hash, the membership, the creation time and the expiry (+10 min).
> **Limit.** At most 5 links per 10 minutes per member, counted from the stored rows under `connect-links:<ws>:<account>` (AC-13).
>
> — `sad.md §4, choice 4, Issue + Limit, abridged` · full text: [sad.md](../sad.md)

> **Usable** = `used_at IS NULL AND replaced_at IS NULL AND expires_at > now`. It is re-checked under `FOR UPDATE`, after the membership share lock (SAD §8 lock order).
>
> — `data-model.md §Entities, connect_links, Usable, verbatim` · full text: [data-model.md](../data-model.md)

> | Ping content | 0 pings containing customer message text or a contact name | unit test on the ping text builder; review of the template |
>
> — `spec.md §6, Ping content, verbatim` · full text: [spec.md](../spec.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Internal — no API surface. The `retry_at` this task computes is the `ConnectLinkLimitReachedError.details.retry_at` of `createConnectLink` (oldest counted link + 10 min).

## Acceptance criteria

### AC-05 — error

> **Given** a member who opens a connect link
> **When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
> **Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — happy path

> **Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
> **When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
> **Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping at that point. If they become away later while the customer is still waiting and the message is still unread for them, the ping goes out as soon as they are counted away. The 5 minutes always run from the start of the wait. For a waiting period that began when a conversation reopened (AC-08), the clock starts at the reopen. Having read the earlier messages does not hold such a ping back, because the customer's message was read and the team's reply did not reach them.
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — domain invariant

> **Given** a conversation of "Acme Flowers" for which a linked away member has been pinged
> **When** the customer writes more messages in the same waiting period, or other conversations become due for the same member within 10 minutes
> **Then** that member is pinged at most once per conversation per waiting period. Pings to one member from one workspace are at most one per 10 minutes. Conversations that become due in between are combined into the next ping, sent at the member's next allowed moment. A ping counts only the conversations not yet pinged to this member in their current waiting period, and the longest wait among them. If all of them are the member's own, it reads "Acme Flowers: 4 customers are waiting for your reply, the longest 12 min" and links to the inbox's "mine" lens. If all are unassigned, it says so and links to the "unassigned" lens. A mixed set reads "Acme Flowers: 4 customers are waiting for a reply (2 yours, 1 unassigned, 1 a teammate's), the longest 12 min" and links to the inbox's open conversations. A waiting period ends when a reply is marked sent or the conversation is closed. The next customer message after that starts a new one. A conversation that is reopened while its customer is still waiting for a reply also starts a new one at the moment it reopens, for example after a reply ends "not delivered" (assignment-statuses AC-08). A member who reads the waiting message before their ping is sent is not pinged for that period. A reassignment does not restart the clock. A new assignee who is away, linked and has not read the message becomes due at once if the customer has already waited 5 minutes. Unassigning a waiting conversation makes it due at once for the away members as an unassigned one. Each member still gets at most one ping per conversation per waiting period.
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — cross-context

> **Given** an open conversation of "Acme Flowers" assigned to an operator, whose customer has been waiting for a reply
> **When** 30 minutes pass since the wait began and it has not ended, or 5 minutes pass while the assignee is away and cannot be pinged
> **Then** every other linked member of "Acme Flowers" who is away and has not read the waiting message gets the ping for it, as for an unassigned conversation (AC-07, AC-08), saying that a teammate's customer is waiting (without the teammate's name). The assignee stays the assignee, since a ping never changes the assignee or the status. "Cannot be pinged" means exactly one of two things: the assignee has no Telegram link, or their link is "Not reachable" (AC-10). That state is either already known from an earlier failed ping or found by the failed attempt at this moment. An assignee who is present on the web, or who has read the waiting message, can be reached. For them the team is pinged only at 30 minutes.
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — cross-context

> **Given** an operator of "Acme Flowers" whose Telegram account is linked to the "Acme Flowers" bot
> **When** they write anything in that chat, for example "ok" in answer to a ping
> **Then** the message is not captured, whatever it is: text, media, an edit or a start of the bot through any link, including a business's own campaign link. It creates no contact or conversation, does not reopen anything and counts toward no unread count or waiting marker. The bot answers that this chat only sends notifications and that replies to customers are written in the panel, with a link. It sends that answer at most once per hour. Messages the same person sent to the bot before they linked stay in their conversation as they were. Once they disconnect, their messages are captured as an end customer's again. For anyone without a Telegram link to that bot, starting the bot with a business's own campaign link is captured as before (bot-connection AC-07).
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a member of "Acme Flowers" who has requested 5 connect links within the last 10 minutes
> **When** they request another one
> **Then** no new link is made. The panel says that connect links are limited to 5 per 10 minutes and when they can try again. A newer link always replaces the previous unused one (AC-05). When the bot of "Acme Flowers" is not connected, not working or taken over, the panel offers no connect link. It explains that Telegram pings need a working bot that receives messages. A taken-over bot would never receive the Start. An operator is told to ask a business owner; a business owner gets the way to the bot settings.
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `pingText({ workspaceName, mine, unassigned, teammate, longestWaitMinutes, panelUrl, workspaceId, conversationId? })` → `{ text, url }`; the input type has **no** field for message text, contact or teammate names — `apps/api/src/modules/notifications/domain/ping-text.ts`
- [ ] `formatWait(minutes)` → «12 min», «1 h 5 min», «2 h» (Decision 9) — same file
- [ ] `answerText(kind, { workspaceName, panelUrl, workspaceId, reason? })` for the seven TG-02 rows, plain text, bare URLs on their own line — `apps/api/src/modules/notifications/domain/answers.ts`
- [ ] Connect-link rules: `newConnectToken(random)` (32 bytes → 43-char base64url), `startPayload(token)` = `tgi_<token>`, `parseStartPayload(text)` for `/start tgi_<43>`, `hashToken`, `isUsable(link, now)`, `limitDecision(createdAts, now)` → allowed | `{ retryAt }` — `apps/api/src/modules/notifications/domain/connect-link.ts`
- [ ] Unit tests over every set shape and every answer kind, asserting no contact or message string can appear — `ping-text.test.ts`, `answers.test.ts`, `connect-link.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Mixed set with no unassigned part | «(2 yours, 1 a teammate's)» — only non-zero parts, in order |
| Exactly 60 minutes | «1 h» |
| `/start tgi_` + 42 chars, or a campaign payload `promo` | not a connect-link start (`parseStartPayload` → null) |
| 6th link inside 10 min | refused with `retryAt` = oldest counted `created_at` + 10 min |
| Link used, replaced or past `expires_at` | `isUsable` false |

## Definition of Done

- [ ] Unit tests pass for every TG-03 set shape (one mine / unassigned / teammate's, all mine, all unassigned, all teammates', mixed) with its lens link and wait format, every TG-02 answer kind, the start-payload parser, the usable rule and the 5-per-10-minutes decision with its retry time, and the ping builder's input type has no text or name field.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
