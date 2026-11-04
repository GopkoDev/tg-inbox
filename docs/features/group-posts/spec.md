---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
---

# Spec — group-posts

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** `docs/roadmap.md` (step 10, § Decisions so far: channel posting needs the bot as an admin with the right to post, scheduling is ours to build), `docs/idea-brief.md` §1, §5 and §7, `docs/architecture-map.md`, and the shipped features this one builds on: `docs/features/bot-connection/spec.md` (§3 and AC-12: group and channel work was left to this step, messages in groups are not captured), `docs/features/broadcasts/spec.md` (owner-only sending, at-most-once sends, "not confirmed", the send pause, a bot that stopped working or was replaced, the plain-text rule), `docs/features/operator-notifications/spec.md` (the single-use 10-minute connect link pattern).

## 1. Context

Many pilot businesses run a Telegram channel or a customer group next to their support bot: new arrivals, opening hours, offers. Today the team posts there by hand from someone's personal Telegram account, with no shared draft, no way to prepare a post for the morning, and no record of who posted what. The business bot that already serves support is a natural author for those posts, and the web panel is where the team already works (idea brief §1 names "posts to a group" from the start; §7 orders them after broadcasts).

Why now: broadcasts (step 8) shipped the hard parts this step reuses — owner-only sending through the shared bot, at-most-once sends with an honest "not confirmed", the bot's send pause, and what happens when the bot stops working or is replaced. The roadmap places group posts in wave 7, and the owner already fixed two facts (roadmap § Decisions so far): channel posting needs the bot as an admin with the right to post, and scheduling is tg-inbox's own to build.

**Committed approach.** A business owner connects a channel or group by adding the workspace's bot to it with the right to post and then posting a single-use connect code from the panel into that chat. Only a chat where someone who can post there used the code becomes a **destination** of the workspace; a chat the bot was merely added to never does. Any member drafts a **post**: one destination and plain text (with an option to send it without a notification sound). Only a **business owner publishes it now or schedules it** for a time in the workspace's time zone, from a confirmation that shows the destination's Telegram name and the exact text. A scheduled post is locked: changing its text, destination or sound option moves it back to a draft, and only an owner schedules it again (an owner changing its time is scheduling it again). Each post goes out at most once, at its time or within a short grace window; if it cannot go out in that window it is marked missed and is never published late. Every post shows its outcome live (published with a way to open it in Telegram, failed with a plain reason, missed, or not confirmed). A business owner can delete a published post from the chat within 48 hours, the brake for a post that went out wrong. Grounding: the schedulers the research found (Publer, Postiz, PostFast, Fedica — researcher, 2026-11-03) all connect a chat through a bot made admin, and only one documents an approval step before publishing; none documents a per-post outcome with a reason or what happens to a late post, and none sits next to a customer inbox — that is the gap this step fills. The adversarial pass named the sharpest failure: a post landing in the **wrong chat** (a stranger's group the bot was added to, a lookalike, the internal group instead of the public channel), which is why a chat becomes a destination only through the code posted into it, the confirmation names the chat, and an owner can delete a fresh post. The same pass shaped the rest: no catch-up of overdue posts after an outage, a scheduled post confirms exactly what goes out and returns to draft when its owner leaves, one workspace time zone with its daylight-saving changes handled, posts never set the bot-wide pause for a per-chat limit, and chat messages the bot now receives never slow down customer capture.

Success means a pilot owner prepares tomorrow morning's channel post in the panel, it appears in the channel on time, and the team sees that it did.

Sized M (the roadmap's size, confirmed here): a new capability area with its own data, screens and a timed job, plus a new inbound path (the connect code and chat membership changes from Telegram); no breaking change to existing features. The route is `standard` (the size-matrix default for M).

Assumptions taken in the autonomous pipeline run (2026-11-03). Each can be vetoed at review:

- **Who does what.** Any member (operator or business owner) sees destinations and every post of the workspace, creates and edits drafts, duplicates posts and moves a scheduled post back to a draft. Only a business owner connects or removes a destination, publishes, schedules and deletes a published post: a post speaks publicly for the business and cannot be taken back after 48 hours. A draft is deleted by its author or a business owner.
- **Connecting a destination.** A business owner creates a connect code in Settings (single-use, valid 10 minutes, as the Telegram link of operator notifications) and posts it in the channel or group where the bot already is. The chat becomes a destination named as in Telegram, and the panel shows its kind (channel or group) and public username when it has one. The bot removes the code message when it is allowed to. A chat where the bot cannot post (a channel without the right to post, a group where it may not send messages) is not connected and the panel says what right is missing. At most 20 destinations per workspace.
- **Content.** Plain text only, 1–4096 characters counted the way Telegram counts them, trimmed at both ends — the same rule as broadcasts. No photos, files, formatting or buttons in this step (OQ-1). Link previews are Telegram's default. "Send without sound" is an option per post.
- **Scheduling.** A post is scheduled in the workspace's time zone, which a business owner sets in Settings (prefilled from the owner's browser the first time). Times are picked to the minute, at least 2 minutes and at most 90 days ahead. A local time that a daylight-saving change skips cannot be picked; a repeated one means its first occurrence. Every member sees the time in the workspace's zone, with the zone named.
- **On time or missed.** A scheduled post goes out within 1 minute of its time. Posts due at the same time to the same chat go out one after another, at most one every 3 seconds, in the order they were scheduled, so a later one in such a run may take longer than the minute. If a post cannot go out within 15 minutes of its time because the service was down or the bot was paused by Telegram, it is marked missed and never published later. A bot that is not working makes it fail instead (AC-14).
- **Context at the time it goes out.** What goes out is exactly the text and destination the owner confirmed. A scheduled post whose scheduling owner is deactivated before its time returns to a draft with a notice. A destination that was removed, or that the bot can no longer post to, makes the post fail at its time with that reason.
- **Limits.** At most 30 posts published per workspace in any 24 hours (scheduled ones count when they go out; a missed or failed one does not) and at most 100 scheduled posts waiting per workspace — a brake for a hijacked owner session, far above a pilot's needs.
- **Failures are visible.** A failed or missed post is marked on the Posts page and counted next to Posts in the navigation until a member opens it.
- **One chat, one workspace at a time is not required.** A destination belongs to a workspace and its bot; the same chat could in principle be connected by another workspace's own bot, which is harmless because each workspace posts only through its own bot.
- **Platform admin is not involved.** Destinations and posts are run by the workspace; the tg-inbox team has no step here.
- **Chat messages are not captured.** Messages written in a destination group, or posted in a destination channel by others, create no contact, conversation or unread (bot-connection AC-12 stays true); the bot answers nothing there except removing its connect code.
- **Delete after publishing.** A business owner can delete a published post from the chat within 48 hours of publishing it (Telegram's limit for a bot's own messages); it is then marked deleted with who did it and when. Editing a published post is not in this step (OQ-2).
- **The bot is the Telegram bot.** Destinations belong to the Telegram bot connected now. Reconnecting the same Telegram bot keeps them; connecting a different one makes them unavailable until each is connected again with a code (as broadcasts' "current bot" rule).

Clarifications (clarify, autonomous run 2026-11-03). Each picks the most sensible reading of a point where two builders could have diverged; any can be vetoed at review:

- **The connect code is a command to the bot.** It is a short command addressed to the workspace's bot, so Telegram delivers it in a group even when the bot is not an admin there; in a channel it is posted as a channel post, which only the channel's admins with the right to post can do. Whoever posts it must be able to post in that chat; the code itself (single-use, 10 minutes, shown only to the business owner who created it) is the proof (AC-01).
- **A destination is the chat, once per workspace.** A code posted in a chat that is already a destination of the workspace — available, unavailable or removed — revives that same destination (same slot of the 20, same posts) and refreshes its name; a removed destination comes back the same way. The destination's name follows renames that Telegram tells the bot about (AC-01, AC-14).
- **Available or not, live.** Telegram's notices that the bot lost or regained its right to post, or left or rejoined the chat, mark the destination unavailable or available again at once; a send refused for missing rights marks it too. Publishing or scheduling to an unavailable destination is refused upfront, with what right is missing (AC-13).
- **Removing a destination.** A business owner removes it after a confirmation that names how many scheduled posts target it; those return to drafts with a notice, and drafts keep it but cannot be published until another destination is picked or it comes back.
- **Not working versus replaced.** A bot that stops working or is disconnected refuses all publishing and scheduling, and due posts fail with "the bot was not working". A different working bot refuses only destinations that belong to the old bot (unavailable until connected again with a code), and due posts to them fail with "this chat is not connected to the current bot" (AC-14).
- **The 15-minute window covers every wait.** It runs from the scheduled time, or from the confirmation for "publish now", and is measured at the moment the send to Telegram starts. Inside the window a post waits for the service, the bot's send pause or a limit Telegram applies to that one chat; posts that became due during an outage still go out within their window, in scheduled-time order, at most one every 3 seconds per chat and one per second per bot. Past the window the post is missed with the reason (the service was down, the bot was paused, or Telegram limited posting to this chat) (AC-07, AC-12).
- **Per-chat limits stay with posts.** A rate-limit answer to a post delays only posts to that chat and sets no bot-wide send pause; posts still wait for a send pause set by any other send (AC-17).
- **The scheduling range is checked at confirmation.** "At least 2 minutes and at most 90 days ahead" is measured when the owner confirms (scheduling or changing the time), not when the picker was opened (AC-10).
- **Changing the workspace time zone.** Scheduled posts keep their moment and are shown in the new zone; the confirmation for the change says how many scheduled posts it re-labels. Until a time zone is set, the first owner who schedules confirms it (prefilled from their browser) and it is saved for the workspace; nothing can be scheduled before that (AC-09).
- **Limits are counted on what went out.** The 30-per-24-hours limit counts posts sent to Telegram — published, not confirmed and later deleted ones — and is checked at "publish now" and when a scheduled post goes out (which then fails with that reason); scheduling itself checks only the 100 waiting (AC-16).
- **Needing attention is shared.** Failed, missed and not confirmed posts are counted next to Posts in the navigation for the whole team until any member opens the post (AC-13).
- **Duplicates and authors.** A duplicate copies the text, the destination and the sound option into a new draft whose author is the member who duplicated it. A scheduled post that returns to a draft keeps its author (AC-07, AC-18).
- **The Posts page.** One list of every post, the most recently changed first, with filters by state (drafts, scheduled, published, needing attention); scheduled posts show their time in the workspace's zone. The draft preview is the plain text with its line breaks, without a link card.

Critic pass (2026-11-03), resolved as amendments: a bot that is not working makes a due post fail, a paused bot or an outage makes it missed (AC-12, AC-14); changing a scheduled post's text, destination or sound option returns it to a draft, an owner changing its time confirms it again (AC-09, AC-11); the roadmap's admin rule is quoted for channels only; the on-time bound is for the first post due in a chat; AC-04 no longer claims a chat is exclusive to one workspace; US-08 covers the end customer side of AC-17.

## 2. Goals

- A business can post to its own Telegram channel or group from the panel, through its own bot, without anyone using a personal account.
- The team can prepare posts ahead and trust the schedule: a post goes out at its time, once, exactly as an owner confirmed it, or is clearly marked as missed or failed — never late, twice or into the wrong chat.
- Posting never gets in the way of support: replies, pings and broadcasts keep their pace, and customer messages are captured as fast as before.

## 3. Non-goals

- **Photos, video, files, albums, formatting and buttons** — every scheduler researched supports media, but each kind of content is its own upload, preview and failure path; plain text matches broadcasts and is enough to learn whether pilots post at all (OQ-1).
- **Editing a published post** — a post that went out wrong is deleted (within 48 hours) and posted again; editing in place needs its own history and conflict rules (OQ-2).
- **Recurring posts, queues and best-time suggestions** — one post, one time; recurring rules are a separate feature once pilots post regularly.
- **Reading the chat: capturing group messages, comments or replies, and statistics (views, reactions)** — v1 support is private chats only (bot-connection §3), and the bot cannot reliably read channel statistics.
- **Topics in forum groups, pinning and posting to several destinations at once** — a post goes to one destination's main chat; duplicating a post covers another destination.
- **Posting through someone's personal account or a shared tg-inbox bot** — every workspace posts only through its own business bot (roadmap § Decisions so far).

## 4. User stories

### US-01: Connect a channel or group

**As a** Business owner
**I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
**So that** the team can post there through the business bot, and no other chat can be posted to by mistake

### US-02: Draft a post

**As an** Operator
**I want** to write a post for one of the workspace's destinations and save it as a draft the team can see and edit
**So that** posts are prepared together before an owner sends them

### US-03: Publish a post now

**As a** Business owner
**I want** to check the destination and the exact text one last time and publish the post right away
**So that** the announcement appears in the business's channel or group from its bot, once

### US-04: Schedule a post

**As a** Business owner
**I want** to choose when a post goes out, in the business's time zone, and change or cancel that until it goes out
**So that** posts appear at the right moment without anyone being online then

### US-05: Know what happened to a post

**As an** Operator
**I want** to see each post's state live — draft, scheduled, published (and open it in Telegram), failed or missed with a plain reason
**So that** the team notices at once when a post did not go out and can act

### US-06: Take back a wrong post

**As a** Business owner
**I want** to delete a post the bot published, shortly after it went out
**So that** a mistake does not stay in front of the business's audience

### US-07: Keep support working while posts go out

**As an** Operator
**I want** replies to customers to go out and customer messages to arrive as fast as ever, whatever is being posted or written in the business's groups
**So that** posting never makes support slower

### US-08: Write to the business without being captured from its group

**As an** End customer
**I want** what I write in the business's group to stay in the group, and my private messages to the bot to reach the team as fast as before
**So that** the team sees only what I sent them directly, and my questions are not delayed by the group

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
**When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
**Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to

### AC-02 (US-01) — domain invariant

**Given** a business owner whose bot is in a group but may not send messages there, or in a channel without the right to post
**When** the owner posts a valid connect code there
**Then** the chat is not connected, and Settings tells the owner which right the bot needs in that chat; a chat the bot was added to without a code never becomes a destination; an expired or already used code connects nothing, and Settings shows the code as expired

### AC-03 (US-01, US-03, US-04, US-06) — authorization

**Given** an operator of "Acme Flowers"
**When** they look at destinations, a draft or a published post
**Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead

### AC-04 (US-02, US-05) — authorization

**Given** members of "Acme Flowers" and of "Bolt Bikes"
**When** a member of "Bolt Bikes" opens, edits or publishes a post or a destination of "Acme Flowers" by its address
**Then** the system refuses as if it did not exist and reveals nothing about it; each workspace sees and posts only to its own destinations, through its own bot

### AC-05 (US-02) — happy path

**Given** an operator of "Acme Flowers" with the destination "Acme Flowers News"
**When** they create a post, pick that destination, type the text and tick "send without sound"
**Then** the draft is saved as they type, shows how the text will look in the chat and how many characters remain, and appears on the Posts page for every member with its destination and who last changed it

### AC-06 (US-02) — error

**Given** an operator editing a draft
**When** the text is empty after trimming spaces and line breaks, is longer than Telegram allows for one message, or no destination is picked, or a teammate saved a newer version of the draft meanwhile
**Then** the draft cannot be published or scheduled, the editor says plainly what is missing or too long, and a stale save is refused with the teammate's current version shown, never overwriting it

### AC-07 (US-03) — happy path

**Given** a business owner with a draft for "Acme Flowers News" and a working bot
**When** the owner opens Publish, sees the destination's Telegram name and kind and the exact text, and confirms
**Then** the post appears in the channel from the bot within seconds (if the bot is paused by Telegram it waits, at most 15 minutes, then is marked missed), once, and is marked published with the time, the owner who published it and a way to open it in Telegram; its text and destination never change afterwards, and it can be duplicated into a new draft

### AC-08 (US-03, US-04) — domain invariant

**Given** a draft that a business owner is publishing or scheduling
**When** the owner double-clicks, two owners confirm at the same time, the draft was changed after the confirmation opened, or the service restarts while the post is being sent
**Then** the post goes out at most once; a confirmation for a changed draft publishes nothing and shows the current version to confirm again; a send that got no answer from Telegram is marked "not confirmed — Telegram did not answer, not sent again" and is never repeated automatically

### AC-09 (US-04) — happy path

**Given** a business owner of a workspace whose time zone is Europe/Kyiv, with a draft
**When** the owner schedules it for tomorrow 09:00 and confirms the destination and text
**Then** the post is marked scheduled for "09:00 (Europe/Kyiv)", shown in that zone to every member, appears in the chat within 1 minute after that time with no one online (posts due together in one chat follow each other a few seconds apart), and until then any member can move it back to a draft and an owner can change its time, which confirms it again

### AC-10 (US-04) — error

**Given** a business owner scheduling a post or changing a scheduled post's time
**When** at the moment they confirm, the chosen time is less than 2 minutes ahead, more than 90 days ahead, the destination is unavailable, or a local time the daylight-saving change skips in the workspace's time zone
**Then** the post is not scheduled and the owner is told the allowed range, that this time does not exist on that day, or what right the bot is missing in that chat

### AC-11 (US-04) — domain invariant

**Given** a scheduled post
**When** any member changes its text, destination or sound option, or its scheduling owner is deactivated before its time
**Then** the post first goes back to a draft (after a confirmation for the member, with a notice when it was the deactivation), so it only goes out after a business owner schedules or publishes it again; what goes out is always exactly what an owner confirmed

### AC-12 (US-04, US-05) — cross-context

**Given** a post scheduled for 09:00
**When** it cannot go out by 09:15 because the service was down, the bot was paused by Telegram or Telegram limited posting to that chat
**Then** it is marked missed with the reason, is never published later, and counts as needing attention; after an outage, posts still inside their window go out in scheduled-time order, paced, and the rest are missed

### AC-13 (US-05) — error

**Given** a published-now or scheduled post
**When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
**Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there

### AC-14 (US-01, US-05) — cross-context

**Given** a workspace with destinations and scheduled posts
**When** its bot stops working or is disconnected, or a different Telegram bot is connected
**Then** while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different working bot, only the old bot's destinations are unavailable until connected again with a code, and posts due to them fail with "this chat is not connected to the current bot"; while reconnecting the same bot keeps them; a group that Telegram upgraded keeps working as the same destination

### AC-15 (US-06) — happy path

**Given** a post the bot published to "Acme Flowers News" less than 48 hours ago
**When** a business owner deletes it from Telegram and confirms
**Then** the message disappears from the channel, the post is marked deleted with the owner and time, and its text stays readable in the panel; after 48 hours, or if Telegram refuses, the panel says it can no longer be deleted by the bot

### AC-16 (US-03, US-04) — domain invariant

**Given** a workspace that sent 30 posts to Telegram in the last 24 hours, or holds 100 scheduled posts waiting
**When** a business owner publishes another post now, or schedules one more while 100 are waiting
**Then** the system refuses and says the daily posting limit (and when posting is possible again) or the scheduled-post limit was reached; a scheduled post whose time comes while the daily limit is reached fails with that reason

### AC-17 (US-07, US-08) — cross-context

**Given** a destination group where customers chat busily and a broadcast and replies are being sent
**When** posts go out and people write in the group
**Then** nothing written in a destination is captured — no contact, conversation, unread or ping is created; customer messages to the bot and replies keep their usual speed; a limit Telegram applies to one chat delays only posts to that chat, while posts still wait for the bot's send pause

### AC-18 (US-02) — authorization

**Given** a draft created by an operator
**When** another operator tries to delete it
**Then** they are refused and told only its author or a business owner can delete it; a scheduled post must be moved back to a draft first, and a published, failed or missed post is kept as a record and cannot be deleted from the panel

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Scheduled post on time | p95 ≤ 30 s and max ≤ 60 s from the scheduled time to Telegram accepting it, while the service and bot are up, for the first post due in a chat at that time (each further post due together in the same chat adds ≤ 3 s) | post timing log (scheduled vs accepted); integration test with a fake clock and the fake Telegram |
| Publish now | p95 ≤ 5 s from confirm to "published" shown | request + send timing log |
| Missed window | 0 posts whose send to Telegram started more than 15 min after their scheduled time (or their "publish now" confirmation) | integrity query in the run book; integration test with an outage longer than the window |
| At most once | 0 posts sent twice, including after a restart at the moment of sending, a double confirm or two owners | integration test: concurrent publish, restart mid-send, unanswered send; integrity query |
| What was confirmed goes out | 0 posts whose sent text or destination differs from the version an owner confirmed | integration test per edit path; integrity query |
| Destination connect | p95 ≤ 5 s from the code posted in the chat to the destination shown in an open panel | update handling timing log; integration test with the fake Telegram |
| Live updates | p95 ≤ 3 s from a post's change to it shown in an open panel (as shared-inbox §6) | server-side timing from change to push |
| Customer capture unaffected | p95 capture time of private customer messages unchanged (± 1 s) while a destination group receives 10 messages per second | capture timing log; load test with group traffic interleaved |
| Reply latency unaffected | p95 reply send → Telegram accepted ≤ 2 s while posts go out (shared-inbox §6) | reply delivery timing log |
| Per-chat pace | ≤ 1 post per 3 s into one chat (under Telegram's ~20 per minute per group) | send timing log per destination |
| Posting limits | ≤ 30 published per workspace per rolling 24 h; ≤ 100 scheduled waiting | integration test: the 31st and 101st are refused |
| Availability | 99.5 % monthly (as shared-inbox §6) | uptime check on the health endpoint |

## 6.1 Security / privacy

- **Data classification:** confidential — drafts and scheduled posts are unpublished business announcements; once published the text is public in the business's chat, but the draft history, who wrote it and the destinations stay internal.
- **Personal data touched:** new — per post, which members created, changed, published, scheduled or deleted it; per destination, the chat's Telegram name, kind and public username (a business's own chat). Nothing is read from people writing in the chats; the connect code message is only checked against the code and removed.
- **AuthZ/AuthN impact:** seeing posts and destinations, drafting, duplicating and moving a scheduled post back to a draft require an active membership with either role. Connecting and removing destinations, publishing, scheduling and deleting a published post require the business owner role, re-checked at the moment of the action and, for a scheduled post, at its time (the scheduling owner must still be active). Deleting a draft requires being its author or a business owner. Every read and write is scoped to the caller's workspace; a post can only target a destination of its own workspace, sent through that workspace's own bot.
- **Abuse cases:**
  - **The sharpest one: posting into the wrong chat.** Anyone who knows the bot's username can add it to their group, and a lookalike chat can carry the business's name. The response: a chat becomes a destination only when a single-use code from an owner's panel is posted in it, within 10 minutes (AC-01, AC-02); the confirmation names the chat and its kind (AC-07); an owner can delete a fresh post (AC-15).
  - Cross-tenant: submitting a post or destination id of another workspace is refused with no hint (AC-04); a code works only for the workspace and bot that issued it, so another workspace's code cannot connect a chat through this workspace's bot.
  - Context drift between scheduling and sending: a changed scheduled post returns to draft, and a departed owner's posts do not go out (AC-11).
  - Hijacked owner session: at most 30 posts per day and 100 scheduled (AC-16); every publish, schedule and delete records the owner.
  - Markup injection through the text or a chat's name: sent and shown as plain text everywhere.
  - Leak of unpublished text: post text and chat names never appear in logs, live frames or job payloads (as broadcasts).
- **Security review:** Required — a new owner-only capability that speaks publicly for the business, a new inbound path from chats the bot is added to, and a timed action that runs on an owner's earlier authority.

## 7. Metrics / KPIs

- *Active pilot workspace* as in CONTEXT.md.
- **Pilot workspaces posting** — baseline: 0 (new), target: ≥ 30 % of active pilot workspaces connect a destination and publish at least one post within 30 days of release.
- **Scheduled posts on time** — baseline: 0 (new), target: ≥ 99 % of scheduled posts accepted by Telegram within 60 s of their time, over the first 30 days, excluding posts failed for a reason in the chat (rights, chat gone).
- **Failed or missed share** — baseline: 0 (new), target: ≤ 3 % of posts that were due end failed or missed over 30 days; alert to the tg-inbox team's monitoring above 10 % in a day.
- **Duplicates and wrong chats** — baseline: 0 (new), target: 0 posts sent twice and 0 support reports of a post in a chat the business did not connect, over 30 days.
- **Support unaffected** — baseline: the p95 reply delivery and capture times of the 30 days before release; target: within 1 s of baseline over 30 days.

## 8. Open questions

- [ ] **OQ-1** Should posts carry photos (and later video or files)? Every scheduler researched supports them. Default now: plain text only. — owner: Dmytro Hopko, due: after the first 30 days of pilot posting
- [ ] **OQ-2** Should a business owner be able to edit a published post in place instead of deleting and posting again? Default now: no; delete within 48 hours. — owner: Dmytro Hopko, due: after the first 30 days of pilot posting
- [ ] **OQ-3** Should a failed or missed scheduled post also reach the scheduling owner through their Telegram link, not only the panel? Default now: panel only (marker and navigation count). — owner: Dmytro Hopko, due: after the first 30 days of pilot posting, or earlier if the §7 failed-share alert fires

## Clarify log (2026-11-03)

20 findings were merged from the self-sweep (5) and the clean-context devil's-advocate (15); none overlapped exactly. All 20 are resolved in place (§1 Clarifications and the AC named); none is deferred. OQ-1…OQ-3 stay open with their owner and due date.

- conflicting-requirement · AC-16, §1 Limits · resolved: does the daily limit block scheduling → no; it counts sends and is checked at publish now and when a post goes out; scheduling checks only the 100 waiting.
- conflicting-requirement · §1, AC-12 · resolved: catch-up after an outage → posts inside their 15-minute window still go out, in order, paced per chat and per bot; the rest are missed.
- under-specified-AC · AC-07 · resolved: publish now during a send pause → waits up to 15 minutes from the confirmation, then missed.
- under-specified-AC · AC-12 · resolved: a per-chat limit past the window → missed with that reason.
- under-specified-AC · §1 · resolved: changing the workspace time zone → scheduled posts keep their moment, shown in the new zone, after a confirmation naming how many.
- under-specified-AC · AC-13 · resolved: who clears the attention count → shared; counts failed, missed and not confirmed.
- under-specified-AC · AC-14 · resolved: not working versus replaced → all refused vs only the old bot's destinations, with distinct failure reasons.
- under-specified-AC · AC-13, §1 · resolved: what makes a destination unavailable → Telegram's rights / membership notices and a refused send, both ways, live; publishing to it refused upfront (AC-10 too).
- under-specified-AC · AC-01, AC-14 · resolved: reconnecting a known chat → revives the same destination and slot.
- under-specified-AC · §6 · resolved: when the 15 minutes are measured → the moment the send to Telegram starts.
- under-specified-AC · AC-07 · resolved: what a duplicate copies → text, destination, sound option; the duplicator is the author.
- under-specified-AC · AC-10 · resolved: the 2-minute / 90-day range → checked at confirmation.
- under-specified-AC · §1 (self) · resolved: removing a destination with scheduled posts → they return to drafts after a confirmation naming how many.
- unstated-assumption · AC-01 · resolved: can a non-admin bot receive the code in a group → the code is a command addressed to the bot; groups need no admin bot.
- unstated-assumption · AC-17 · resolved: per-chat versus bot-wide limit → a rate-limit answer to a post delays only that chat's posts and sets no send pause.
- unstated-assumption · §1 · resolved: time zone not yet set → the first owner who schedules confirms it for the workspace.
- vague-term · §1 · resolved: "someone who can post there" → anyone able to post in the chat who has the code.
- vague-term · AC-05 · resolved: the preview → plain text with line breaks, no link card.
- vague-term · §1 (self) · resolved: the Posts page → one list, most recently changed first, filters by state.
- vague-term · §1 (self) · resolved: the destination's name → follows renames Telegram tells the bot about.
