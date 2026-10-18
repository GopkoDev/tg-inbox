---
status: draft
feature_size: "M"
tool: "code"
updated_at: "2026-10-18"
---

# Screens — assignment-statuses

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`) — inline wireframes below, one per state that needs a distinct layout. No degradation: the canon's tool is `code`, so no Figma / Pencil MCP was needed.
- **File:** inline wireframes below.
- **Inventory:** SCR ids from [`ux-flows.md`](ux-flows.md) §Screen inventory — SCR-01, SCR-02, SCR-06, SCR-07, SCR-09, SCR-10…SCR-14, all covered. SCR-01/02 are the shipped shared-inbox screens ([shared-inbox `screens.md`](../shared-inbox/screens.md)); every state listed there stays as is and is **not repeated** here — this manifest lists only the states this feature adds or changes. SCR-10/11/12 are new. SCR-06, SCR-07, SCR-09 are routed to with no new state. SCR-13/14 are ui-redesign SCR-12/SCR-17 under local ids.
- **Component names:** names from the canon inventory (`AppShell`, `NotFoundCard`, `Card`, `Button`, `Badge`, `Alert`, `AlertDialog`, `Popover`, `Select`, `Tabs`, `Separator`, `Avatar`, `ScrollArea`, `Skeleton`, `Input`, `AuthLayout`, `SettingsLayout`, `Table`, `DropdownMenu`, `EmptyFilterState`, `ConversationList`, `Thread`, `MessageBubble`, `ReplyComposer`); `extended: <name>` = an existing inventory component that gains states (its canon row is updated, not duplicated); `NEW: <name>` = a reusable part listed under §New components. No primitive from the canon's _Not yet in the repo_ list is needed (no toast, no `command` — every outcome is shown in place).
- **Sources per row:** spec §5 ACs, sad.md §6 flows (`flow N`), contract responses (`openapi.yaml` `operationId` + status/code) and the live frame (`contracts/events.md` `conversation.changed` item `activity`). Every non-default state names at least one.
- **Copy:** existing texts stay word for word. Activity-line and refusal texts follow the contract (`listThreadItems` description, `error.message` examples); new texts are quoted below and may be polished in `implement` without changing their meaning. Every member display name and customer name renders as plain text (spec §6.1). Relative times («2 minutes ago») use the existing `relative-time.ts` helper; line times use the thread's existing time format.
- **Decisions taken at this stage** (the contract and the SAD leave them to `screens`; recorded here, not elsewhere):
  1. **Lens controls:** status = `Tabs` used as a two-segment switch («Open» / «Closed», no tab content); assignee = `Select` («All» / «Mine» / «Unassigned»). Both sit in the list pane between the search and the rows. While a search is present the status tabs are disabled with the hint «Searching open and closed» (AC-01). The panel never sends a lens value outside the enum: an unknown `status` / `assignee` in the address is treated as the default and the address is rewritten in place (so `listConversations` `400` on a lens cannot be produced).
  2. **Thread actions live in one header bar** (`NEW: ConversationActions`): status `Badge` («Open» outline / «Closed» secondary), the assignee button («Unassigned» or the assignee's name, chevron) that opens SCR-10, and **Close** / **Reopen**. One change per conversation is in flight per tab: while one is pending, all three controls are disabled.
  3. **SCR-10 is a `Popover`** with a list of member buttons (`NEW: AssigneeChooser`), not a `DropdownMenu`: it must stay open to show the AC-04 refusal and the reloaded members in place, which a menu that closes on select cannot do. The repo has no `command` primitive; tens of members need no search, so none is added.
  4. **Both confirmations are `AlertDialog`s** (`NEW: StateChangedDialog`, `NEW: CloseConfirmDialog`), as shared-inbox SCR-04/05 (sad.md §4 names shadcn `Dialog`; the canon's confirmation flavour is `AlertDialog`). An explicit choice is needed; a click outside does not dismiss; Esc = the cancel choice; focus returns to the control that opened it.
  5. **The close dialog opens only from the server's answer.** **Close** always sends the version and close snapshot on screen; SCR-12 opens on `409 CLOSE_NEEDS_CONFIRMATION` and shows `details.reasons`. The panel does not pre-evaluate the reasons — the record-time check is the single source (ADR-0003). A close with no reason is recorded at once, with no dialog (AC-05).
  6. **Reason lines in SCR-12:** one line per reason; when both `unread_customer_message` and `new_customer_message` apply they are shown as **one** line («A customer message arrived that you haven't read — <how long ago>»), since both point at the same message. `state_changed` shows the stale change as in SCR-11.
  7. **Open dialogs are not refreshed by live frames.** The header behind them updates live; the dialog's content is replaced only by the next server answer («asks again»). The confirm request carries the refusal's version/snapshot, so a change in between is caught by the server, never lost.
  8. **SCR-14 deactivate copy gains one sentence** (AC-10): «Conversations assigned to <name> here become unassigned, and reactivating does not give them back.» No new step and no new state (ux-flows assumption).

### Assumptions (autonomous run 2026-10-18)

- Depth = medium, posture desktop-first per the canon; the per-screen confirmations were made by the pipeline itself (Accept on every screen) and can be vetoed at review. Decisions 1–8 above are this stage's own picks.
- Empty-lens copy is per lens (SCR-01); the shared-inbox «No conversations yet» sentence becomes the open · all text «No open conversations. New ones appear here when customers write to your bot.», because an empty open · all lens can also mean every conversation is closed. The bot-not-connected empty states (owner / operator) keep their shared-inbox second sentence.
- Activity lines always name members by display name (also the caller's own changes — no «you»), exactly as the contract composes them.
- The change-limit and change-failed lines appear under the thread header (where the member acted), not in the composer slot, so a reply and a change refusal never overwrite each other.

## Screens

**Shared states (SCR-01, SCR-02, SCR-10, SCR-11, SCR-12).** Inherited from shared-inbox `screens.md` §Shared inbox states (401 → SCR-09, 403 → SCR-07, guard 404 → SCR-06, socket close codes, resync, foreign-workspace frames dropped, workspace switch reset). This feature adds the rows below; each screen lists them as one row pointing here.

| Trigger | What the panel does | Source |
| --- | --- | --- |
| `403 ACCESS_REMOVED` on `assignConversation` / `unassignConversation` / `closeConversation` / `reopenConversation` (`CallerAccessRemoved` — deactivated at the guard or under the share lock) | any open dialog / chooser closes; as the inherited 403 row → SCR-07 | AC-11; flow 5, flow 12 |
| `404 NOT_FOUND` on a change route, `getThreadActivity` or `listActiveMembers` | any open dialog / chooser closes; SCR-06 in the thread pane (no hint) | AC-11; flow 5, flow 11 |
| `conversation.changed` with item `activity` (`created`) | coalesced with a same-transaction `message` / `reply` frame; re-read `getConversation`, and `getThreadActivity` if that thread is open; an activity id already shown is ignored; the row is re-evaluated against the current lenses (only the assignee lens while searching) → inserted, updated or dropped; an open thread stays open; unread counts untouched | AC-02, AC-05, AC-07, AC-08, AC-09, AC-10; flow 13; events.md |
| a frame that fails to parse | dropped; reconnect + resync of the first list page in the current lenses and the open summary | flow 13 dead-letter; events.md «Old bundles» |
| `resync` / reconnect | re-read the first list page **in the current lenses and `q`** and the open conversation's summary (version + close snapshot replaced) | flow 13; events.md |
| workspace switched | lenses reset to open · all (the switcher navigates to a path without lens parameters) | AC-01; flow 4 |

### SCR-01 — Inbox — conversation list

Every shared-inbox SCR-01 state is kept. Added or changed:

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: open · all | `/w/<id>/inbox` with no lens parameters — under the search: status `Tabs` with **Open** selected and **Closed**, assignee `Select` «All»; rows of open conversations of every assignee, newest activity first; each row as before (Avatar, name, time, last item, unread `Badge`, «Waiting for a reply») plus a muted assignee line — the assignee's display name, or «Unassigned» — with a lucide `UserRound` icon; an assignee or status change never becomes the row's preview or time (AC-01) | Tabs, Select, extended: ConversationList, ScrollArea | wireframe «list desktop» |
| lens: mine / unassigned | assignee `Select` → «Mine» / «Unassigned» — the address gets `?assignee=mine` / `?assignee=unassigned`; only open conversations assigned to the caller / with no assignee (AC-01; flow 4) | Select, extended: ConversationList | wireframe «list desktop» |
| lens: closed | status tab **Closed** — `?status=closed` (+ the assignee lens); closed conversations in the chosen assignee lens, newest activity first; no «closed» mark on rows here (the whole lens is closed) (AC-01) | Tabs, extended: ConversationList | — |
| lens from the address | reload, back, forward or a saved link with `status` / `assignee` — the controls and the first page open in those lenses; defaults are omitted from the address (AC-01; flow 4) | Tabs, Select | — |
| validation | an unknown lens value in the address (`?status=archived`) — treated as the default and the address rewritten in place; no request with it is sent (Decision 1) (contract `listConversations` `400` cannot be produced) | — | — |
| loading: lens switch | a lens chosen — the list shows 6 skeleton rows while the first page of the new lens loads; the controls stay enabled; an answer whose `lens` echo is not the current lens is dropped (contract `ConversationPage.lens`) | Skeleton | wireframe «list loading» (shared-inbox) |
| empty: lens | no `q`, `items` empty — one sentence in the list pane, per lens: open · all «No open conversations. New ones appear here when customers write to your bot.»; open · mine «No open conversations are assigned to you.»; open · unassigned «Every open conversation has an assignee.»; closed · all «No closed conversations.»; closed · mine «No closed conversations are assigned to you.»; closed · unassigned «No closed conversations without an assignee.» (AC-01) | Card | wireframe «list empty lens» |
| empty: no bot, owner / operator | open · all empty and bot `not_connected` / `needs_token` — the shared-inbox text, its first sentence replaced by the open · all sentence above; **Open bot settings** for the owner, «Ask a business owner to connect the bot.» for the operator (shared-inbox AC-02, AC-13) | Card, Button | — |
| searching | `q` non-empty — the status tabs are disabled with the hint «Searching open and closed» under them; the assignee lens is kept; matches of both statuses, each closed row with a «Closed» `Badge` (outline) after the name (AC-01; contract `lens.status: null`) | Input, Tabs (disabled), Select, extended: ConversationList, Badge | wireframe «list searching» |
| empty: no match | `q` set, `items` empty — unchanged «No conversations match» + **Clear search**; clearing returns to the lenses chosen before (AC-01) | EmptyFilterState | — |
| live: row joins / leaves the lens | an `activity` frame (a teammate's assign / unassign / close / reopen, a customer reopen, a failed-reply reopen, a deactivation unassign) — the row is inserted at its activity place, updated in place (new assignee line, «Closed» badge in search) or removed, without a reload; it never moves to the top for a change (AC-02, AC-05, AC-07, AC-08, AC-10; flow 13) | extended: ConversationList | — |
| live: reopened by the customer | `message` + `activity` frames (coalesced) — the row returns to the open lenses with its assignee, at the top as the newest activity, unread count + 1, «Waiting for a reply» (AC-07; flow 9) | extended: ConversationList | — |
| selected row left the lens | the open thread's conversation stops matching the lens (e.g. a teammate takes it while the member is on «Unassigned», or it is closed while on «Open») — its row leaves the list, the thread stays open in the right pane (AC-02; flow 13) | extended: ConversationList | — |
| opened outside the lens | a saved conversation address whose conversation is not in the current lens — the thread opens, no row is selected (AC-01, AC-02) | — | — |
| workspace switched | the other workspace opens at open · all (Shared states) (AC-01) | Tabs, Select | — |
| error | unchanged (shared-inbox): «Something went wrong» + **Retry** re-reads the first page **in the current lenses** | Alert (destructive), Button | — |
| phone (< md) | search, then the status tabs and the assignee select side by side (tabs `flex-1`, select `w-36`), then the rows; the assignee line stays under the preview (AC-01) | Tabs, Select, extended: ConversationList | wireframe «list phone» |
| guard / live states | → §Shared states | — | §Shared states |

```text
list desktop (open · all; Olena's thread open → SCR-02 fills the right pane)
+-------------------------------+----------------------------------------+
| [ Search conversations      ] |                                        |
| [ Open | Closed ]  [All     ▾]|          SCR-02 (or «Pick a            |
|-------------------------------|           conversation to see it here»)|
|▌(OK) Olena Kravets        2m  |                                        |
|▌ Photo · new bouquet?     ②   |                                        |
|▌ ● Waiting for a reply        |                                        |
|▌ 👤 Unassigned                |                                        |
| (MB) Maks Bondar          1h  |                                        |
|  ↩ Delivery on Saturday…      |                                        |
|  👤 Ana Shevchenko            |                                        |
| (IS) Iryna S.            Yest.|                                        |
|  Thanks, got it!              |                                        |
|  👤 Bob Petrenko              |                                        |
+-------------------------------+----------------------------------------+

list searching (q = "ir", assignee All)        list empty lens (open · mine)
+-------------------------------+              +-------------------------------+
| [ ir                        ] |              | [ Search conversations      ] |
| [ Open | Closed ]  [All     ▾]|              | [ Open | Closed ]  [Mine    ▾]|
|  (disabled)                   |              |-------------------------------|
| Searching open and closed     |              | No open conversations are     |
|-------------------------------|              | assigned to you.              |
| (IS) Iryna S. [Closed]   Yest.|              +-------------------------------+
|  Thanks, got it!              |
|  👤 Bob Petrenko              |
| (IK) Iryna Koval          3h  |
|  Is it in stock?              |
|  👤 Unassigned                |
+-------------------------------+

list phone
+--------------------------------+
| Inbox                          |
| [ Search conversations       ] |
| [ Open | Closed ]   [ All   ▾] |
| (OK) Olena Kravets          2m |
|  Photo · new bouquet?       ②  |
|  ● Waiting for a reply         |
|  👤 Unassigned                 |
+--------------------------------+
```

### SCR-02 — Inbox — conversation thread

Every shared-inbox SCR-02 state is kept (history, content kinds, delivery states, composer). Added or changed:

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: open | `getConversation` `status: open` — header as before (Avatar, name, @username) plus the actions bar: «Open» `Badge` (outline), the assignee button («Unassigned» or the assignee's display name, `ChevronDown`) → SCR-10, **Close** (`outline`, sm); the screen keeps `state_version` and `close_snapshot` from the summary it rendered (AC-02; ADR-0002, ADR-0003) | extended: Thread, NEW: ConversationActions (Badge, Button) | wireframe «thread header» |
| default: closed | `status: closed` — «Closed» `Badge` (secondary), the assignee button (still usable: a closed conversation can be assigned and stays closed), **Reopen** instead of **Close**; the composer works as in an open conversation — a reply does not reopen (AC-02, AC-05; spec §1 assumption) | NEW: ConversationActions | wireframe «thread header» |
| activity lines | `listThreadItems` items of `type: activity` — a centred muted line among messages and replies at its `position_at`, with its time: «<actor> assigned this to <new>», «<actor> reassigned this from <previous> to <new>», «<actor> unassigned this», «<actor> closed this», «<actor> reopened this»; automatic: «reopened — the customer wrote», «reopened — a reply was not delivered», «unassigned — <previous> was deactivated»; never counted unread, never part of `read_through_at` (AC-09; flow 11; contract `listThreadItems`) | NEW: ActivityLine, extended: Thread | wireframe «thread with activity» |
| loading | as before; the actions bar shows a skeleton until the summary arrives (no action can be sent without a version) | Skeleton | — |
| pending | an assign / unassign / close / reopen in flight — the control that was used shows a spinner; all three controls disabled (Decision 2) | NEW: ConversationActions | — |
| success: recorded | `200 outcome: recorded` — the header shows `conversation` from the answer (new assignee / status, version, snapshot); the answer's `activity` line is appended at its time; the row keeps its place in the activity order (AC-02, AC-05; flow 5, flow 7, flow 8) | NEW: ConversationActions, NEW: ActivityLine | — |
| success: unchanged | `200 outcome: unchanged` (already the pick / already unassigned / already closed / already open) — the header shows the answer's `conversation`; no line, no message (AC-02, AC-03) | NEW: ConversationActions | — |
| close: asks first | **Close** → `409 CLOSE_NEEDS_CONFIRMATION` → SCR-12 over the thread (AC-06; flow 7) | — | — |
| changed since I looked | assign / unassign / reopen → `409 CONVERSATION_STATE_CHANGED` → SCR-11 over the thread (AC-03; flow 6, flow 8) | — | — |
| error: change limit | `429 CHANGE_LIMIT_REACHED` — under the actions bar a warning line «Changes are limited to 60 per minute — you can continue in N seconds», N counting down to `details.retry_at`; the three controls disabled until then, then the line goes; the composer is not affected; nothing changed (AC-12; flow 5, flow 7, flow 8) | Alert, NEW: ConversationActions | wireframe «thread header» (limit) |
| error: change failed | network / `500` on a change route — under the actions bar «Couldn't save the change — check your connection and try again»; controls enabled again; the screen keeps its version (AC-02) | Alert (destructive) | — |
| validation | N/A: the panel builds every change body itself from the summary it shows (version, snapshot, a pick from `listActiveMembers`); `400 VALIDATION_ERROR` cannot be produced by a member — handled as «change failed» if it ever appears; `400 ASSIGNEE_NOT_ACTIVE` is SCR-10's | — | — |
| live: teammate / automatic change | an `activity` frame for this conversation — the header switches to the new assignee and status (version + close snapshot replaced), the line appears at its time, unread unchanged; the thread stays open even if the row left the current lens (AC-02, AC-09; flow 13) | NEW: ConversationActions, NEW: ActivityLine | — |
| live: reopened by the customer | `message` + `activity` frames — the new message (unread, waiting) and «reopened — the customer wrote» at its arrival; a late redelivery keeps its earlier place while the line sits at its arrival time; an edit adds no line (AC-07; flow 9) | extended: MessageBubble, NEW: ActivityLine | wireframe «thread with activity» |
| live: reopened by a failed reply | `reply` state frame + `activity` — the reply shows «Not delivered» / «Not confirmed» with its existing action, and «reopened — a reply was not delivered» appears (AC-08; flow 10) | NEW: ActivityLine | — |
| live: unassigned by deactivation | «unassigned — <previous> was deactivated»; header «Unassigned» (AC-10; flow 12) | NEW: ActivityLine, NEW: ConversationActions | — |
| background tab | as before: nothing marked read; a close attempted from it later is asked about the unread message (SCR-12) (AC-06) | — | — |
| not found / access removed | change or read routes `404` → SCR-06 in the pane; `403` → SCR-07 (§Shared states) (AC-11) | NotFoundCard | — |
| phone (< md) | the actions bar moves to a second header row under **Back to conversations** + name: badge, assignee button (`flex-1`, truncates), **Close** / **Reopen**; the limit / failed line under it (AC-02) | NEW: ConversationActions | wireframe «thread phone» |
| empty | N/A: as shared-inbox, a thread always has ≥ 1 message; a conversation with no activity lines simply shows none | — | — |
| guard / live states | → §Shared states | — | §Shared states |

```text
thread header (desktop, right pane)
+------------------------------------------------------------------+
| (OK) Olena Kravets  @olena_k                                     |
|        [Open]  [👤 Unassigned ▾]                       [Close]   |  default: open
|------------------------------------------------------------------|
| (IS) Iryna S.                                                    |
|        [Closed] [👤 Bob Petrenko ▾]                    [Reopen]  |  default: closed
|------------------------------------------------------------------|
| (MB) Maks Bondar                                                 |
|        [Open]  [👤 Ana Shevchenko ▾]                   [Close]   |
| ⚠ Changes are limited to 60 per minute — you can continue in    |  error: change limit
|   14 seconds                                                     |  (controls disabled)
+------------------------------------------------------------------+

thread with activity
+------------------------------------------------------------------+
| ┌──────────────────────────┐                                     |
| │ Do you deliver on Sunday?│                                     |
| │ 09:58                    │                                     |
| └──────────────────────────┘                                     |
|        Ana Shevchenko assigned this to Bob Petrenko · 10:01      |
|                        Bob Petrenko                              |
|               ┌─────────────────────────────────┐                |
|               │ Yes, we deliver on Sunday       │                |
|               │ 10:02                           │                |
|               └─────────────────────────────────┘                |
|                                         ✓ Sent                   |
|               Bob Petrenko closed this · 10:08                   |
| ┌──────────────────────────┐                                     |
| │ One more question        │                                     |
| │ 10:15                    │                                     |
| └──────────────────────────┘                                     |
|             reopened — the customer wrote · 10:15                |
|------------------------------------------------------------------|
| [ Write a reply…                                       ] [Send]  |
+------------------------------------------------------------------+

thread phone
+--------------------------------+
| [Back to conversations]        |
| (OK) Olena Kravets  @olena_k   |
| [Open] [👤 Unassigned ▾][Close]|
|--------------------------------|
| …                              |
+--------------------------------+
```

### SCR-06 — Not found (in frame)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: shared-inbox `screens.md` §SCR-06. New entries only: a `404` on a change route, `getThreadActivity` or `listActiveMembers`, and a saved conversation address with lens parameters of another workspace — no hint that the conversation or workspace exists (AC-11; flow 4, flow 11) | AppShell, NotFoundCard | — |
| error / empty | N/A: a static card with no data load | — | — |

### SCR-07 — Access-removed landing

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: shared-inbox `screens.md` §SCR-07. New entries only: `403 ACCESS_REMOVED` on a change route (deactivated at the guard or under the share lock — `CallerAccessRemoved`), and the deactivated member's next action after flow 12; nothing of the workspace — assignee, status or activity — is shown (AC-10, AC-11; flow 5, flow 12) | AuthLayout, Alert, Button, Badge | — |
| loading, error, guard states | inherited: shared-inbox §SCR-07 | Skeleton, Alert, Button | — |

### SCR-09 — Sign-in

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: shared-inbox `screens.md` §SCR-09. New entry only: the return address now keeps the lens parameters (`/w/<id>/inbox?status=closed&assignee=mine`), so after sign-in the same lenses open (AC-01, AC-11; flow 4) | AuthLayout, Field, Input, Label, Button | — |
| validation, error, other states | inherited verbatim: shared-inbox §SCR-09 | Field, Alert, Button | — |

### SCR-10 — Choose assignee

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | the assignee button pressed — the `Popover` opens under it and `listActiveMembers` is read (every time it opens); 3 skeleton rows (avatar + name) (AC-04; contract `listActiveMembers`) | NEW: AssigneeChooser (Popover, Skeleton) | — |
| default | members loaded — heading «Assign to»; first «Me (<my display name>)», then the other active members by display name (from the answer's order), each with `Avatar` initials; when the conversation has an assignee, a `Separator` and «Unassign»; the current assignee carries a check icon and `aria-current`; arrow keys move, Enter picks, Esc closes and returns focus to the assignee button (AC-02, AC-04; flow 5) | NEW: AssigneeChooser (Popover, Button `ghost`, Avatar, Separator) | wireframe «chooser» |
| only me | the caller is the only active member — «Me (<name>)» (+ «Unassign» when assigned) and nothing else (AC-04) | NEW: AssigneeChooser | — |
| pick: the current assignee | the checked row picked — the chooser closes; nothing is sent, nothing recorded (AC-02; flow 5) | — | — |
| pending | a member or «Unassign» picked — that row shows a spinner, the other rows are disabled; `assignConversation` / `unassignConversation` with the version on screen (AC-02) | NEW: AssigneeChooser | — |
| success | `200` (recorded or unchanged) — the chooser closes; SCR-02 `success: recorded` / `success: unchanged` (AC-02) | — | — |
| refused: not an active member | `400 ASSIGNEE_NOT_ACTIVE` — the chooser stays open; destructive `Alert` at its top «A conversation can be assigned only to an active member of this workspace.»; the members are re-read (skeleton, then the list without the gone member); nothing changed (AC-04, AC-10; flow 5, flow 12) | NEW: AssigneeChooser (Alert) | wireframe «chooser» (refused) |
| changed since I looked | `409 CONVERSATION_STATE_CHANGED` — the chooser closes; SCR-11 opens with the pick kept (AC-03; flow 6) | — | — |
| error: change limit / change failed | `429 CHANGE_LIMIT_REACHED` or network / `500` on the change — the chooser closes; SCR-02 `error: change limit` / `error: change failed` (AC-12) | — | — |
| error: members not loaded | `listActiveMembers` network / `500` — in the chooser «Couldn't load the team» + **Retry** (AC-04) | NEW: AssigneeChooser (Alert, Button) | — |
| empty | N/A: the caller is always an active member (otherwise `403` → SCR-07), so the list has at least «Me» | — | — |
| validation | N/A: picks come only from the list; no free input | — | — |
| phone (< md) | the popover is as wide as the header row (`w-[--radix-popover-trigger-width]`, min 240px) and scrolls inside past 8 rows | NEW: AssigneeChooser | — |
| guard / live states | → §Shared states (`403` / `404` close the chooser) | — | §Shared states |

```text
chooser (default; Bob is the current assignee)    chooser (refused)
            +------------------------------+      +------------------------------+
            | Assign to                    |      | ✕ A conversation can be      |
            | (AS) Me (Ana Shevchenko)     |      |   assigned only to an active |
            | (BP) Bob Petrenko         ✓  |      |   member of this workspace.  |
            | (IM) Ivan Melnyk             |      |------------------------------|
            | (OK) Oksana Kovalenko        |      | Assign to                    |
            |------------------------------|      | (AS) Me (Ana Shevchenko)     |
            | Unassign                     |      | (BP) Bob Petrenko         ✓  |
            +------------------------------+      | (OK) Oksana Kovalenko        |
                                                  |------------------------------|
                                                  | Unassign                     |
                                                  +------------------------------+
```

### SCR-11 — Confirm over a recent change

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | `409 CONVERSATION_STATE_CHANGED` on assign / unassign / reopen — `AlertDialog` over the thread: title «This conversation changed since you looked»; «Now: <assigned to <name> \| unassigned> · <Open \| Closed>» from `details.conversation`; the change from `details.latest_change` with its relative time — a member's change as its activity line («Bob Petrenko reassigned this from Ana Shevchenko to Bob Petrenko — 2 minutes ago»), an automatic one by cause («Reopened — the customer wrote — 1 minute ago», «Reopened — a reply was not delivered — …», «Unassigned — Bob Petrenko was deactivated — …»); buttons **Leave it** (cancel) and the go-ahead action: «Assign to <pick>» / «Unassign anyway» / «Reopen anyway» (AC-03; flow 6, flow 8) | NEW: StateChangedDialog (AlertDialog, Button) | wireframe «confirm change» |
| left it | **Leave it** or Esc — the dialog closes; the header shows `details.conversation` (its version becomes the one on screen); nothing changed (AC-03; flow 6) | — | — |
| pending | go-ahead pressed — both buttons disabled, a spinner on the go-ahead; the same request with `details.conversation.state_version` (AC-03) | NEW: StateChangedDialog | — |
| success | `200` recorded — the dialog closes; SCR-02 `success: recorded`; `200` unchanged (it reached that state meanwhile) — closes, SCR-02 `success: unchanged` (AC-03) | — | — |
| asks again | another `409 CONVERSATION_STATE_CHANGED` — the dialog stays, its «Now» and change lines are replaced by the newer ones, and «It changed again — check before going ahead.» appears above the buttons; buttons enabled (AC-03; flow 6 «a third change asks again») | NEW: StateChangedDialog | — |
| refused: not an active member | `400 ASSIGNEE_NOT_ACTIVE` on the go-ahead assign — the dialog closes and SCR-10 reopens in `refused: not an active member` (AC-04, AC-10; flow 12) | — | — |
| error: change limit | `429 CHANGE_LIMIT_REACHED` — the dialog closes; SCR-02 `error: change limit` (AC-12) | — | — |
| error | network / `500` — the dialog stays with «Couldn't save the change — try again» (destructive) above the buttons; buttons enabled | Alert (destructive), Button | — |
| empty | N/A: content comes from the `409` answer; no list | — | — |
| guard / live states | → §Shared states; live frames do not change an open dialog (Decision 7) | — | §Shared states |

```text
confirm change (reassign over a customer reopen)
          +------------------------------------------------------+
          | This conversation changed since you looked           |
          | Now: assigned to Bob Petrenko · Open                 |
          | Reopened — the customer wrote — 1 minute ago         |
          |                                                      |
          |                    [Leave it]  [Assign to Ivan Melnyk]|
          +------------------------------------------------------+
```

### SCR-12 — Confirm close

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | **Close** → `409 CLOSE_NEEDS_CONFIRMATION` — `AlertDialog`: title «Close this conversation?»; «It may be too early:» + one line per reason in `details.reasons` (Decision 6): `customer_waiting` «The customer is waiting for a reply»; `unread_customer_message` / `new_customer_message` «A customer message arrived that you haven't read — <relative time of `details.newest_unread_message.received_at`>» (or «— since you opened it» when only `new_customer_message`); `reply_not_delivered` «The latest reply was not delivered»; `reply_not_confirmed` «The latest reply was not confirmed — it may not have reached the customer»; `state_changed` «It changed since you looked: <`details.stale_change` as in SCR-11>»; buttons **Keep it open** (cancel) and **Close anyway** (primary) (AC-06, AC-08, AC-03; flow 7) | NEW: CloseConfirmDialog (AlertDialog, Button) | wireframe «confirm close» |
| kept open | **Keep it open** or Esc — the dialog closes; the header takes `details.conversation` (version + snapshot); nothing changed (AC-06; flow 7) | — | — |
| pending | **Close anyway** pressed — both buttons disabled, spinner; `closeConversation` with `details.conversation.state_version`, `details.conversation.close_snapshot` and `confirm_close_reasons: true` (AC-06) | NEW: CloseConfirmDialog | — |
| success | `200` recorded — the dialog closes; SCR-02 shows «Closed» and «<me> closed this»; the row leaves the open lenses (AC-05); `200` unchanged (closed meanwhile) — closes, SCR-02 `success: unchanged` (AC-03) | — | — |
| asks again | another `409 CLOSE_NEEDS_CONFIRMATION` (a customer message or a failed reply recorded meanwhile, or another change) — the dialog stays, the reason lines are replaced, and «Something changed while you were deciding — check again.» appears above the buttons; buttons enabled (AC-06; flow 7 «the dialog asks again with what is new») | NEW: CloseConfirmDialog | wireframe «confirm close» (asks again) |
| error: change limit | `429 CHANGE_LIMIT_REACHED` — the dialog closes; SCR-02 `error: change limit` (AC-12; flow 7) | — | — |
| error | network / `500` — the dialog stays with «Couldn't close the conversation — try again» (destructive) above the buttons; buttons enabled | Alert (destructive), Button | — |
| empty | N/A: the dialog opens only with ≥ 1 reason (contract: `reasons` has at least one) | — | — |
| guard / live states | → §Shared states; live frames do not change an open dialog (Decision 7) | — | §Shared states |

```text
confirm close
          +------------------------------------------------------+
          | Close this conversation?                             |
          | It may be too early:                                 |
          |  • The customer is waiting for a reply               |
          |  • A customer message arrived that you haven't       |
          |    read — 30 seconds ago                             |
          |  • The latest reply was not delivered                |
          |                                                      |
          |                       [Keep it open]  [Close anyway] |
          +------------------------------------------------------+

confirm close (asks again)
          +------------------------------------------------------+
          | Close this conversation?                             |
          | It may be too early:                                 |
          |  • A customer message arrived that you haven't       |
          |    read — just now                                   |
          | Something changed while you were deciding — check    |
          | again.                                               |
          |                       [Keep it open]  [Close anyway] |
          +------------------------------------------------------+
```

### SCR-13 — Settings — Team

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim: ui-redesign `screens.md` §SCR-12 (and workspace-operators §SCR-07 behind it). This feature adds no state: deactivating a member here is the trigger of flow 12; its effects show in the inbox (SCR-01 `live: row joins / leaves the lens`, SCR-02 `live: unassigned by deactivation`); reactivation is unchanged and gives no conversations back (AC-10; flow 12) | SettingsLayout, DataTableToolbar, Card, Table, Avatar, Badge, DropdownMenu, Button | — |
| loading, empty: no match, error, owners only, other states | inherited verbatim: ui-redesign §SCR-12 — unchanged by this feature | Skeleton, EmptyFilterState, Alert, Card, Button | — |

### SCR-14 — Confirm member action

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default: confirm deactivate | inherited: ui-redesign §SCR-17 / workspace-operators §SCR-07 «confirm deactivate», with one added sentence (Decision 8): «Deactivate Bob? Bob loses access to Acme Flowers at once. Conversations assigned to Bob here become unassigned, and reactivating does not give them back. You can reactivate them later.» Cancel / Deactivate (AC-10) | AlertDialog, Button | — |
| pending, errors (last active owner, stale row), confirm revoke | inherited verbatim: ui-redesign §SCR-17 | AlertDialog, Alert, Button | — |

## New components

| Component | Why no existing primitive fits | Registered in design-system |
| --- | --- | --- |
| ConversationActions | The SCR-02 header bar: status `Badge`, assignee button opening `AssigneeChooser`, Close / Reopen, the pending lock across all three, and the change-limit countdown / change-failed line under it; it holds the version and close snapshot the screen shows and routes `409`s to the two dialogs. No primitive owns this state; composes Badge, Button, Alert, AssigneeChooser, StateChangedDialog, CloseConfirmDialog | pending |
| AssigneeChooser | SCR-10: a `Popover` with «Me» first, active teammates, «Unassign», the current-assignee check, per-row pending, the in-place `ASSIGNEE_NOT_ACTIVE` refusal with re-read, and loading / load-error states. A `DropdownMenu` closes on select and cannot show the refusal in place; the repo has no `command` primitive (Decision 3). Composes Popover, Button, Avatar, Separator, Skeleton, Alert | pending |
| StateChangedDialog | SCR-11: an `AlertDialog` showing the current state and the latest change (member or cause, relative time) with an action-specific go-ahead, pending, «asks again» and error states — like `TeammateRepliedDialog`, the fixed composition is reused for assign, unassign and reopen. Composes AlertDialog, Alert, Button | pending |
| CloseConfirmDialog | SCR-12: an `AlertDialog` listing every close reason (merged unread/new line), carrying the refusal's version + snapshot into «Close anyway», with pending, «asks again» and error states. Composes AlertDialog, Alert, Button | pending |
| ActivityLine | A centred, muted one-line thread item composed from `kind` + `cause` + names, with its time; neither inbound nor outbound, so `MessageBubble` (sender-aligned bubble with a delivery slot) does not fit | pending |
| ConversationList (extended) | Existing NEW component; gains the assignee line, the «Closed» badge in search results, and (in its `InboxList`) the status `Tabs` + assignee `Select` lenses, lens-aware loading / per-lens empty states and the live join / leave of rows — canon row updated, not duplicated | pending |
| Thread (extended) | Existing NEW component; gains `ConversationActions` in its header (second row at phone width) and `ActivityLine` as the third item type in its history and live updates — canon row updated | pending |
