---
status: draft
feature_size: "M"
tool: "code"
updated_at: "2026-10-19"
---

# Screens — contacts

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`) — inline wireframes below, one per state that needs a distinct layout. No degradation: the canon's tool is `code`, so no Figma / Pencil MCP was needed.
- **File:** inline wireframes below.
- **Inventory:** SCR ids from [`ux-flows.md`](ux-flows.md) §Screen inventory — SCR-01, SCR-02, SCR-03, SCR-06, SCR-07, SCR-08, SCR-09, SCR-15, SCR-18, SCR-19, SCR-20, SCR-21, SCR-22, SCR-23, all covered. SCR-18…SCR-23 are new. SCR-18 and SCR-19 **replace** the ui-redesign previews (`ContactsPreview`, `ContactProfilePreview`, the sample source and the «Sample data» label) at the same addresses `/w/<id>/contacts` and `/w/<id>/contacts/<contactId>`. SCR-02 is the shipped thread; its **header gains the contact's tags and the tag control** (§SCR-02). The other reused screens are landings with no new layout; every state they already list stays as is and is **not repeated** here — this manifest lists only what this feature adds or changes.
- **Component names:** names from the canon inventory (`AppShell`, `Breadcrumb`, `SettingsLayout`, `Card`, `Badge`, `Button`, `Input`, `Label`, `Field`, `Checkbox`, `RadioGroup`, `Popover`, `Dialog`, `AlertDialog`, `Alert`, `Table`, `Tabs`, `Avatar`, `Skeleton`, `ScrollArea`, `Separator`, `DropdownMenu`, `DataTableToolbar`, `EmptyFilterState`, `NotFoundCard`, `Thread`, `MessageBubble`, `MessageContent`, `ActivityLine`, `ReplyDeliveryState`, `MediaViewer`, `ConversationCrumb`); `extended: <name>` = an existing inventory component that gains states (its canon row is updated, not duplicated); `NEW: <name>` = a part listed under §New components.
- **No new npm dependency.** The SAD's «popover + command list» for the tag control (sad.md §4) is **not** the shadcn `command` primitive: `pnpm dlx shadcn@latest add command` pulls in the `cmdk` package, which `apps/web/package.json` does not have (checked 2026-10-19; the dependencies are `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `zustand`, `zod`, `react-router`). The tag control is composed from the existing `Popover` + `Input` + `Button` rows, as `AssigneeChooser` already is (Decision 3). No primitive from the canon's _Not yet in the repo_ list is needed (no toast: every outcome is shown in place).
- **Sources per row:** spec §5 ACs, sad.md §6 flows (`flow N`, seeded flows `S1`…`S3`), contract responses (`contracts/openapi.yaml` `operationId` + status / code) and live frames (`contracts/events.md`). Every non-default state names at least one.
- **Copy:** existing texts stay word for word. New texts are quoted below; `implement` may polish them without changing their meaning. Tag names, contact names, usernames and member names render as plain text everywhere (spec §6.1, sad.md §8 _Untrusted content_). Times use the existing helpers: relative times from `features/inbox/relative-time.ts` (`relativeTime`), dates and clock times from `features/bot/settings/format.ts` (`formatBotDay`, `formatBotTime`).

### Decisions taken at this stage

The contract and the SAD leave these to `screens`; they are recorded here, not elsewhere.

1. **The Contacts address is `?q=<text>&mode=any|all|none&tag=<id>&tag=<id>`** (the contract's query names). `mode` is written only when it is not `any`. The page parses the address like the inbox lens (`features/inbox/lens.ts`): a malformed tag id, a duplicate, an unknown `mode`, or tags together with `mode=none` are dropped from the address before the request (`replace`, no history entry), so the panel never sends the `400` combination. Each change of search (debounced 300 ms, as the inbox search), mode or tags pushes a history entry, so the back button walks the views (AC-02).
2. **The tag filter is one `Popover`** behind a **Tags** toolbar button: a `RadioGroup` «Any of these tags» / «All of these tags» / «No tags» on top, then one `Checkbox` per workspace tag in tag-list order with its contact count. Choosing «No tags» clears and disables the checkboxes; checking a tag while «No tags» is chosen switches to «Any of». The button reads «Tags», «Tags · 2», «All of 2 tags» or «No tags». The filter's tag names come from `listTags` (so a renamed tag shows its new name); the list rows' tags come from the page answer.
3. **The tag control (SCR-20) is a `Popover`** opened from an **Add tag** button next to the contact's tags, on SCR-02's header and on SCR-19. It holds a search `Input` (the combobox, `role="combobox"` with `aria-controls` the list), the contact's carried tags as `Badge`s with a remove button, the suggestion rows as ghost `Button`s (`role="option"`, Up / Down moves, Enter picks, Esc closes and returns focus to **Add tag**) and the guidance line. It stays open after each add or remove, so a member can make several changes, and shows every refusal inside itself (AC-06). Matching runs in the browser over `listTags` with the shared tidy and fold functions; the server decides again.
4. **Tags are shown as `Badge variant="secondary"`** in tag-list order everywhere (list rows, SCR-02 header, SCR-19), with no colour meaning. On a list row more than 3 tags collapse into «+N» (`Badge variant="outline"`, the full list in its `title`); the header and the profile wrap all of them.
5. **The profile is a header `Card` + a conversation `Card` + `Tabs`** «Conversation» (the read-only history, default) and «Tag history», following the canon's visual direction for the contact profile. The preview's «Notes» card is removed (spec §3). The breadcrumb shows the contact's name (NEW: ContactCrumb, like `ConversationCrumb`).
6. **The profile's history is the inbox thread's rendering without its two writing parts**: no read marking while visible and no composer (ADR-0006). It reuses `MessageBubble`, `MessageContent`, `ActivityLine` and `MediaViewer` as they are; a reply's delivery line shows its state with **no** «Try again» / «Send again» buttons (extended: ReplyDeliveryState `readOnly`), because the profile does not act on the conversation.
7. **Settings — Tags is the third owner section**: the section menu reads Bot / Team / Tags / Notifications for an owner, and the owner's description becomes «Manage your workspace's bot, team and tags, and your notifications». An operator's menu is unchanged (Notifications only); on the Tags address an operator gets the in-place card «Only a business owner manages the workspace's tags» + **Back to inbox**, as Bot and Team do (AC-11).
8. **Owner actions are on each row** of SCR-21: **Rename** and **Delete** as ghost buttons on desktop, collapsed into a row-actions `DropdownMenu` («⋯») below `md`. The count is a link to `/w/<id>/contacts?tag=<id>` (AC-10).
9. **The merge is step 2 of the rename `Dialog`** (SCR-22), not a separate dialog: on `409 TAG_NAME_TAKEN` the dialog's body and buttons change to the merge offer, and **Back** returns to the name field with the typed name kept. The delete (SCR-23) is an `AlertDialog`, because it cannot be undone; the merge is in a `Dialog` whose confirm button is `destructive`.
10. **Missing values are words, not blanks** (AC-01): no username → «no username» (muted); no language → «Unknown»; no first / last wrote (data-model assumption 7) → «Never». A missing last name is simply left out of the name.
11. **Counts above the list:** «120 contacts» with no search or filter; «14 of 120 contacts match» with one (the segment size, AC-02). They show above the table, right-aligned in the toolbar row at desktop and on their own line below it at phone width.

### Assumptions (autonomous run 2026-10-19)

- Depth = medium, posture desktop-first per the canon; the per-screen confirmations were made by the pipeline itself (Accept on every screen) and can be vetoed at review. Decisions 1–11 above are this stage's own picks.
- The tag control does not pre-check the 100-tag workspace limit before the member creates a tag; the server answers `409 TAG_LIMIT_REACHED` and the control shows it. It **does** show the 20-per-contact state up front, because the carried tags are on screen (the server still decides).
- With an empty search field the tag control lists every workspace tag in tag-list order (carried ones marked), scrolled inside the popover; a workspace with no tags yet shows only the guidance line and «Type a name to create the first tag».
- A `404` from `getContactConversation` while `getContact` answered `200` (contract flag F-3, should not happen) renders the conversation card as «No conversation to show» with no **Open in inbox**; the contact part stays.
- After a successful merge or delete SCR-21 re-reads `listTags` and shows a one-line `Alert` above the table (««Loyal» merged into «VIP».» / ««Old promo» deleted.») until the next action or navigation. After a rename the row simply moves to its new place.
- A live frame never closes an open SCR-22 / SCR-23 (Settings — Tags is not live); their answers carry the current state instead.

## Screens

**Shared states (SCR-18…SCR-23 and the SCR-02 header tags).** The shared-inbox guard table (shared-inbox `screens.md` §Shared inbox states: 401 → SCR-09, 403 → SCR-07, guard 404 → SCR-06, socket close codes, resync, foreign-workspace frames dropped, workspace switch reset) applies unchanged. This feature adds the rows below; each screen lists them as one row pointing here.

| Trigger | What the panel does | Source |
| --- | --- | --- |
| `401 UNAUTHENTICATED` on any contacts or tags route | an open SCR-20 / SCR-22 / SCR-23 closes; as the inherited 401 row → SCR-09, then back to the same address (search, filter and contact id included) | AC-12; flow 4, flow 6 |
| `403 ACCESS_REMOVED` on the same routes, or the socket closes `4403` | an open popover or dialog closes; as the inherited 403 row → SCR-07; nothing of the workspace stays on screen | AC-12; flow 4 |
| guard `404 NOT_FOUND` (another workspace's address, unknown workspace) | the frame shows `NotFoundCard` (inherited); no hint the workspace, contact or tag exists | AC-12; flow 4, flow 6 |
| `contact.changed` (`change: tags`) for the shown contact | SCR-02's header and SCR-19 re-read `getContact`; SCR-19 also re-reads `listContactTagHistory` from the top; an open SCR-20 re-renders (the typed text is kept); other contacts' frames are ignored | AC-06; flow 11; events.md |
| `tags.changed` | the tag store re-reads `listTags` (picker, filter labels); SCR-02's header and SCR-19 re-read their contact's tags (and SCR-19 its tag history); a merged or deleted tag disappears, a renamed one shows its new name | AC-06, AC-09, AC-14; flow 11; events.md |
| `conversation.changed` for SCR-19's conversation | SCR-19 re-reads `getContactConversation`, the new thread items and `getContact` (a new Telegram name) — never `markConversationRead` | AC-05, AC-13; flow 7; events.md |
| `resync` / reconnect | the same re-reads as the three rows above for whatever is open | AC-05, AC-06; flow 11 |
| a frame that fails to parse | dropped; reconnect + resync (inherited rule; an old bundle ignores the two new frames) | events.md «Old bundles» |
| a background re-read fails (network / `500`) | what is shown stays; the next frame or resync asks again; no error shown | flow 7 «keeps what it shows» |
| workspace switched | the outlet remounts keyed on the workspace (inherited); SCR-18 starts with no search and no filter; the tag store is reloaded for the new workspace | AC-02; flow 4 |
| SCR-18 and SCR-21 are **not live** | they ignore every frame; they refresh when opened or when the search or filter changes | spec §1; flow 11 |

### SCR-18 — Contacts list

New, replaces `ContactsPreview` at `/w/<id>/contacts`, breadcrumb «Acme Flowers › Contacts». Both roles see and do the same (AC-01). Body: page title «Contacts», the toolbar (`DataTableToolbar`: search + Tags filter + the count), then the card-wrapped table. `listContacts` + `listTags` (for the filter).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | the page opens, or the search / filter changes — `listContacts` in flight; 8 `Skeleton` rows in the table, the toolbar stays usable, the count shows a short `Skeleton` (flow 4) | NEW: ContactsTable (Card, Table, Skeleton), DataTableToolbar | — |
| default | `200` with items — columns **Contact** (`Avatar` initials, name as a link to SCR-19, `@username` or «no username» below it), **Tags** (Decision 4), **Language** (`language_code` shown as the language's English name via `Intl.DisplayNames`, else the code; «Unknown» when null), **First wrote** (`formatBotDay`, «Never» when null), **Last wrote** (`relativeTime`, full date-time in `title`; «Never» when null). Newest last wrote first. The count reads «120 contacts». No sample data, no «Sample data» label (AC-01; flow 4; `listContacts` example `firstPage`) | NEW: ContactsTable (Card, Table, Avatar, Badge), DataTableToolbar | wireframe «contacts desktop» |
| show more | `has_next: true` — a **Show more** `Button` (`outline`) under the table; pressing it loads the next 50 after `next_cursor` and appends them (none shown twice or skipped); the button shows a spinner while loading and disappears when `has_next` is false (AC-01; flow 4) | NEW: ContactsTable, Button | wireframe «contacts desktop» |
| error: more failed | the next page fails (network / `500`) — the rows stay; an `Alert` (destructive) under them «Couldn't load more contacts» + **Retry** (flow 4) | Alert, Button | — |
| filtered | `q` and / or a tag filter in the address — the narrowed rows and «14 of 120 contacts match» (`matching_count` of `total_count`); the search `Input` and the Tags button show the current values (AC-02; flow 5; example `filtered`) | NEW: ContactsTable, NEW: TagFilter, DataTableToolbar, Input | wireframe «contacts filtered» |
| filter open | the **Tags** button pressed — the `Popover` of Decision 2: mode `RadioGroup`, one `Checkbox` per tag with its count, in tag-list order; a workspace with no tags shows «No tags yet — tags are added on a contact» and only the mode «No tags» (AC-02, AC-10; flow 5) | NEW: TagFilter (Popover, RadioGroup, Checkbox, Label) | wireframe «tag filter open» |
| filter: no tags mode | «No tags» chosen — the checkboxes clear and are disabled; the list shows contacts with no tag and their count (AC-02; flow 5) | NEW: TagFilter | — |
| notice: tag no longer exists | `missing_tag_ids` is not empty (a saved link with a deleted, merged or foreign tag) — those ids are removed from the address (`replace`) and an `Alert` above the table says «One of the chosen tags no longer exists, so it was left out of the filter.» until the filter changes; a renamed tag filters on under its new name, with no notice (AC-02; flow 5) | Alert | — |
| empty: nothing matches | `matching_count: 0` with `total_count > 0` — the table is replaced by «No contacts match your search and filter» + **Clear search and filter** (clears `q`, `mode` and `tag` from the address) (AC-03; flow 5) | EmptyFilterState (`actionLabel`) | — |
| empty: no contacts, owner without a bot | `total_count: 0`, the caller is a business owner and the existing `getInboxBotStatus` answers `not_connected` — «No contacts yet. A contact appears when a customer writes to your business bot.» + **Connect bot** → SCR-08; no toolbar (AC-03; flow 4) | Card, Button | wireframe «contacts empty» |
| empty: no contacts | `total_count: 0` in any other case (an operator, or a bot that is connected) — «No contacts yet. A contact appears when a customer writes to the business bot.»; no button, no toolbar (AC-03; flow 4) | Card | wireframe «contacts empty» |
| error | the first `listContacts` fails (network / `500`) — destructive `Alert` «Couldn't load contacts» + **Retry** in place of the table (flow 4) | Alert, Button | — |
| validation | N/A: the address is cleaned before the request (Decision 1), so the contract's `400` (none + tags, malformed id) cannot be sent by the panel; a `400` that still arrives is shown as `error` | — | — |
| pick a contact | the name link → SCR-19 at `/w/<id>/contacts/<contactId>`; back returns to the same address and list (AC-01, AC-04; flow 4) | — | — |
| live | N/A: not live (§Shared states) — a contact who writes while the list is open moves only on the next first page (flow 4 note) | — | — |
| phone (< md) | the Language and First wrote columns are hidden (as the preview); the search takes the full width, the Tags button and the count go on the next line; the filter popover is the trigger's width, at least 280 px | NEW: ContactsTable, DataTableToolbar | wireframe «contacts phone» |
| guard states | → §Shared states | — | §Shared states |

```text
contacts desktop                                               (owner and operator alike)
+------------------------------------------------------------------------------------------+
| Contacts                                                                                 |
| [ Search by name or username        ]  [Tags ▾]                          120 contacts    |
| +--------------------------------------------------------------------------------------+ |
| | Contact                  | Tags                    | Language  | First wrote | Last wrote | |
| |--------------------------+-------------------------+-----------+-------------+------------| |
| | (TU) Test User           | [Kyiv] [VIP]            | Ukrainian | 2 Sep 2026  | 3 min ago  | |
| |      @test_user_1        |                         |           |             |            | |
| | (T2) Test User 2         |                         | Unknown   | 18 Oct 2026 | yesterday  | |
| |      no username         |                         |           |             |            | |
| | (T3) Test User 3         | [Kyiv] [VIP] [Wh…] [+2] | English   | 1 Oct 2026  | 2 days ago | |
| |      @test_user_3        |                         |           |             |            | |
| |  …  (50 rows)            |                         |           |             |            | |
| +--------------------------------------------------------------------------------------+ |
|                                    [ Show more ]                                         |
+------------------------------------------------------------------------------------------+

contacts filtered  (?tag=<VIP id>&tag=<Kyiv id>&mode=all)
+------------------------------------------------------------------------------------------+
| [ Search by name or username        ]  [All of 2 tags ▾]           14 of 120 contacts match |
| [!] One of the chosen tags no longer exists, so it was left out of the filter.   (only    |
|     when missing_tag_ids is not empty)                                                    |
| +-------------------------------- table, as above ------------------------------------+ |
+------------------------------------------------------------------------------------------+

tag filter open
                 +----------------------------------+
  [Tags · 2 ▾] → | (•) Any of these tags            |
                 | ( ) All of these tags            |
                 | ( ) No tags                      |
                 |----------------------------------|
                 | [x] Kyiv                     30  |
                 | [ ] Old promo                40  |
                 | [x] VIP                      14  |
                 | [ ] Wholesale                 0  |
                 +----------------------------------+

contacts empty
+------------------------------------------------------------------------------------------+
| Contacts                                                                                 |
| +--------------------------------------------------------------------------------------+ |
| | No contacts yet. A contact appears when a customer writes to your business bot.      | |
| | [ Connect bot ]          (owner, bot not connected only)                             | |
| +--------------------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------------+

contacts phone
+--------------------------------+
| [≡] | Acme Flowers › Contacts  |
|--------------------------------|
| Contacts                       |
| [ Search by name or username ] |
| [Tags ▾]          120 contacts |
| +----------------------------+ |
| | Contact       | Tags  | Last| |
| | (TU) Test User| [Kyiv]| 3 m | |
| |  @test_user_1 | [VIP] |     | |
| +----------------------------+ |
|         [ Show more ]          |
+--------------------------------+
```

### SCR-19 — Contact profile

New, replaces `ContactProfilePreview` at `/w/<id>/contacts/<contactId>`, breadcrumb «Acme Flowers › Contacts › <contact name>» (NEW: ContactCrumb). Three parts load in parallel (seeded flow 3): the **header card** (`getContact`), the **conversation card** (`getContactConversation`) and the **tabs** «Conversation» (`listThreadItems`, read-only) and «Tag history» (`listContactTagHistory`). Nothing on this screen marks anything read and there is no reply box (AC-05, ADR-0006).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | the page opens — the header card shows a `Skeleton` avatar, name and fact lines; the conversation card a `Skeleton` badge row; the Conversation tab 4 bubble skeletons (flow 6; S3) | NEW: ContactProfile (Card, Skeleton), Tabs | — |
| default | `getContact` `200` — header card: `Avatar` (initials, `size-16`), name (`h1`), `@username` or «no username», the facts line «Ukrainian · First wrote 2 Sep 2026 · Last wrote 3 min ago», and the tags row: every carried tag as a `Badge` with «Added by Test User, 19 Oct, 10:02» in its `title` and in the tag control, then **Add tag** (SCR-20). Conversation card from `getContactConversation`: status `Badge` («Open» / «Closed»), «Assigned to Test User 2» or «Unassigned», «Waiting for a reply» (the inbox's waiting marker) when `waiting_for_reply`, and **Open in inbox** → SCR-02 `/w/<id>/inbox/<conversationId>`. Tabs: «Conversation» selected (AC-04; flow 6; S3; `getContact`, `getContactConversation` examples) | NEW: ContactProfile (Card, Avatar, Badge, Button, Tabs), NEW: TagControl | wireframe «profile desktop» |
| default: missing facts | a null username, language or wrote time — «no username», «Unknown», «Never» (Decision 10); a contact with no tags shows «No tags» (muted) before **Add tag** (AC-01, AC-04) | NEW: ContactProfile | — |
| default: deactivated adder | an adder or history actor who was deactivated — shown by their display name as any member (`MemberRef` keeps the name) (AC-13; flow 6) | NEW: ContactProfile, NEW: TagHistoryList | — |
| conversation tab | the history in inbox order from `listThreadItems` (newest at the bottom, scrolled to the end on open): customer messages and team replies as `MessageBubble` with `MessageContent`, the reply's author and its delivery state (read-only, Decision 6), activity entries as `ActivityLine`; «Start of the conversation» at the top when `has_prev` is false (AC-04; flow 7; S3) | NEW: ContactConversationHistory (ScrollArea, MessageBubble, MessageContent, ActivityLine, extended: ReplyDeliveryState) | wireframe «profile desktop» |
| conversation: loading older | scrolled to the top with `has_prev` — the previous page by `before`; a bubble `Skeleton` on top while it loads (AC-04; flow 7) | NEW: ContactConversationHistory, Skeleton | — |
| conversation: older failed | the older page fails — destructive `Alert` «Couldn't load earlier messages» + **Retry** on top; what is shown stays (flow 7) | Alert, Button | — |
| conversation: media | a photo or video opened — SCR-03 `MediaViewer` over the profile; other media (file, voice, location…) as in the inbox `MessageContent` (AC-04; flow 7) | MediaViewer, MessageContent | — |
| conversation: empty | `listThreadItems` returns no item (every message gone) — «No messages to show» in the tab (AC-04) | NEW: ContactConversationHistory | — |
| conversation: none | `getContactConversation` `404` while the contact is found (contract F-3; assumption) — the conversation card reads «No conversation to show», no **Open in inbox**; the Conversation tab shows the same sentence | NEW: ContactProfile | — |
| conversation: error | `getContactConversation` or the first `listThreadItems` fails (network / `500`) — destructive `Alert` «Couldn't load the conversation» + **Retry** in the conversation card and tab; the header card stays (flow 7) | Alert, Button | — |
| live: conversation changed | `conversation.changed` for this conversation (a message, a reply, an assignment, a status change, an edit) — the status, assignee and waiting marker change in place, the new item appears at the bottom (the view follows it only when it was at the bottom), and a new Telegram name shows in the header; **nothing is marked read**: the inbox unread count, the frame's attention count and pings stay as they were (AC-05, AC-13; flow 7; events.md) | NEW: ContactProfile, NEW: ContactConversationHistory | — |
| tag history tab | «Tag history» chosen — `listContactTagHistory`, newest first, one line per entry composed from `kind` + names + actor + time: «Test User added «Kyiv» · inbox · 19 Oct, 10:02», «Test User removed «Wholesale» · inbox · …», «Test Owner merged «Loyal» into «VIP» · …», ««Old promo» removed by Test Owner's delete · …», each under the name the tag had then (AC-04, AC-09; flow 6) | NEW: TagHistoryList (ScrollArea, Separator) | wireframe «profile tag history» |
| tag history: loading / more | first page: 5 line `Skeleton`s; scrolled to the end with `has_next` → the next page by `after`, a `Skeleton` line at the bottom (AC-04; flow 6) | NEW: TagHistoryList, Skeleton | — |
| tag history: empty | no entry — «No tag changes yet» (AC-04) | NEW: TagHistoryList | — |
| tag history: error | the read fails — destructive `Alert` «Couldn't load the tag history» + **Retry** in the tab (flow 6) | Alert, Button | — |
| live: tags changed | `contact.changed` for this contact or `tags.changed` — the header's tags and the tag history (from the top) re-read and update in place; a merged or deleted tag disappears, a renamed one shows its new name (AC-06, AC-09; flow 11) | NEW: ContactProfile, NEW: TagHistoryList | — |
| tagging | **Add tag** → SCR-20 opens over the header card with `source: profile` (AC-06; flow 8) | NEW: TagControl | §SCR-20 |
| not found | `getContact` `404` (unknown id, a contact of another workspace) — `NotFoundCard` inside the frame, no hint; the conversation part is not shown (AC-04, AC-12; flow 6) | NotFoundCard | — |
| error | `getContact` fails (network / `500`) — destructive `Alert` «Couldn't load this contact» + **Retry** in place of the header card (flow 6) | Alert, Button | — |
| open in inbox | **Open in inbox** → SCR-02 of the conversation, where reading counts as before (AC-05; flow 7) | Button | — |
| validation | N/A: the profile takes no input (the tag control is SCR-20) | — | — |
| phone (< md) | the header card stacks (avatar above the name, as the preview); **Open in inbox** is full width; the tabs list is full width | NEW: ContactProfile | wireframe «profile phone» |
| guard states | → §Shared states | — | §Shared states |

```text
profile desktop                                            breadcrumb: Acme Flowers › Contacts › Test User
+------------------------------------------------------------------------------------------+
| +--------------------------------------------------------------------------------------+ |
| | (TU)   Test User                                                                     | |
| |        @test_user_1                                                                  | |
| |        Ukrainian · First wrote 2 Sep 2026 · Last wrote 3 min ago                     | |
| |        [Kyiv] [VIP]  [+ Add tag]                                                     | |
| +--------------------------------------------------------------------------------------+ |
| +--------------------------------------------------------------------------------------+ |
| | Conversation   [Open]  Assigned to Test User 2  · Waiting for a reply  [Open in inbox] | |
| +--------------------------------------------------------------------------------------+ |
| [ Conversation | Tag history ]                                                           |
| +--------------------------------------------------------------------------------------+ |
| |                        Start of the conversation                                     | |
| |  ( Do you deliver on Sunday?                          09:58 )                        | |
| |                    — Test User 2 was assigned by Test User · 10:00 —                 | |
| |                         ( Yes, until 14:00 — Test User 2  10:01 )                    | |
| |                                                        Sent                          | |
| |   (no reply box — read only)                                                         | |
| +--------------------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------------+

profile tag history
| [ Conversation | Tag history ]                                                           |
| +--------------------------------------------------------------------------------------+ |
| | Test User removed «Wholesale» · inbox                         19 Oct, 10:02           | |
| | Test User added «Kyiv» · inbox                                19 Oct, 10:02           | |
| | Test Owner merged «Loyal» into «VIP»                          12 Oct, 16:20           | |
| | «Old promo» removed by Test Owner's delete                     5 Oct, 09:00           | |
| |  …  (older on scrolling)                                                              | |
| +--------------------------------------------------------------------------------------+ |

profile phone
+--------------------------------+
| [≡] | … › Contacts › Test User |
|--------------------------------|
| +----------------------------+ |
| | (TU)                       | |
| | Test User                  | |
| | @test_user_1               | |
| | Ukrainian · First wrote …  | |
| | [Kyiv] [VIP] [+ Add tag]   | |
| +----------------------------+ |
| | [Open] Unassigned          | |
| | [     Open in inbox      ] | |
| +----------------------------+ |
| [ Conversation | Tag history ] |
| ( history … )                  |
+--------------------------------+
```

### SCR-20 — Tag control

New, a `Popover` (Decision 3) opened by **Add tag** on SCR-02's header (`source: inbox`) or on SCR-19 (`source: profile`). It reads the contact's tags from its host (`getContact`) and the workspace's tags from the tag store (`listTags`); it writes through `addContactTag` / `removeContactTag`. Nothing it does reaches the customer, and it works in every state of the bot (AC-06, AC-13).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | opened — focus in the search `Input` («Add a tag…»); above it the carried tags as `Badge`s, each with a remove button (`aria-label` «Remove tag Kyiv») and «Added by Test User, 19 Oct» in its `title`; below it, with the field empty, every workspace tag in tag-list order (carried ones marked «✓ On this contact», not selectable); at the bottom, always, the guidance line «Tags are visible to your whole team. Don't use them for health, religion or other sensitive traits.» (AC-06; flow 8) | NEW: TagControl (Popover, Input, Badge, Button, ScrollArea, Separator) | wireframe «tag control» |
| typing: matches | text typed — tidied and case-folded with the shared functions; tags whose tidied name **starts with** it first, then those that **contain** it, each group in tag-list order; carried ones stay marked and unselectable (AC-06; flow 8) | NEW: TagControl | wireframe «tag control» |
| typing: exact match | the text equals a tag's name ignoring case and spacing («vip», « VIP », «VIP  ») — only that tag is offered (or shown as carried), **no** create row (AC-06, AC-08; flow 8) | NEW: TagControl | — |
| typing: new name | no tag has that name — the matches (if any) and, last, the separate row **Create tag "Kyiv"** (the tidied text, quoted) (AC-06; flow 9) | NEW: TagControl | wireframe «tag control» |
| validation: name rules | **Create tag** with a text that tidies to empty or to more than 32 characters (graphemes) — checked in the browser first, nothing sent; `FieldError` under the input «A tag name must be 1 to 32 characters», input `aria-invalid`; the same text for a server `400 TAG_NAME_INVALID` (AC-07; flow 9) | NEW: TagControl, Field (`FieldError`) | — |
| pending | a tag picked, created or removed — a spinner on that row or badge; every add / remove control is disabled until the answer; the input stays editable (flow 8, flow 9, flow 10) | NEW: TagControl | — |
| success: added | `200` `outcome: recorded` — the tag moves into the carried badges under its current name (a tag renamed meanwhile shows its new name), the input clears and keeps focus; the host's tags update from the answer's `tags`; with `tag_created: true` the tag store re-reads `listTags`. Teammates see it through `contact.changed` (AC-06, AC-14; flow 8, flow 9; S1) | NEW: TagControl | — |
| success: removed | `200` `outcome: recorded` on remove — the badge goes; the host updates (AC-06; flow 10) | NEW: TagControl | — |
| unchanged | `200` `outcome: unchanged` (a teammate added or removed the same tag a moment earlier) — the control shows the answer's `tags`, no message (AC-06; flow 8, flow 10) | NEW: TagControl | — |
| limit: contact carries 20 | 20 badges carried (on open, or `409 CONTACT_TAG_LIMIT_REACHED`) — the suggestion and create rows are disabled and an `Alert` reads «A contact can carry at most 20 tags. Remove one to add another.»; remove still works (AC-08; flow 8) | NEW: TagControl, Alert | — |
| limit: workspace has 100 | `409 TAG_LIMIT_REACHED` on **Create tag** — `Alert` «A workspace can have at most 100 tags. A business owner can merge or delete some in Settings → Tags.»; nothing created; picking existing tags still works (AC-08; flow 9) | NEW: TagControl, Alert | — |
| refused: tag no longer exists | `404 TAG_NOT_FOUND` — `Alert` «This tag no longer exists.»; the tag store re-reads `listTags` and the host re-reads `getContact`, so the control shows the current tags (AC-14; flow 8; S1) | NEW: TagControl, Alert | — |
| limit: rate | `429 TAG_CHANGE_LIMIT_REACHED` — `Alert` «Tag changes are limited to 60 a minute. You can continue in 14 s.» counting down to `details.retry_at`; add and remove disabled until then, then the alert goes (AC-15; flow 8, flow 10) | NEW: TagControl, Alert | — |
| error: action failed | network / `500` — destructive `Alert` «Couldn't change the tags — try again.»; controls enabled again; nothing shown changed (flow 8) | NEW: TagControl, Alert (destructive) | — |
| empty: no tags yet | the workspace has no tags and the field is empty — «Type a name to create the first tag» above the guidance line (assumption) | NEW: TagControl | — |
| loading | the tag store has not loaded `listTags` yet — 3 row `Skeleton`s in the suggestion list; the carried badges (from the host) show at once (flow 8) | NEW: TagControl, Skeleton | — |
| live | `contact.changed` / `tags.changed` while open — carried badges and suggestions re-render; the typed text stays; a tag merged or deleted meanwhile disappears from the suggestions (AC-06, AC-14; flow 11) | NEW: TagControl | — |
| closed | Esc, a click outside, or the trigger again — focus returns to **Add tag**; the host shows the updated tags (flow 8) | — | — |
| not found | `404 NOT_FOUND` for the contact (contact not of this workspace) — the control closes and the host re-reads (SCR-19 → not found) (AC-12; flow 8) | — | — |
| phone (< md) | the popover takes the viewport width minus the 16 px gutters and opens below the trigger; rows are 44 px tall | NEW: TagControl | — |
| guard states | → §Shared states | — | §Shared states |

```text
tag control (opened from the SCR-02 header or SCR-19)
               +-----------------------------------------------+
 [+ Add tag] → | [Kyiv ×] [VIP ×]                               |
               | [ vi                                         ] |
               |-----------------------------------------------|
               |  VIP                       ✓ On this contact  |   ← starts with "vi"
               |  Vintage                                      |
               |  Kyiv VIP clients                             |   ← contains "vi"
               |  + Create tag "vi"                            |   ← only when no tag is "vi"
               |-----------------------------------------------|
               | Tags are visible to your whole team. Don't    |
               | use them for health, religion or other        |
               | sensitive traits.                             |
               +-----------------------------------------------+

refusal in place (example: rate limit)
               +-----------------------------------------------+
               | [Kyiv ×] [VIP ×]                               |
               | [ Wholesale                                  ] |
               | [!] Tag changes are limited to 60 a minute.    |
               |     You can continue in 14 s.                  |
               |  Wholesale                      (disabled)    |
               |-----------------------------------------------|
               | Tags are visible to your whole team. …        |
               +-----------------------------------------------+
```

### SCR-21 — Settings — Tags

New. `/w/<id>/settings/tags`, breadcrumb «Acme Flowers › Settings › Tags», inside `SettingsLayout` (extended, Decision 7). `listTags`. Not live: read when opened and after each action of its own (spec §1).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | the section opens — a `Card` with 5 `Skeleton` rows (flow 12) | NEW: TagsSettings (Card, Table, Skeleton) | — |
| default | `200` — Card title «Tags», description «Every tag of the workspace with the number of contacts carrying it. Tags are created on a contact, in the inbox or on the profile.»; a `Table` **Tag** · **Contacts** · actions, every tag in tag-list order, zero-count tags included; the count is a link «30 contacts» → SCR-18 `?tag=<id>` (Decision 8; «0 contacts» is plain text); **Rename** and **Delete** on each row; no way to create a tag here (AC-10; flow 12; `listTags` example) | NEW: TagsSettings (Card, Table, Button) | wireframe «settings tags» |
| count chosen | the count link → SCR-18 filtered by that tag, showing the same number in «N of M contacts match» (AC-10; flow 12) | — | — |
| success notice | after a merge or a delete — a one-line `Alert` above the table (««Loyal» merged into «VIP».» / ««Old promo» deleted.») until the next action or navigation; after a rename the row moves to its new place (assumption) | Alert | — |
| refused: tag gone | an action answers `404 TAG_NOT_FOUND` — the dialog closes, the list re-reads, `Alert` «This tag no longer exists.» (AC-14; flow 13) | Alert | — |
| empty | no tags — «No tags yet. Tags are created on a contact, in the inbox or on the profile.» in the card; no table (AC-10) | Card | — |
| error | `listTags` fails (network / `500`) — destructive `Alert` «Couldn't load the tags» + **Retry** (flow 12) | Alert, Button | — |
| owners only | an operator on the Tags address (a saved link) — the in-place card «Only a business owner manages the workspace's tags» + **Back to inbox**, as on Bot and Team; the operator's section menu shows no Tags (AC-11; flow 12) | Card, Button | — |
| owners only: lost meanwhile | an action answers `403 OWNER_ONLY` (the role changed since the page opened) — the dialog closes and the section shows the owners-only card (AC-11; flow 13) | Card, Button | — |
| phone (< md) | the section menu stacks above (inherited `SettingsLayout`); **Rename** / **Delete** collapse into a row-actions `DropdownMenu` «⋯» (Decision 8) | DropdownMenu | wireframe «settings tags» |
| validation | N/A: no input on the list itself (rename has SCR-22) | — | — |
| guard states | → §Shared states | — | §Shared states |

```text
settings tags (owner, desktop)                       breadcrumb: Acme Flowers › Settings › Tags
+--------------------------------------------------------------------------------------------+
| Settings                                                                                   |
| Manage your workspace's bot, team and tags, and your notifications                         |
|                                                                                            |
|  Bot           +-----------------------------------------------------------------------+   |
|  Team          | Tags                                                                  |   |
|  Tags   ●      | Every tag of the workspace with the number of contacts carrying it.   |   |
|  Notifications | Tags are created on a contact, in the inbox or on the profile.        |   |
|                |-----------------------------------------------------------------------|   |
|                | Tag              | Contacts        |                                   |   |
|                | Kyiv             | 30 contacts     |               [Rename] [Delete]   |   |
|                | Old promo        | 40 contacts     |               [Rename] [Delete]   |   |
|                | VIP              | 14 contacts     |               [Rename] [Delete]   |   |
|                | Wholesale        | 0 contacts      |               [Rename] [Delete]   |   |
|                +-----------------------------------------------------------------------+   |
+--------------------------------------------------------------------------------------------+
phone: the rows end in [⋯] → Rename / Delete
```

### SCR-22 — Rename tag (+ merge step)

New, a `Dialog` over SCR-21 opened by **Rename** (Decision 9). `renameTag`. Focus returns to the row's **Rename** (or «⋯») on close.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | opened — title «Rename tag», `Field` «Name» prefilled with the current name and selected; **Cancel** / **Save** (AC-09; flow 13) | NEW: RenameTagDialog (Dialog, Field, Input, Label, Button) | wireframe «rename» |
| validation | **Save** with a name that tidies to empty or to more than 32 characters — checked in the browser, nothing sent; `FieldError` «A tag name must be 1 to 32 characters»; the same for a server `400 TAG_NAME_INVALID` (AC-07; flow 13) | NEW: RenameTagDialog, Field (`FieldError`) | — |
| pending | **Save** or **Merge tags** pressed — spinner on the button, both buttons disabled, Esc ignored (flow 13) | NEW: RenameTagDialog | — |
| success: renamed | `200` `outcome: renamed` — the dialog closes; the row shows the new name in its new place; a case- or spacing-only change («vip» → «VIP») only changes how it is shown (AC-09, AC-14; flow 13) | NEW: RenameTagDialog | — |
| success: unchanged | `200` `outcome: unchanged` (the same text) — the dialog closes, nothing changes (AC-09; flow 13) | NEW: RenameTagDialog | — |
| merge offer | `409 TAG_NAME_TAKEN` — the dialog turns into step 2: title «Merge into «VIP»?»; «A tag named «VIP» already exists (12 contacts). Merging moves the 3 contacts of «Loyal» to «VIP» — a contact that has both keeps one — and «Loyal» is gone. Each of those contacts' tag history records the merge. This cannot be undone.»; **Back** (to step 1, the typed name kept) / **Merge tags** (`destructive`). The counts come from `details.tag.contact_count` and the row's own count (AC-09; flow 13; S2) | NEW: RenameTagDialog (Dialog, Button) | wireframe «merge step» |
| success: merged | `200` `outcome: merged` — the dialog closes; «Loyal» leaves the list, «VIP» shows its new count (`tag.contact_count`, 14 in the AC example); the success notice of SCR-21 (AC-09; flow 13; S2) | NEW: RenameTagDialog | — |
| refused: merge target changed | `409 TAG_MERGE_TARGET_CHANGED` — with `details.name_holder` set: step 2 again, now naming that tag and its count, with the notice «The tag to merge into changed — check again.»; with `name_holder: null`: back to step 1 with that notice, where **Save** now renames plainly (AC-09; flow 13) | NEW: RenameTagDialog, Alert | — |
| refused: tag gone | `404 TAG_NOT_FOUND` (deleted or merged meanwhile) — the dialog closes; SCR-21 `refused: tag gone` (AC-14; flow 13) | — | — |
| refused: owners only | `403 OWNER_ONLY` — the dialog closes; SCR-21 `owners only: lost meanwhile` (AC-11; flow 13) | — | — |
| error | network / `500` — destructive `Alert` «Couldn't rename the tag — try again.» in the dialog; buttons enabled again (flow 13) | Alert (destructive) | — |
| loading / empty | N/A: a form over data already on screen | — | — |
| guard states | → §Shared states | — | §Shared states |

```text
rename                                         merge step (after 409 TAG_NAME_TAKEN)
+-------------------------------------+        +-----------------------------------------------+
| Rename tag                       ×  |        | Merge into «VIP»?                          ×  |
|                                     |        |                                               |
| Name                                |        | A tag named «VIP» already exists (12          |
| [ vip                             ] |        | contacts). Merging moves the 3 contacts of    |
|                                     |        | «Loyal» to «VIP» — a contact that has both    |
|                 [Cancel]  [ Save ]  |        | keeps one — and «Loyal» is gone. Each of      |
+-------------------------------------+        | those contacts' tag history records the       |
                                               | merge. This cannot be undone.                 |
                                               |                                               |
                                               |              [Back]  [ Merge tags ]           |
                                               +-----------------------------------------------+
```

### SCR-23 — Confirm delete tag

New, an `AlertDialog` over SCR-21 opened by **Delete** (Decision 9). `deleteTag` with `expected_count` = the count the dialog shows. Focus opens on **Cancel** and returns to the row's **Delete** (or «⋯»).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | opened — title «Delete «Old promo»?»; «It will be removed from 40 contacts. Each of them keeps a note in its tag history. This cannot be undone.» (`contact_count` from the list; with 0: «No contact carries it. This cannot be undone.»); **Cancel** / **Delete tag** (`destructive`) (AC-09; S2) | NEW: DeleteTagDialog (AlertDialog, Button) | wireframe «delete» |
| pending | **Delete tag** pressed — spinner, both buttons disabled, Esc ignored (S2) | NEW: DeleteTagDialog | — |
| success | `200` — the dialog closes; the row goes; the success notice of SCR-21 (AC-09; S2) | NEW: DeleteTagDialog | — |
| asks again | `409 TAG_COUNT_CHANGED` — nothing was deleted; the text updates to `details.tag.contact_count` («It will be removed from 41 contacts…») with the notice above the buttons «The number of contacts changed since you opened this.»; **Delete tag** now sends the new number (AC-09; S2) | NEW: DeleteTagDialog, Alert | wireframe «delete» (asks again) |
| refused: tag gone | `404 TAG_NOT_FOUND` — the dialog closes; SCR-21 `refused: tag gone` (AC-14; S2) | — | — |
| refused: owners only | `403 OWNER_ONLY` — the dialog closes; SCR-21 `owners only: lost meanwhile` (AC-11; S2) | — | — |
| error | network / `500` — destructive `Alert` «Couldn't delete the tag — try again.» in the dialog (S2) | Alert (destructive) | — |
| loading / empty / validation | N/A: a confirmation over data on screen, no input | — | — |
| guard states | → §Shared states | — | §Shared states |

```text
delete                                            asks again (409 TAG_COUNT_CHANGED)
+---------------------------------------------+   +---------------------------------------------+
| Delete «Old promo»?                         |   | Delete «Old promo»?                         |
|                                             |   |                                             |
| It will be removed from 40 contacts. Each   |   | It will be removed from 41 contacts. Each   |
| of them keeps a note in its tag history.    |   | of them keeps a note in its tag history.    |
| This cannot be undone.                      |   | This cannot be undone.                      |
|                                             |   | [!] The number of contacts changed since    |
|          [Cancel]  [ Delete tag ]           |   |     you opened this.                        |
+---------------------------------------------+   |          [Cancel]  [ Delete tag ]           |
                                                  +---------------------------------------------+
```

### SCR-02 — Inbox — conversation thread (header extension)

Every shared-inbox, assignment-statuses and operator-notifications SCR-02 state is kept (extended: Thread). Added to the **header** only; the list rows (SCR-01) show no tags (spec §1). The header reads `getContact` for `ConversationSummary.contact.id`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: tags | the header shows, under the name and `@username`, the contact's tags as `Badge`s in tag-list order and **Add tag** (SCR-20, `source: inbox`); a contact with no tags shows only **Add tag** (AC-06; flow 8) | extended: Thread, NEW: TagControl | wireframe «thread header» |
| default: name links to the profile | the contact's name (and avatar) in the header is a link to SCR-19 `/w/<id>/contacts/<contactId>` (AC-04; flow 6) | extended: Thread | wireframe «thread header» |
| loading: tags | `getContact` in flight — a short `Skeleton` in the tags row; the rest of the header as before (flow 8) | extended: Thread, Skeleton | — |
| error: tags | `getContact` fails (network / `500`) — the tags row reads «Couldn't load tags» (muted) + a **Retry** link button; replying and the actions are unaffected (flow 8) | extended: Thread, Button (`link`) | — |
| live: tags | `contact.changed` for this contact / `tags.changed` — the tags row re-reads and updates in place for every member with this header open (AC-06, AC-09; flow 11) | extended: Thread | — |
| tagging | **Add tag** → SCR-20 over the thread; the member stays in the conversation, the composer keeps its draft (AC-06; flow 8) | NEW: TagControl | §SCR-20 |
| phone (< md) | the tags row wraps under the header row, above the actions row (`compact`) | extended: Thread | — |
| reading | unchanged: opening the thread marks read as before — including when reached by **Open in inbox** from SCR-19 (AC-05; flow 7) | Thread | — |
| empty / other states | N/A for the tags row beyond «no tags» above; every other state inherited | — | — |

```text
thread header (desktop)
+-------------------------------------------------------------------------------------+
| (TU) Test User                                  [Open] [Test User 2 ▾] [Close]      |
|      @test_user_1                                                                   |
|      [Kyiv] [VIP] [+ Add tag]                                                       |
|-------------------------------------------------------------------------------------|
| (thread …)                                                                          |
```

### SCR-01 — Inbox — conversation list (landing)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **no change**: the rows show no tags and the lenses gain no tag lens (spec §3, §1 clarifications) | InboxList, ConversationList | — |
| unread / attention | reading a conversation's history on SCR-19 leaves this list's unread badges and the frame's count as they were (AC-05; flow 7) | ConversationList | — |
| error / empty / loading | inherited verbatim (shared-inbox, assignment-statuses §SCR-01); nothing new | InboxList | — |

### SCR-03 — Media viewer

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entry**: a photo or video opened from SCR-19's Conversation tab; closing returns focus to it on the profile (AC-04; flow 7) | MediaViewer | — |
| loading, error, unavailable | inherited (Telegram not responding + Try again; unavailable reasons) | Skeleton, Alert, Button | — |

### SCR-06 — Not found (in frame)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entries**: a contact address that is unknown or of another workspace (`getContact` `404`), and the Contacts or Tags address of a workspace the account is not a member of — no hint that it exists (AC-04, AC-12; flow 4, flow 6) | AppShell, NotFoundCard | — |
| error / empty | N/A: a static card with no data load | — | — |

### SCR-07 — Access-removed landing

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entries**: `403 ACCESS_REMOVED` on any contacts or tags route, and the socket close `4403` on SCR-18…SCR-23 (AC-12; flow 4) | AuthLayout, Alert, Button, Badge | — |
| loading, error | inherited | Skeleton, Alert, Button | — |

### SCR-08 — Settings — Bot

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entry**: **Connect bot** on SCR-18's empty state (owner, no bot) opens it; the owner's section menu now also lists **Tags** (Decision 7) (AC-03; flow 4) | SettingsLayout, Card, Badge, Alert, Button | — |
| owners only, loading, error | inherited | Card, Button, Skeleton, Alert | — |

### SCR-09 — Sign-in

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entries**: a signed-out visit to a Contacts address (search and filter kept), a profile address or `/w/<id>/settings/tags`; after sign-in the same address opens (AC-12; flow 4) | AuthLayout, Field, Input, Label, Button | — |
| validation, error | inherited | Field, Alert, Button | — |

### SCR-15 — Workspace frame

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **Contacts** in the navigation now opens the real list (SCR-18); the attention count and title prefix are untouched by anything on SCR-18…SCR-23 (AC-01, AC-05) | AppShell, Sidebar | — |
| breadcrumb: contact | on a profile the last crumb is the contact's display name from `getContact` (name, else `@username`), «Contact» while loading or not found (Decision 5) | Breadcrumb, NEW: ContactCrumb | — |
| settings menu | the Settings sections follow the role, now with Tags for owners (Decision 7, extended: SettingsLayout); an operator never sees Tags (AC-11; flow 12) | extended: SettingsLayout | wireframe «settings tags» |
| entering / not found / error / access removed | inherited verbatim (ui-redesign SCR-07, operator-notifications §SCR-15) | Skeleton, NotFoundCard, Alert | — |
| empty | N/A: the frame has no list of its own | — | — |

## New components

| Component | Why no existing primitive fits | Registered in design-system |
| --- | --- | --- |
| ContactsTable | SCR-18's list on `listContacts`: the address-driven query (Decision 1), keyset **Show more**, the two counts, the missing-tag notice, the three empty / error states and the row layout with tags. Replaces `ContactsPreview`; composes DataTableToolbar, Input, Card, Table, Avatar, Badge, Button, Alert, Skeleton, EmptyFilterState, TagFilter | pending |
| TagFilter | SCR-18's tag filter: a mode `RadioGroup` with the «No tags» rule (clears and disables the tags) over a `Checkbox` list with counts, labelled from `listTags`. The preview's checkbox popover had no mode and used names; composes Popover, RadioGroup, Checkbox, Label, Button | pending |
| ContactProfile | SCR-19's three-part page: header card with facts, tags and **Add tag**; conversation card (status, assignee, waiting marker, **Open in inbox**) from `getContactConversation`; the Conversation / Tag history tabs; live re-reads that never mark read. Replaces `ContactProfilePreview`; composes Card, Avatar, Badge, Button, Tabs, Skeleton, Alert, NotFoundCard | pending |
| ContactConversationHistory | SCR-19's read-only thread: `Thread` cannot be reused as is, because it marks read while visible and owns the composer (ADR-0006). Renders the same items with MessageBubble, MessageContent, ActivityLine and ReplyDeliveryState (`readOnly`), paged by `before`, live by `conversation.changed`, media through MediaViewer; composes ScrollArea, Skeleton, Alert, Button | pending |
| TagHistoryList | SCR-19's tag history lines, composed from `kind` + name snapshots + actor + time (sad.md §8 Internationalisation), paged by `after`; like `ActivityLine`, fixed copy that no primitive provides; composes ScrollArea, Separator, Skeleton, Alert, Button | pending |
| TagControl | SCR-20: the combobox over the workspace tags (shared tidy / fold matching, starts-with before contains, exact match hides create, carried marked), the create row, the carried badges with remove, the always-on guidance line, and every refusal in place. The shadcn `command` primitive would add the `cmdk` dependency, and a `DropdownMenu` cannot hold an input or stay open for refusals; composed like `AssigneeChooser` from Popover, Input, Badge, Button, Field, Alert, ScrollArea, Separator, Skeleton | pending |
| TagsSettings | SCR-21: the owner's tag table with counts as links to the filtered list, row actions, the success / gone notices and the owners-only card; composes Card, Table, Button, DropdownMenu, Alert, Skeleton | pending |
| RenameTagDialog | SCR-22: a two-step `Dialog` — the name form with the shared name rules, then the merge offer from `TAG_NAME_TAKEN`, with the `TAG_MERGE_TARGET_CHANGED` re-ask; no existing dialog holds a form and a confirmation step; composes Dialog, Field, Input, Label, Button, Alert | pending |
| DeleteTagDialog | SCR-23: the delete confirmation that sends the count it shows and asks again on `TAG_COUNT_CHANGED`, after `CloseConfirmDialog`'s pattern; composes AlertDialog, Alert, Button | pending |
| ContactCrumb | The profile's breadcrumb label from live contact data, like `ConversationCrumb` (the shell's `handle.Crumb` slot); replaces the route's sample-data crumb | pending |
| Thread (extended) | Existing component; the header gains the tags row with TagControl (`source: inbox`), its loading / error / live states, and the contact name as a link to SCR-19 — canon row updated, not duplicated | pending |
| ReplyDeliveryState (extended) | Existing component; gains `readOnly`: the state text without «Try again» / «Send again», for SCR-19 — canon row updated | pending |
| SettingsLayout (extended) | Existing component; gains the owner-only **Tags** section and the owner's description line (Decision 7) — canon row updated | pending |
| SampleDataBadge (retired from contacts) | Not new: SCR-18 / SCR-19 no longer use it, and the contacts sample source goes with the previews; `implement` removes the component if nothing else uses it and updates its canon row | pending |
