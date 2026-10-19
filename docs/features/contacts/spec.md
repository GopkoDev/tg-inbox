---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: "M"
---

# Spec — contacts

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** `docs/roadmap.md` (steps 7 and 8), `docs/idea-brief.md` §5 and §7, `docs/architecture-map.md`, `docs/design-system.md` (list page, contact profile, Settings sections), the contact capture it builds on (`docs/features/bot-connection/spec.md` AC-07, AC-08: a contact is created and refreshed from the Telegram profile), the preview it replaces (`docs/features/ui-redesign/spec.md` US-05, AC-15…AC-17: contacts list and contact profile on sample data), and the inbox it links to (`docs/features/shared-inbox/spec.md`, `docs/features/assignment-statuses/spec.md`).

## 1. Context

Every customer who writes to a workspace's business bot already becomes a contact (bot-connection), but the team cannot see them anywhere except as the name on an inbox conversation. The Contacts and contact-profile screens still show labelled sample data (ui-redesign). A business owner of a pilot team (idea brief §3: teams of 3+ operators who want "the contact base for future broadcasts") has no way to say who their customers are or to group them, and operators have nowhere to record "this one is a wholesale buyer" while they answer.

Why now: the inbox, assignment and notifications shipped (roadmap steps 4–6), so pilots now collect contacts every day. The pitch to pilots is tagging as "your broadcast base in the making" (idea brief §7), and the next step, broadcasts (roadmap step 8), selects its recipients by tag. Every week without tags is a week of customers who will have to be tagged after the fact.

**Committed approach.** The two preview screens get real data, and contacts get **workspace tags**. The Contacts list shows the workspace's contacts with search, a tag filter (any or all of the chosen tags, or contacts with no tags) and the number of contacts that match, which is the size of a future broadcast segment. A contact's profile shows the facts Telegram gave us, the tags, the state of the contact's one conversation and its history, read-only, with a way into the inbox to answer. Any member tags a contact, from the profile or from the conversation header in the inbox, where the work happens; typing suggests existing tags first and creates a new one only on purpose. Only business owners rename, merge and delete tags, in a new Settings section that shows each tag's contact count. This follows the permission model of the closest comparable product (researcher, 2026-10-19: respond.io lets every agent create tags from the inbox and keeps edit and delete with managers; Intercom added a tagging permission after open creation made tags "unmanageable"), and the gap no checked product fills for a small Telegram-only team is contact-owned tags set during support with a plain per-tag segment size. The adversarial pass shaped the rest: the sharpest failure is a broadcast segment that silently shrinks, splits or leaks, so tags are unique per workspace after normalising spaces and letter case, a rename into an existing name merges instead of failing, each contact keeps a history of who added or removed which tag and when (including removals by an owner's merge or delete), a delete shows how many contacts lose it before it happens, and a tag or contact of another workspace can never be linked or counted. A second failure the pass found is that reading history in the profile must not count as reading the conversation, or pings would stop for customers nobody saw.

Sized M (the roadmap's first guess was S and was resized to M in this run): it adds a schema change (tags), new member actions and new screens across the contacts, inbox and settings areas.

Critic pass (2026-10-19), resolved as amendments: removals are recorded in a per-contact tag history instead of deferred (the former open question on it is closed); a merge keeps the original adder and time; a case-only rename changes how a tag is shown; the change-signal glossary entry now covers open contact profiles.

Assumptions taken in the autonomous pipeline run (2026-10-19) — each can be vetoed at review:

- Operators and business owners have the same rights over contacts and over tagging a contact; only managing the tag list (rename, merge, delete) is owner-only, because it changes every contact carrying the tag and every future segment at once.
- A tag is just a name: no colour, no description, no tag groups. Names are 1–32 characters after trimming; spaces of any kind inside are collapsed to one; two names that differ only in letter case or spacing are the same tag. The text is shown exactly as first typed (or as renamed).
- Limits: at most 100 tags per workspace and 20 tags per contact — enough for pilot segmentation, small enough to keep the tag list readable.
- The contact list is ordered by the contact's latest customer message, newest first; 50 contacts per page.
- The tag filter offers "any of" (the default, as in the preview) and "all of" the chosen tags, plus "no tags"; excluding a tag is left to step 8 (OQ-1).
- The profile shows the conversation's thread read-only and never marks anything read; answering happens in the inbox, one click away.
- Tag changes on a contact are not activity entries in the conversation thread: tags belong to the contact, not the conversation. Instead the profile keeps the contact's tag history — every addition and removal with the member and the time, including removals caused by an owner's merge or delete — so a shrunk segment can be explained. A rename changes no history.
- The tag picker carries one line of guidance that tags are visible to the whole team and should not record health, religion or other sensitive traits; nothing is filtered automatically.
- The contacts list updates when it is opened or its search or filter changes; an open profile and an open inbox conversation header show a teammate's tag change live.

## 2. Goals

- The team can find any customer of the workspace and see who they are and where their conversation stands without opening the inbox list.
- Tagging becomes part of answering, so the workspace's active customers carry tags by the time broadcasts arrive.
- A business owner can trust a tag as a segment: its size is visible, it does not split into look-alikes, and it never includes another workspace's customers.

## 3. Non-goals

- **Notes on a contact** — the decided contact model is Telegram profile + tags + history (idea brief §5); free text about a customer adds personal-data questions and a notes card would duplicate the conversation itself. The preview's "Notes" card is removed.
- **Deleting, hiding or merging contacts, and self-serve erasure** — a contact owns the conversation history; deleting it needs rules for that history and for future broadcasts. During the pilot an erasure request is handled by hand by the tg-inbox team, as for any captured data (bot-connection §3); OQ-2 decides the product path before broadcasts.
- **Collecting phone, email or other fields, and custom contact fields** — out of scope for the product (idea brief §5).
- **Telegram profile photos** — the avatar stays the contact's initials; fetching and storing photos is a separate cost with no segmentation value.
- **Broadcasts, saved segments and exporting contacts** — broadcasts are roadmap step 8; an export would move the whole base out of the workspace's access control, so it waits for a decided need.
- **A tag lens in the inbox list and bulk tagging** — the inbox keeps its status and assignee lenses; finding customers by tag is the Contacts list's job, and bulk tagging is also the fastest way to corrupt a segment.
- **Whether a customer has blocked the bot** — that is tracked by broadcasts (roadmap step 8), where it matters.

## 4. User stories

### US-01: Find a customer

**As an** Operator
**I want** the Contacts list to show the workspace's real contacts, with search and a tag filter
**So that** I find a customer, or a group of customers, without scrolling the inbox

### US-02: Know who a customer is

**As an** Operator
**I want** a contact's profile with what Telegram tells us, their tags, where their conversation stands and its history
**So that** I understand the customer before I answer and can jump into the conversation

### US-03: Tag customers while I work

**As an** Operator
**I want** to add and remove tags on a contact from the conversation I am answering or from the profile, reusing the team's existing tags
**So that** the team builds a grouped customer base as a side effect of support

### US-04: Keep the tag list tidy

**As a** Business owner
**I want** to rename, merge and delete the workspace's tags
**So that** one kind of customer has one tag and the list stays usable

### US-05: See how big a segment is

**As a** Business owner
**I want** to see how many contacts carry each tag and how many match a filter
**So that** I know how many customers a future broadcast would reach

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** an operator of "Acme Flowers" whose bot has captured 120 contacts, some of them tagged
**When** they open Contacts
**Then** the list shows the contacts of "Acme Flowers" and nothing else, with no sample data and no "Sample data" label: each row shows the contact's name and username, their tags, language, when they first wrote and when they last wrote, newest last message first, 50 at a time with the next ones on request, and the page says how many contacts there are in total; choosing a contact opens their profile; a business owner sees and does the same

### AC-02 (US-01, US-05) — happy path

**Given** an operator on the Contacts list of "Acme Flowers"
**When** they type part of a name or username into the search, and choose tags in the filter with "any of", "all of", or "no tags"
**Then** the list shows only the contacts that match both: the search follows the inbox search rules (anywhere in the full name or username, ignoring letter case in any alphabet, surrounding spaces and a leading "@"), "any of" keeps contacts carrying at least one chosen tag, "all of" keeps contacts carrying every chosen tag, and "no tags" keeps contacts with no tag at all; the page says how many contacts match; the search and filter are part of the page's address, so a reload, the back button or a saved link opens the same view, and switching to another workspace starts with no search and no filter

### AC-03 (US-01) — error

**Given** an operator on the Contacts list of "Acme Flowers"
**When** the search and filter match no contact, or the workspace has no contacts yet
**Then** in the first case the list is replaced by one sentence saying no contact matches, with a button that clears the search and filter; in the second it explains that a contact appears when a customer writes to the business bot, and a business owner whose workspace has no connected bot is offered the way to the bot settings

### AC-04 (US-02) — happy path

**Given** a contact of "Acme Flowers" whose conversation is open, assigned to a teammate and waiting for a reply
**When** an operator opens the contact's profile (from the list, from the contact's name in the inbox conversation header, or by a saved link)
**Then** the profile shows the contact's name, username, language, when they first wrote and when they last wrote, their tags with who added each one and when, the contact's tag history (each tag added or removed, by whom and when, newest first), and their conversation: its status, its assignee (or "unassigned"), the "waiting for a reply" marker when it applies, and a way to open it in the inbox; a history section shows the conversation's messages, the team's replies with their authors and its activity entries in the same order as in the inbox, latest first part loaded and older ones on scrolling, with media opened through the panel as in the inbox; the profile can be reopened by reload, the back button or a saved link, and a link to a contact that does not exist shows the not-found card inside the frame

### AC-05 (US-02) — cross-context

**Given** a conversation of "Acme Flowers" holding customer messages the operator has not read
**When** the operator reads its history on the contact's profile, including while new customer messages arrive
**Then** nothing counts as read for the operator: the conversation's unread count, the operator's attention count and the pings they would get stay exactly as if the profile had not been opened, and the profile has no reply box; only opening the conversation in the inbox marks it read, as before; new messages, replies and activity entries appear in the open history without reloading

### AC-06 (US-03) — happy path

**Given** an operator answering a conversation of "Acme Flowers" in the inbox, or on its contact's profile, while "Acme Flowers" has the tags "VIP" and "Wholesale"
**When** they open the tag control on the contact and type "vi", pick "VIP", then type "Kyiv" (which no tag matches) and confirm creating it, then remove "Wholesale"
**Then** while typing, existing tags that contain the text are offered first and creating a new tag is a separate, named choice ("Create tag "Kyiv""); the contact now carries "VIP" and "Kyiv" and not "Wholesale", "Kyiv" exists in the workspace's tag list for everyone, each added tag records the member who added it and when, the contact's tag history shows the two additions and the removal with the member and time, the change shows for every member who has that conversation header or profile open without reloading, and the Contacts list filter finds the contact by the new tags; adding a tag the contact already carries changes nothing; the tag control says once that tags are visible to the whole team and should not record health, religion or other sensitive traits; no tag change is ever sent to the end customer

### AC-07 (US-03) — error

**Given** an operator creating a tag in "Acme Flowers"
**When** the name is empty or only spaces, or longer than 32 characters after trimming
**Then** no tag is created and nothing changes on the contact, and the tag control says that a tag name must be 1 to 32 characters

### AC-08 (US-03) — domain invariant

**Given** "Acme Flowers" has the tag "VIP" and 100 tags in total, and a contact that carries 20 tags
**When** an operator types "vip", " VIP " or "V  I P" with other spacing variants for a contact, or two members create "Kyiv" for different contacts at the same moment, or someone tries to create a 101st tag or add a 21st tag to that contact
**Then** a name that differs from an existing tag only in letter case or spacing is the existing tag ("vip" applies "VIP"), and two members creating the same new name at the same moment end up with one tag applied to both contacts — a workspace never holds two tags with the same name; the 101st tag is not created and the tag control says a workspace can have at most 100 tags and a business owner can merge or delete some in Settings; the 21st tag is not added and the control says a contact can carry at most 20 tags; both limits hold when members act at the same moment

### AC-09 (US-04) — happy path

**Given** a business owner of "Acme Flowers" in Settings → Tags, where "VIP" is on 12 contacts, "vip-clients" on 3 (one contact carries both) and "Old promo" on 40
**When** they rename "vip-clients" to "Loyal", then rename "Loyal" to "vip", and delete "Old promo"
**Then** after the first rename every contact that carried "vip-clients" carries "Loyal"; renaming into the name of an existing tag first says that "VIP" already exists and offers to merge, and on confirmation the 3 contacts carry "VIP" (the contact that had both carries it once), "VIP" now shows 14 contacts and "Loyal" is gone; a contact that carried only "Loyal" keeps who added it and when, the contact that carried both keeps the earlier of its two additions, and the tag history of the contact that carried both records "Loyal" removed by the owner's merge; deleting first says that "Old promo" will be removed from 40 contacts and cannot be undone, and only on confirmation the tag disappears from the workspace and from every contact, and each of the 40 contacts' tag history records it removed by the owner's delete; every change shows for members who have an affected profile or conversation header open without reloading; renaming a tag to a name that differs only in letter case or spacing ("vip" to "VIP") changes only how it is shown, renaming it to exactly the same text changes nothing, and a rename follows the name rules of AC-07

### AC-10 (US-05) — happy path

**Given** a business owner of "Acme Flowers" whose workspace has the tags "VIP" (14 contacts), "Kyiv" (30) and "Wholesale" (0)
**When** they open Settings → Tags and choose the count next to "Kyiv"
**Then** the section lists every tag of the workspace with the number of contacts carrying it, alphabetically, including tags no contact carries; choosing a count opens the Contacts list filtered by that tag, which shows the same number of matching contacts

### AC-11 (US-04) — authorization

**Given** an operator (not a business owner) of "Acme Flowers"
**When** they look for the Tags section of Settings, or try to rename, merge or delete a tag (for example through a saved link to the section)
**Then** Settings shows them no Tags section, the attempt changes nothing, and the panel says that only a business owner manages the workspace's tags; the operator can still add and remove tags on contacts and create new tags while doing so

### AC-12 (US-01, US-02, US-03) — authorization

**Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
**When** they try to list, search or open contacts of "Acme Flowers", see its tags or their counts, or add, remove, rename or delete a tag — including by naming a contact or tag of "Acme Flowers" from another workspace, or a tag of another workspace on a contact of "Acme Flowers"
**Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the contact or the tag exists, a deactivated member gets the access-removed notice, and someone not signed in is asked to sign in first; a contact only ever carries tags of its own workspace, and no list, filter or count of one workspace ever includes a contact or tag of another

### AC-13 (US-03) — cross-context

**Given** a contact of "Acme Flowers" carrying the tags "VIP" and "Kyiv", added by an operator who has since been deactivated
**When** the customer changes their Telegram name and writes again, or the bot of "Acme Flowers" stops working or is disconnected, or the same person writes to the bot of another workspace
**Then** the contact shows the new name with the same tags; the tags and the tag history still show the deactivated member as the one who added them; tagging, the Contacts list and profiles work in every state of the bot, since nothing about tags goes to Telegram; the same person in another workspace is a separate contact with none of the tags of "Acme Flowers"

### AC-14 (US-03) — domain invariant

**Given** an operator whose tag control on a contact of "Acme Flowers" still offers the tag "Old promo"
**When** a business owner deletes "Old promo" (or merges it into another tag) before the operator picks it
**Then** the tag is not added, the operator is told that this tag no longer exists, and the control shows the current tags; a contact never carries a tag that is not in the workspace's tag list

### AC-15 (US-03) — error

**Given** an operator of "Acme Flowers" who has added or removed 60 tags on contacts or created tags within the last 60 seconds
**When** they try another tag change
**Then** nothing changes, and the tag control says that tag changes are limited to 60 per minute per member and when they can continue; only recorded changes count (adding a tag the contact already carries counts as none); the limit is per workspace, so changes in another workspace of the same account are not affected

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Contacts list p95 — first page with search and any tag filter, including the matching count, workspace with 10 000 contacts and 100 tags | ≤ 500 ms server time | request timing log; seeded integration test per filter mode |
| Contact profile p95 — profile with conversation state and the first part of history | ≤ 500 ms server time | request timing log; integration test |
| Tag change p95 — add, remove or create, member action → recorded | ≤ 300 ms server time | request timing log on the tag path |
| Tag live update p95 — change recorded → shown in another member's open profile or conversation header | ≤ 3 s (as shared-inbox §6) | server-side timing from change to push; integration test asserts the push |
| Owner rename / merge / delete p95, tag on 10 000 contacts | ≤ 2 s server time | request timing log; seeded integration test |
| Tag uniqueness | 0 workspaces holding two tags whose names are equal after normalising letter case and spacing | integration test under concurrent creation; integrity query in the run book |
| Tag limits | 0 workspaces over 100 tags and 0 contacts over 20 tags | integration test with concurrent adds at the limit; integrity query |
| Tenant isolation | 0 contacts carrying a tag of another workspace | integrity query; cross-workspace integration test for every contacts and tags read and write |
| Tag history completeness | 0 tag additions or removals on a contact (by a member, a merge or a delete) without a tag history entry | integration test per change path |
| Read state untouched by profile | 0 changes to any member's read state caused by opening or reading a profile | integration test: open profile history with unread messages → unread and attention counts unchanged |
| Tag change rate per member | ≤ 60 per rolling 60 s per member per workspace (AC-15) | integration test: the 61st change within a minute is refused |
| Availability | 99.5 % monthly (as shared-inbox §6) | uptime check on the health endpoint |

## 6.1 Security / privacy

- **Data classification:** confidential — the contact base and how a business groups its customers are business-private and describe identifiable people.
- **Personal data touched:** new — tags on end customers (member-typed labels, which can describe a person), and the tag history: which member added or removed each tag and when. Existing contact data (Telegram name, username, language, first and last message time) becomes visible on new screens; no new data is collected from end customers.
- **AuthZ/AuthN impact:** listing, searching and opening contacts, reading tags and counts, and adding, removing and creating tags require an active membership of the workspace, with either role; renaming, merging and deleting tags additionally require the business owner role. Every read and write is scoped to the caller's workspace, and linking a tag to a contact checks that both belong to that same workspace; reading a profile's history never changes read state.
- **Abuse cases:**
  - Cross-tenant tagging or counting — submitting a contact or tag of another workspace, or probing ids: refused with no hint they exist; a contact can only carry its own workspace's tags (AC-12).
  - Segment sabotage by a departing or compromised member — removing tags one by one: limited to 60 tag changes per minute (AC-15), operators cannot delete or merge tags (AC-11), an owner's delete states the number of contacts affected before it happens (AC-09), and every removal is kept in the contact's tag history with the member and time (AC-04), so a shrunk segment can be explained.
  - Sensitive or insulting labels on customers: the tag control warns that tags are visible to the team and must not record sensitive traits (AC-06); tags are never sent to the customer; erasure is handled by hand by the tg-inbox team during the pilot (OQ-2).
  - Markup injection through a tag name, a contact's name or username (customer-controlled): shown as plain text everywhere, never interpreted.
  - Tag-list flooding by one member: at most 100 tags per workspace (AC-08) and the per-member rate limit.
- **Security review:** Required — new personal data about end customers, a new owner-only capability and a new cross-entity link that must stay inside one workspace.

## 7. Metrics / KPIs

- **Active contacts with at least one tag** — baseline: 0 % (tags do not exist), target: ≥ 30 % of contacts that wrote in the last 30 days carry a tag, per active pilot workspace, 30 days after release.
- **Pilot workspaces using tags** — baseline: 0, target: ≥ 80 % of active pilot workspaces have at least 3 tags each on 5 or more contacts within 30 days of release.
- **Tags added from the inbox** — baseline: 0 (new), target: tracked from release; ≥ 50 % of tag additions made from the inbox conversation header after 30 days (a sign tagging happens while answering, not as a chore).
- **Look-alike tag merges** — baseline: 0 (new), target: tracked from release; alert when a workspace's owner merges more than 5 tags in 7 days (a sign naming needs more help than suggestions give).

## 8. Open questions

- [ ] **OQ-1** Should segments for broadcasts also exclude tags ("VIP but not Staff")? Default now: the Contacts filter offers any of, all of and no tags; exclusion is decided with broadcasts. — owner: Dmytro Hopko, due: at `specify` of roadmap step 8 (broadcasts)
- [ ] **OQ-2** How does a workspace remove a contact — a test message from a teammate, spam, or a customer's erasure request? Default now: no in-product deletion; the tg-inbox team handles erasure by hand on request. — owner: Dmytro Hopko, due: before roadmap step 8 ships
