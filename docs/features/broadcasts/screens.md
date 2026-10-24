---
status: draft
feature_size: "L"
tool: "code"
updated_at: "2026-10-23"
---

# Screens — broadcasts

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`) — inline wireframes below, one per state that needs a distinct layout. No degradation: the canon's tool is `code`, so no Figma / Pencil MCP was needed (the contacts precedent).
- **File:** inline wireframes below.
- **Inventory:** SCR ids from [`ux-flows.md`](ux-flows.md) §Screen inventory — SCR-02, SCR-06, SCR-07, SCR-08, SCR-09, SCR-15, SCR-18, SCR-19, SCR-24, SCR-25, SCR-26, SCR-27, SCR-28, SCR-29, SCR-30, SCR-31, SCR-32, all covered. SCR-24…SCR-32 are new. SCR-02, SCR-18 and SCR-19 are shipped screens that gain one element each (the broadcast item; the blocked marker; the blocked line). The other reused screens are landings with no new layout; every state they already list stays as is and is **not repeated** here — this manifest lists only what this feature adds or changes.
- **Component names:** names from the canon inventory (`AppShell`, `Sidebar`, `Breadcrumb`, `Card`, `Badge`, `Button`, `Input`, `Label`, `Field`, `Textarea`, `Checkbox`, `RadioGroup`, `Select`, `Popover`, `Dialog`, `AlertDialog`, `Alert`, `Table`, `Tabs`, `Avatar`, `Skeleton`, `ScrollArea`, `Separator`, `DropdownMenu`, `Tooltip`, `DataTableToolbar`, `EmptyFilterState`, `NotFoundCard`, `Thread`, `ThreadItemView`, `MessageBubble`, `ContactsTable`, `ContactProfile`, `TagFilter`, `SettingsLayout`); `extended: <name>` = an existing inventory component that gains states (its canon row is updated, not duplicated); `NEW: <name>` = a part listed under §New components.
- **No new npm dependency and no new shadcn primitive.** Every new part composes the canon's primitives; the canon's _Not yet in the repo_ list (`input-group`, `sonner`) is not needed — every outcome is shown in place.
- **Sources per row:** spec §5 ACs, sad.md §6 flows (`flow N`, seeded flows `S1`…`S4`), contract responses (`contracts/openapi.yaml` `operationId` + status / code) and live frames (`contracts/events.md`). Every non-default state names at least one.
- **Copy:** new texts are quoted below; `implement` may polish them without changing their meaning. Broadcast names, the broadcast text, tag names, contact names and member names render as plain text everywhere (spec §6.1); the text keeps its line breaks (`whitespace-pre-wrap`) and nothing in it becomes a link or formatting. Times use the existing helpers (`relativeTime` from `features/inbox/relative-time.ts`; `formatBotDay`, `formatBotTime` from `features/bot/settings/format.ts`). Counts use `Intl.NumberFormat` («10 000» in the user's locale).

### Decisions taken at this stage

The contract and the SAD leave these to `screens`; they are recorded here, not elsewhere.

1. **Addresses** (sad.md §4): `/w/<id>/broadcasts` (SCR-24), `/w/<id>/broadcasts/<broadcastId>` (SCR-25 while `status: draft`, SCR-28 otherwise — chosen from `getBroadcast`), `/w/<id>/broadcasts/<broadcastId>/launch` (SCR-27 over SCR-25 for an owner; an operator is sent to the draft address with `replace`, and the draft shows the owners-only note). The editor of a not-yet-created draft is `/w/<id>/broadcasts/new`; after `createBroadcast` answers `201` the address is replaced with the new id.
2. **Navigation:** a **Broadcasts** item (lucide `Megaphone`) in the frame's primary nav between Contacts and Settings, for both roles. The breadcrumb reads «Acme Flowers › Broadcasts › <name>» (NEW: BroadcastCrumb, like `ContactCrumb`; «New broadcast» on `/new`, «Broadcast» while loading).
3. **Save as you go** (ux-flows): the name saves on blur and 800 ms after the last keystroke; the text 800 ms after the last keystroke and on blur; each save carries the `version` the editor holds, and the answer's draft replaces it (version, breakdown). One save in flight per draft; a change made meanwhile is sent after it with the new version. A status line under the title reads «Saving…», «Saved», or «Couldn't save — Retry». The audience saves at once on each choice.
4. **The editor is two cards** side by side at `lg` and stacked below it: **Message** (Name `Input`, Text `Textarea` with the remaining-length line) and **Audience** (the kind `RadioGroup` «Contacts with tags» / «Hand-picked group», the kind's controls, then the count breakdown). Actions sit in the page title row: **Launch** (owner, primary), **Duplicate** (outline), and **Delete** in a «More» `DropdownMenu` (author or owner).
5. **The remaining length** reads «4 096 characters left» from the shared rule (`broadcastTextLength`, ADR-0012) and turns into the field error «The text must be 1 to 4096 characters as Telegram counts them — 5 over» when exceeded; nothing is saved while invalid. An emoji counts as Telegram counts it (2 for most), so the counter can drop by 2.
6. **The tag audience** reuses the Contacts tag filter in a controlled mode (extended: TagFilter — `value` / `onChange` instead of the page address): the **Send to** button opens the same mode `RadioGroup` + tag `Checkbox` list with counts. A second button, **Leave out**, opens a `Popover` with a `Checkbox` per tag (a chosen tag is disabled there and vice versa; «No tags» mode disables Leave out). Both buttons label themselves like TagFilter («Tags · 2», «Leave out · 1»). Below them the chosen and left-out tags show as `Badge`s («VIP», «− Staff» `outline`).
7. **The count breakdown** (CONTEXT *Count breakdown*) is one component, NEW: AudienceBreakdown, used on SCR-25 (live draft numbers), SCR-27 (confirmation) and SCR-28 (frozen at launch): four lines — «Audience 38 contacts», «Left out — blocked the bot 2», «Left out — never wrote to the current bot 0», and the emphasised «Would reach 36» (SCR-28: «Sent to 36»). With `reach: null` only the first line and «Reach is known once a bot is connected.»
8. **The group picker is a large `Dialog`** (`max-w-3xl`, full screen below `sm`), not a page: a `DataTableToolbar` with the Contacts search `Input`, the TagFilter (controlled) and the count «14 of 120 contacts match», then rows with **Add** (ghost) or «In group ✓» (muted), **Show more**, and the footer **Add all matching (13)**. The second step replaces the footer in place: «Add 13 contacts to this group?» **Back** / **Add 13**.
9. **The group in the editor** is a compact table (NEW: BroadcastGroupList): contact (Avatar initials, name, @username), tags (`Badge`s, «+N» after 3, as ContactsTable), a «Blocked the bot» `Badge` (`outline`, destructive text), and a **Remove** icon button («Remove <name> from this group»); 50 rows with **Show more**; the header reads «14 contacts» with **Add contacts**.
10. **The report** (NEW: BroadcastReport) shows five totals as small stat blocks inside one `Card`: **Waiting** (`waiting` + `sending`), **Delivered**, **Blocked the bot**, **Failed** (`failed` + `not_confirmed`), and **Not sent — stopped** (only when `stopped` > 0). Below: an outcome `Select` («All recipients», «Waiting», «Delivered», «Blocked the bot», «Failed», «Not confirmed», «Not sent — stopped») and the recipients `Table` (Contact link to SCR-19 · Outcome `Badge` · Reason · Time), 50 at a time with **Show more**. Reasons in plain words: `account_gone` «Account no longer exists», `chat_not_found` «Chat not found», `telegram_error` «Telegram error», `text_refused` «Telegram refused the text», `bot_stopped` «The bot stopped working»; `not_confirmed` «Not confirmed — Telegram did not answer, not sent again»; `stopped` «Not sent — stopped»; `sending` «Sending…».
11. **Statuses** read «Draft» (`secondary`), «Sending» (`default` with a pulsing dot), «Sent» (`outline`), «Stopped» (`outline`, muted); a sent broadcast that ended early adds «— ended early: Telegram refused the text» or «— ended early: the bot stopped working» on SCR-28.
12. **The broadcast item** in a thread (NEW: BroadcastItem, a new `ThreadItemView` kind) is a full-width, centred card-like block — not a bubble on either side — so it never reads as a team reply or a customer message: a `Megaphone` icon, «Broadcast «Spring prices» · sent by Test User», the text, and the time (or a «Not confirmed» `Badge` with the send time). The broadcast name is a link to SCR-28.
13. **Dialogs:** SCR-27, SCR-29, SCR-31 and SCR-32 are `AlertDialog`s (irreversible or dropping data; Cancel focused first); SCR-30 is a `Dialog` (a choice; closing loses nothing). Focus returns to the opener.

### Assumptions (autonomous run 2026-10-23)

- Depth = medium, posture desktop-first per the canon; the per-screen confirmations were made by the pipeline itself (Accept on every screen) and can be vetoed at review. Decisions 1–13 above are this stage's own picks.
- The editor does **not** pre-check the 10 000 limit before a group add beyond what the API answers; it shows `can_add` from `countBroadcastGroupMatching` before the bulk add, and every refusal in place.
- A stale save (`BROADCAST_DRAFT_CHANGED`) applies the teammate's version to the fields the member did not touch, and for the field they were editing shows both texts (Decision 3, AC-03); it never silently overwrites.
- On SCR-25 a `broadcast.changed` with `change: status` for the open draft (a teammate launched it) switches the address's view to SCR-28 with a one-line `Alert` «A teammate launched this broadcast.»; `deleted` shows `NotFoundCard` with «This draft was deleted.» Draft and group changes by teammates are not pushed (ux-flows), so the open editor keeps its numbers until its own next save or reopen.
- The Contacts list (SCR-18) re-reads its current page on `contact.changed { change: reach }` for a contact on that page (contract assumption 7); nothing else on SCR-18 becomes live.
- The launch-confirmation address opened by an owner for a draft that cannot be launched shows the draft with the refusal (the confirmation never opens), exactly as pressing **Launch** does.

## Screens

**Shared states (SCR-24…SCR-32 and the changed parts of SCR-02, SCR-18, SCR-19).** The shared-inbox guard table (shared-inbox `screens.md` §Shared inbox states: 401 → SCR-09, 403 → SCR-07, guard 404 → SCR-06, socket close codes, resync, foreign-workspace frames dropped, workspace switch reset) applies unchanged. This feature adds the rows below; each screen lists them as one row pointing here.

| Trigger | What the panel does | Source |
| --- | --- | --- |
| `401 UNAUTHENTICATED` on any broadcasts route | an open dialog (SCR-26, SCR-27, SCR-29…SCR-32) closes; an unsent edit in the editor is kept in the draft store for the same address; as the inherited 401 row → SCR-09, then back to the same address | AC-08; flow 5 |
| `403 ACCESS_REMOVED` on the same routes (including the launch and the stop), or the socket closes `4403` | an open dialog closes; as the inherited 403 row → SCR-07; nothing is launched or stopped; nothing of the workspace stays on screen | AC-08; flow 5, flow 10 |
| guard `404 NOT_FOUND`, or `BroadcastNotFound` (unknown, deleted or foreign broadcast) | the frame shows `NotFoundCard` (inherited); no hint the workspace or the broadcast exists | AC-08; flows 5, 6, 9, 11 |
| `broadcast.changed` (any change) | SCR-24 re-reads `listBroadcasts` (one fetch in flight, one more queued); SCR-28 of that broadcast re-reads `getBroadcast` and its current recipient page on `report` / `status`, one fetch at a time; SCR-25 of that broadcast acts only on `status` and `deleted` (§Assumptions) | AC-01, AC-11; flows 5, 11; events.md |
| `contact.changed` (`change: reach`) | SCR-18 re-reads its current page when the contact is on it; SCR-19 of that contact re-reads `getContact`; nothing else | AC-14; flow 16; events.md |
| `conversation.changed` with `item.type: broadcast` | only an open thread of that conversation (SCR-02) re-reads `getThreadBroadcastItem`; the inbox list and the attention count ignore it | AC-16; flow 18; events.md |
| `resync` / reconnect | the re-reads of the rows above for whatever is open | AC-11; events.md |
| a frame that fails to parse | dropped; reconnect + resync (inherited rule; an old bundle ignores the new frame and values) | events.md «Old bundles» |
| a background re-read fails (network / `500`) | what is shown stays; the next frame or resync asks again; no error shown | flow 11 |
| workspace switched | the outlet remounts keyed on the workspace (inherited); an open editor's pending save is sent first only if it belongs to the old workspace's draft and the session still holds | inherited |

### SCR-24 — Broadcasts list

New, `/w/<id>/broadcasts`, breadcrumb «Acme Flowers › Broadcasts». Both roles see the same list (AC-01). Body: title «Broadcasts» with **New broadcast** (primary) on the right, then the card-wrapped table. `listBroadcasts`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | the page opens — `listBroadcasts` in flight; 6 `Skeleton` rows in the table (flow 5) | NEW: BroadcastsTable (Card, Table, Skeleton) | — |
| default | `200` with items — columns **Name** (link to SCR-25 or SCR-28), **Status** (Decision 11), **Audience** («38 contacts»; a draft's tag audience over 10 000 shows «10 420 contacts» with a warning icon and the `title` «Over the 10 000 limit — cannot be launched»), **Last change** («Test User · 3 min ago», «launched by» / «stopped by» wording from the status; full date-time in `title`), and a row-actions `DropdownMenu` («⋯»): **Duplicate**, and **Delete** on a draft row when the member is its author or a business owner. Most recently changed first (AC-01; flow 5; example `withBroadcasts`) | NEW: BroadcastsTable (Card, Table, Badge, DropdownMenu, Button, Tooltip) | wireframe «broadcasts desktop» |
| empty | `items: []` — «No broadcasts yet. A broadcast sends one message from your business bot to a group of your contacts, chosen by tags or picked by hand.» + **New broadcast**, for every member (flow 5; example `empty`) | Card, Button | wireframe «broadcasts empty» |
| error | the first read fails (network / `500`) — destructive `Alert` «Couldn't load broadcasts» + **Retry** in place of the table (flow 5) | Alert, Button | — |
| live | a `broadcast.changed` frame — the list re-reads; a status changes in place, a new or deleted draft appears or goes, a row moves to the top when changed (AC-01; flow 5) | NEW: BroadcastsTable | — |
| duplicate a draft | **Duplicate** on a draft row — `duplicateBroadcast { audience: same }`; the row's menu shows a spinner, then the copy's editor opens (SCR-25) (AC-13; flow 15) | DropdownMenu | — |
| duplicate a launched one | **Duplicate** on a launched row → SCR-30 (AC-13; flow 15) | — | — |
| delete | **Delete** on a draft row → SCR-31 (AC-07; flow 9) | — | — |
| action failed | a duplicate fails (network / `500`) — destructive `Alert` above the table «Couldn't duplicate the broadcast» until the next action | Alert | — |
| validation | N/A: the list takes no input | — | — |
| phone (< md) | rows stack: name + status on the first line, audience and last change muted below, the «⋯» menu on the right; **New broadcast** goes full width under the title | NEW: BroadcastsTable | wireframe «broadcasts phone» |
| guard states | → §Shared states | — | §Shared states |

```text
broadcasts desktop
+------------------------------------------------------------------------------------------+
| Broadcasts                                                           [ New broadcast ]   |
| +--------------------------------------------------------------------------------------+ |
| | Name                     | Status      | Audience        | Last change           |   | |
| |--------------------------+-------------+-----------------+-----------------------+---| |
| | Wholesale catch-up       | [Draft]     | 14 contacts     | Test User 2 · 2 min   | ⋯ | |
| | Spring prices            | [● Sending] | 38 contacts     | launched by Test User | ⋯ | |
| | Holiday hours            | [Sent]      | 120 contacts    | launched by Test User | ⋯ | |
| | Everyone (old)           | [Draft]     | ⚠ 10 420 contacts | Test User · 3 days  | ⋯ | |
| +--------------------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------------+

broadcasts empty
+------------------------------------------------------------------------------------------+
| Broadcasts                                                                               |
| +--------------------------------------------------------------------------------------+ |
| | No broadcasts yet. A broadcast sends one message from your business bot to a group   | |
| | of your contacts, chosen by tags or picked by hand.                                  | |
| | [ New broadcast ]                                                                    | |
| +--------------------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------------+

broadcasts phone
+------------------------------------+
| Broadcasts                         |
| [        New broadcast           ] |
| +--------------------------------+ |
| | Spring prices    [● Sending] ⋯ | |
| | 38 contacts · Test User        | |
| |--------------------------------| |
| | Wholesale catch-up  [Draft]  ⋯ | |
| | 14 contacts · 2 min ago        | |
| +--------------------------------+ |
+------------------------------------+
```

### SCR-25 — Broadcast draft

New, `/w/<id>/broadcasts/new` and `/w/<id>/broadcasts/<broadcastId>` while the broadcast is a draft; breadcrumb «… › Broadcasts › <name>». Both roles edit; only the actions differ (AC-07). `getBroadcast`, `createBroadcast`, `saveBroadcastFields`, `saveBroadcastAudience`, `listBroadcastGroup`, `removeBroadcastGroupContact`, `duplicateBroadcast`, `getLaunchConfirmation`. Decisions 3–7, 9.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | a draft address opens — `getBroadcast` in flight; the two cards as `Skeleton`s shaped like the fields and the breakdown (flow 7) | NEW: BroadcastEditor (Card, Skeleton) | — |
| new, empty | `/new` — empty Name and Text, the Audience card disabled with «Name the broadcast to start», no actions; nothing is created until the first valid name (ux-flows assumption; flow 6) | NEW: BroadcastEditor (Card, Field, Input, Textarea, Label) | wireframe «draft new» |
| created | the first valid name — `createBroadcast` `201`; the address becomes the draft's (`replace`), the status line «Saved», the Audience card enables with «Contacts with tags», «any of», no tag = every contact, and its breakdown (AC-01; flow 6) | NEW: BroadcastEditor | — |
| default: tag audience | `200` draft with `audience.kind: tags` — Message card with name and text and «4 071 characters left»; Audience card with **Send to** (extended: TagFilter controlled) and **Leave out**, the chosen / left-out `Badge`s, and the AudienceBreakdown «Audience 38 · blocked the bot 2 · never wrote to the current bot 0 · Would reach 36» (AC-01; flow 7; example `draftTagAudience`) | NEW: BroadcastEditor, extended: TagFilter, Popover, Checkbox, Badge, NEW: AudienceBreakdown | wireframe «draft tag audience» |
| default: group | `audience.kind: group` — the Audience card shows the group (NEW: BroadcastGroupList) with «14 contacts», **Add contacts** (→ SCR-26), rows with name, @username, tags, the «Blocked the bot» marker and **Remove**, **Show more** after 50; then the AudienceBreakdown (AC-04, AC-14; flow 8; `listBroadcastGroup`) | NEW: BroadcastGroupList (Table, Avatar, Badge, Button), NEW: AudienceBreakdown | wireframe «draft group» |
| empty: group | `size: 0` — «No contacts in this group yet.» + **Add contacts**; the breakdown shows «Audience 0» (flow 8) | NEW: BroadcastGroupList, Button | — |
| no bot | `breakdown.reach: null` — the breakdown shows only «Audience 38 contacts» and «Reach is known once a bot is connected.» (owner: + link **Open bot settings** → SCR-08); everything else works (AC-10; flow 7; example `draftGroupNoBot`) | NEW: AudienceBreakdown, Button (link) | — |
| saving | a field or audience save in flight — the status line «Saving…»; inputs stay editable; audience controls show a spinner on the used control (Decision 3; flow 6) | NEW: BroadcastEditor | — |
| validation: name | the tidied name is empty or over 80 graphemes — `FieldError` «A name must be 1 to 80 characters», `aria-invalid`, nothing sent; the last valid name stays saved; also on `400 BROADCAST_NAME_INVALID` (AC-02; flow 6) | Field, Input | — |
| validation: text | the trimmed text is empty (after it had a value) or over 4096 units — `FieldError` «The text must be 1 to 4096 characters as Telegram counts them» (+ «— N over»), nothing sent; also on `400 BROADCAST_TEXT_INVALID` (AC-02; flow 6; Decision 5) | Field, Textarea | wireframe «draft text over» |
| stale save | `409 BROADCAST_DRAFT_CHANGED` — an `Alert` above the cards «A teammate changed this draft. Their version is shown; your edit is kept below to apply again.»; the touched field shows the teammate's value with the member's own text in a muted box under it and **Use mine** / **Keep theirs**; the version and breakdown come from `details.draft` (AC-03; flow 6) | Alert, Button, NEW: BroadcastEditor | wireframe «draft stale» |
| notice: dropped tag | `dropped_tags` not empty — `Alert` in the Audience card «“Old promo” no longer exists, so it was left out of this audience.» (one line per tag); it goes at the next audience save (AC-01; flow 7) | Alert | — |
| notice: tag gone on save | `404 TAG_NOT_FOUND` on an audience save — the tag store re-reads `listTags`, the tag is unchecked, and the same notice shows; nothing saved (flow 7) | Alert | — |
| notice: over 10 000 | `audience_size` > 10 000 — `Alert` (default) in the Audience card «This audience holds 10 420 contacts. A broadcast can reach at most 10 000 — narrow it down to launch.»; the draft is saved; **Launch** still opens the pre-check, which refuses (AC-05; flow 7) | Alert | — |
| switch kind | choosing «Hand-picked group» on a tag audience — `saveBroadcastAudience { kind: group }` at once (tags dropped, no confirmation: nothing hand-picked is lost); choosing «Contacts with tags» on a non-empty group → SCR-32; on an empty group, at once (AC-03; flow 7) | RadioGroup | — |
| remove from group | **Remove** on a row — `removeBroadcastGroupContact`; the row goes, the size and breakdown re-read; `unchanged` (a teammate removed it) also drops it (AC-04; flow 8) | NEW: BroadcastGroupList | — |
| launched meanwhile | `409 BROADCAST_NOT_A_DRAFT` on any save, or a `broadcast.changed { status }` frame — the view switches to SCR-28 with `Alert` «This broadcast was launched and can no longer be changed.» (+ **Duplicate** on SCR-28) (AC-09; flow 6, flow 11) | Alert | — |
| actions: owner | title row: **Launch** (primary), **Duplicate**, «More» → **Delete** (any draft) (AC-06, AC-07) | Button, DropdownMenu | wireframe «draft tag audience» |
| actions: operator | **Launch** is absent; a muted line under the title «Only a business owner launches broadcasts.»; **Duplicate**; «More» → **Delete** only on their own draft, otherwise the «More» item reads «A draft is deleted by its author or a business owner» (disabled) (AC-07; flow 9, flow 10) | Button, DropdownMenu | — |
| launch: checking | **Launch** pressed — `getLaunchConfirmation` in flight; the button shows a spinner, other actions disabled (flow 10) | Button | — |
| launch refused: no working bot | `409 BROADCAST_NEEDS_WORKING_BOT` — destructive `Alert` under the title: `not_connected` «Launching needs a connected bot.», `needs_token` «Your bot's token stopped working — replace it to launch.», `taken_over` «Your bot is connected elsewhere — reconnect it to launch.», each + **Open bot settings** → SCR-08; the draft stays (AC-10; flow 10) | Alert, Button | — |
| launch refused: too large | `409 BROADCAST_AUDIENCE_TOO_LARGE` — `Alert` «A broadcast's audience can hold at most 10 000 contacts — this one holds 10 420.» (AC-05; flow 10) | Alert | — |
| launch refused: nobody reachable | `409 BROADCAST_NO_REACHABLE_CONTACT` — `Alert` «This audience has no reachable contact.» with the breakdown from the answer (AC-09; flow 10) | Alert, NEW: AudienceBreakdown | — |
| launch refused: daily limit | `429 BROADCAST_LAUNCH_LIMIT_REACHED` — `Alert` «A workspace can launch at most 10 broadcasts in 24 hours. The next launch is possible at 14:20 tomorrow.» (`next_launch_at`, `formatBotTime` / `formatBotDay`); drafts stay editable (AC-09; flow 10) | Alert | — |
| launch refused: no text | `400 BROADCAST_TEXT_INVALID` (empty text) — the Text field shows `FieldError` «Write the text before launching» and gets focus (data-model hand-off; flow 10) | Field, Textarea | — |
| launch: owners only | `403 OWNER_ONLY` (the role changed meanwhile) — the operator's note replaces **Launch**; the role is re-read (AC-07) | — | — |
| launch: can launch | `200` confirmation → SCR-27 opens over the draft; the address gains `/launch` (AC-06; flow 10) | — | — |
| duplicate | **Duplicate** — `duplicateBroadcast { audience: same }` → the copy's editor (SCR-25), the original unchanged (AC-13; flow 15) | Button | — |
| delete | «More» → **Delete** → SCR-31 (AC-07; flow 9) | DropdownMenu | — |
| error | the first `getBroadcast` fails (network / `500`) — destructive `Alert` «Couldn't load this broadcast» + **Retry** (flow 7); a save that fails (network / `500`) → status line «Couldn't save — Retry», the edit kept | Alert, Button | — |
| live | → §Shared states (only `status` and `deleted` act here) | — | §Shared states |
| phone (< lg / < sm) | below `lg` the Message card stacks above the Audience card; below `sm` the title row wraps (**Launch** full width first), the group table becomes stacked rows, Send to / Leave out buttons go full width | NEW: BroadcastEditor | wireframe «draft phone» |
| guard states | → §Shared states | — | §Shared states |

```text
draft new
+------------------------------------------------------------------------------------------+
| New broadcast                                                                            |
| +----------------------------- Message ---------+ +--------- Audience ----------------+ |
| | Name  [                                     ] | | Name the broadcast to start.      | |
| | Text  [                                     ] | | (disabled)                        | |
| |       [                                     ] | |                                   | |
| |                     4 096 characters left     | |                                   | |
| +-----------------------------------------------+ +-----------------------------------+ |
+------------------------------------------------------------------------------------------+

draft tag audience                                                      (business owner)
+------------------------------------------------------------------------------------------+
| Spring prices   [Draft]  Saved                     [ Launch ] [ Duplicate ] [ More ▾ ]    |
| +----------------------------- Message ---------+ +--------- Audience ----------------+ |
| | Name  [ Spring prices                       ] | | (•) Contacts with tags            | |
| | Text  [ New prices from Monday:             ] | | ( ) Hand-picked group             | |
| |       [ roses 20% off for VIP customers.    ] | | [Send to · Any of 1 ▾] [Leave out · 1 ▾] |
| |       [                                     ] | | [VIP]  [− Staff]                  | |
| |                     4 041 characters left     | |-----------------------------------| |
| +-----------------------------------------------+ | Audience                 38       | |
|                                                   | Left out — blocked the bot   2     | |
|                                                   | Left out — never wrote to         | |
|                                                   |   the current bot             0   | |
|                                                   | Would reach              **36**   | |
|                                                   +-----------------------------------+ |
+------------------------------------------------------------------------------------------+
  (operator: no [ Launch ]; under the title: "Only a business owner launches broadcasts.")

draft group
+--------- Audience -----------------------------------------------+
| ( ) Contacts with tags   (•) Hand-picked group                   |
| 14 contacts                                   [ Add contacts ]   |
| +--------------------------------------------------------------+ |
| | (TU) Test User  @test_user_1  [Wholesale]  [Blocked the bot] ✕ | |
| | (T2) Test User 2  no username  [Kyiv] [VIP]                 ✕ | |
| |  …                                                           | |
| +--------------------------------------------------------------+ |
|                         [ Show more ]                            |
| Audience 14 · blocked the bot 1 · never wrote 0 · Would reach 13 |
+------------------------------------------------------------------+

draft text over
| Text  [ …4101 units of text…                  ]  (aria-invalid)                           |
|       ! The text must be 1 to 4096 characters as Telegram counts them — 5 over            |

draft stale
+------------------------------------------------------------------------------------------+
| [!] A teammate changed this draft. Their version is shown; your edit is kept below to    |
|     apply again.                                                                         |
| Text  [ New prices from Monday!  (teammate's)  ]                                         |
|       +---------------------------------------+                                          |
|       | Your edit: New prices from Monday.    |  [ Use mine ] [ Keep theirs ]            |
|       +---------------------------------------+                                          |
+------------------------------------------------------------------------------------------+

draft phone
+------------------------------------+
| Spring prices  [Draft]  Saved      |
| [            Launch              ] |
| [ Duplicate ] [ More ▾ ]           |
| +-------- Message ---------------+ |
| | Name [ Spring prices         ] | |
| | Text [ …                     ] | |
| +--------------------------------+ |
| +-------- Audience --------------+ |
| | (•) Contacts with tags         | |
| | [   Send to · Any of 1     ▾ ] | |
| | [   Leave out · 1          ▾ ] | |
| | Audience 38 … Would reach 36   | |
| +--------------------------------+ |
+------------------------------------+
```

### SCR-26 — Group picker

New, `Dialog` over SCR-25 (Decision 8), title «Add contacts», opened by **Add contacts** on a group draft. `listContacts` (unchanged matching and counts), `getBroadcastGroupMembership`, `addBroadcastGroupContact`, `countBroadcastGroupMatching`, `addBroadcastGroupMatching`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | opened, or the search / filter changed — `listContacts` then `getBroadcastGroupMembership` for the page's ids; 8 `Skeleton` rows, the count a short `Skeleton` (flow 8) | NEW: GroupPicker (Dialog, ScrollArea, Skeleton), DataTableToolbar | — |
| default | rows of the Contacts list read with the same search (300 ms debounce) and tag filter; each row: Avatar, name, @username, tags, «Blocked the bot» marker, and **Add** (ghost) or «In group ✓» (muted, for ids in the membership answer); the count «14 of 120 contacts match» or «120 contacts»; **Show more** (50 more, then their membership); footer **Add all matching (N)** with N from `countBroadcastGroupMatching` and **Done** (AC-04; flow 8) | NEW: GroupPicker, DataTableToolbar, Input, extended: TagFilter, Avatar, Badge, Button | wireframe «picker» |
| adding one | **Add** pressed — `addBroadcastGroupContact`; the row's button shows a spinner, then «In group ✓»; the editor's group re-reads when the picker closes (AC-04; flow 8) | Button | — |
| already in the group | `200 outcome: unchanged` — the row turns «In group ✓» and a muted line under it «Already in this group» for 3 s (AC-05; flow 8) | NEW: GroupPicker | — |
| add all matching: confirm | **Add all matching (13)** — the footer becomes «Add 13 contacts to this group?» **Back** / **Add 13**; when `to_add_count` > `can_add` the footer shows instead the refusal below and no confirm (AC-04; flow 8) | Button | wireframe «picker confirm» |
| add all matching: adding | **Add 13** — `addBroadcastGroupMatching` with the search, the filter and `expected_count`; both buttons disabled with a spinner (flow 8) | Button | — |
| add all matching: added | `200` — the footer shows «13 contacts added.», or when `added_count` differs «The matching contacts changed — 12 were added.»; the visible rows turn «In group ✓» (AC-04; flow 8; examples `asCounted`, `changedMeanwhile`) | Alert | — |
| too large | `409 BROADCAST_AUDIENCE_TOO_LARGE` (single or bulk) — `Alert` in the footer «A broadcast's audience can hold at most 10 000 contacts — 10 more can be added.» (`can_add`; «— no more can be added.» at 0); nothing added (AC-05; flow 8) | Alert | — |
| empty: nothing matches | `matching_count: 0` — «No contacts match your search and filter» + **Clear search and filter** (AC-04) | EmptyFilterState | — |
| empty: no contacts | `total_count: 0` — «No contacts yet. A contact appears when a customer writes to the business bot.» | Card | — |
| notice: tag no longer exists | `missing_tag_ids` not empty — as SCR-18 (contacts): dropped from the filter with the one-line notice | Alert | — |
| draft changed | `409 BROADCAST_DRAFT_CHANGED` (a teammate switched the audience to tags) or `BROADCAST_NOT_A_DRAFT` — the picker closes; SCR-25 shows the current draft (stale-save notice) or SCR-28 (flow 8 amended) | — | — |
| contact gone | `404` on an add (should not happen for a listed row) — the page re-reads; `Alert` «This contact is no longer available.» | Alert | — |
| error | `listContacts` fails — destructive `Alert` «Couldn't load contacts» + **Retry**; an add fails (network / `500`) — the row's `Alert` «Couldn't add — Retry» | Alert, Button | — |
| validation | N/A: the search and filter are cleaned like the Contacts address (contacts Decision 1), so the panel never sends the contract's `400` | — | — |
| closed | **Done**, Esc or ✕ — the editor re-reads `listBroadcastGroup` and `getBroadcast` (size, breakdown) (flow 8) | — | — |
| phone (< sm) | full-screen dialog; rows stack; the footer buttons go full width | NEW: GroupPicker | — |
| guard states | → §Shared states | — | §Shared states |

```text
picker
+--------------------------------- Add contacts ---------------------------------------- ✕ +
| [ Search by name or username     ] [Tags · Wholesale ▾]           14 of 120 contacts match |
| +--------------------------------------------------------------------------------------+ |
| | (TU) Test User      @test_user_1  [Wholesale]                         In group ✓     | |
| | (T2) Test User 2    no username   [Wholesale] [Kyiv]                  [ Add ]        | |
| | (T3) Test User 3    @test_user_3  [Wholesale] [Blocked the bot]       [ Add ]        | |
| |  …                                                                                    | |
| +--------------------------------------------------------------------------------------+ |
|                                    [ Show more ]                                         |
|------------------------------------------------------------------------------------------|
|                                         [ Add all matching (13) ]  [ Done ]              |
+------------------------------------------------------------------------------------------+

picker confirm (footer replaced in place)
|------------------------------------------------------------------------------------------|
| Add 13 contacts to this group?                               [ Back ]  [ Add 13 ]        |
+------------------------------------------------------------------------------------------+
```

### SCR-27 — Launch confirmation

New, `AlertDialog` over SCR-25 for a business owner, at `/w/<id>/broadcasts/<broadcastId>/launch` (Decision 1). Title «Send this broadcast?». `getLaunchConfirmation` (already answered on open), `launchBroadcast`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | the address opened directly — the draft loads, then `getLaunchConfirmation`; the dialog shows `Skeleton` lines until it answers; a refusal closes it and shows on the draft (SCR-25 refusal rows) | AlertDialog, Skeleton | — |
| default | `200` — «This message goes to **36 contacts** from your business bot:», the text in a bordered read-only box exactly as the customer will see it (plain text, line breaks kept, scrolls above 12 lines), the AudienceBreakdown («Left out: 2 — blocked the bot 2, never wrote to the current bot 0»), and a warning `Alert` «Customers who did not expect this message can block or report the bot. That can limit the bot for support too.»; **Cancel** (focused) / **Send to 36 contacts** (primary) (AC-06; flow 10) | AlertDialog, Alert, NEW: AudienceBreakdown, ScrollArea, Button | wireframe «launch confirm» |
| launching | **Send to 36 contacts** — `launchBroadcast` with the version and fingerprint; spinner, both buttons disabled, Esc ignored (AC-06; S1) | Button | — |
| launched | `200 outcome: launched` or `already_launched` — the dialog closes and the address becomes the broadcast's (`replace`), showing SCR-28 «Sending» (AC-06; flow 10) | — | — |
| asks again: audience changed | `409 BROADCAST_AUDIENCE_CHANGED` — the dialog stays and shows `details.confirmation`: a notice «The contacts this broadcast would reach changed. Check the number and confirm again.», the new count and breakdown; the next confirm sends the new version and fingerprint (AC-06; flow 10) | Alert, NEW: AudienceBreakdown | wireframe «launch confirm» |
| asks again: draft changed | `409 BROADCAST_DRAFT_CHANGED` — the dialog re-reads `getLaunchConfirmation` and shows «This draft was changed by a teammate. Check the text and number and confirm again.» with the new text and count (AC-06; flow 10) | Alert | — |
| refused at confirm time | `409 BROADCAST_NEEDS_WORKING_BOT` / `BROADCAST_AUDIENCE_TOO_LARGE` / `BROADCAST_NO_REACHABLE_CONTACT`, `429 BROADCAST_LAUNCH_LIMIT_REACHED`, `400 BROADCAST_TEXT_INVALID` — the same texts as SCR-25's refusal rows, shown as a destructive `Alert` in the dialog; only **Close** remains (the bot refusal adds **Open bot settings** → SCR-08) (AC-05, AC-09, AC-10; flow 10) | Alert, Button | — |
| owner deactivated | `403 ACCESS_REMOVED` — nothing launched; → SCR-07 (AC-08; flow 10) | — | — |
| operator | `403 OWNER_ONLY`, or an operator opens the address — the dialog never opens; the draft at its own address (`replace`) with the owners-only note (AC-07; flow 10) | — | — |
| error | `launchBroadcast` fails (network / `500`) — destructive `Alert` «Couldn't send the broadcast. Nothing was sent.» + the confirm button enabled again (a repeat is safe: a second launch returns the launched broadcast) | Alert | — |
| cancelled | **Cancel** or Esc — the dialog closes, the address returns to the draft, focus to **Launch** | — | — |
| empty | N/A: the confirmation opens only with at least one reachable contact (flow 10) | — | — |
| phone (< sm) | the dialog is full width; the text box takes the remaining height; buttons stack, the confirm first | AlertDialog | — |
| guard states | → §Shared states | — | §Shared states |

```text
launch confirm
+---------------------------- Send this broadcast? --------------------------------+
| This message goes to 36 contacts from your business bot:                         |
| +------------------------------------------------------------------------------+ |
| | New prices from Monday:                                                      | |
| | roses 20% off for VIP customers.                                             | |
| +------------------------------------------------------------------------------+ |
| Audience 38 · Left out: blocked the bot 2 · never wrote to the current bot 0     |
| [!] Customers who did not expect this message can block or report the bot.       |
|     That can limit the bot for support too.                                      |
| ( asks again: [i] The contacts this broadcast would reach changed. Check the     |
|   number and confirm again. )                                                    |
|                                      [ Cancel ]  [ Send to 36 contacts ]         |
+----------------------------------------------------------------------------------+
```

### SCR-28 — Broadcast page

New, read-only, `/w/<id>/broadcasts/<broadcastId>` once launched; breadcrumb «… › Broadcasts › <name>». Both roles; Stop for a business owner while sending (AC-11, AC-18). `getBroadcast`, `listBroadcastRecipients`, `duplicateBroadcast` (via SCR-30), `stopBroadcast` (via SCR-29). Decisions 10, 11.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| loading | `getBroadcast` in flight — `Skeleton` header, text and report; then the first recipient page with 8 skeleton rows (flow 11) | NEW: BroadcastPage (Card, Skeleton) | — |
| default: sending | `status: sending` — title row: name, «Sending» status, **Duplicate**, and for a business owner **Stop** (outline destructive); a line «Launched by Test User · today 09:00» and «Read-only — a launched broadcast can't be changed.»; cards **Message** (the text, plain), **Audience** (as defined: «Any of VIP · leaving out Staff» with the names at launch, or «Hand-picked group», and the frozen AudienceBreakdown «Sent to 36»), and **Delivery report** (AC-11; flow 11; example `sending`) | NEW: BroadcastPage, Badge, Button, NEW: AudienceBreakdown, NEW: BroadcastReport | wireframe «broadcast page» |
| report | totals and the recipients table per Decision 10; picking a contact → SCR-19 (AC-11; flow 11) | NEW: BroadcastReport (Card, Select, Table, Badge, Button) | wireframe «broadcast page» |
| report: narrowed | an outcome chosen in the `Select` — `listBroadcastRecipients?state=…` from the top; «No recipients with this outcome.» when empty (flow 11) | Select | — |
| report: more | **Show more** — the next 50 after `next_cursor`; spinner; gone when `has_next` is false; a failure → `Alert` «Couldn't load more recipients» + **Retry** (flow 11) | Button, Alert | — |
| live | `broadcast.changed` `report` / `status` — the totals and the current page re-read in place (at most one per second per broadcast), no scroll jump; rows already shown keep their place (AC-11; flow 11) | NEW: BroadcastReport | — |
| sent | `status: sent`, `end_reason: completed` — «Sent» status, «Finished today 09:02»; no Stop (AC-11; flow 13) | Badge | — |
| sent: ended early | `end_reason: text_refused` / `bot_stopped` — «Sent» + an `Alert` «Sending ended early: Telegram refused the text.» / «Sending ended early: the bot stopped working.» + «You can duplicate it, fix the text or the bot, and send the copy to the recipients it did not reach.» with **Duplicate** (AC-12; flow 13) | Alert, Button | — |
| stopped | `status: stopped` — «Stopped», «Stopped by Test User · today 09:03», the «Not sent — stopped» total; no Stop (AC-18; S4) | Badge | — |
| stop | **Stop** (owner, sending) → SCR-29 (AC-18; S4) | Button | — |
| operator | no **Stop**; nothing else differs (AC-18; flow 11) | — | — |
| read-only | the page has no edit or delete control; an attempt from an old tab (`409 BROADCAST_NOT_A_DRAFT`) lands here with «This broadcast was launched and can no longer be changed.» (AC-09; flow 11) | Alert | — |
| duplicate | **Duplicate** → SCR-30 (AC-13; flow 15) | Button | — |
| empty | N/A: a launched broadcast has at least one recipient (frozen breakdown CHECK); a narrowed outcome with none is `report: narrowed` | — | — |
| error | `getBroadcast` fails — destructive `Alert` «Couldn't load this broadcast» + **Retry**; a recipients page fails — `Alert` in the report + **Retry**; a background re-read failing keeps what is shown (flow 11) | Alert, Button | — |
| phone (< md) | the three cards stack; the totals wrap two per row; the recipients table becomes stacked rows (name, then outcome + time, then the reason) | NEW: BroadcastPage, NEW: BroadcastReport | wireframe «broadcast page phone» |
| guard states | → §Shared states | — | §Shared states |

```text
broadcast page                                                     (business owner, sending)
+------------------------------------------------------------------------------------------+
| Spring prices   [● Sending]                                 [ Duplicate ] [ Stop ]       |
| Launched by Test User · today 09:00 · Read-only — a launched broadcast can't be changed. |
| +------------- Message ---------------------+ +------------ Audience -----------------+ |
| | New prices from Monday:                   | | Any of VIP · leaving out Staff        | |
| | roses 20% off for VIP customers.          | | Audience 38 · blocked 2 · never wrote 0 | |
| +-------------------------------------------+ | Sent to 36                            | |
|                                               +---------------------------------------+ |
| +------------------------------ Delivery report ---------------------------------------+ |
| |  Waiting 22   Delivered 12   Blocked the bot 1   Failed 1                             | |
| |  [ All recipients ▾ ]                                                                 | |
| |  Contact             | Outcome           | Reason                     | Time          | |
| |  Test User           | [Delivered]       |                            | 09:00         | |
| |  Test User 2         | [Failed]          | Account no longer exists   | 09:00         | |
| |  Test User 3         | Waiting           |                            |               | |
| |   …                                                                                   | |
| |                               [ Show more ]                                           | |
| +--------------------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------------+

broadcast page phone
+------------------------------------+
| Spring prices  [● Sending]         |
| [ Duplicate ]  [ Stop ]            |
| Launched by Test User · 09:00      |
| +-------- Message ---------------+ |
| +-------- Audience --------------+ |
| +-------- Delivery report -------+ |
| | Waiting 22     Delivered 12    | |
| | Blocked 1      Failed 1        | |
| | Test User                      | |
| | [Delivered] · 09:00            | |
| +--------------------------------+ |
+------------------------------------+
```

### SCR-29 — Stop confirmation

New, `AlertDialog` over a sending SCR-28 for a business owner. Title «Stop this broadcast?». `stopBroadcast`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | **Stop** pressed — «22 recipients are still waiting. They will not get this message. Sends already on their way finish. A stop can't be undone.» (the waiting total from the last read; it may be stale, no second confirmation); **Keep sending** (focused) / **Stop broadcast** (destructive) (AC-18; S4) | AlertDialog, Button | — |
| stopping | confirm — spinner, both disabled, Esc ignored (S4) | Button | — |
| stopped | `200 outcome: stopped` — the dialog closes; SCR-28 shows «Stopped» from the answer's broadcast (AC-18; S4) | — | — |
| unchanged | `200 outcome: unchanged` — the dialog closes; SCR-28 shows the answer's status («Sent» when the last outcome came in first) and a one-line notice «Nothing was waiting any more — the broadcast had already finished.» (AC-18; S4) | Alert | — |
| owners only | `403 OWNER_ONLY` (the role changed) — the dialog closes; **Stop** disappears (AC-18) | — | — |
| error | network / `500` — destructive `Alert` in the dialog «Couldn't stop the broadcast» + the confirm enabled again (a repeat is safe) | Alert | — |
| empty / validation | N/A: a confirmation with no list and no input | — | — |
| guard states | → §Shared states | — | §Shared states |

### SCR-30 — Duplicate broadcast

New, `Dialog` for a launched broadcast, from SCR-28 or a launched row of SCR-24. Title «Duplicate “Spring prices”». `duplicateBroadcast`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | a `RadioGroup` «Who should the copy go to?»: **The same tags** («Any of VIP · leaving out Staff — counted again when you launch»; shown only for a tag audience, preselected then), **All recipients** («36 contacts — those who blocked the bot stay in the group, counted as unreachable»; preselected for a group), **Only recipients it didn't reach** («2 contacts whose send failed for a reason a new attempt can fix»); **Cancel** / **Create draft** (AC-13; flow 15) | Dialog, RadioGroup, Label, Button | wireframe «duplicate» |
| not reached: disabled | the broadcast is still sending — the third option is disabled with «Available once the broadcast has ended» (AC-13; flow 15) | RadioGroup | — |
| not reached: not confirmed | the third option chosen and `totals.not_confirmed` > 0 — a `Checkbox` under it «Also include 3 recipients whose send was not confirmed» with the warning «They may already have received it.»; unchecked by default; checked sends `include_not_confirmed: true` (AC-13; flow 15) | Checkbox, Alert | wireframe «duplicate» |
| creating | **Create draft** — spinner, buttons disabled | Button | — |
| created | `201` — the dialog closes and the copy's editor opens (SCR-25), named «Copy of Spring prices»; the original unchanged (AC-13; flow 15) | — | — |
| refused: not ended | `409 BROADCAST_NOT_ENDED` (the page was stale) — the third option turns disabled with its reason and a notice «It is still sending — choose another option or wait until it ends.» (flow 15) | Alert | — |
| error | network / `500`, or `400` — destructive `Alert` «Couldn't create the copy» | Alert | — |
| empty | N/A: the counts come from the page; a «did not reach» copy with 0 contacts still creates an empty group draft (contract) and the option reads «0 contacts» | — | — |
| guard states | → §Shared states | — | §Shared states |

```text
duplicate
+------------------------ Duplicate "Spring prices" ------------------------ ✕ +
| Who should the copy go to?                                                   |
| (•) The same tags                                                            |
|     Any of VIP · leaving out Staff — counted again when you launch           |
| ( ) All recipients                                                           |
|     36 contacts — those who blocked the bot stay, counted as unreachable     |
| ( ) Only recipients it didn't reach                                          |
|     2 contacts whose send failed for a reason a new attempt can fix          |
|     [ ] Also include 3 recipients whose send was not confirmed               |
|         They may already have received it.                                   |
|     (while sending: disabled — Available once the broadcast has ended)       |
|                                            [ Cancel ]  [ Create draft ]      |
+------------------------------------------------------------------------------+
```

### SCR-31 — Confirm delete draft

New, `AlertDialog` from SCR-25 or a draft row of SCR-24, offered only to the draft's author and business owners. Title «Delete “Wholesale catch-up”?». `deleteBroadcast`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | «This draft and its audience of 14 contacts will be deleted. This can't be undone. Nothing is sent to anyone.»; **Cancel** (focused) / **Delete draft** (destructive) (AC-07; flow 9) | AlertDialog, Button | — |
| deleting | spinner, both disabled, Esc ignored | Button | — |
| deleted | `200` — back to SCR-24 (from the editor) or the row disappears (from the list) (flow 9) | — | — |
| refused: not author | `403 FORBIDDEN` — destructive `Alert` «A draft is deleted by its author or a business owner.»; only **Close** (AC-07; flow 9) | Alert | — |
| refused: launched | `409 BROADCAST_NOT_A_DRAFT` — the dialog closes; SCR-28 with «This broadcast was launched and can no longer be changed.» (AC-09; flow 9) | Alert | — |
| gone | `404` — the dialog closes; the list re-reads (it was deleted meanwhile) | — | — |
| error | network / `500` — destructive `Alert` «Couldn't delete the draft» | Alert | — |
| empty / validation | N/A: a confirmation with no list and no input | — | — |
| guard states | → §Shared states | — | §Shared states |

### SCR-32 — Confirm switch audience

New, `AlertDialog` over SCR-25 when a member chooses «Contacts with tags» on a draft whose group is not empty. Title «Switch to contacts with tags?». `saveBroadcastAudience { kind: tags, expected_group_size }`.

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | «The hand-picked group of 14 contacts will be removed from this draft.»; **Keep the group** (focused) / **Switch** (AC-03; flow 7) | AlertDialog, Button | — |
| switching | spinner, both disabled | Button | — |
| switched | `200` — the dialog closes; the Audience card shows the tag audience (any of, no tag = every contact) and its breakdown (flow 7) | — | — |
| asks again | `409 BROADCAST_GROUP_CHANGED` — the dialog stays with the new size from `details.group_size` and «The group changed while you were deciding.»; the next confirm sends it (AC-03; flow 7) | Alert | — |
| stale / launched | `409 BROADCAST_DRAFT_CHANGED` / `BROADCAST_NOT_A_DRAFT` — the dialog closes; SCR-25's stale notice or SCR-28 | — | — |
| cancelled | **Keep the group** — the kind stays «Hand-picked group» | — | — |
| error | network / `500` — destructive `Alert` «Couldn't switch the audience» | Alert | — |
| empty / validation | N/A: a confirmation with no list and no input; an empty group switches without this dialog | — | — |
| guard states | → §Shared states | — | §Shared states |

### SCR-02 — Inbox — conversation thread (changed)

Shipped (shared-inbox, assignment-statuses, contacts); every listed state stays. **Added:** the broadcast item (Decision 12, extended: ThreadItemView).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim (messages, replies, activity lines, header, composer) | Thread, ThreadItemView | — |
| broadcast item: delivered | a `ThreadBroadcastItem` with `state: delivered` in `listThreadItems` — the centred block «📣 Broadcast **Spring prices** · sent by Test User», the text (plain, line breaks kept), the delivered time; the name links to SCR-28 (AC-16; flow 18) | extended: ThreadItemView, NEW: BroadcastItem | wireframe «thread broadcast item» |
| broadcast item: not confirmed | `state: not_confirmed` — the same block with a `Badge` «Not confirmed» and «sent at 09:00 — Telegram did not answer» (AC-16; flow 18) | NEW: BroadcastItem, Badge | — |
| launcher deactivated | `launched_by` is a deactivated member — still named (AC-16) | NEW: BroadcastItem | — |
| live | `conversation.changed { item.type: broadcast, change: created }` for the open conversation — `getThreadBroadcastItem`, inserted at its position; the header's status, assignee, waiting marker, the unread state and the frame's attention count do **not** change (AC-16; flow 18) | Thread | — |
| customer answers | inherited: the answer is a customer message (reopens, unread, waiting, ping as usual) (AC-16) | — | — |
| loading / error / empty | inherited verbatim (Thread) | Thread | — |
| guard states | inherited + §Shared states | — | §Shared states |

```text
thread broadcast item
|                                                                                     |
|              +-------------------------------------------------------+              |
|              | 📣 Broadcast Spring prices · sent by Test User         |              |
|              | New prices from Monday:                               |              |
|              | roses 20% off for VIP customers.                      |              |
|              |                                          today 09:00  |              |
|              +-------------------------------------------------------+              |
|  ( Test User )  Is the VIP price for roses too?                       09:04         |
```

### SCR-18 — Contacts list (changed)

Shipped (contacts); every listed state stays. **Added:** the blocked marker (extended: ContactsTable).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim (contacts SCR-18) | ContactsTable | — |
| blocked marker | a row with `blocked_since` set — a `Badge` (`outline`, destructive text) «Blocked the bot» after the name, `title` «Blocked the bot since 20 Oct 2026» (AC-14; flow 16) | extended: ContactsTable, Badge | wireframe «contacts blocked» |
| no bot | every `blocked_since` null — no markers (AC-10) | — | — |
| live: reach | `contact.changed { change: reach }` for a contact on the current page — the page re-reads in place (contract assumption 7); everything else on SCR-18 stays not live (AC-14; flow 16) | extended: ContactsTable | — |
| phone (< md) | the marker wraps under the name with the @username | extended: ContactsTable | — |
| loading / empty / error / guard | inherited verbatim | — | — |

```text
contacts blocked
| (TU) Test User  [Blocked the bot]  | [Kyiv] [VIP] | Ukrainian | 2 Sep 2026 | 3 min ago |
|      @test_user_1                  |              |           |            |           |
```

### SCR-19 — Contact profile (changed)

Shipped (contacts); every listed state stays. **Added:** the blocked line (extended: ContactProfile).

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim (contacts SCR-19) | ContactProfile | — |
| blocked | `blocked_since` set — under the facts line a muted line with a `Badge` «Blocked the bot» and «since 20 Oct 2026» (AC-14; flow 16) | extended: ContactProfile, Badge | — |
| not blocked | `blocked_since` null — no line (AC-14) | — | — |
| live: reach | `contact.changed { change: reach }` for this contact — `getContact` re-read; the line appears or goes (AC-14; flow 16) | extended: ContactProfile | — |
| new entry | picking a recipient on SCR-28 opens this profile; back returns to the report (ux-flows) | — | — |
| loading / error / not found / guard | inherited verbatim | — | — |

### SCR-06 — Not found (in frame)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entries**: a broadcast address that is unknown, deleted or of another workspace, and the Broadcasts address of a workspace the account is not a member of — no hint (AC-08; flows 5, 6, 9, 11) | AppShell, NotFoundCard | — |
| error / empty | N/A: a static card with no data load | — | — |

### SCR-07 — Access-removed landing

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entries**: `403 ACCESS_REMOVED` on any broadcasts route — including the launch, after which nothing was launched — and the socket close `4403` on SCR-24…SCR-32 (AC-08; flow 5, flow 10) | AuthLayout, Alert, Button, Badge | — |
| loading, error | inherited | Skeleton, Alert, Button | — |

### SCR-08 — Settings — Bot

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entry**: **Open bot settings** on a launch refused for the bot (SCR-25, SCR-27) or on a draft with no bot (AudienceBreakdown); back returns to the draft (AC-10; flow 10) | SettingsLayout, Card, Badge, Alert, Button | — |
| owners only, loading, error | inherited | Card, Button, Skeleton, Alert | — |

### SCR-09 — Sign-in

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **new entries**: a signed-out visit to a Broadcasts, broadcast or launch-confirmation address; after sign-in the same address opens (an operator on the launch address then lands on the draft) (AC-08; flow 5) | AuthLayout, Field, Input, Label, Button | — |
| validation, error | inherited | Field, Alert, Button | — |

### SCR-15 — Workspace frame

| State | Trigger / condition | Components (from the inventory) | Source-ref |
| --- | --- | --- | --- |
| default | inherited verbatim; **Broadcasts** (lucide `Megaphone`) joins the primary nav between Contacts and Settings for both roles (Decision 2) | extended: AppShell, Sidebar | — |
| breadcrumb: broadcast | the last crumb is the broadcast's name from the open draft or page, «New broadcast» on `/new`, «Broadcast» while loading or not found (Decision 2) | Breadcrumb, NEW: BroadcastCrumb | — |
| attention | broadcast items never move the attention count or the title prefix (AC-16; ADR-0010; events.md) | extended: AppShell | — |
| entering / not found / error / access removed | inherited verbatim | Skeleton, NotFoundCard, Alert | — |
| empty | N/A: the frame has no list of its own | — | — |

## New components

| Component | Why no existing primitive fits | Registered in design-system |
| --- | --- | --- |
| BroadcastsTable | SCR-24's list on `listBroadcasts`: status badges, audience size with the over-limit warning, «last change» wording by status, role-aware row actions, live re-read, stacked phone rows; composes Card, Table, Badge, DropdownMenu, Button, Tooltip, Skeleton, Alert | registered (2026-10-24) |
| BroadcastEditor | SCR-25's two-card editor: save-as-you-go with one save in flight per draft against the shown version, the status line, the stale-save merge view, the kind switch, the role-aware title actions and every launch pre-check refusal in place; composes Card, Field, Input, Textarea, Label, RadioGroup, Button, DropdownMenu, Alert, Skeleton | registered (2026-10-24) |
| AudienceBreakdown | The count breakdown (CONTEXT) in one place for SCR-25, SCR-27 and SCR-28 — four labelled numbers, the «would reach» / «sent to» emphasis and the no-bot variant; fixed copy no primitive provides; composes Separator, Button (link) | registered (2026-10-24) |
| BroadcastGroupList | SCR-25's group: rows with tags and the blocked marker, per-row Remove, keyset Show more, size header with Add contacts; ContactsTable cannot be reused (address-bound, no remove, no added order); composes Table, Avatar, Badge, Button, Skeleton | registered (2026-10-24) |
| GroupPicker | SCR-26: the Contacts list read inside a Dialog with membership marks, per-row Add, and the two-step Add all matching with the changed-matches and too-large outcomes; composes Dialog, DataTableToolbar, Input, TagFilter (controlled), ScrollArea, Avatar, Badge, Button, Alert, Skeleton, EmptyFilterState | registered (2026-10-24) |
| LaunchConfirmDialog | SCR-27: shows the confirmation, sends its version and fingerprint, re-asks on `BROADCAST_AUDIENCE_CHANGED` / `BROADCAST_DRAFT_CHANGED`, owns the `/launch` address; after `CloseConfirmDialog`'s pattern; composes AlertDialog, Alert, ScrollArea, Button, AudienceBreakdown | registered (2026-10-24) |
| BroadcastPage | SCR-28's read-only header, message and audience cards with status, launch / stop / finish lines and the ended-early notice; composes Card, Badge, Button, Alert, Skeleton, AudienceBreakdown | registered (2026-10-24) |
| BroadcastReport | SCR-28's live totals, outcome filter and paged recipients table with plain reasons, one fetch at a time on `broadcast.changed`; composes Card, Select, Table, Badge, Button, Alert, Skeleton | registered (2026-10-24) |
| StopBroadcastDialog | SCR-29: the waiting count, stopped / unchanged answers; composes AlertDialog, Alert, Button | registered (2026-10-24) |
| DuplicateBroadcastDialog | SCR-30: the audience choice with per-option counts, the disabled-until-ended option and the not-confirmed checkbox warning; composes Dialog, RadioGroup, Checkbox, Label, Alert, Button | registered (2026-10-24) |
| DeleteDraftDialog | SCR-31: names the draft and its audience size; composes AlertDialog, Alert, Button | registered (2026-10-24) |
| SwitchAudienceDialog | SCR-32: sends the group size it shows and re-asks on `BROADCAST_GROUP_CHANGED`, after `DeleteTagDialog`'s pattern; composes AlertDialog, Alert, Button | registered (2026-10-24) |
| BroadcastItem | SCR-02's broadcast entry: a centred, full-width block that is neither bubble side, with name link, launching owner, text and delivered / not-confirmed time; like `ActivityLine`, fixed copy no primitive provides; composes Badge, Button (link) | registered (2026-10-24) |
| BroadcastCrumb | The broadcast's breadcrumb label from live data, like `ContactCrumb` | registered (2026-10-24) |
| TagAudience (built) | The tag audience of SCR-25 was built as its own component (Send to, Leave out, badges, notices); registered under that name | registered (2026-10-24) |
| TagFilter (extended) | Existing component; gains a controlled mode (`value` / `onChange`, no page address) so the draft's Send to and the group picker reuse it — canon row updated, not duplicated | registered (2026-10-24) |
| ThreadItemView (extended) | Existing component; gains the kind `broadcast` rendering BroadcastItem — canon row updated | registered (2026-10-24) |
| ContactsTable (extended) | Existing component; gains the «Blocked the bot» row marker and the re-read on `contact.changed reach` — canon row updated | registered (2026-10-24) |
| ContactProfile (extended) | Existing component; gains the «Blocked the bot since …» line and its live re-read — canon row updated | registered (2026-10-24) |
| AppShell (extended) | Existing component; the Broadcasts nav item — canon row updated | registered (2026-10-24) |
