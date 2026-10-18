---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "S"
---

# Spec — ui-redesign

> **Glossary:** [CONTEXT](../../../CONTEXT.md) · [feature CONTEXT](./CONTEXT.md)
> **Reference module / docs / channels used:** `docs/design-system.md` (the design canon), the local uncommitted reference markup in `docs/design-refs/` (auth, logged-in layout, chat, contact-profile, users-list, settings), `docs/features/workspace-operators/screens.md` and `docs/features/bot-connection/screens.md` (the screens being redesigned), the current web panel code.

## 1. Context

The web panel works but does not yet look or navigate like a product. Today every workspace screen sits under a bare top bar with two owner-only links (Team, Bot), the workspace home is a placeholder that says "Your inbox arrives here", and the sign-in, invitation and password screens are plain forms. Operators and business owners of the 5–10 pilot businesses (idea brief §4) are the people who will open this panel every day, and the next roadmap steps — the shared inbox (step 4), assignment (step 5) and contacts (step 7) — each need a place in the navigation and a screen pattern to build into.

Why now: the design canon was fixed today (`docs/design-system.md`, "Visual direction"): centred entry screens, a workspace frame with a collapsible side navigation, list pages as a table inside a card, a two-pane inbox, a contact profile with sections, settings with a section menu. None of the shipped screens follow it yet. Building the inbox (step 4) on the old frame would mean building it twice; moving the frame first means every next feature only fills in data.

Committed approach: move every existing screen onto the canon without changing what any of them does — the entry screens (sign in, accept invitation, set new password, link unavailable, workspace picker, no access) take the centred layout; every workspace screen lives inside one frame with a side navigation (workspace switcher, Inbox, Contacts, owner-only Settings, account menu) that collapses into a drawer at phone width; the business owner's Bot and Team pages become two sections of one Settings screen. Next to them come three preview screens — the shared inbox, the contact list and a contact's profile — filled with clearly labelled sample data that is never saved and never reaches Telegram, so the product direction is visible to pilots and the next features only replace the sample data with real data. When the screens are done, every component added on the way is registered in the canon's component inventory, the local reference markup is deleted and the canon no longer points at it; feature work continues on the new frame.

Traceability: the canon's "Visual direction", "Component inventory" and "Interaction & writing conventions" are the source of every layout decision here; the redesigned screens are SCR-01…SCR-10 of `workspace-operators` and SCR-02…SCR-05 of `bot-connection` (its SCR-01 and SCR-06 are the same workspace home and not-found screens), whose acceptance criteria keep holding unchanged. The decisions taken in the interview (easy depth, assumptions accepted as a batch): workspace entry lands on the inbox preview; Settings is owner-only and holds Bot + Team; old Team/Bot links lead to the matching Settings section; sample data is the same for every workspace and a message "sent" in the preview lives only until the page is reloaded; no dark-mode switch and no translations.

## 2. Goals

- Every screen of the web panel follows the design canon and the same navigation frame, so the panel reads as one product and each next roadmap step only adds data to an existing screen.
- Pilot operators and business owners can see where the product is going — the shared inbox, contacts, a contact's profile — without ever mistaking sample data for their own customers.
- Nothing that works today stops working: every existing action, message and safeguard behaves exactly as before the redesign.

## 3. Non-goals

- Real data on the preview screens (listing captured conversations, replying, assignment, contact tags) — these are roadmap steps 4, 5 and 7; this feature only shows sample data.
- Screens for broadcasts and group/channel posts — there is no reference for them and their steps (8, 10) are not specified yet, so drawing them now would guess their behaviour.
- A light/dark theme switch and translated interface text — the panel stays in one theme and English; neither is needed for the pilots.
- Any change to what the system allows, refuses or says — permissions, validation and messages stay as specified by `workspace-operators` and `bot-connection`; this feature changes presentation and navigation only.
- Settings for operators (their own profile, password change, notification preferences) — no such capability exists yet; Settings holds only what a business owner already manages.
- Social sign-in or a self-serve sign-up link from the reference sign-in layout — there is no self-serve signup (roadmap § Out of scope).

## 4. User stories

### US-01: Work inside one navigation frame

**As an** Operator
**I want** every workspace screen inside one frame with a side navigation, a workspace switcher and my account menu
**So that** I always know where I am and reach any section in one step, on a desktop or a phone

### US-02: Enter the panel through clean entry screens

**As an** Operator
**I want** the sign-in, invitation, new-password and workspace-choice screens in one consistent centred layout
**So that** getting into the panel feels like one product and nothing about how I sign in changes

### US-03: Manage the bot and the team in Settings

**As a** Business owner
**I want** my workspace's bot and team as two sections of one Settings screen, with the team list searchable and filterable
**So that** everything I administer is in one place and I find a member quickly

### US-04: Preview the shared inbox

**As an** Operator
**I want** an inbox screen with a conversation list and a conversation thread, filled with labelled sample data
**So that** I can see how I will answer customers before the real inbox arrives

### US-05: Preview contacts and a contact's profile

**As an** Operator
**I want** a contact list and a contact profile screen, filled with labelled sample data
**So that** I can see how the contact base will look before the contacts step ships

### US-06: Keep every existing action working

**As a** Business owner
**I want** inviting members and revoking invitations, deactivating and reactivating members, connecting, reconnecting and managing the bot, switching workspaces and signing out to work exactly as before
**So that** the redesign costs my team nothing in their daily work

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** an Operator who is an active member of "Acme Flowers" and is signed in
**When** they enter "Acme Flowers"
**Then** they land on the inbox preview inside the workspace frame: a side navigation with the workspace switcher at the top, Inbox and Contacts, and their account menu (their email and Sign out) at the bottom; the current section is highlighted and a breadcrumb above the page says where they are

### AC-02 (US-01) — happy path

**Given** an Operator using the panel on a phone-width screen
**When** they open any workspace screen
**Then** the side navigation is hidden behind a menu button, opens as a drawer over the page, closes once they pick a section, and no screen scrolls sideways

### AC-03 (US-01) — cross-context

**Given** an account that is a Business owner of "Acme Flowers" and an Operator of "Bloom Bakery"
**When** they switch from "Acme Flowers" to "Bloom Bakery" with the workspace switcher
**Then** they land on "Bloom Bakery"'s inbox preview, Settings disappears from the navigation because their membership there is an operator's, and nothing shown for "Acme Flowers" remains on screen

### AC-04 (US-02) — happy path

**Given** a person with an account who is signed out
**When** they open the sign-in screen and sign in with their email and password
**Then** they see one centred column with the product mark, a heading, a short description and the form, and after signing in they reach exactly the place the existing sign-in rule picks (the address they came from, else the workspace they used last, else their only workspace, else the workspace picker, else the no-access screen — `workspace-operators` AC-07)

### AC-05 (US-02) — error

**Given** a person on the sign-in screen
**When** they submit with an empty email, or with a password that does not match
**Then** the system does not sign them in; an empty field is marked with its message right below it, and a wrong email or password shows the same in-place message as before the redesign, without saying which of the two was wrong

### AC-06 (US-02) — happy path

**Given** a person who opens an invitation link, a password-reset link, or a link that is no longer valid
**When** the screen loads
**Then** they see the accept-invitation, set-new-password or link-unavailable screen in the same centred layout as sign-in, with the same fields, rules and outcomes as before the redesign

### AC-07 (US-03) — happy path

**Given** a Business owner of "Acme Flowers"
**When** they open Settings from the side navigation
**Then** they see a Settings title with a short description, a section menu with Bot and Team (stacked above the content on narrow screens), and the Bot section shows the bot's state and every action it offers today — connect, replace the token, reconnect, disconnect

### AC-08 (US-03) — happy path

**Given** a Business owner of "Acme Flowers" whose team has 6 members and 2 pending invitations
**When** they open the Team section, type part of a member's email in the search box and filter by role "operator" and state "active"
**Then** the table shows only the members and pending invitations already listed that match all three — each member row with an avatar, the name, the email, a role badge, a state badge and a row-actions menu; each invitation row with its email, role and expiry but never its link — while **Show more** still loads the next part of a long list; clearing the search and filters shows every listed row again

### AC-09 (US-03) — error

**Given** a Business owner on the Team section
**When** their search and filters match nobody
**Then** the table is replaced by one sentence saying no member matches, with a button that clears the search and filters

### AC-10 (US-03) — authorization

**Given** an Operator of "Acme Flowers" who is not a business owner
**When** they look for Settings in the navigation, or open a saved link to the Settings, Team or Bot screen
**Then** Settings is not in their navigation, and the saved link shows the same refusal as before the redesign — only business owners manage the team, or only business owners manage the bot — without showing any team or bot details

### AC-11 (US-03) — happy path

**Given** a Business owner who bookmarked the old Team page or the old Bot page of "Acme Flowers"
**When** they open that bookmark
**Then** they land on the Team or Bot section of Settings for "Acme Flowers"

### AC-12 (US-04) — happy path

**Given** an Operator on the inbox preview
**When** they look at the conversation list and pick a conversation
**Then** the list shows each sample conversation with an avatar, the contact's name, a relative time, the last message and an unread count, the chosen conversation opens as a thread (contact header, messages grouped by sender, a reply box), and a visible "Sample data" label says these are not real conversations

### AC-13 (US-04) — error

**Given** an Operator in a sample conversation thread
**When** they try to send with an empty reply box, or one holding only spaces
**Then** nothing is added to the thread and the send button stays unavailable until they type text

### AC-14 (US-04) — domain invariant

**Given** an Operator in a sample conversation thread
**When** they type a reply and send it
**Then** the reply appears at the end of the thread on this screen only, a note in the reply area says that preview screens send nothing to customers, and after reloading the page the reply is gone — a preview screen never saves anything and never writes to any end customer

### AC-15 (US-05) — happy path

**Given** an Operator on the contacts preview
**When** they search by name and filter by a tag, then open a contact from the table
**Then** the table narrows to the matching sample contacts, and the contact opens on a profile screen with a header card (avatar, name, username, key facts) and Overview / Conversation history sections, both carrying the "Sample data" label

### AC-16 (US-05) — error

**Given** an Operator on the contacts preview
**When** their search and tag filter match no sample contact
**Then** the table is replaced by one sentence saying no contact matches, with a button that clears the search and filter

### AC-17 (US-05) — cross-context

**Given** "Acme Flowers" whose business bot has already captured real contacts and conversations
**When** an Operator of "Acme Flowers" opens the inbox, contacts or contact profile preview
**Then** they see only the labelled sample data — the same in every workspace — and never a real contact or conversation of "Acme Flowers" or of any other workspace mixed into it

### AC-18 (US-06) — cross-context

**Given** an Operator viewing "Acme Flowers" whose membership a Business owner has just deactivated
**When** their next action in "Acme Flowers" is refused
**Then** they leave "Acme Flowers" and land where the existing rule sends them — another workspace's screen inside the new frame, or the workspace picker or no-access screen in the centred layout — with the same dismissible "Your access to Acme Flowers was removed" notice as before the redesign

### AC-19 (US-06) — happy path

**Given** a Business owner of "Acme Flowers"
**When** they invite a member, copy the invitation link, revoke a pending invitation, deactivate and reactivate a member, connect a bot, replace its token, reconnect it (including confirming a takeover from another service), disconnect it, switch workspace and sign out
**Then** each action asks the same confirmations, shows the same messages and has the same outcome as before the redesign

### AC-20 (US-06) — happy path

**Given** a signed-in Operator
**When** they open a workspace that does not exist or is not theirs, or the workspace fails to load
**Then** the frame shows the same not-found card, or the same "Something went wrong" message with Retry, as before the redesign, and shows no workspace data while the workspace is loading

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Phone-width layout | 0 screens with sideways page scroll at 360px width; every screen also checked at 1280px | manual walk through every screen at both widths before ship, recorded in the ship notes |
| Behaviour preserved | 100% of the existing web-panel tests pass, changed only where they locate elements on the page, never in what they assert happens | CI test run on the feature branch; test diffs reviewed |
| Accessibility | 100% of navigation items and actions reachable and operable by keyboard; every control has an accessible name (screen tests locate them by role and name) | screen tests query controls by role and name; manual keyboard pass over every screen before ship |
| Initial download size | ≤ +120 KB gzipped over the `main` baseline for the panel's first load | build output size compared against `main` in the review |
| Loading feedback | every screen shows a content-shaped placeholder within 100 ms of opening while its data loads; no full-page spinner | screen tests for the loading state; manual check on a throttled connection |
| Reference markup left | 0 reference files in the repository's reference folder and 0 mentions of it in the design canon at ship; 100% of components added by this feature listed in the canon's component inventory | repository check before ship |

## 6.1 Security / privacy

- **Data classification:** internal — the screens show the same workspace data as today (team, bot facts) plus static sample data.
- **Personal data touched:** none new. Sample data uses invented names, usernames and messages, belongs to no workspace and names no real person.
- **AuthZ/AuthN impact:** no new capability and no changed check. Hiding Settings from operators is presentation only; the existing server-side checks (only business owners manage the team and the bot, members see only their own workspace) stay the actual guard.
- **Abuse cases:**
  - Operator opens a saved Settings/Team/Bot link: the server refuses as today and the screen shows the refusal without team or bot details (AC-10).
  - Cross-tenant residue on workspace switch: the frame drops the previous workspace's data before showing the next one (AC-03, AC-20).
  - Sample data mistaken for a leak of another business's customers: every preview screen carries a visible "Sample data" label and the data is identical in all workspaces (AC-12, AC-17).
  - Markup injection through the preview reply box: typed text is shown as plain text, never interpreted as markup, and never leaves the browser (AC-14).
- **Security review:** N/A — no new permission boundary, no new personal data, no server change; the existing guards are re-verified by the behaviour-preserved NFR.

## 7. Metrics / KPIs

- **Screens on the canon** — baseline: 0 of the 14 shipped screens (10 from `workspace-operators`, 4 more from `bot-connection`), target: 14 of 14 plus 3 preview screens at ship.
- **Regressions reported after release** — baseline: 0 (new), target: 0 behaviour regressions reported by pilots or found in the shipped screens within 14 days of release.
- **Sample-data confusion** — baseline: 0 (new), target: 0 pilot support questions of the kind "whose conversations/contacts are these?" within 30 days of release.
- **Screens reused by the next feature** — baseline: 0, target: the shared-inbox step (4) ships by replacing the inbox preview's sample data instead of building a new screen, confirmed in its spec.

## 8. Open questions

- [ ] Should operators see the Team section (read-only), e.g. to know whom to hand a conversation to? Default now: no — Settings stays owner-only (carried over from `workspace-operators` §8). — owner: Dmytro Hopko, due: before roadmap step 5 (assignment) is specified
- [ ] Should an operator get a Settings entry of their own (profile, password change, notification preferences)? Default now: no Settings for operators until such a capability exists. — owner: Dmytro Hopko, due: before roadmap step 6 (notifications) is specified
