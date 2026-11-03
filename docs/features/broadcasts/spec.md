---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-23"
feature_size: "L"
---

# Spec — broadcasts

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** `docs/roadmap.md` (step 8, § Decisions so far, § Out of scope), `docs/idea-brief.md` §2, §5 and §7, `docs/architecture-map.md` (Telegram limits, one-process note), and the shipped features this one builds on: `docs/features/contacts/spec.md` (Contacts search and tag filter, tag rules, OQ-1 and OQ-2), `docs/features/bot-connection/spec.md` (§3: tracking who blocked the bot was left to this step), `docs/features/shared-inbox/spec.md` (replies, delivery state, "the customer blocked the bot", at-most-once sending), `docs/features/operator-notifications/spec.md` (send pause, pings).

## 1. Context

Pilot workspaces now hold a tagged contact base: every customer who wrote to the business bot is a contact, and the team tags contacts while answering (contacts, roadmap step 7). The base was pitched to pilots as "your broadcast base in the making" (idea brief §7), and broadcasts are "the main reason to pay" that v1 lacked (idea brief §6). Today a business owner who wants to tell their customers about a new price list, a holiday schedule or an offer has no way to do it from tg-inbox: they would have to copy contacts out by hand, which the panel deliberately does not allow, or message each customer one by one from the inbox.

Why now: tags shipped (step 7), so a segment exists and its size is visible. The roadmap orders broadcasts next (wave 6) and the platform MCP server waits for them (step 11). The owner settled the shape on 2026-10-23 (roadmap § Decisions so far): both audience kinds in one step, a draft until launch, a frozen recipient list after it, a delivery report, duplication instead of saved groups, the Telegram rate limit and tracking who blocked the bot.

**Committed approach.** Broadcasts get their own page in the panel. Any member drafts a broadcast: an internal name, the plain text, and one audience — either a **tag audience** (the Contacts tag filter's "any of", "all of" or "no tags", plus tags to leave out, which closes contacts OQ-1) or a **broadcast group** that members fill from the Contacts search and filter, one contact at a time or all matching at once, and trim. A draft always shows how many contacts it would reach and how many of them cannot be reached. Only a **business owner launches**, from a confirmation that shows the exact text and the final number. Launch freezes the recipient list, and the broadcast goes sending → sent (or stopped, if a business owner stops it while it sends) and is read-only apart from its live delivery report (delivered, failed with a reason, blocked the bot). The bot learns who blocked it from Telegram and from refused sends, and those contacts are left out. Sending is paced below the bot's limit and always gives way to replies. Each delivered broadcast shows in the recipient's conversation, so an answer to it makes sense in the inbox. Grounding: the products the research found either re-evaluate a dynamic segment at send time or keep a hand list, and none documents a blocked-the-bot outcome in its report. The one inbox product (respond.io) keeps drafts and lets answers land in the inbox, but documents no frozen list and no blocked outcome (researcher, 2026-10-23: respond.io, BotHelp, Sentinel). The gap tg-inbox fills is a frozen, reviewable recipient list with an honest per-recipient report inside the shared inbox. The adversarial pass named the sharpest failure: broadcasts and support share **one bot**. A broadcast that gets the bot rate-limited, or spam-reported into restriction, takes support down with it. That is why launch is owner-only, confirmed against a count and capped per day; why sending leaves room for replies and pauses at the first rate-limit answer; and why the risk of spam reports is spelled out at launch (§6.1, OQ-1). The pass also shaped these rules: a launch never sends twice, a "not confirmed" send is never repeated, a launch confirms the version it showed, group edits never overwrite each other, blocked marks belong to the current bot, and duplicating a launched broadcast can target only the recipients it did not reach.

Critic pass (2026-10-23), resolved as amendments: the reply-latency target during a broadcast is the inbox's own ≤ 2 s (§6); AC-04 states the group's starting size so its count adds up.

- Decision override: launch is owner-only, although the roadmap's step 8 row read "an operator drafts … and launches it" — rationale: the owner's decisions of 2026-10-23 do not say who launches, and the sharpest failure found (a broadcast getting the shared bot restricted, which stops support) makes a launch a business-level decision; the roadmap row is reworded to match, and this is the first item to veto at review.

Success means a pilot owner sends a message to a tagged part of their base, sees in the report who got it, and the team's replies on that day go out as fast as on any other day.

Sized L (the roadmap's size after the 2026-10-23 revision, confirmed here): a new capability area with its own data and screens, a new kind of sending through the bot that shares its limits with replies and pings, a change to how the bot reads Telegram updates (blocked / unblocked) and a new kind of item in the conversation thread. The route is `full` (the size-matrix default for L).

Assumptions taken in the autonomous pipeline run (2026-10-23). Each can be vetoed at review:

- **Who does what.** Any member (operator or business owner) creates, edits and duplicates drafts and sees every broadcast and report of the workspace. Only a business owner launches, because a launch messages customers on behalf of the business and cannot be undone. A draft is deleted by its author or by a business owner, after a confirmation that names its audience size.
- **Content.** The name is internal, 1–80 characters, and never sent. The text is plain text: what is typed is what the customer sees, with no formatting and no placeholders. It is 1 to 4096 characters, counted the way Telegram counts them, so the editor never accepts a text Telegram refuses for its length. Link previews are Telegram's default.
- **Tag audience.** The chosen tags work as in the Contacts filter ("any of", "all of", "no tags"; no tag chosen = every contact), and optional tags to leave out remove every contact carrying any of them. The audience is evaluated when the draft is shown and again at launch. A tag that is renamed keeps working, and a tag that is deleted or merged away drops out of the draft with a notice.
- **Broadcast group.** A group is filled from the Contacts search and tag filter (the same rules as the Contacts list). "Add all matching" adds the contacts matching at that moment, and contacts that match later are not added. A contact is in a group at most once. Additions and removals by different members are each kept, never overwritten.
- **Limits.** At most 10 000 recipients per broadcast (well above any pilot base) and at most 10 launches per workspace in any 24 hours. Pacing is at most 25 messages per second per bot for broadcasts, which leaves room under Telegram's ~30 per second for replies, pings and the bot's answers.
- **Who is left out at launch.** Contacts marked as having blocked the bot, and contacts who never wrote to the currently connected bot (after a workspace changes its bot), are left out at launch and counted apart. A Telegram account that no longer exists shows as failed with that reason, not as blocked.
- **A business owner can stop a sending broadcast** (OQ-2, decided at clarify). Stopping is the brake for a launch that turns out wrong (a typo, the wrong audience) and for a broadcast drawing blocks; at the pace of §6 a 10 000-recipient broadcast runs for about seven minutes, long enough to need one. A stop is final: the recipients still waiting are never sent it, and the broadcast ends as "stopped" (AC-18).
- **Answers to a broadcast are ordinary customer messages.** They are captured into the customer's conversation, reopen it if closed and count for unread and pings as any message does (OQ-3 revisits this with pilot data). The broadcast itself shows in each recipient's thread as its own kind of item, with the broadcast name and the business owner who launched it. It is not a reply: it never changes the conversation's status, assignee, "waiting for a reply" marker or anyone's read state.
- **Blocked state is visible** on the contact's profile and as a marker on the Contacts list row, so the team sees it outside broadcasts too.

Clarifications (clarify, autonomous run 2026-10-23). Each one picks the most sensible reading of a point where two builders could have diverged. Any of them can be vetoed at review:

- **The bot is the Telegram bot, not the connection.** "The current bot" is the Telegram bot connected now. Reconnecting the same Telegram bot (for example after a revoked token is replaced) keeps its blocked marks and who wrote to it. Only connecting a different Telegram bot resets both. A contact "wrote to the current bot" when at least one of their messages was received through that bot, so tg-inbox keeps, per contact, which bot they wrote through (AC-10, AC-14).
- **The draft and the confirmation count the same way.** Both show the audience size, then how many are left out because they blocked the bot and how many because they never wrote to the current bot, then the number it would reach (AC-01, AC-06).
- **The 10 000 limit is on the audience size.** It counts every contact a group holds or a tag audience matches, reachable or not. A group never holds more than 10 000, and a tag audience over 10 000 cannot be launched (AC-05).
- **Which draft edits are versioned.** The name, the text, the audience kind and a tag audience's tags are saved against the version the member saw, and a stale save is refused (AC-03). Adding contacts to a group and removing them are separate changes that never conflict and do not count as a change to the version. Switching the audience kind drops the other kind's choice: a group with contacts is dropped only after a confirmation naming how many it holds.
- **The launch confirms exactly what it showed.** The recipient list is the set of contacts counted in the confirmation. If the text, the audience, or the set of contacts it would reach changed since the confirmation was opened (even when the number is the same), nothing is launched and the owner is shown the current version to confirm again (AC-06).
- **Each recipient is checked again at their turn.** A recipient marked as having blocked the current bot by the time their turn comes is not sent the broadcast and gets the outcome "blocked the bot". One who unblocked before their turn is sent it as usual. The recipient list itself never changes (AC-11, AC-14).
- **A send is tried once.** A rate-limit answer means nothing was sent, so that recipient waits for the pause and is tried again. Any other refusal from Telegram ends that recipient as failed with its reason, without a retry. A send that got no answer, including one in flight when the service stopped, ends as "not confirmed" and is never sent again automatically (AC-11).
- **Broadcasts respect the bot's send pause.** After any rate-limit answer, from a broadcast, a reply, a ping or the bot's own answer, broadcasts wait for the bot's send pause, as pings do. Replies never wait for it (AC-15).
- **Pace and sharing.** The 25 messages per second is a fixed ceiling for all of a bot's broadcasts together. Replies are not counted against it and never wait for it. When two broadcasts of a workspace send at the same time, they take turns, so neither waits for the other to finish. The completion targets in §6 are for a broadcast sending alone (AC-15).
- **The launch cap counts every confirmed launch**, including one that was stopped or ended early (AC-12, AC-18). A refused launch does not count.
- **A draft's author** is the member who created it, by creating it or by duplicating another broadcast. The author is kept with the draft and is, besides business owners, the only member who can delete it. The list shows who last changed the draft, which may be someone else (AC-07).
- **Broadcasts list.** It shows drafts and launched broadcasts together, the most recently changed first, each with its name, status, audience size and who last changed or launched it. A broadcast's status and report update live. A draft's count is computed again when it is opened or changed.
- **Text.** Spaces and line breaks at both ends of the text are removed before it is saved, and the length is measured on what is left. That trimmed text is what the customer gets (AC-02, AC-17).
- **Drafts do not need a bot.** Drafts can be created, edited and duplicated while the bot is missing or not working. Only a launch needs a working bot (AC-10).
- **A launch outlives its launcher.** If the business owner who launched a broadcast is deactivated, sending continues, and the broadcast still names them (AC-16).
- **The thread shows a "not confirmed" broadcast too.** The recipient may have got it and may answer it. The item is marked "not confirmed" and sits at the time the send was made (AC-16).
- **Duplicates.** "Copy of …" is shortened to fit the 80-character name. "All recipients" copies every recipient of the launched broadcast. Those who have blocked the bot stay in the copy's group, counted as unreachable. "Only recipients it did not reach" is offered once the broadcast has ended. It copies recipients who failed for a reason that a new attempt can fix (the bot stopped working, Telegram refused the text, a Telegram error, or the broadcast was stopped before their turn), plus the "not confirmed" ones after a warning. It leaves out the delivered ones, the ones who blocked the bot and those whose account no longer exists (AC-13).
- **"Add all matching" adds what matches when it is confirmed.** If the matching contacts changed after the count was shown, it adds the current ones (within the limit) and says how many it added (AC-04).
- **The blocked-share alert is internal.** It goes to the tg-inbox team's monitoring, not to the workspace. It feeds OQ-1 and has no screen in the panel (§7).

## 2. Goals

- A business owner can reach a chosen part of the workspace's contact base (by tags, or a hand-picked group) with one message from the business's own bot, without leaving the panel.
- Broadcasting never gets in the way of support: replies to customers keep going out on time while a broadcast is sending, and customers who answer a broadcast land in the inbox like any other message.
- The team can trust what a broadcast did: who it was sent to is fixed at launch, nobody gets it twice, and the delivery report says, per recipient, whether it arrived, failed or could not arrive because the customer blocked the bot.

## 3. Non-goals

- **Photos, files, buttons, formatting and per-contact placeholders** — a broadcast is plain text in this step; every extra kind of content is its own preview, size and failure path, and plain text is enough for a pilot's announcement or offer.
- **Scheduling a broadcast for later** — a broadcast goes out when it is launched; scheduling is built for group and channel posts (roadmap step 10) and can be shared afterwards.
- **A saved group or segment of its own** — a group lives inside its broadcast and is reused by duplicating the broadcast (owner decision, roadmap § Decisions so far); a second list type would need its own rules for editing, sharing and deleting.
- **Paid high-throughput broadcasts** — Telegram gates them behind 100 000 monthly active users, out of reach for pilot bots (roadmap § Out of scope).
- **Editing or deleting a broadcast message after it was sent** — once launched a broadcast is read-only apart from its report (owner decision); taking back a message from thousands of chats is a separate feature.
- **Statistics beyond delivery** (opened, clicked, answered) — Telegram does not tell a bot whether a message was read; answers are visible in the inbox.

## 4. User stories

### US-01: Draft a broadcast for a tag audience

**As an** Operator
**I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
**So that** the team can prepare a message for a group of customers before anyone sends it

### US-02: Hand-pick a broadcast group

**As an** Operator
**I want** to build a draft's audience from specific contacts — one at a time from the contacts search, or all contacts matching a search and filter at once — and remove the ones that should not get it
**So that** I can reach exactly the customers I mean, even when no tag describes them

### US-03: Launch a broadcast

**As a** Business owner
**I want** to see the final number of recipients and the text one last time, then launch the broadcast
**So that** the message goes out once, to the customers I confirmed, from the workspace's bot

### US-04: Follow the delivery report

**As a** Business owner
**I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
**So that** I know how many customers it really reached and whom it did not

### US-05: Reuse an audience

**As an** Operator
**I want** to duplicate any broadcast into a new draft with the same text and audience
**So that** a follow-up goes to the same customers without picking them again

### US-06: Know who blocked the bot

**As an** Operator
**I want** to see on a contact that they have blocked the bot, and have such contacts left out of broadcasts
**So that** the team does not count on reaching customers the bot cannot reach

### US-07: Keep answering while a broadcast sends

**As an** Operator
**I want** my replies to go out without waiting behind a broadcast, and to see the broadcast in a customer's conversation when they answer it
**So that** support works as usual and I understand what the customer is answering

### US-08: Receive the broadcast once

**As an** End customer
**I want** to get the business's broadcast once, in my chat with its bot, as the text the business wrote
**So that** I read one message, not duplicates, and see nothing about other customers or the team

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
**When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
**Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer

### AC-02 (US-01) — error

**Given** an operator editing a draft broadcast of "Acme Flowers"
**When** they leave the name empty or make it longer than 80 characters, leave the text empty or only spaces, or make it longer than Telegram allows for one message
**Then** the draft keeps its last valid content, nothing is sent, and the editor says next to the field that a name must be 1 to 80 characters, or that the text must be 1 to 4096 characters as Telegram counts them; the remaining length is shown while typing, counted the way Telegram counts it, so an emoji-heavy text is never accepted by the editor and then refused by Telegram for its length

### AC-03 (US-01, US-02) — error

**Given** two members of "Acme Flowers" with the same draft open
**When** one changes the text or the audience and saves, and then the other saves a change made on the older version; or both add and remove contacts in the draft's group at the same moment
**Then** the second text or audience change is not saved over the first: that member is told that a teammate changed the draft and is shown the current version to apply their change again; group additions and removals by both members are each kept (a contact added by one and not removed by the other stays in the group), so no one's additions silently disappear, and adding or removing group contacts never makes a teammate's text or name save count as stale

### AC-04 (US-02) — happy path

**Given** an operator editing a draft "Wholesale catch-up" of "Acme Flowers" whose audience is a broadcast group already holding 1 contact
**When** they search contacts by name or username and add "Olena K.", then filter contacts by the tag "Wholesale" with the search "kyiv" and choose "add all matching" (14 contacts, one of them already in the group), then remove one contact
**Then** the search and filter work as on the Contacts list (the same matching, the same counts); "add all matching" first says how many contacts it will add and then adds the 13 not already in the group; the group shows its contacts with name, username and tags, marks the ones that blocked the bot, and says how many it holds (14) and how many it would reach; if the matching contacts changed between the count and the confirmation, the current ones are added and the editor says how many were; contacts who match the filter later are not added; removing a contact takes it out of this draft only and changes nothing on the contact; the group belongs to this draft and is not a list of its own anywhere else in the panel

### AC-05 (US-02) — domain invariant

**Given** a draft of "Acme Flowers" whose group holds 9 990 contacts
**When** an operator adds a contact who is already in the group, or chooses "add all matching" for a filter matching 50 contacts not in the group, or a tag audience would match more than 10 000 contacts
**Then** a contact already in the group is not added twice and the group says it is already there; the bulk add is refused as a whole and the editor says that a broadcast's audience can hold at most 10 000 contacts (reachable or not) and how many can still be added; a tag audience matching more than 10 000 contacts, reachable or not, can be saved as a draft but not launched, and says so; a group only ever holds contacts of its own workspace

### AC-06 (US-03) — happy path

**Given** a business owner of "Acme Flowers" with the draft "Spring prices" whose audience would reach 36 contacts, and a working bot
**When** they choose to launch it
**Then** a confirmation shows the exact text as the customer will see it, the number of contacts it will be sent to (36), how many are left out because they blocked the bot or never wrote to the current bot (2), and a warning that customers who did not expect the message can block or report the bot, which can limit the bot for support too; on confirmation the recipient list is fixed to exactly the 36 contacts counted in the confirmation, the broadcast becomes "sending" for every member, records who launched it and when, and sending starts; if between opening the confirmation and confirming it the text, the audience or the set of contacts it would reach changed (even if their number is the same), nothing is launched and the owner is shown the current version and number to confirm again; choosing launch twice, or two business owners launching the same draft at the same moment, launches it once and sends each recipient one message

### AC-07 (US-03) — authorization

**Given** an operator (not a business owner) of "Acme Flowers"
**When** they open a draft they could launch if they were an owner, or try to launch it in any other way (for example from a saved link to the confirmation), or try to delete a draft that a teammate created
**Then** the draft shows no launch action and says that only a business owner launches broadcasts; the attempt sends nothing and changes nothing; the delete is refused with the explanation that a draft is deleted by its author or a business owner; the operator can still edit, duplicate and delete their own drafts

### AC-08 (US-01, US-02, US-03, US-04, US-05) — authorization

**Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
**When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
**Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast

### AC-09 (US-03) — domain invariant

**Given** "Acme Flowers" with the broadcast "Spring prices" launched to 36 recipients, a draft whose audience reaches nobody, and 10 broadcasts launched in the last 24 hours
**When** a member tries to change the text, name or audience of "Spring prices", add or remove a recipient, or delete it; or teammates retag contacts, new customers write in, or a recipient unblocks the bot after the launch; or an owner tries to launch the empty draft or an 11th broadcast within 24 hours
**Then** a launched broadcast cannot be changed or deleted — the page says it is read-only and offers to duplicate it — and its recipient list stays the 36 contacts fixed at launch whatever happens to tags and contacts afterwards; a draft that would reach nobody cannot be launched and says that its audience has no reachable contact; the 11th launch is refused and the owner is told that a workspace can launch at most 10 broadcasts in 24 hours and when the next launch is possible; every confirmed launch counts toward the 10, including one that was stopped or ended early, and a refused launch does not; drafts can still be created and edited

### AC-10 (US-03) — cross-context

**Given** a business owner of "Acme Flowers" about to launch a draft
**When** the workspace has no bot connected, or its bot is not working (the token was revoked), or the workspace connected a different bot since some of the audience last wrote
**Then** with no bot or a bot that is not working, launch is refused, the draft stays a draft, and the owner is told why and offered the way to the bot settings; contacts who have never written to the bot connected now cannot be reached by it, so they are left out at launch and counted apart in the draft and the confirmation ("never wrote to the current bot"), and blocked marks learned with the old bot do not apply to the new one; reconnecting the same Telegram bot is not a change of bot, so its blocked marks and who wrote to it stay; drafts can be created, edited and duplicated while the bot is missing or not working

### AC-11 (US-04) — happy path

**Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
**When** a business owner or an operator opens it while it sends and after it ends
**Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically

### AC-12 (US-04) — error

**Given** the broadcast "Spring prices" of "Acme Flowers" while it is sending
**When** Telegram refuses the text itself, or the bot stops working (its token is revoked) or is disconnected or replaced by another bot
**Then** sending ends at once: every recipient still waiting is marked failed with the plain reason ("Telegram refused the text" or "the bot stopped working"), the broadcast becomes "sent" with the report showing who got it before that, and nothing of it is sent later when the bot works again or by a newly connected bot; the owner can duplicate it, fix the text or the bot, and launch the copy to the recipients it did not reach (AC-13)

### AC-13 (US-05) — happy path

**Given** "Acme Flowers" with a draft "Wholesale catch-up" (a group of 14 contacts) and the sent broadcast "Spring prices" (tag audience; 33 delivered, 1 blocked the bot, 2 failed because the bot stopped working)
**When** an operator duplicates the draft, and duplicates "Spring prices" choosing first "all recipients" and then "only recipients it did not reach"
**Then** each duplicate is a new draft named "Copy of …" (shortened to fit 80 characters) with the same text, listed for every member, its author being the member who duplicated it, and the original is unchanged; the copy of the draft has the same group of 14 contacts; the copy of "Spring prices" with "all recipients" has a broadcast group of its 36 recipients, the one who blocked the bot counted as unreachable; "only recipients it did not reach" is offered once a broadcast has ended, and gives a group of the 2 who failed: it copies recipients who failed for a reason a new attempt can fix (the bot stopped working, Telegram refused the text, a Telegram error, stopped before their turn) and those marked "not confirmed" only after a warning that they may have received it, while recipients who were delivered, who blocked the bot or whose account no longer exists are not copied; a tag audience can also be duplicated as the same tags, evaluated again at the copy's launch; the copy is then edited and launched like any draft

### AC-14 (US-06) — cross-context

**Given** a contact "Olena K." of "Acme Flowers"
**When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
**Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient

### AC-15 (US-07) — cross-context

**Given** "Acme Flowers" launches a broadcast to 3 000 contacts while operators keep answering customers, and another broadcast of the workspace is already sending
**When** operators send replies during the broadcast, and Telegram answers the bot with a rate limit
**Then** replies go out without waiting for the broadcasts to finish — a reply sent during a broadcast reaches the customer as fast as on a quiet day (§6); the bot's broadcast sending together stays below Telegram's per-bot limit with room left for replies, pings and the bot's own answers; two broadcasts sending at the same time take turns, so neither waits for the other to finish; on a rate-limit answer to any of the bot's sends the broadcasts pause for the time Telegram asked (the bot's send pause, as for pings) and then continue where they stopped, without skipping or doubling any recipient, while replies keep going as before; a broadcast of one workspace never slows the replies, pings or broadcasts of another workspace

### AC-16 (US-07) — cross-context

**Given** "Olena K.", whose conversation is closed, unassigned and not waiting for a reply, received the broadcast "Spring prices"
**When** an operator opens her conversation in the inbox, and then she answers the broadcast in Telegram
**Then** the thread shows the broadcast at the time it was delivered as a broadcast item — its text, its name and the business owner who launched it (still named if that owner was deactivated since) — distinct from the team's replies; a recipient whose send ended "not confirmed" also gets the item, marked "not confirmed" and placed at the time the send was made; receiving it did not reopen the conversation, did not change its assignee, its "waiting for a reply" marker, any unread or attention count, and triggered no ping; her answer is captured as a customer message as before: it reopens the conversation and counts for unread, "waiting for a reply" and pings like any message; a recipient whose broadcast failed for any other reason, was stopped before their turn, or who was left out gets no broadcast item

### AC-17 (US-08) — happy path

**Given** an end customer who wrote to the bot of "Acme Flowers" and is a recipient of "Spring prices"
**When** the broadcast is sent
**Then** they receive exactly one message from the business bot in their private chat with it, with the text exactly as the owner confirmed it (spaces and line breaks at its ends were removed when it was saved), shown as plain text (nothing in it is turned into formatting); the message names no member and shows nothing about other recipients, the audience or the workspace's tags

### AC-18 (US-04) — error

**Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
**When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
**Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Broadcast pace per bot | ≤ 25 messages per second for all of a bot's broadcasts together, over any 1 s window | send timing log per bot; integration test against the fake Telegram counting sends per second |
| Broadcast completion | 1 000 recipients, no rate-limit answers → every recipient has an outcome within 90 s of launch; 10 000 within 10 minutes | launch-to-finish timing log; seeded integration test with 1 000 recipients |
| Reply latency during a broadcast | p95 reply send → Telegram accepted ≤ 2 s while a 10 000-recipient broadcast is sending (the same target as on a quiet day, shared-inbox §6) | reply delivery timing log, compared between broadcast and non-broadcast windows; integration test with a broadcast and replies interleaved |
| Cross-workspace isolation of load | p95 reply and ping latency of other workspaces unchanged (± 1 s) while one workspace sends 10 000 | reply and ping timing logs per workspace |
| At most once per recipient | 0 recipients sent the same broadcast twice, including after a restart mid-send or a double launch | integration test: concurrent launch, restart mid-send, unanswered send; integrity query in the run book |
| Frozen recipients | 0 changes to a launched broadcast's text or recipient list | integration test per edit path; integrity query |
| Draft audience count p95 — tag audience or group, workspace with 10 000 contacts | ≤ 500 ms server time (as the Contacts list, contacts §6) | request timing log; seeded integration test |
| Launch p95 — freezing 10 000 recipients | ≤ 2 s server time from confirm to "sending" | request timing log; seeded integration test |
| Report live update p95 — outcome recorded → shown in an open report | ≤ 3 s (as shared-inbox §6) | server-side timing from change to push |
| Blocked state freshness p95 — Telegram's block or unblock notice received → contact marked or unmarked | ≤ 5 s | update handling timing log; integration test with the fake Telegram |
| Launch cap | ≤ 10 launches per workspace per rolling 24 h (AC-09) | integration test: the 11th launch is refused |
| Stop takes effect | 0 sends of a broadcast started more than 2 s after its stop was confirmed (AC-18) | send timing log against the stop time; integration test stopping mid-send against the fake Telegram |
| Availability | 99.5 % monthly (as shared-inbox §6) | uptime check on the health endpoint |

## 6.1 Security / privacy

- **Data classification:** confidential — broadcasts describe how a business addresses its customers, and the report lists identifiable customers and what reached them.
- **Personal data touched:** new — per contact, whether they blocked the business bot and since when (learned from Telegram, about end customers); per broadcast, its recipients and each one's outcome and time, and which member created, edited and launched it. The broadcast text is business-written. No new data is collected from end customers.
- **AuthZ/AuthN impact:** seeing broadcasts and reports, and creating, editing and duplicating drafts, require an active membership of the workspace with either role. Deleting a draft requires being its author or a business owner. Launching and stopping require the business owner role and are re-checked at the moment of the action. Every read and write is scoped to the caller's workspace. Adding a contact to a group checks that the contact belongs to the same workspace, and sending goes only through that workspace's own bot.
- **Abuse cases:**
  - **The sharpest one: the shared bot gets restricted.** A launch to a cold or broad audience draws blocks and spam reports, Telegram limits the bot, and support stops with it. The response: only a business owner launches, after a confirmation that states the count and warns about this risk (AC-06); at most 10 launches per workspace per 24 hours (AC-09); pacing below the bot's limit with room for replies, pausing on a rate-limit answer (AC-15); a business owner can stop a broadcast that is going wrong (AC-18); the blocked rate per broadcast is a KPI with an alert (§7). Whether audiences must be limited to recently active or opted-in contacts is OQ-1.
  - Cross-tenant reach: submitting a contact or broadcast id of another workspace, or probing ids, is refused with no hint they exist; a group holds only its own workspace's contacts, and one workspace's bot never sends another's broadcast (AC-08).
  - Duplicate or replayed launch (double click, two owners, a retried request): the broadcast is launched once and each recipient gets at most one message (AC-06, AC-11).
  - A departing or compromised operator: cannot launch (AC-07) or stop a broadcast (AC-18); can delete only their own drafts; every launch records the owner who did it.
  - Markup injection through the broadcast text or contact names: the text is sent and shown as plain text; names are shown as plain text everywhere.
  - Flooding drafts or groups: at most 10 000 contacts per broadcast (AC-05); launches are capped per day.
- **Security review:** Required — a new owner-only capability that messages customers in bulk on behalf of the business, new personal data (blocked state, recipient outcomes) and a new cross-entity link (groups of contacts) that must stay inside one workspace.

## 7. Metrics / KPIs

- *Active pilot workspace* as in CONTEXT.md (a customer wrote and a member replied in the last 30 days).
- **Pilot workspaces broadcasting** — baseline: 0 (new), target: ≥ 50 % of active pilot workspaces launch at least one broadcast within 30 days of release.
- **Reach of a broadcast** — baseline: 0 (new), target: ≥ 95 % of recipients delivered, per broadcast, counting failures for every reason except "blocked the bot", over the first 30 days.
- **Blocked share after a broadcast** — baseline: measured from release (blocked marks did not exist before); target: tracked; alert when more than 5 % of a broadcast's delivered recipients block the bot within 48 hours of it, a sign the audience was too broad (feeds OQ-1). The alert goes to the tg-inbox team's monitoring only; the workspace sees no alert in the panel.
- **Support unaffected** — baseline: the p95 reply delivery time of the 30 days before release; target: p95 reply delivery time in the hour after a launch is no more than 1 s above the baseline, and 0 replies "not delivered" because of a rate limit during a broadcast, over 30 days.
- **Duplicates sent** — baseline: 0 (new), target: 0 recipients who got the same broadcast twice, over 30 days (integrity query).

## 8. Open questions

- [ ] **OQ-1** Should a broadcast reach only contacts who wrote recently (for example within 90 days) or who opted in, to keep the bot from being reported as spam? Default now: any contact of the audience who has not blocked the bot is reached; the confirmation warns about the risk and the blocked share is watched (§7). — owner: Dmytro Hopko, due: after the first 30 days of pilot broadcasts, or earlier if the §7 alert fires
- [x] **OQ-2** Should a business owner be able to stop a broadcast while it is sending? **Resolved at clarify (2026-10-23):** yes — a business owner stops it; the recipients still waiting are never sent it and the broadcast ends as "stopped" (§1, AC-18). Default was: no stop. — owner: Dmytro Hopko, due: before `sdd:design` of broadcasts
- [ ] **OQ-3** Should answers to a broadcast count toward pings and reopen conversations like any customer message, or be grouped so that a broadcast's answers do not flood the inbox and the team's pings? Default now: they count like any message (AC-16). — owner: Dmytro Hopko, due: after the first 30 days of pilot broadcasts
- [ ] **OQ-4** How does a workspace remove a contact (a test message from a teammate, spam, or a customer's erasure request), now that contacts can be messaged in bulk? Default now: no in-product deletion; the tg-inbox team handles erasure by hand on request (carried over from contacts OQ-2, which was due before this step ships). — owner: Dmytro Hopko, due: before roadmap step 8 ships

## Clarify log (2026-10-23)

22 findings were merged from the self-sweep (14) and the clean-context devil's-advocate (12); 4 overlapped. All 22 are resolved and none is deferred. OQ-2 (stop button) is resolved. OQ-1, OQ-3 and OQ-4 stay open: each already has an owner and a due date tied to pilot data or to shipping, not to this sweep.

- conflicting-requirement · AC-13 · resolved: does "all recipients" copy those who blocked the bot → yes, they stay in the group counted as unreachable; the "did not reach" copy takes only failures a new attempt can fix (+ "not confirmed" after a warning), never delivered, blocked or deleted accounts; the example's 2 failures are now "the bot stopped working".
- conflicting-requirement · AC-11, AC-14 · resolved: a block or unblock while a recipient waits → the recipient list never changes; the mark at their turn decides whether they are sent it.
- under-specified-AC · OQ-2, §1, AC-18 (new) · resolved: no stop → a business owner can stop a sending broadcast; waiting recipients become "not sent — stopped", the broadcast ends "stopped"; operators cannot stop; a late stop changes nothing; §6 "stop takes effect" row added.
- under-specified-AC · AC-06 · resolved: what "changed" means for the launch check → the exact set of contacts counted, not just their number.
- under-specified-AC · AC-05, §1 · resolved: what counts toward 10 000 → the audience size, reachable or not, for both the group and a tag audience.
- under-specified-AC · AC-03 · resolved: are group edits versioned → no; name, text, audience kind and tags are; switching kind drops the other kind's choice after a confirmation.
- under-specified-AC · AC-15, §6 · resolved: sharing the pace → 25/s is a fixed ceiling for all of a bot's broadcasts; replies are not counted and never wait; concurrent broadcasts take turns; §6 completion targets are for one broadcast alone.
- under-specified-AC · AC-15 · resolved: rate-limit answers to replies or pings → broadcasts wait for the bot's send pause, as pings do (CONTEXT "Send pause" updated).
- under-specified-AC · AC-01, AC-10 · resolved: what the draft count shows → the same breakdown as the confirmation (blocked, never wrote to the current bot, would reach).
- under-specified-AC · AC-16 · resolved: a "not confirmed" send in the thread → shown, marked "not confirmed", at the time of the send.
- under-specified-AC · AC-09 · resolved: what counts toward the daily cap → every confirmed launch, including stopped or ended early; a refused launch does not count.
- under-specified-AC · AC-11 · resolved: Telegram errors other than rate limits and blocks → that recipient fails with the reason and is not tried again; a send in flight at a restart ends "not confirmed".
- under-specified-AC · AC-04 · resolved: "add all matching" when the matches changed after the count → adds the current matches and says how many.
- unstated-assumption · AC-10, §1 · resolved: what a "different bot" is → a different Telegram bot; reconnecting the same one keeps marks and who wrote to it; who wrote through which bot is kept per contact.
- unstated-assumption · AC-10 · resolved: drafts without a working bot → can be created, edited and duplicated; only a launch needs the bot.
- unstated-assumption · AC-16 · resolved: launcher deactivated mid-send → sending continues and the item still names them.
- undefined-term · §1, AC-07, §6.1 · resolved: "author" of a draft → the member who created it, by creating or duplicating; added to CONTEXT.md as "Draft author".
- missing-actor · §7 · resolved: who gets the blocked-share alert → the tg-inbox team's monitoring only, with no panel surface.
- vague-term · §1, AC-02, AC-17 · resolved: text with spaces at the ends → trimmed before saving; length measured on the trimmed text.
- vague-term · AC-01, §1 · resolved: the Broadcasts list → drafts and launched together, most recently changed first; status and report live, draft counts recomputed on open or change.
- vague-term · AC-13 · resolved: "Copy of …" past 80 characters → shortened to fit.
- vague-term · AC-13 · resolved: when "only recipients it did not reach" is offered → once the broadcast has ended.
