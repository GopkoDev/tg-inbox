---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
---

# Spec — assignment-statuses

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** `docs/roadmap.md` (step 5), `docs/idea-brief.md` §2, `docs/architecture-map.md`, and the shipped inbox it extends — `docs/features/shared-inbox/spec.md` (list, thread, unread, "waiting for a reply", live updates, the teammate-collision warning AC-16).

## 1. Context

A workspace's whole team now answers customers from one shared inbox, but nothing in it says **who is handling a customer** or **whether a conversation is done**. Every conversation stays in one list forever; the only marker is "waiting for a reply". With three or more operators — the segment the product targets (idea-brief §3) — two members pick up the same customer, or each assumes the other did, and finished conversations bury the ones that still need work. The brief names "no assignment, no open/closed status" as part of the very pain free forwarder bots leave behind (idea-brief §2).

Why now: the inbox shipped (roadmap step 4) and pilots with several operators start on it; ownership and a done-state are the next thing a team needs to work the list without stepping on each other, and they are what the following steps build on — notifications (step 6) are sent to a conversation's assignee.

**Committed approach.** A deliberately small, predictable model: every conversation is **open or closed** and has **at most one assignee** (or none). The list gets two lenses — status (open by default, or closed) and assignee (all / mine / unassigned). A customer's new message always **reopens** a closed conversation and returns it to the same assignee if they are still an active member, otherwise to unassigned — an explicit rule, where comparable products leave reopen ownership to settings or workarounds (researcher, 2026-10-18: Front, Chatwoot, a Telegram-focused forum thread). Closing is guarded against the sharpest failure found by the adversarial pass — **a customer silently lost in a closed conversation** (a message the closer had not seen, a reply that later fails): the inbox asks before closing over a waiting or unseen customer message, and a reply that ends "not delivered" or "not confirmed" reopens the conversation. Every change is recorded in the thread and shown to the team live; there are no extra statuses (snoozed, pending), no automatic routing and no notifications in this step.

Sized M, not the roadmap's first-guess S: it adds a schema change and new member actions across the inbox, conversations and workspaces (deactivation) contexts.

Assumptions taken in the autonomous pipeline run (2026-10-18) — each can be vetoed at review:

- Business owners and operators have identical rights over assignment and status, as for everything else in the inbox (shared-inbox AC-01).
- A member's reply never changes a conversation's status or assignee (OQ-1 tracks auto-assign on reply).
- An edit of an earlier customer message does not reopen a closed conversation (edits never move a conversation — shared-inbox AC-01); only a newly arrived customer message does.
- The default list is open conversations of all assignees; search looks across both statuses within the chosen assignee lens.

## 2. Goals

- Every open conversation has a visible owner or is visibly unowned, so the team knows at a glance who handles whom.
- Finished conversations leave the working list without ever hiding a customer who still needs an answer.
- Two members never take or close the same conversation by accident.

## 3. Non-goals

- **More statuses (snoozed, pending, on hold)** — open/closed plus the existing "waiting for a reply" marker covers small teams; extra states are what makes comparable products hard to predict.
- **Automatic assignment (round robin, on first reply, by load)** — needs real pilot data on how teams split work; OQ-1 tracks the simplest variant.
- **Notifying an assignee** — that is roadmap step 6 (operator notifications); this step only records the assignee.
- **Counters on the list lenses** (for example "mine · 4") — counts kept in step with live changes across tabs are a reliability risk for little value at pilot size; each row already shows its unread count.
- **Unassigning conversations of a member who is merely absent** (not deactivated) — needs an availability notion that does not exist yet; the list shows every assignee, so teammates can reassign by hand.
- **Muting a flooding sender** — answers shared-inbox §8 ("revisit with statuses"): still deferred; closing cannot hide a flood, because every new customer message reopens (AC-07), so a flood stays visible rather than silently lost; OQ-2 revisits it with pilot data.
- **Bulk actions** (close or assign many at once) — also the main abuse vector found; pilots work conversation by conversation.

## 4. User stories

### US-01: See who handles what

**As an** Operator
**I want** the list to show each conversation's assignee and let me switch between all, mine and unassigned conversations
**So that** I pick up only what nobody handles or what is mine

### US-02: Take or hand over a conversation

**As an** Operator
**I want** to assign a conversation to myself or a teammate, or unassign it
**So that** the team knows who answers this customer

### US-03: Close a finished conversation

**As an** Operator
**I want** to close a conversation when the customer needs nothing more, and see closed ones when I look for them
**So that** the working list holds only what still needs work

### US-04: A returning customer is never lost

**As an** End customer
**I want** my new message to a business to reach the team even if they had closed our conversation
**So that** I get an answer whenever I write again

### US-05: Know what happened to a conversation

**As an** Operator
**I want** the thread to show who assigned, unassigned, closed or reopened the conversation and when
**So that** I understand its history before I act

### US-06: Ownership follows the team

**As a** Business owner
**I want** a deactivated member's conversations to return to the team automatically
**So that** no customer waits on someone who no longer works here

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** an operator of "Acme Flowers" whose workspace has 30 conversations — some assigned to them, some to a teammate, some unassigned, some closed
**When** they open the inbox
**Then** the list shows the open conversations of every assignee, newest activity first as before, each row showing its assignee's name (or "unassigned") and keeping its last message and time — an assignee or status change never becomes a row's preview or time; choosing "mine" shows only open conversations assigned to them, "unassigned" only open conversations with no assignee, and "closed" the closed conversations in the chosen assignee lens, also newest activity first; while searching, the status lens is set aside and matches of both statuses are shown within the chosen assignee lens, each closed row marked "closed"; when a lens holds nothing the inbox says so; the chosen lenses are part of the page's address, so a reload, the back button or a saved link opens the same lenses, and switching to another workspace starts again at open · all; a business owner sees and does the same

### AC-02 (US-02) — happy path

**Given** an operator with a conversation of "Acme Flowers" open in its thread (assignee, status and their changes are made from the thread; list rows only show them)
**When** they assign it to themselves or to a teammate who is an active member of "Acme Flowers", reassign it from one member to another, or unassign it
**Then** the conversation shows the new assignee in its header and in the list for the whole team without reloading (within the live-update target of §6), it moves between the "mine" and "unassigned" lenses accordingly, the thread records one line — "<member> assigned this to <assignee>", "<member> reassigned this from <previous> to <assignee>" or "<member> unassigned this" — with the time, and the conversation keeps its place in the activity order (assigning does not count as activity); a closed conversation can be assigned or unassigned too and stays closed; a teammate reading the thread while it drops out of their current lens keeps it open with the new assignee shown, and only its row leaves their list; choosing the assignee it already has changes nothing and records nothing; assignment, closing and reopening work in every state of the bot

### AC-03 (US-02) — domain invariant

**Given** an operator of "Acme Flowers" looking at a conversation with the assignee and status they last saw
**When** its assignee or status has changed since then — by a teammate or automatically (reopened by the customer, unassigned by a deactivation) — and the operator now assigns, reassigns, unassigns, closes or reopens it; including when two members act at the same moment, where one change is recorded first and the other member counts as having seen the old state
**Then** nothing changes yet: the inbox shows the current assignee and status, who changed them and how long ago, and asks whether to go ahead (take it over, close anyway…) or leave it; the change happens only if the operator confirms; when the conversation is already in the state the operator asked for, nothing changes, no line is recorded and the inbox simply shows it — a conversation has at most one assignee, and two members never take or close one conversation by accident

### AC-04 (US-02) — error

**Given** an operator of "Acme Flowers" choosing an assignee for a conversation
**When** the person they pick is no longer an active member of "Acme Flowers" (deactivated a moment ago), or belongs to another workspace
**Then** nothing changes, the inbox says that a conversation can be assigned only to an active member of this workspace, and the list of members to choose from shows only active members of "Acme Flowers"

### AC-05 (US-03) — happy path

**Given** an operator in an open conversation of "Acme Flowers" whose customer is not waiting for a reply and who has read every customer message in it (none arrived after their arrival watermark)
**When** they close it
**Then** the conversation leaves the open lenses for the whole team without reloading and appears under "closed", keeping its assignee; the thread records "<member> closed this" with the time; closing does not count as activity and does not change anyone's unread count; the conversation can be opened again from the thread ("reopen") by any member, which records "<member> reopened this" and returns it to the open lenses with the same assignee

### AC-06 (US-03) — domain invariant

**Given** an operator of "Acme Flowers" about to close a conversation
**When** its customer is still waiting for a reply, or a customer message arrived after the operator's own arrival watermark (they have not read it — a thread in a background tab marks nothing read)
**Then** before closing the inbox shows why — the customer is waiting for a reply, the newest message the operator has not read, or the conversation's latest reply was "not delivered" / "not confirmed" — and asks whether to close anyway or keep it open; the conversation is closed only if the operator confirms; the condition is checked again at the moment the close is recorded, so a customer message recorded between the question and the close asks again — a customer is never put out of sight by a close made over a message the closer had not read; a customer message recorded after the close reopens it (AC-07)

### AC-07 (US-04) — cross-context

**Given** a closed conversation of "Acme Flowers" assigned to an operator
**When** its end customer sends a new message to the business bot
**Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with the same assignee (an assignee is always an active member — AC-10), the thread records "reopened — the customer wrote" with the time, and the message counts as unread and as waiting for a reply exactly as for an open conversation; this holds for a customer message that arrives late and takes an earlier place in the history (a late redelivery) — it reopens by its arrival, the message keeps its earlier place, and the "reopened" line sits at the time it arrived; an edit of an earlier message does not reopen

### AC-08 (US-04) — cross-context

**Given** a closed conversation of "Acme Flowers" holding a reply that is still sending (the conversation was closed right after the reply was sent)
**When** that reply ends "not delivered" or "not confirmed"
**Then** the conversation opens again and returns to the open lenses for the whole team without reloading, with its assignee, and the thread records "reopened — a reply was not delivered" with the time, so the team sees it and can try again; closing a conversation whose latest reply is already "not delivered" or "not confirmed" asks first (AC-06) — the "waiting for a reply" marker itself keeps its meaning (the customer wrote after the last reply marked sent)

### AC-09 (US-05) — happy path

**Given** a conversation of "Acme Flowers" that has been assigned, reassigned, unassigned, closed and reopened
**When** any member opens its thread
**Then** each change appears in the thread at the time it happened (its position time), among the messages and replies, as a short line naming the member who made it (or "the customer wrote" / "a reply was not delivered" / "the assignee was deactivated" for automatic changes) and the time; these lines are never sent to the end customer, do not count as unread, and appear live in a thread open in another member's tab

### AC-10 (US-06) — cross-context

**Given** an operator of "Acme Flowers" who is the assignee of open and closed conversations
**When** a business owner deactivates their membership
**Then** every conversation of "Acme Flowers" assigned to them, open and closed, becomes unassigned as part of the deactivation itself — there is no moment when a deactivated member is anyone's assignee, and an assignment to them made at the same moment is either refused (AC-04) or, if it was recorded first, undone by the deactivation itself with its own activity line — open ones appear under "unassigned" for the team without reloading, and each thread records "unassigned — <member> was deactivated"; conversations of another workspace the same account belongs to keep that assignee; reactivating the member later does not give the conversations back

### AC-11 (US-02, US-03) — authorization

**Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
**When** they try to assign, unassign, close or reopen a conversation of "Acme Flowers", or to see its assignee, status or activity (for example through a saved link)
**Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace or the conversation exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first

### AC-12 (US-02, US-03) — error

**Given** an operator of "Acme Flowers" who has assigned, unassigned, closed or reopened 60 conversations within the last 60 seconds
**When** they try to make another such change
**Then** nothing changes, the inbox says that changes are limited to 60 per minute per member and when they can continue; only recorded changes count (a reassignment is one change; a refused, declined or already-in-place request is none); the limit is per workspace, so changes in another workspace of the same account are not affected; automatic changes (a customer's message, a failed reply, a deactivation) never count and are never refused

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Assign / close / reopen p95 — member action → recorded | ≤ 300 ms server time | request timing log on the change path |
| Live update p95 — change made → shown in another member's open inbox | ≤ 3 s (as shared-inbox §6) | server-side timing from change to push, logged per event; a CI integration test asserts the push |
| Reopen on customer message p95 — message captured → conversation shown open to the team | ≤ 3 s | timing from capture to push; integration test |
| Inbox list p95 — first page of any lens, workspace with 1 000 conversations | ≤ 500 ms server time (as shared-inbox §6) | request timing log; seeded integration test per lens |
| Single assignee | 0 conversations with more than one assignee or with an assignee who is not an active member | integrity check in the integration suite and a periodic reconciliation query in the run book |
| Deactivation unassign | 0 conversations assigned to a deactivated member at any moment — unassigning is part of the deactivation itself (AC-10) | integration test: deactivate during a concurrent assign → the assign is refused or undone, no assignment remains |
| Lost customers | 0 closed conversations whose latest customer message arrived after the close | integrity check: closed conversations with a later customer arrival must not exist |
| Change rate per member | ≤ 60 assignment/status changes per rolling 60 s per member per workspace (AC-12) | integration test: the 61st change within a minute is refused |
| Availability | 99.5 % monthly (as shared-inbox §6) | uptime check on the health endpoint |

## 6.1 Security / privacy

- **Data classification:** confidential — part of the private conversation record between a business and its customers.
- **Personal data touched:** new — which member is assigned to which customer conversation, and who changed assignee or status and when (attributed to the member's account). No new end-customer data.
- **AuthZ/AuthN impact:** assigning, unassigning, closing, reopening and reading assignee/status/activity require an active membership of the conversation's workspace, with either role; every change is scoped to the caller's workspace; an assignee must be an active member of that same workspace; deactivation removes the member's assignments in that workspace only.
- **Abuse cases:**
  - Mass close or reassignment by a departing or compromised member, hiding customers from the working list: limited to 60 changes per minute per member (AC-12), every change attributed in the thread (AC-09), a customer's next message always reopens (AC-07), and no bulk action exists (§3).
  - Cross-tenant assignment — assigning a conversation to an account of another workspace, or probing conversation ids: refused with no hint the conversation exists (AC-04, AC-11).
  - Former member keeps or gains ownership: deactivation unassigns at once (AC-10) and a non-active member can never be chosen (AC-04).
  - Markup injection through a member's display name shown in assignee labels and activity lines: shown as plain text, never interpreted.
- **Security review:** Required — a new member-driven state change on customer conversations and new attributed personal data.

## 7. Metrics / KPIs

- **Open conversations with an assignee** — baseline: 0 % (no assignment exists), target: ≥ 80 % of open conversations in active pilot workspaces have an assignee, as a daily snapshot at 18:00 server time, on every day of the week 30 days after release.
- **Duplicate first answers** — baseline: TBD — measured from release (share of customer messages followed, before the customer's next message and within 10 minutes, by "sent" replies from two or more different members; per workspace, rolling 7 days); target: ≤ 2 % within 30 days of release.
- **Closed conversations reopened by the customer within 24 h** — baseline: 0 (new), target: tracked from release; alert when, over a rolling 7 days, more than 30 % of a workspace's closes are followed by a customer reopen within 24 h (a sign conversations are closed too early).
- **Customer messages left without a reply** (shared-inbox §7, now counted across open and closed conversations) — target unchanged: ≤ 5 % still waiting 24 h after the customer's last message.

## 8. Open questions

- [ ] Should a member's first reply to an unassigned conversation assign it to them automatically? Default now: no — every assignment is explicit (§3). — owner: Dmytro Hopko, due: after 30 days of pilot use
- [ ] Should a customer's thank-you or sticker after a close reopen the conversation, or should short acknowledgements leave it closed? Default now: every new customer message reopens (AC-07) — never lose a real question behind a "thanks"; this also covers the deferred mute-a-flooding-sender question from shared-inbox §8. — owner: Dmytro Hopko, due: after 30 days of pilot use (watch the §7 reopen KPI)
