---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
---

# Spec — bot-connection

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** None — only the interview + CONTEXT, plus `docs/idea-brief.md`, `docs/roadmap.md` (step 3), `docs/architecture-map.md` and the precedent `docs/features/workspace-operators/spec.md`.

## 1. Context

A pilot business now has a workspace and a signed-in team (roadmap step 2), but nothing its customers write in Telegram reaches tg-inbox. Every business brings its own Telegram bot (its brand, its contact base — idea brief §3), so the first thing a business owner must be able to do is attach that bot to the workspace; and from that moment every message an end customer sends must land in the workspace as a conversation with a contact, or the shared inbox (step 4) and the contact base (step 7) have nothing to show.

Why now: this is step 3 of the roadmap and the only path into the data every later step uses — the inbox shows captured conversations, contacts are created on inbound, group posts go out through the connected bot. The near-term goal is 5–10 hand-onboarded pilots using v1 daily (idea brief §4); onboarding friction ("each business is willing to create its own bot in BotFather and hand over the token", idea brief §6) is a named risk, so connecting must take one paste and give unmistakable feedback.

Committed approach: a business owner pastes the token of the business's bot into the web panel; the system checks it with Telegram, shows which bot it is, and starts capturing. Every private message an end customer sends to that bot — text or any other kind — is captured, exactly once and in order, into one continuous conversation per end customer, and the first message creates a contact from the person's Telegram profile, refreshed on later messages. The owner sees whether the bot is healthy, can rotate its token and can disconnect it without losing what was captured. Replying, the inbox screens and contact editing are later steps. Why this shape: comparable shared inboxes stop at "paste a token, messages appear" and leave the owner-facing lifecycle undocumented — health, token rotation, refusing a bot another workspace uses, one continuous conversation per customer rather than one chat per issue — so a trustworthy, self-serve connection is where tg-inbox can be better; and the sharpest failure found for this idea is a silently broken connection (another service takes over the bot's messages, or the token is revoked) while the panel still says "connected", which is why the connection state is a first-class part of this step. Success is the pilot owner connecting alone, in minutes, with no customer message lost or doubled.

Traceability: the architecture map fixes the workspace as the tenancy boundary and treats bot tokens as tenant secrets that are never shown back; the roadmap fixes "each business connects its own BotFather bot" and "the bot is for end customers only" (§ Decisions so far).

## 2. Goals

- A business owner connects the business bot alone, in minutes, and knows at a glance whether it is working.
- Every message an end customer sends to a connected bot is available to the workspace — none lost, none doubled — so the team can rely on tg-inbox instead of the bot's own chat.
- The workspace's contact base grows by itself from every person who writes, ready for the inbox, contacts and broadcasts steps.

## 3. Non-goals

- Replying to end customers and the inbox screens — roadmap step 4; this step only captures.
- Viewing the content of photos, voice notes, files and other media — this step records a non-text message's kind and caption and keeps what is needed to show its content later; how media is shown is decided with the inbox (step 4).
- Messages in groups or channels the bot belongs to — v1 support is one-to-one private chats; group and channel work arrives with group posts (step 10).
- Tracking which end customers blocked or unblocked the bot — needed for broadcasts, so it arrives with step 8.
- Several bots per workspace, or creating the bot for the business — one BotFather bot per business is enough for pilots, and the business keeps ownership of its bot.
- Editing contacts, tagging them or merging duplicates — roadmap step 7.

## 4. User stories

### US-01: Connect the business bot

**As a** Business owner
**I want** to connect the business bot to my workspace by pasting its token
**So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team

### US-02: Reach the business through its bot

**As an** End customer
**I want** what I write to the business's bot to reach the business's team
**So that** I get an answer without leaving Telegram or knowing who is on shift

### US-03: Grow the contact base automatically

**As a** Business owner
**I want** every person who writes to the bot to become a contact from their Telegram profile
**So that** our contact base grows without anyone typing it in

### US-04: Keep each customer's messages in one conversation

**As an** Operator
**I want** every message from one customer kept in a single conversation, in the order it was sent and up to date with the customer's edits
**So that** I see the whole history when I answer

### US-05: Check the bot's health

**As a** Business owner
**I want** to see which bot is connected, whether it is working and when the last message arrived
**So that** I notice a broken connection before customers do

### US-06: Rotate the token or disconnect the bot

**As a** Business owner
**I want** to give the connected bot a new token or disconnect it
**So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
**When** the owner pastes the token (surrounding spaces are ignored) and confirms
**Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again

### AC-02 (US-01) — error

**Given** a business owner of "Acme Flowers" connecting a bot or giving the connected bot a new token
**When** the pasted text is not a bot token, or Telegram does not accept it (mistyped, revoked, or the bot was deleted)
**Then** the system changes nothing — an existing connection keeps working as before — and tells the owner the token is not valid — copy it again from BotFather

### AC-03 (US-01) — authorization

**Given** an operator of "Acme Flowers" who is not a business owner
**When** they try to connect, rotate or disconnect the bot, or open the bot settings
**Then** the system refuses and tells them that only business owners manage the bot; a person with no active membership in "Acme Flowers" gets no hint that the workspace or its bot exists

### AC-04 (US-01) — domain invariant

**Given** a business owner of "Bolt Bikes" and the token of a bot that is connected to another workspace, or through which another workspace has captured conversations
**When** the owner pastes that token
**Then** the system refuses and explains that the bot already belongs to another workspace, without revealing which one

### AC-05 (US-01) — domain invariant

**Given** "Acme Flowers" has a connected bot, or has captured conversations through a bot it later disconnected
**When** a business owner pastes the token of a different bot
**Then** the system refuses and explains that a workspace keeps one business bot — while connected, disconnect it first; once customers have written to it, the workspace stays with that bot (its customers know only that bot)

### AC-06 (US-01) — cross-context

**Given** a business owner of "Acme Flowers" pasting a valid token of a bot that currently delivers its messages to some other service
**When** the system checks the token
**Then** before connecting, it warns the owner that connecting will stop that bot delivering messages to the other service, and connects only after the owner confirms

### AC-07 (US-02) — happy path

**Given** "Acme Flowers" has a connected bot and an end customer who has never written to it
**When** the end customer starts the bot or sends it a first message in a private chat
**Then** within the capture-latency target of §6 (2 seconds at p95) "Acme Flowers" holds a new contact built from the customer's Telegram profile (name, username, language) and a new conversation with that contact containing the message, and the bot settings show the time of that message as the last message received

### AC-08 (US-03) — happy path

**Given** an end customer who already has a contact and a conversation in "Acme Flowers" and has since changed their Telegram name or username
**When** they send the bot another message
**Then** the message is added to their existing conversation, no second contact is created, and the contact now holds the new name and username

### AC-09 (US-04) — happy path

**Given** a connected bot and an end customer with a conversation in "Acme Flowers"
**When** the customer sends a photo with a caption, a voice note, a sticker, a file or a location
**Then** each one appears in their conversation in the order sent (each item of an album as its own message), marked with its kind and carrying its caption when it has one, so the workspace holds a record that something arrived; viewing its content arrives with the inbox step

### AC-10 (US-04) — happy path

**Given** a captured message in an end customer's conversation — text, or a non-text message with a caption
**When** the customer edits its text or caption in Telegram
**Then** the conversation holds the edited text in place of the old one, marked as edited, and no new message is added; an edit of a message that was never captured adds nothing

### AC-11 (US-04) — domain invariant

**Given** a message from an end customer that has already been captured
**When** Telegram delivers the same message again (for example after a delivery retry)
**Then** the conversation still holds it exactly once, and messages keep the order in which the customer sent them

### AC-12 (US-02) — domain invariant

**Given** a connected bot of "Acme Flowers"
**When** someone writes in a group or channel the bot belongs to, another bot writes to it, or the bot receives messages on behalf of someone's personal Telegram Business account
**Then** the system captures nothing from it and creates no contact or conversation — only private chats between people and the bot are captured

### AC-13 (US-03) — cross-context

**Given** "Acme Flowers" and "Bolt Bikes" each have a connected bot, and one person writes to both bots
**When** both messages are captured
**Then** each workspace has its own contact and conversation for that person, holding only the messages sent to its own bot, and neither workspace can see that the other one knows the person

### AC-14 (US-02) — authorization

**Given** a connected bot of "Acme Flowers"
**When** someone who is not Telegram sends the system a message pretending to come from that bot
**Then** the system ignores it — nothing is captured and no contact or conversation is created

### AC-15 (US-05) — happy path

**Given** a business owner of "Acme Flowers" with a connected bot that has captured messages from 12 end customers
**When** they open the bot settings
**Then** they see the bot's name and username, its state "connected", the time the last message was received and the number of contacts captured — but never the token

### AC-16 (US-05) — error

**Given** a connected bot whose token was revoked in BotFather, or which was deleted there
**When** a business owner of "Acme Flowers" opens the bot settings
**Then** the system shows the state "not working — needs a new token", explains that messages are not arriving until the owner pastes a new token of the same bot, and keeps every contact and conversation already captured

### AC-16b (US-05) — cross-context

**Given** a connected bot of "Acme Flowers" whose messages another service has since taken over
**When** a business owner opens the bot settings and then chooses to reconnect the bot
**Then** the settings show the state "not receiving messages — another service took them over"; on reconnecting, the system gives the warning of AC-06, and after the owner confirms the bot is connected again and new messages are captured into their existing conversations

### AC-17 (US-06) — happy path

**Given** a business owner of "Acme Flowers" whose bot is connected (or not working because its old token was revoked)
**When** they paste a new token of the same bot
**Then** the bot is connected with the new token, the old token is no longer used, and new messages from existing end customers continue their existing conversations

### AC-18 (US-06) — happy path

**Given** a business owner of "Acme Flowers" with a connected bot
**When** they disconnect it and confirm
**Then** the bot settings show "not connected", messages sent to the bot afterwards are not captured, and every contact and conversation captured so far stays in the workspace

### AC-19 (US-06) — cross-context

**Given** "Acme Flowers" disconnected its bot earlier and its contacts and conversations remain
**When** a business owner connects the same bot again and an existing end customer writes to it
**Then** the message continues that customer's existing conversation and no duplicate contact is created

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Capture latency p95 | ≤ 2 s from Telegram delivering a message until it is in its conversation | server ingest-duration logs, weekly p95 |
| Inbound acknowledgement p95 | ≤ 300 ms to acknowledge a delivery to Telegram | server request-duration logs, weekly p95 |
| Latency p95 connect / rotate / disconnect | ≤ 3 s (includes the round-trips to Telegram) | server request-duration logs, weekly p95 |
| Bot settings load p95 | ≤ 300 ms | server request-duration logs, weekly p95 |
| Throughput | ≥ 50 inbound messages/s per instance across all bots | load test before the first pilot |
| Capture completeness | 0 messages lost and 0 duplicated among messages Telegram delivered; messages sent during an outage shorter than Telegram's redelivery window (24 h) are captured after recovery | integration test (redelivery + duplicate) + monthly spot-check against the bot chat of one pilot |
| Availability | 99.5% monthly | uptime check on the health endpoint, monthly window |
| Cross-workspace isolation | 0 reads or writes of contacts, conversations or bots across workspaces | an isolation test for every data-access path, run in CI |
| Token secrecy | 0 occurrences of a bot token in logs, error messages or anything the web panel receives | automated test over logs and responses + security review |

## 6.1 Security / privacy

- **Data classification:** confidential — bot tokens give full control of a business's bot, and captured messages are private customer correspondence.
- **Personal data touched:** end customer Telegram user id (identifier, confidential), first and last name, username, language (low–confidential), message text and captions (confidential, may contain anything the customer writes); bot token (secret — never shown back, never logged).
- **AuthZ/AuthN impact:** adds a business-owner-only capability to connect, rotate and disconnect the workspace's bot and to view its settings; operators have no access to bot settings. Inbound deliveries are accepted only when they prove they come from Telegram for that specific connected bot. Every contact, conversation and message belongs to exactly one workspace and is read and written only within it.
- **Abuse cases:**
  - Cross-tenant bot hijack (pasting a token of a bot connected elsewhere): refused without naming the other workspace (AC-04).
  - Forged inbound deliveries (someone posting fake customer messages into a workspace): ignored unless they prove they come from Telegram for that bot (AC-14).
  - Token leak (from logs, the panel or an error message): the token is never shown back or logged; a leaked token is rotated in BotFather and pasted again (AC-17).
  - Former owner keeps the token: they can still control the bot in Telegram outside tg-inbox — out of our reach; the remaining owner rotates the token in BotFather and pastes the new one (AC-17).
  - Bot hijack (a former employee or agency with a copy of the token connects the bot to their own workspace first): the real owner is refused by AC-04 and cannot see where the bot is; recovery path, including what happens to the conversations captured in the other workspace, is an open question (§8).
  - Inbound flood (a customer or script spamming the bot): every message is still captured once, and a flood on one workspace's bot must not push other workspaces' capture past the §6 latency target; rate limiting of a single sender is deferred until a pilot shows the need.
- **Security review:** Required — a new tenant secret (bot tokens), a new unauthenticated inbound entry point and new personal data of end customers.

## 7. Metrics / KPIs

- **Pilot workspaces with a connected bot capturing messages** (≥1 message captured in the last 7 days) — baseline: 0, target: ≥5 workspaces within 30 days of onboarding the first pilot.
- **Time from the first business owner's first sign-in to the bot being connected** — baseline: none, target: median ≤ 1 day across pilots.
- **First-attempt connection success** (owners whose first pasted token connects ÷ owners who tried) — baseline: none, target: ≥ 80%.
- **Connection effort** — time from an owner first opening the bot settings to the bot being connected, and the share of connections done without help from the tg-inbox team — baseline: none, target: median ≤ 10 min and ≥ 80% without help.
- **Missing or duplicated messages reported by pilots** — baseline: 0, target: 0 per month.

## 8. Open questions

- [ ] Should a workspace ever be allowed to move to a different bot once customers have written to the old one (e.g. a rebrand)? Default now: no — AC-05; the old conversations would become unreachable for replies. — owner: Dmytro Hopko, due: before `sdd:design bot-connection`
- [ ] Messages Telegram still holds when a bot is connected or reconnected (sent up to 24 h earlier, while nothing was capturing them): capture them or drop them? Default now: capture them in order. — owner: Dmytro Hopko, due: during `sdd:clarify bot-connection`
- [ ] Should the owner be alerted proactively when the bot stops working (revoked token, deleted bot), instead of seeing it only on opening the bot settings (AC-16)? Default now: only in the bot settings; proactive alerts with operator notifications. — owner: Dmytro Hopko, due: before roadmap step 6 (notifications) is specified
- [ ] How does a business recover its bot when someone else connected it to their workspace first (AC-04)? Default now: the owner revokes the token in BotFather (the other workspace's connection stops working) and asks the tg-inbox team; a platform admin disconnects the bot from the workspace that holds it and, on a verified request, removes the contacts and conversations captured there. — owner: Dmytro Hopko, due: before `sdd:design bot-connection`
- [ ] Should operators see whether the bot is connected and working (read-only), e.g. to explain an empty inbox? Default now: no — bot settings are business-owner only (AC-03). — owner: Dmytro Hopko, due: before roadmap step 4 (inbox) is specified
