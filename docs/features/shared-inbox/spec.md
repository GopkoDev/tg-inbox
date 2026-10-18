---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
---

# Spec — shared-inbox

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** None beyond the project docs — `docs/roadmap.md` (step 4), `docs/idea-brief.md`, `docs/architecture-map.md`, `docs/design-system.md`, and the precedents `docs/features/bot-connection/spec.md` (capture, bot states, media references) and `docs/features/ui-redesign/spec.md` (AC-12…AC-14, the inbox preview this feature fills with real data).

## 1. Context

Since bot-connection (roadmap step 3) every private message an end customer sends to a workspace's business bot is captured into one continuous conversation per customer, but nobody can see it: the inbox in the web panel is still a preview on sample data (ui-redesign), and there is no way to answer. For the operators and business owners of the 5–10 pilot businesses — teams of 3+ people doing support in Telegram (idea brief §3) — tg-inbox is not yet usable at all; this step is the first one that replaces their forwarder bot.

Why now: step 4 is the step every later one builds on — assignment and statuses (5) live on inbox conversations, notifications (6) point into the inbox, AI drafts (9) appear in its reply box — and the canon already fixed its screen (two-pane list + thread), so this step fills a finished shape with real data. The pilots' near-term success is daily use (idea brief §4), and "slow replies from a web-only workspace" is a named risk (idea brief §6), so the inbox has to be live and trustworthy from day one.

Committed approach: the inbox preview becomes the real, shared inbox. Every member of the workspace (operators and business owners alike) sees the workspace's conversations, newest activity first, with what each of them has not yet read and which conversations are waiting for a reply; can search them by the contact's name or username; opens a conversation to read its whole history — including the customer's photos, voice notes, files and other media, opened through the panel — and writes text replies that the business bot sends to the customer in Telegram. Everything a teammate or a customer does appears live, without reloading; every reply carries a visible delivery state with a plain-language reason when it fails; and the inbox never sends a reply twice and never sends one silently into a broken bot. Why this shape: the products that already put Telegram bots into a shared inbox are broad suites that treat Telegram as one more channel and document none of the basics a team relies on — per-member read state, who wrote each reply, what happens when a reply does not arrive (only one of them shows "the customer blocked the bot") — so making those basics explicit is where a Telegram-only inbox can be better; and the sharpest failure found for this idea is leaking the bot's credentials or the conversation stream to someone who should not see them (a media link that carries the bot's secret, a live stream that outlives a deactivated operator), which is why media opens only through the panel and the live stream stops within seconds of access ending (AC-09). Success is a pilot team answering every customer from tg-inbox for a working day with no reply lost, doubled or sent by the wrong workspace.

Traceability: the canon's two-pane inbox and the preview's behaviours (list with unread counts, a thread with a reply box, addresses that survive reload, Enter sends / Shift+Enter starts a new line, 4096-character limit) carry over from ui-redesign AC-12…AC-14; the bot states (connected / not working / taken over / not connected) and the media references usable only while the same bot is connected come from bot-connection AC-09 and AC-15…AC-18. This spec closes bot-connection §8 "Should operators see whether the bot is connected and working?": yes — every member sees the bot's state in the inbox when it stops replies or incoming messages (AC-13, AC-14); the bot settings stay owner-only (bot-connection AC-03). The phone-width behaviour of the inbox (ui-redesign AC-12b) carries over unchanged (AC-03).

## 2. Goals

- A pilot team answers its Telegram customers entirely from the shared inbox, so the business can drop its forwarder bot.
- Every member sees the same conversations live and knows who answered what, so two people rarely answer one customer and no customer is left without a reply unnoticed.
- An operator always knows whether a reply reached Telegram, and if not, why — no reply is lost, doubled or silently sent into a broken bot.

## 3. Non-goals

- Assigning conversations to an operator and open/closed statuses — roadmap step 5; in this step every member can answer every conversation, and "waiting for a reply" is the only shared marker.
- Notifications outside the open inbox (sound, browser notifications, a Telegram ping) — roadmap step 6.
- Contact profiles, tags and the contact list with real data — roadmap step 7; the contacts screens stay previews.
- Editing or deleting a reply after it is sent — keeps the record of what the customer actually received simple and honest for pilots; revisited from pilot feedback (§8).
- Operators sending photos, files, voice notes or other media, and quoting ("replying to") a specific message — text replies cover first-line support; media out arrives when pilots ask for it.
- Searching inside message text — the list search finds a conversation by the contact's name or username; full-text search waits until histories are long enough to need it.
- Keeping tg-inbox's own copy of customer media — media opens through the panel while the bot can still reach it (§8 tracks whether to keep copies).
- "Someone is typing" indicators between teammates or from the customer — Telegram does not tell a bot that a customer is typing, and the teammate-collision warning (AC-16) covers the costly case.

## 4. User stories

### US-01: See the workspace's conversations

**As an** Operator
**I want** one list of all the workspace's conversations, newest activity first, showing what I have not read and what is waiting for a reply
**So that** I know at a glance which customers need an answer

### US-02: Read a conversation's history

**As an** Operator
**I want** to open a conversation and read everything the customer sent and everything the team replied, including the customer's photos, voice notes and files
**So that** I answer with the full context, without asking the customer to repeat themselves

### US-03: Reply to a customer

**As an** Operator
**I want** to write a text reply in a conversation and send it
**So that** the customer gets an answer from the business without me touching Telegram

### US-04: Get the answer in the bot

**As an** End customer
**I want** the business's answer to arrive in my chat with its bot
**So that** I keep talking to the business where I started, without knowing who is on shift

### US-05: Know whether a reply arrived

**As an** Operator
**I want** every reply I send to show whether it reached Telegram, and if not, why
**So that** no customer is left believing they were answered when they were not

### US-06: Work alongside teammates

**As an** Operator
**I want** new customer messages and my teammates' replies to appear live, and to be warned before I answer a customer a teammate has just answered
**So that** our team does not miss messages or give a customer two different answers

### US-07: Know when the bot cannot carry replies

**As a** Business owner
**I want** the inbox to tell the whole team when the bot is not working or not receiving messages, and to point me to the bot settings
**So that** nobody writes replies that cannot be delivered and I fix the connection quickly

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** an operator of "Acme Flowers" whose business bot has captured conversations with 30 end customers
**When** they open the inbox
**Then** the list shows those 30 conversations and nothing else — no sample data and no "Sample data" label — newest activity first (the latest customer message or reply), each with the contact's name, the last message (a non-text message shown by its kind and caption, for example "Photo · new bouquet?"), how long ago it happened, how many of its messages this operator has not read, and a "waiting for a reply" marker when the last word is the customer's; a business owner of "Acme Flowers" sees and does in the inbox everything an operator does

### AC-02 (US-01) — happy path

**Given** an operator in the inbox of "Acme Flowers"
**When** they type part of a contact's name or username into the search
**Then** the list shows only the conversations whose contact matches, ignoring letter case; when nothing matches it says so and offers to clear the search; when the workspace has no conversations at all the inbox explains that conversations appear when customers write to the bot — and a business owner whose workspace has no connected bot is offered the way to the bot settings

### AC-03 (US-02) — happy path

**Given** an operator of "Acme Flowers" and a conversation with 600 messages and replies
**When** they open it
**Then** the thread shows the latest part of the history with the contact's name in its header, the customer's messages and the team's replies in the order they happened, each reply marked with the name of the member who wrote it; scrolling up loads older history until the first message; opening the conversation marks every message that has arrived in tg-inbox so far as read for this operator only — teammates' unread counts do not change (unread is counted by arrival in tg-inbox, not by place in the history); the conversation can be reopened by reload, the browser's back button or a saved link, and a link to a conversation that does not exist shows the not-found card; on a phone-width screen the list fills the screen, picking a conversation replaces it with the thread, and a back control returns to the list

### AC-04 (US-02) — happy path

**Given** a conversation in "Acme Flowers", whose bot is connected, holding a photo, a sticker, a video, a voice note, an audio track, a file, a location, a shared contact and a poll from the customer
**When** an operator opens the conversation
**Then** the photo, sticker and video are shown in the thread, the voice note and audio can be played, the file can be downloaded under its name, the location is shown as a place on a map, the shared contact as its name and phone, the poll as its question and options, and any caption is shown with its message; a message tg-inbox did not recognise is shown as "unsupported message — tg-inbox cannot show this kind yet" (marked "other", as captured); every piece of media is opened through the web panel, and nothing the panel shows or links to reveals the bot's token

### AC-05 (US-02) — error

**Given** a captured photo, voice note or file in a conversation of "Acme Flowers"
**When** an operator tries to open it while the bot is not connected or not working, or the file is larger than Telegram lets a bot download (20 MB), or Telegram no longer has it
**Then** the thread shows the message's kind and caption with "content unavailable" and the reason in plain language (the bot is disconnected / the bot is not working — needs a new token / the file is too large to open in tg-inbox / Telegram no longer keeps this file), and the rest of the conversation stays readable

### AC-06 (US-03) — happy path

**Given** an operator of "Acme Flowers", whose bot is connected, in a conversation with an end customer who has not blocked the bot
**When** they type a reply and press Enter (Shift+Enter starts a new line)
**Then** the reply appears at once at the end of the thread marked "sending" with the operator's name, then "sent" once Telegram accepts it (within the reply-latency target of §6); the conversation moves to the top of the list for the whole team, its "waiting for a reply" marker disappears, and the reply box is empty and ready for the next reply; the preview's note that nothing is sent to customers is no longer shown

### AC-07 (US-03) — error

**Given** an operator in a conversation of "Acme Flowers"
**When** they try to send with an empty reply box, one holding only spaces or new lines, or one longer than 4096 characters
**Then** nothing is sent and sending stays unavailable; for an over-long reply the box says replies are limited to 4096 characters and keeps the text so it can be shortened

### AC-08 (US-03) — authorization

**Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated operator of "Acme Flowers", or someone not signed in
**When** they try to open the inbox of "Acme Flowers", one of its conversations or one of its customers' media, or to send a reply in it (for example through a saved link)
**Then** the system refuses and gives no hint that the workspace, the conversation or the customer exists; nothing is sent to any end customer; someone not signed in is asked to sign in first

### AC-09 (US-06) — authorization

**Given** an operator of "Acme Flowers" with the inbox open
**When** a business owner deactivates their membership, or the operator switches to another workspace
**Then** within 5 seconds the open inbox stops receiving new messages and replies of "Acme Flowers", the next action leads to the access-removed notice (deactivation) or shows only the other workspace's conversations (switch), and no conversation of "Acme Flowers" is shown inside another workspace, not even for a moment

### AC-10 (US-05) — error

**Given** an operator of "Acme Flowers" replying to an end customer who has blocked the bot (or deleted their Telegram account)
**When** they send the reply
**Then** the reply stays in the thread marked "not delivered — the customer blocked the bot" (or "the customer's Telegram account no longer exists"), the conversation keeps its "waiting for a reply" marker, and the operator understands the customer can be reached again only after they unblock the bot and write to it

### AC-11 (US-05) — domain invariant

**Given** an operator of "Acme Flowers" sending a reply
**When** they press send twice quickly, lose their connection right after sending, or tg-inbox cannot learn whether Telegram accepted the reply
**Then** the customer receives the reply at most once: a double press sends one reply; when the outcome is unknown the reply is marked "not confirmed — it may or may not have reached the customer" and is never resent automatically; the operator can send it again only after a warning that the customer may receive it twice — a reply is never delivered twice without a member choosing so

### AC-12 (US-05) — error

**Given** an operator of "Acme Flowers" sending a reply while Telegram is temporarily unavailable or asks the bot to slow down
**When** Telegram answers that it did not accept the reply (it is unavailable or asks the bot to slow down)
**Then** the reply stays "sending" and tg-inbox keeps trying on its own for up to 5 minutes, in the order the replies were written; if it is still not accepted, it is marked "not delivered — Telegram did not accept it, try again" with a "Try again" action that sends it once more; a send whose answer never came back is never retried on its own — it follows AC-11 ("not confirmed")

### AC-12b (US-05) — error

**Given** an operator of "Acme Flowers" who has sent 30 replies within the last minute
**When** they try to send another one
**Then** the reply is not sent, the text stays in the reply box, and the inbox says that replies are limited to 30 per minute per member and when sending is available again

### AC-13 (US-07) — cross-context

**Given** the bot of "Acme Flowers" is not connected, or is in the state "not working — needs a new token"
**When** an operator or business owner opens the inbox or a conversation
**Then** every conversation stays readable, the reply box is unavailable and explains that replies cannot be sent until the bot works again — a business owner gets the way to the bot settings, an operator is told to ask a business owner; a reply still "sending" when the bot stops working ends up "not delivered — the bot is not working"; once a business owner fixes the bot, replying works again without reloading

### AC-14 (US-07) — cross-context

**Given** the bot of "Acme Flowers" is in the state "not receiving messages — another service took them over"
**When** any member opens the inbox
**Then** the inbox shows every member a notice that customers' new messages are not arriving in tg-inbox until a business owner reconnects the bot (with the way to the bot settings for owners); replies can still be sent, and each one shows the same notice next to its delivery state

### AC-15 (US-06) — happy path

**Given** two operators of "Acme Flowers" with the inbox open, one of them inside a conversation
**When** the customer of that conversation sends a message or edits one, a new customer writes for the first time, or the other operator sends a reply
**Then** within the live-update target of §6 and without reloading, the list and the open thread show it: the new conversation appears at the top, the edited message shows its new text marked as edited, the teammate's reply shows with their name and delivery state; a message that arrives in an open thread counts as read for the operator looking at it, and a customer message that arrived late and took its earlier place in the history (a late redelivery) counts as unread, by its arrival, for every member who has not looked at the conversation since — it is never hidden behind messages already read

### AC-16 (US-06) — domain invariant

**Given** an operator of "Acme Flowers" writing a reply in a conversation
**When** a teammate's reply to the same customer appears in the thread after the operator started typing, and the operator sends
**Then** before anything is sent the inbox shows that the teammate replied and how long ago, and asks whether to send anyway or keep editing; the reply is sent only if the operator confirms — two members do not answer one customer by accident

### AC-17 (US-04) — happy path

**Given** an end customer who wrote to the bot of "Acme Flowers" and an operator who replied in their conversation
**When** the reply is sent
**Then** the customer receives the text as a message from the business's bot in their chat with it, with its line breaks, without any operator name or mark of tg-inbox; when the customer answers, the message continues the same conversation

### AC-18 (US-01) — cross-context

**Given** one person writes to the bots of both "Acme Flowers" and "Bolt Bikes", and an account is a member of both workspaces
**When** that account opens the inbox of each workspace in turn
**Then** each inbox shows only its own workspace's conversation with that person — only the messages sent to its own bot and the replies sent by its own team — and a reply sent from one workspace goes only through that workspace's bot, to that person's conversation with it; each inbox holds at most one conversation per end customer

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Live update p95 — customer message captured or teammate reply sent → shown in another member's open inbox | ≤ 3 s | server-side timing from capture/send to push, logged per event; a CI integration test asserts the push |
| Reply latency p95 — operator presses send → marked "sent" (Telegram healthy) | ≤ 2 s | request timing on the reply path, logged per reply |
| Inbox list p95 — first page, workspace with 1 000 conversations | ≤ 500 ms server time | request timing log; a seeded integration test of 1 000 conversations |
| Thread open p95 — latest page of a 5 000-message conversation | ≤ 500 ms server time | request timing log; seeded integration test |
| Media open p95 — a ≤ 5 MB file, bot connected | ≤ 3 s | request timing log on the media path |
| Duplicate replies | 0 replies delivered twice without a member's explicit "send again" | delivery log reconciliation: replies with more than one accepted send and no confirmed resend |
| Access revocation | live stream of a deactivated or switched-away member stops ≤ 5 s | integration test: deactivate → no further events for that member |
| Reply rate per member | ≤ 30 replies per minute per member (AC-12b) | integration test: the 31st reply within a minute is refused |
| Bot token exposure | 0 occurrences of a bot token in anything the web panel receives (pages, data, media addresses, redirects) or in logs | the bot-connection secrecy test extended to the inbox and media paths |
| Availability | 99.5 % monthly (as bot-connection §6) | uptime check on the health endpoint |

## 6.1 Security / privacy

- **Data classification:** confidential — private conversations between a business and its customers, including their media.
- **Personal data touched:** new — reply texts written by members (free text, may contain customer personal data), each tied to its author's account; per-member read state (which arrived messages each member has seen). Customer media now passes through tg-inbox on its way to the browser (not stored — §3); customer profile and message data are as captured by bot-connection.
- **AuthZ/AuthN impact:** every inbox capability (list, search, read, open media, reply, live updates) requires an active membership of the workspace, with either role; the live stream re-checks membership and stops on deactivation or workspace switch (AC-09); every read and write is scoped to the caller's workspace; a reply can go only to the conversation's own end customer through the workspace's own bot.
- **Abuse cases:**
  - Cross-tenant read via a guessed or saved conversation or media link: refused with no hint the conversation exists (AC-08) — hiding existence, so ids cannot be probed.
  - Bot token leak through media: media is served only through the panel, never as a Telegram address or redirect (AC-04, §6 token exposure).
  - Former operator keeps reading through an open tab: live stream stops within 5 s of deactivation (AC-09).
  - Markup or script injection through a customer's message, caption, file name or a reply: shown as plain text, never interpreted; a reply is sent to Telegram as plain text.
  - Spam replies from a compromised member account: replies are sent at most at the rate Telegram allows per chat and attributed to the author; a per-member limit of 30 replies per minute stops a runaway client (AC-12b).
- **Security review:** Required — new personal data (reply texts), a new outbound action on behalf of the business (sending through its bot) and media proxying near the bot token.

## 7. Metrics / KPIs

- **Pilot workspaces answering from tg-inbox** — baseline: 0 (no reply is possible today), target: every connected pilot workspace sends ≥ 1 reply on ≥ 5 working days a week within 30 days of release.
- **Median time to first reply** — baseline: TBD — measured from release (time from a conversation's first unanswered customer message to the first "sent" reply, per workspace, working hours); target: ≤ 15 minutes within 30 days of release.
- **Customer messages left without a reply** — baseline: TBD — measured from release (share of conversations still "waiting for a reply" 24 h after the customer's last message); target: ≤ 5 % within 30 days of release.
- **Replies not delivered through tg-inbox's fault** — baseline: 0 (new), target: 0 "not delivered" or "not confirmed" replies caused by tg-inbox (not by a blocked bot, a revoked token or a Telegram outage) within 30 days of release.

## 8. Open questions

- [ ] Should tg-inbox keep its own copy of customer media at capture, so photos and voice notes stay viewable after the bot is disconnected and beyond Telegram's download limit? Default now: no — media opens through the panel while the bot can reach it (AC-05). — owner: Dmytro Hopko, due: before `sdd:design shared-inbox`
- [ ] Should members be able to edit or delete a reply after it is sent (Telegram allows a bot to do so for a limited time)? Default now: no (§3). — owner: Dmytro Hopko, due: after 30 days of pilot use
- [ ] Should a member be able to mute or hide a conversation flooded by one sender, so it does not push real customers down the list? Default now: no — handled by hand for pilots; revisit with statuses. — owner: Dmytro Hopko, due: before roadmap step 5 (assignment & statuses) is specified
