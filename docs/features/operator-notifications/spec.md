---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: "M"
---

# Spec — operator-notifications

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** `docs/roadmap.md` (step 6, open decision D1), `docs/idea-brief.md` §6 Risks and §7, `docs/architecture-map.md`, `docs/design-system.md`, and the shipped features this one builds on: `docs/features/shared-inbox/spec.md` (unread, "waiting for a reply", live updates, AC-09 access revocation), `docs/features/assignment-statuses/spec.md` (assignee, open/closed, reopen, deactivation unassign), `docs/features/bot-connection/spec.md` (capture of every private message incl. starting the bot, AC-07; bot states).

## 1. Context

Operators answer customers only from the web panel (idea-brief §5), and the panel shows a new customer message only to someone who is looking at it. Nobody is told anything when the inbox tab sits behind another window, when the laptop is closed or when the operator is working in another workspace. For the pilot teams of 3+ operators (idea-brief §3), that is the named risk "slow replies from a web-only workspace": the product assumes that operators notice new messages fast enough (idea-brief §6). The forwarder bots that pilots use today push every customer message straight into the operator's Telegram. If tg-inbox is slower to tell them, they will go back to the forwarder.

Why now: the inbox (step 4) and assignment & statuses (step 5) have shipped. Every conversation now has a "waiting for a reply" marker, a per-member unread count, an open/closed status and an assignee. That is exactly what a notification needs to decide who to tell and when. The pilots are about to rely on the inbox for whole working days.

**Committed approach.** There are two tiers, both opt-in per member and both small. **On the web**, the panel adds three things. An attention count of conversations that need this member appears in the tab title and next to Inbox in the navigation. When this member turns them on, a desktop notification appears for a new customer message in a conversation that is theirs or unassigned, while no tab of that workspace is on screen. When the member is **away from the web**, the workspace's **own business bot** sends a short **ping** to the member's personal Telegram. The member connects Telegram once, from the panel, through a single-use link (the **Telegram link**). A ping goes out only after a customer has waited 5 minutes for a reply. It goes to the conversation's assignee. For an unassigned conversation, or when the assignee cannot be pinged, it goes to every linked member who is away. When an assigned conversation is still waiting after 30 minutes, it also reaches the rest of the team. A member is pinged at most once per conversation per waiting period. It never contains any customer text. It says how many customers are waiting in which workspace and links to the panel.

Grounding: the products the research found escalate to their own email or mobile app after a short wait. They wait for the assignee first and stay silent once someone has opened the conversation (researcher, 2026-10-19: Crisp waits 3 minutes and emails the assigned operator; Front waits 20–30 seconds and suppresses the alert once a teammate has seen the message; Chatwoot has only an open request; BotHelp pings typed usernames on flow events). None of them pings through the business's own Telegram bot after an unanswered wait. None fans out to the team for unassigned conversations. None uses "no live panel on screen" as the away signal. That combination is where tg-inbox can be better.

The adversarial pass found several failures, and each shaped a rule here:
- **The sharpest one: a link code that leaks or is replayed** binds a stranger's Telegram to an operator. The code is single-use, short-lived and bound to one membership. The link message never becomes a customer message, and linking never silently replaces an existing link.
- **The link chat turns into a customer conversation.** Operators get captured as contacts, or reply "ok" to a ping, which restarts waiting. Messages from a linked member's Telegram account to that bot are therefore not captured, and the bot points them back to the panel.
- **A tab left open counts as "present".** Presence needs a working live connection and a tab that has been on screen recently.
- **Ping storms when a bot recovers.** Waiting is measured by arrival in tg-inbox. Pings to one member are combined, and pings never delay customer replies.
- **The assignee is absent.** A wait that continues reaches the team.
- **The contact's name is text the customer controls.** It can carry a phishing line, so pings carry no contact names.

This step reverses one earlier choice. assignment-statuses §3 kept counters off the list lenses because many counts, kept live across tabs, were a reliability risk. The attention count is a single number per member and workspace, the one number a notification needs. The lens counters stay out.

This step closes bot-connection §8 ("Should the owner be alerted proactively when the bot stops working?"). The answer is no, not through Telegram: a bot that is not working cannot send the alert (§3). Every member already sees the inbox notice about the bot (shared-inbox AC-13/AC-14), and members with a Telegram link see "Pings paused" in the panel (AC-10).

Success means a pilot customer who writes while the team is away gets a reply as fast as they did with the forwarder bot, without operators muting tg-inbox.

Sized M, not the roadmap's first-guess S: it adds a new capability area (notifications and Telegram links), new member actions with a data change, and a change to capture (linked members' messages).

**D1 decided (closes roadmap open decision D1).** A member is **away from the web** for a workspace when none of their browser tabs, on any device, has that workspace's panel open with a working live connection and on screen within the last 10 minutes. A tab that is minimised, hidden behind another tab, on a sleeping computer or without a live connection does not count.

Assumptions taken in the autonomous pipeline run (2026-10-19). Any of them can be vetoed at review:

- Thresholds: a ping is due after a customer has waited **5 minutes**, and an assigned conversation that is still waiting reaches the rest of the team at **30 minutes**. Pings to one member in one workspace are at most **one per 10 minutes**, combined. The presence window is **10 minutes**.
- A member who has already read the message that started the wait (their arrival watermark is past it) is not pinged for that conversation: they have seen it. This mirrors the research's "stay silent once someone opened it".
- A ping carries no customer text and no contact name (the name is customer-controlled text, see §6.1), only the workspace name, how many conversations wait for this member (and whether they are theirs, unassigned or a teammate's), the longest wait and a panel link. Desktop notifications show the contact's name but never the message text.
- Business owners and operators are treated identically, as everywhere in the inbox.
- Linking is per membership, because each workspace has its own bot. A multi-workspace member links once per workspace.
- Desktop notifications are a per-browser opt-in, asked for only when the member clicks to turn them on. There are no sounds of our own; the operating system's notification sound applies.
- Linking a Telegram account is the opt-in, and removing the link is the off switch. There is no separate on/off toggle, no quiet hours and no per-workspace schedule in this step (§3, §8).

## 2. Goals

- A customer who writes while the team is away from the panel is noticed by a member within minutes, not when someone happens to look.
- Operators get notified only about what needs them and are never flooded, so they keep notifications on.
- Notifications never leak a workspace's customers to anyone outside the workspace's active members.

## 3. Non-goals

- **Customer message text in pings**: pings travel to a personal messenger and appear on lock screens. Previews are an opt-in to revisit with pilots (§8).
- **Replying, assigning or closing from Telegram**: operators work only on the web (idea-brief §5). The bot chat with a member only sends notifications.
- **Email, SMS or a mobile app**: Telegram is the channel every pilot operator already carries. Other channels add consent and delivery work.
- **Quiet hours, working schedules and a "do not disturb" status**: pilot teams are small and unlinking is the off switch. §8 revisits this with ping data.
- **Notifying about other workspaces inside the panel** (a dot in the workspace switcher): a member is away from every workspace they do not have open, so the ping already covers those workspaces, and live data from unopened workspaces is an isolation risk.
- **Alerting about a broken bot through Telegram**: a bot that is not working cannot send the alert. The inbox notice about the bot (shared-inbox AC-13/AC-14) stays the channel.
- **Notification settings per conversation or per event** (mentions, assignment-only, every message): one simple rule set fits pilot teams; finer settings are what makes comparable products heavy.

## 4. User stories

### US-01: See what needs me at a glance

**As an** Operator
**I want** the browser tab and the navigation to show how many conversations need me
**So that** I notice new customer messages while I work on another page or another tab

### US-02: Get a desktop notification

**As an** Operator
**I want** a desktop notification when a customer writes in a conversation that is mine or unassigned and I am not looking at the panel
**So that** I notice it while I work in another window

### US-03: Connect my Telegram for pings

**As an** Operator
**I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
**So that** the bot can ping me when I am away, and only after I chose so

### US-04: Get pinged when away

**As an** Operator
**I want** the business bot to ping me in Telegram when a customer of mine, or an unassigned one, has waited 5 minutes and I am away from the web
**So that** no customer waits because I closed my laptop

### US-05: A waiting customer reaches the team

**As a** Business owner
**I want** a customer whose assigned member does not answer to reach the rest of the team
**So that** nobody waits on a teammate who is off for the day

### US-06: The bot chat stays a notification channel

**As an** End customer
**I want** the business's conversation list to hold only real customers
**So that** the team's attention and replies go to me, not to their own colleagues' notification chats

## 5. Acceptance criteria

### AC-01 (US-01): happy path

**Given** an operator of "Acme Flowers" with the inbox open: 2 open conversations assigned to them and 1 unassigned open conversation have customer messages they have not read, while a teammate's conversation and a closed one also have unread messages
**When** they look at the browser tab or move to Settings or Contacts
**Then** the tab title starts with "(3)" and the Inbox item in the side navigation shows 3: the **attention count** includes only open conversations that are theirs or unassigned and have unread messages for them. It changes without reloading within the live-update target of §6 as messages arrive, as they read conversations and as conversations are assigned, closed or reopened. At 0 the title has no count and the navigation shows no number. Each tab shows the count of its own workspace. A business owner sees the same.

### AC-02 (US-02): happy path

**Given** an operator of "Acme Flowers" who turned on desktop notifications in this browser and has an "Acme Flowers" tab with a working live connection, but no "Acme Flowers" tab in this browser is on screen
**When** a customer writes in a conversation assigned to them or unassigned
**Then** the computer shows one notification "<contact name> · Acme Flowers": "New message". It shows no message text and appears once for this browser even with several tabs open. Further messages in that conversation replace it instead of stacking. Clicking it brings the tab forward with that conversation open. No notification appears for a conversation assigned to a teammate, for an edit, for a reply or an activity entry, or while an "Acme Flowers" tab in this browser is on screen.

### AC-03 (US-02): error

**Given** an operator who clicks "Turn on desktop notifications" in the panel
**When** the browser refuses permission, or permission was refused earlier, or the browser cannot show notifications
**Then** the panel says that desktop notifications are off for this browser and how to allow them in the browser's site settings. The attention count (AC-01) keeps working. The panel never asks the browser for permission without the member's click.

### AC-04 (US-03): happy path

**Given** an active operator of "Acme Flowers", whose bot is connected, with no Telegram link
**When** they choose "Connect Telegram" in the panel, open the link it shows (or scan its code) on their phone and press Start in the chat with the "Acme Flowers" bot within 10 minutes
**Then** the bot answers in that chat that it will notify them about waiting customers of "Acme Flowers", and how to stop: disconnect in the panel. The panel shows "Connected" with their Telegram name and since when, without reloading. Starting the bot through this link creates no contact and no conversation and shows nothing in the inbox. Choosing "Disconnect" removes the link at once: the bot sends no further pings and tells them in the chat that notifications are off.

### AC-05 (US-03): error

**Given** a member who opens a connect link
**When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
**Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.

### AC-06 (US-03): domain invariant

**Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
**When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
**Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently.

### AC-07 (US-04): happy path

**Given** an operator of "Acme Flowers" with a Telegram link who is away from the web (no tab of theirs, on any device, has "Acme Flowers" open with a working live connection and on screen within the last 10 minutes), and an open conversation assigned to them in which the customer is waiting for a reply, with the message that started the wait still unread for them
**When** 5 minutes pass since that message arrived in tg-inbox and nothing has ended the wait
**Then** the "Acme Flowers" bot sends them one ping: "Acme Flowers: 1 customer is waiting for your reply (5 min)", with a link that opens that conversation in the panel. The ping contains no message text and no contact name. A conversation that is unassigned at that moment pings every linked member of "Acme Flowers" who is away and has not read the message. A member who is present on the web gets the in-web notifications instead (AC-01, AC-02) and no ping.

### AC-08 (US-04): domain invariant

**Given** a conversation of "Acme Flowers" for which a linked away member has been pinged
**When** the customer writes more messages in the same waiting period, or other conversations become due for the same member within 10 minutes
**Then** that member is pinged at most once per conversation per waiting period. Pings to one member from one workspace are at most one per 10 minutes. Conversations that become due in between are combined into the next ping ("Acme Flowers: 4 customers are waiting for your reply, the longest 12 min", with a link to the inbox's "mine" or "unassigned" lens). A waiting period ends when a reply is marked sent or the conversation is closed. The next customer message after that starts a new one. A conversation that is reopened while its customer is still waiting for a reply also starts a new one at the moment it reopens, for example after a reply ends "not delivered" (assignment-statuses AC-08). A member who becomes the assignee after the ping was due, or who reads the waiting message, is not pinged for that period.

### AC-09 (US-05): cross-context

**Given** an open conversation of "Acme Flowers" assigned to an operator, whose customer has been waiting for a reply
**When** 30 minutes pass since the wait began and it has not ended, or 5 minutes pass and the assignee has no Telegram link or their link cannot be reached
**Then** every other linked member of "Acme Flowers" who is away and has not read the waiting message gets the ping for it, as for an unassigned conversation (AC-07, AC-08), saying that a teammate's customer is waiting (without the teammate's name). The assignee stays the assignee, since a ping never changes the assignee or the status.

### AC-10 (US-04): cross-context

**Given** a conversation of "Acme Flowers" whose ping is due
**When** at that moment the conversation is closed, a reply was marked sent, the recipient's membership is no longer active, the bot is "not connected" or "not working", or the member blocked the bot in Telegram
**Then** no ping reaches that member. A closed conversation or a sent reply ends the wait (AC-08). A deactivated member's Telegram link is removed as part of the deactivation, before any further ping, and is not restored when they are reactivated. While the bot does not work, nothing is retried later, and the member's panel shows "Pings paused — the bot is not working". When the member has blocked the bot, their panel shows "Not reachable — you blocked the bot in Telegram, unblock it or disconnect" until a ping reaches them again. A bot that is "taken over" can still send (shared-inbox AC-14), so pings for customers who were already waiting still go out. The panel says that new customer messages are not arriving (shared-inbox AC-14). Pings never delay or crowd out replies to customers: when the bot is at its Telegram sending limit, replies go first and pings wait or are combined.

### AC-11 (US-06): cross-context

**Given** an operator of "Acme Flowers" whose Telegram account is linked to the "Acme Flowers" bot
**When** they write anything in that chat, for example "ok" in answer to a ping
**Then** the message is not captured. It creates no contact or conversation, does not reopen anything and counts toward no unread count or waiting marker. The bot answers that this chat only sends notifications and that replies to customers are written in the panel, with a link. It sends that answer at most once per hour. Messages the same person sent to the bot before they linked stay in their conversation as they were. Once they disconnect, their messages are captured as an end customer's again. Starting the bot with any other start link (a business's own campaign link) is captured as before (bot-connection AC-07).

### AC-12 (US-03, US-04): authorization

**Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
**When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
**Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in, never to the conversation.

### AC-13 (US-03): error

**Given** a member of "Acme Flowers" who has requested 5 connect links within the last 10 minutes
**When** they request another one
**Then** no new link is made. The panel says that connect links are limited to 5 per 10 minutes and when they can try again. A newer link always replaces the previous unused one (AC-05). When the bot of "Acme Flowers" is not connected, not working or taken over, the panel offers no connect link. It explains that Telegram pings need a working bot that receives messages. A taken-over bot would never receive the Start. An operator is told to ask a business owner; a business owner gets the way to the bot settings.

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Ping timeliness: due moment (5 min after the waiting message arrived), or for a combined ping the member's next allowed send moment (AC-08) → ping accepted by Telegram, p95, excluding time the bot spent at its sending limit with replies queued (AC-10) | ≤ 60 s | job timing log from due/allowed time to accepted send; integration test against the fake Bot API |
| In-web latency: customer message captured → attention count / desktop notification updated in an open tab, p95 | ≤ 3 s (shared-inbox live-update target) | server-side timing from capture to push, logged per event; CI integration test asserts the push |
| Presence freshness: a member's last eligible tab closes, loses its live connection or leaves the screen → counted away | ≤ 10 min + 60 s | integration test with a simulated dead connection (no answer to the keep-alive) and with a hidden tab |
| Pings to non-members | 0 pings reach a Telegram account whose membership is not active at send time | send-time membership check; integration test: deactivate during a due ping → no send |
| Ping volume per member | ≤ 1 ping per 10 min per member per workspace; ≤ 1 per conversation per waiting period | integration test; daily reconciliation query in the run book |
| Ping content | 0 pings containing customer message text or a contact name | unit test on the ping text builder; review of the template |
| Captured link messages | 0 contacts or conversations created from connect-link starts or linked members' messages | integration test; run-book query: contacts whose Telegram id equals a linked member's in the same workspace |
| Reply delivery under ping load | reply send p95 unchanged (≤ shared-inbox target) with 50 pings due at once on one bot | load test against the fake Bot API |
| Connect link | single use, expires in 10 min, ≤ 5 requests per 10 min per member | integration tests (AC-05, AC-13) |
| Availability | 99.5 % monthly (as shared-inbox §6) | uptime check on the health endpoint |

## 6.1 Security / privacy

- **Data classification:** confidential. A member's personal Telegram account becomes linked to their workspace membership, and notifications reveal workspace activity.
- **Personal data touched:** new data: each member's linked Telegram account (its Telegram id and display name, shown only to that member) and the record of pings sent (to whom, for which conversations, when). No new end-customer data. Pings carry no customer text or contact name. Desktop notifications show a contact's name on the member's own computer.
- **AuthZ/AuthN impact:** getting a connect link, seeing and removing one's own link require an active membership of the workspace, with either role. A connect link is bound to one membership, is single-use and expires after 10 minutes. Every send re-checks that the recipient's membership is active. Deactivation removes the member's link in that workspace only. The live connection used for presence keeps the shared-inbox checks (it stops within 5 s of access ending, shared-inbox AC-09). A ping's link always goes through the panel's sign-in and membership checks.
- **Abuse cases:**
  - **Connect-link leak or replay** (forwarded, screenshotted, left in browser history): bound to one membership, single-use, expires in 10 min. It never appears as a message in any conversation (AC-04, AC-11), and an existing link is never replaced silently (AC-06). The bot confirms every new link in the linked chat, so a member sees one they did not make.
  - **Phishing through the ping**: the contact's name and the message text are customer-controlled and never appear in a ping. The workspace name is set by the tg-inbox team or the business owner.
  - **Former member keeps receiving workspace activity**: the link is removed with the deactivation, and every send re-checks membership (AC-10). Pings already delivered stay in the person's Telegram, which is why they carry no customer text or names.
  - **Cross-tenant probing** (requesting links for, or reading the link state of, another workspace's members): refused with no hint the workspace exists (AC-12).
  - **Spam through the link flow**: 5 connect links per 10 minutes per member (AC-13). The bot's "this chat only sends notifications" answer is sent at most once per hour (AC-11).
- **Security review:** Required. It adds a new external channel carrying workspace data, a new account-linking flow and new personal data.

## 7. Metrics / KPIs

- **Customer messages answered within 15 minutes**: baseline: TBD, measured from release for 7 days with notifications switched off (share of waiting periods ended by a sent reply within 15 min, per workspace). Target: +30 percentage points over that baseline within 30 days of release.
- **Members with a Telegram link**: baseline: 0 % (new). Target: ≥ 60 % of active members of pilot workspaces within 30 days.
- **Ping → panel within 15 minutes**: baseline: 0 (new). Target: ≥ 50 % of pings followed by the recipient opening the panel for that workspace within 15 min, tracked weekly. Alert if it falls 3 weeks in a row (fatigue signal).
- **Unlinks and bot blocks by members**: baseline: 0 (new). Target: ≤ 10 % of linked members disconnect or block the bot within 30 days.
- **Customer messages left without a reply** (shared-inbox §7): target unchanged at ≤ 5 % still waiting 24 h after the customer's last message.

## 8. Open questions

- [ ] Should members be able to opt in to the customer's message preview or the contact's name in pings? Default now: no, neither (§3, §6.1). Owner: Dmytro Hopko. Due: after 30 days of pilot use (look at the ping → panel KPI).
- [ ] Do pilots need quiet hours or a per-workspace schedule for pings? Default now: no, unlinking is the off switch. Owner: Dmytro Hopko. Due: after 30 days of pilot use (watch the unlink/block KPI and pings sent between 22:00 and 08:00 workspace time).
- [ ] Are the 5-minute ping and 30-minute team escalation thresholds right for pilots, and should owners be able to change them? Default now: fixed at 5 and 30 minutes. Owner: Dmytro Hopko. Due: after 30 days of pilot use.
