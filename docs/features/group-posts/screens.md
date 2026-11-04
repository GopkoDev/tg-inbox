---
status: draft
feature_size: "M"
tool: "code"
updated_at: "2026-11-03"
---

# Screens — group-posts

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`) — inline wireframes below. No degradation.
- **File:** inline wireframes below.
- **Inventory:** SCR ids from [`ux-flows.md`](ux-flows.md) — SCR-06, SCR-07, SCR-08, SCR-09, SCR-15, SCR-33…SCR-44, all covered. SCR-06, SCR-07, SCR-08 and SCR-09 are shipped landings reached from new addresses with no new layout; their existing states are not repeated (one row each below). SCR-15 gains the Posts item; SCR-33…SCR-44 are new.
- **Sources per row:** spec §5 ACs, sad.md §6 flows (`flow N`), contract responses (`contracts/openapi.yaml` `operationId` + code) and live frames (`contracts/events.md`). Every non-default state names one.
- **Copy:** texts quoted below may be polished by `implement` without changing their meaning. Post texts, chat titles, usernames and member names render as plain text everywhere; the post text keeps its line breaks (`whitespace-pre-wrap`). Times are shown in the **workspace time zone with the zone named** («Wed 4 Nov, 09:00 (Europe/Kyiv)»), through one helper in `features/posts/time.ts` over `packages/shared/src/time-zone.ts`.
- **No new npm dependency and no new shadcn primitive.** The date and time inputs are native `<input type="date">` / `<input type="time">` inside `Input` (the canon has no date picker; a pilot schedules a handful of posts).

### Decisions taken at this stage

1. **Addresses** (sad.md §4): `/w/<id>/posts` (SCR-36, `?filter=` in the address), `/w/<id>/posts/new` (SCR-37 before the first save, replaced by the id after `createPost`), `/w/<id>/posts/<postId>` (SCR-37 while `state: draft`, SCR-40 otherwise), `/w/<id>/posts/<postId>/publish` (SCR-38) and `/schedule` (SCR-39) over SCR-37 for an owner — an operator is sent to the post with `replace` and sees the owners-only note; `/w/<id>/settings/channels` (SCR-33).
2. **Navigation:** a **Posts** item (lucide `Send`) between Broadcasts and Settings for both roles, with a `SidebarMenuBadge` for the attention count (`aria-label` «N posts need attention»). Settings gains **Channels & groups** for both roles (an operator's Settings nav becomes Channels & groups / Notifications).
3. **The editor is not optimistic about state:** it saves 600 ms after the last keystroke and on blur, showing «Saving…» / «Saved» / the stale notice; it never shows a published state before `post.changed` and the re-read.
4. **Destination picker** = `Select` with each destination's title and a kind `Badge`; an unavailable one stays selectable in a draft but shows its problem under the field and blocks Publish / Schedule.

## Screens

### SCR-06 / SCR-07 / SCR-09 — reused landings

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | unknown or foreign post / destination / code address (`PostsItemNotFound`, AC-04); deactivated during any posts action (`ACCESS_REMOVED`); signed out on a posts address | NotFoundCard / existing landing / existing sign-in | shipped screens, unchanged |
| error / empty | N/A: shipped landings, their states are unchanged and defined by their own features | — | — |

### SCR-08 — Settings — Bot (reused)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | reached from «Open bot settings» on a `POSTS_NEED_WORKING_BOT` refusal (AC-14) | SettingsLayout (unchanged) | shipped screen, unchanged |
| error / empty | N/A: shipped screen, unchanged (bot-connection, ui-redesign) | — | — |

### SCR-15 — Workspace frame (extended)

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | Posts item for every member | extended: AppShell (nav item), Sidebar | wireframe below |
| attention | `getPostAttention.count > 0`, re-read on `post.changed` (AC-12, AC-13, flow 9) | SidebarMenuBadge, Badge (below `md`) | wireframe below |
| loading | count not yet read | — (no badge, as the Inbox count) | — |
| error | count read failed | — (last count stays, as the Inbox count) | — |

```text
| Inbox        3 |
| Contacts       |
| Broadcasts     |
| Posts        1 |   <- «1 post needs attention»
| Settings       |
```

### SCR-33 — Settings — Channels & groups

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `listDestinations` pending | SettingsLayout, Card, Skeleton | — |
| default (owner) | destinations listed, time zone set (AC-01) | NEW: DestinationsCard (Table rows: title, kind Badge, @username, state Badge, scheduled count, DropdownMenu «Remove»), Button «Connect a channel or group», NEW: TimeZoneField (Select + Button «Change») | wireframe A |
| default (operator) | same list, no actions (AC-03) | same, actions hidden; muted line «Only a business owner can connect channels and groups or change the time zone» | — |
| empty | no destination (AC-01) | Card with how-to: «Add the bot to your channel as an admin who can post messages, or to your group, then connect it here.» + Connect button (owner) | wireframe B |
| unavailable row | `availability: unavailable` with problem (AC-13, AC-14, flow 7) | destructive Badge «Can't post» + muted reason: «Give the bot the right to post messages» / «The bot is no longer in this chat» / «This chat no longer exists» / «Connected with your previous bot — connect it again» | wireframe A |
| time zone not set | `time_zone: null` | TimeZoneField «Not set — you'll be asked when you first schedule a post» + «Set» (owner) | — |
| no working bot | `POSTS_NEED_WORKING_BOT` on Connect (AC-14) | Alert + Button «Open bot settings» (SCR-08) | — |
| destination limit | `DESTINATION_LIMIT_REACHED` (20) | Alert «You can connect up to 20 channels and groups» | — |
| error | read failed | Alert destructive + Button «Retry» | — |
| live | `destinations.changed` | re-read in place | — |

```text
A  Channels & groups                                   [Connect a channel or group]
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ Test Channel  [Channel] @test_channel   [Available]      2 scheduled   [⋯]   │
   │ Test Group    [Group]                   [Can't post]     1 scheduled   [⋯]   │
   │               Give the bot the right to post messages                        │
   └──────────────────────────────────────────────────────────────────────────────┘
   Time zone for scheduled posts:  Europe/Kyiv  [Change]

B  ┌──────────────────────────────────────────────────────────────┐
   │ No channels or groups yet                                     │
   │ Add the bot to your channel as an admin who can post          │
   │ messages, or to your group, then connect it here.             │
   │                                  [Connect a channel or group] │
   └──────────────────────────────────────────────────────────────┘
```

### SCR-34 — Connect-code dialog

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| creating | `createDestinationCode` pending | Dialog, Skeleton | — |
| waiting | `status: waiting` (flow 1) | NEW: ConnectCodeDialog — Dialog, Tabs «Channel» / «Group» with steps; the code (channel) or the group command, selectable + Button «Copy» («Copied» 2 s; hidden without a clipboard); «Expires at 09:10»; muted «Waiting for the code…» | wireframe |
| connected | `status: connected` via `destinations.changed` (AC-01) | Dialog body «Test Channel is connected», Button «Done» | — |
| missing right | `status: no_post_right` (AC-02) | Alert «The bot can't post in Test Group yet. Give it the right to send messages, then post the code again.» — code stays | — |
| expired | `status: expired` or countdown reached (AC-02) | Alert «This code expired» + Button «Get a new code» (primary) | — |
| replaced | `status: replaced` (another tab made a new one) | Alert «A newer code was created» + «Get a new code» | — |
| refused | `POSTS_NEED_WORKING_BOT` / `DESTINATION_LIMIT_REACHED` | Alert in the dialog (+ «Open bot settings» for the bot) | — |
| error | create or read failed | Alert destructive + «Try again» | — |

```text
┌ Connect a channel or group ───────────────────────────────┐
│ [Channel] [Group]                                          │
│ 1. Make the bot an admin who can post messages.            │
│ 2. Post this message in the channel:                       │
│    tgp_Zm9vYmFyYmF6cXV4MTIzNDU2                    [Copy]  │
│ Expires at 09:10 · Waiting for the code…                   │
│                                                   [Close]  │
└────────────────────────────────────────────────────────────┘
```

### SCR-35 — Remove-destination dialog

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | Remove on a row (flow 10) | AlertDialog «Remove Test Channel?» «2 scheduled posts to it go back to drafts. You can connect it again later.» Cancel / Remove (destructive) | — |
| no scheduled | `scheduled_count: 0` | same, without the drafts line | — |
| pending | `removeDestination` pending | spinner, buttons disabled | — |
| error | failed / `OWNER_ONLY` | Alert destructive in the dialog | — |

### SCR-36 — Posts list

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `listPosts` pending | Card, Skeleton rows | — |
| default | posts listed (AC-05) | NEW: PostsTable — DataTableToolbar (filter Tabs: All / Drafts / Scheduled / Published / Needs attention), Table rows: text start, destination title + kind Badge, state Badge with time («Scheduled · Wed 4 Nov, 09:00 (Europe/Kyiv)», «Published · 2 h ago», «Failed», «Missed», «Not confirmed», «Deleted»), who last changed; Button «New post» | wireframe A |
| needs attention row | `needs_attention` (AC-12, AC-13) | destructive Badge on the row | wireframe A |
| empty | no post at all | Card «Posts appear in your channels and groups from your bot» + «New post»; with no destination: «Connect a channel or group first» → SCR-33 | wireframe B |
| empty filter | filter matches nothing | EmptyFilterState («Show all posts») | — |
| truncated | `truncated: true` | muted line «Showing the newest 200 posts» | — |
| error | read failed | Alert destructive + Retry | — |
| live | `post.changed` | re-read in place | — |

```text
A  Posts                                                              [New post]
   [All] [Drafts] [Scheduled] [Published] [Needs attention 1]
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ New arrivals this week   Test Channel [Channel]  Scheduled · Wed 4 Nov, 09:00 │
   │ Opening hours change     Test Group   [Group]    [Failed]  Test User · 1 h    │
   │ Weekend offer            Test Channel [Channel]  Published · 2 h ago          │
   └──────────────────────────────────────────────────────────────────────────────┘

B  ┌──────────────────────────────────────────────────────────────┐
   │ Posts appear in your channels and groups from your bot.      │
   │                                               [New post]     │
   └──────────────────────────────────────────────────────────────┘
```

### SCR-37 — Post draft

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `getPost` pending | Card, Skeleton | — |
| default (owner) | a draft (AC-05) | NEW: PostEditor — Field + Select (destination), Field + Textarea (text) with «N characters left», Checkbox «Send without sound», preview Card (plain text, line breaks), save line («Saved»); Buttons «Publish now», «Schedule…», DropdownMenu (Duplicate, Delete) | wireframe |
| default (operator) | same (AC-03) | Publish / Schedule replaced by muted «A business owner publishes or schedules posts» | — |
| saving | debounce fired | save line «Saving…» | — |
| validation | text empty / over 4096 / no destination (AC-06; `POST_TEXT_INVALID`) | Field invalid + FieldError; Publish / Schedule disabled with the reason | — |
| stale save | `POST_DRAFT_CHANGED` (AC-06, flow 3) | Alert «A teammate changed this draft — showing their version» + the current text loaded | — |
| destination problem | picked destination unavailable (AC-13) | FieldError with the problem + link «Channels & groups» (SCR-33) | — |
| draft notice | `draft_notice` (AC-11, flow 6, flow 10) | Alert «Back in drafts: the owner who scheduled it no longer has access» / «… is no longer a business owner» / «… its channel or group was removed» | — |
| no destination yet | workspace has none | Select empty + link «Connect a channel or group» | — |
| not a draft anymore | `POST_NOT_A_DRAFT` / live change | page switches to SCR-40 | — |
| delete refused | `FORBIDDEN` (AC-18) | Alert «Only the author or a business owner can delete this draft» | — |
| error | read / save failed | Alert destructive + Retry | — |

```text
Post                                                   Saved
Destination  [Test Channel  (Channel) ▾]
Text         ┌──────────────────────────────────────────┐
             │ New arrivals this week                    │
             └──────────────────────────────────────────┘
             4074 characters left
[ ] Send without sound
Preview      ┌──────────────────────────────────────────┐
             │ New arrivals this week                    │
             └──────────────────────────────────────────┘
                              [Schedule…] [Publish now]  [⋯]
```

### SCR-38 — Publish-now confirmation

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `getPublishConfirmation` pending | Dialog, Skeleton | — |
| default | no blockers (AC-07) | NEW: PublishDialog — AlertDialog «Publish to Test Channel now?», destination title + kind Badge + @username, the exact text, «Without sound» when silent, muted «4 of 30 posts sent in the last 24 hours»; Cancel / Publish | wireframe |
| blocked | `blockers` not empty | Alert per blocker; Publish disabled | — |
| pending | `publishPost` pending | spinner, buttons disabled, Esc ignored | — |
| changed | `POST_DRAFT_CHANGED` (AC-08) | Alert «The draft changed — check it again» + refreshed content | — |
| refused | `DESTINATION_UNAVAILABLE` / `POSTS_NEED_WORKING_BOT` (+ «Open bot settings») / `POST_DAILY_LIMIT_REACHED` («You can post again at 10:12») (AC-14, AC-16) | Alert in the dialog | — |
| done | `queued` / `already_scheduled` | closes to SCR-40 | — |
| owner-only | operator on the address (AC-03) | redirect to the post | — |

```text
┌ Publish to Test Channel now? ──────────────────────────────┐
│ Test Channel [Channel] @test_channel                        │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ New arrivals this week                                  │ │
│ └────────────────────────────────────────────────────────┘ │
│ 4 of 30 posts sent in the last 24 hours                     │
│                                       [Cancel] [Publish]    │
└─────────────────────────────────────────────────────────────┘
```

### SCR-39 — Schedule dialog

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| time zone first | `time_zone: null` (AC-09) | NEW: ScheduleDialog — Dialog step «Confirm the workspace time zone» with TimeZoneField prefilled from the browser, Button «Continue» (`setPostingTimeZone`) | — |
| default | zone set (AC-09) | Dialog: Field date (`Input type=date`), Field time (`Input type=time`, minute steps), muted «Europe/Kyiv», the destination and text summary; Cancel / Schedule | wireframe |
| change time | opened from SCR-40 | same, prefilled, Button «Change time» | — |
| validation | `POST_SCHEDULE_OUT_OF_RANGE` / `POST_TIME_DOES_NOT_EXIST` (AC-10) | FieldError «Pick a time between 2 minutes and 90 days from now» / «09:30 doesn't exist on 28 Mar in Europe/Kyiv» | — |
| zone changed | `TIME_ZONE_CHANGED` | Alert «The workspace time zone changed to Europe/Warsaw — check the time» | — |
| refused | `POST_SCHEDULED_LIMIT_REACHED` / `DESTINATION_UNAVAILABLE` / `POSTS_NEED_WORKING_BOT` / `POST_DRAFT_CHANGED` (AC-16, AC-14, AC-08) | Alert in the dialog | — |
| pending | request pending | spinner, buttons disabled | — |
| done | `scheduled` | closes to SCR-40 | — |

```text
┌ Schedule the post ─────────────────────────────────────────┐
│ Date [2026-11-04]   Time [09:00]   Europe/Kyiv              │
│ To Test Channel [Channel] · «New arrivals this week»        │
│                                     [Cancel] [Schedule]     │
└─────────────────────────────────────────────────────────────┘
```

### SCR-40 — Post page

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `getPost` pending | Card, Skeleton | — |
| scheduled | `state: scheduled` (AC-09) | NEW: PostPage — Card with the text, destination, sound line, Badge «Scheduled», «Wed 4 Nov, 09:00 (Europe/Kyiv) · scheduled by Test User»; Buttons «Back to draft» (all), «Change time» (owner), «Duplicate» | wireframe |
| sending | `state: sending` | Badge «Going out…» with spinner; no actions but Duplicate | — |
| published | `state: published` (AC-07) | Badge «Published», time + owner, Button «Open in Telegram» (`telegram_link`, new tab), «Delete from Telegram» (owner, until `deletable_until`), «Duplicate» | — |
| failed | `state: failed` (AC-13, AC-14, AC-16) | destructive Badge «Failed» + reason line («The bot can no longer post in this chat», «The bot was not working», «This chat is not connected to the current bot», «Telegram refused the text», «The daily posting limit was reached», …) + link to SCR-33 when it is the destination | — |
| missed | `state: missed` (AC-12) | destructive Badge «Missed» + «It could not go out by 09:15 — it was not published later» + reason | — |
| not confirmed | `state: not_confirmed` (AC-08) | Badge «Not confirmed» + «Telegram did not answer. It may have been posted — check the chat. It is not sent again.» | — |
| deleted | `state: deleted` (AC-15) | Badge «Deleted» + «Deleted from Telegram by Test User at 10:02»; text kept | — |
| needs attention | failed / missed / not confirmed shown (flow 9) | calls `markPostSeen` once on show | — |
| operator | (AC-03) | owner actions replaced by the owners-only note | — |
| error | read failed | Alert destructive + Retry; NotFoundCard on 404 | — |
| live | `post.changed` | re-read in place | — |

```text
Post                                                [Scheduled]
To Test Channel [Channel] @test_channel
┌──────────────────────────────────────────────────────────────┐
│ New arrivals this week                                        │
└──────────────────────────────────────────────────────────────┘
Wed 4 Nov, 09:00 (Europe/Kyiv) · scheduled by Test User
                        [Duplicate] [Back to draft] [Change time]
```

### SCR-41 — Delete-from-Telegram dialog

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | published < 48 h (AC-15) | AlertDialog «Delete this post from Test Channel?» «It disappears for everyone in the channel. The post stays here as deleted.» Cancel / Delete (destructive) | — |
| pending | request pending (waits for Telegram) | spinner, buttons disabled | — |
| refused | `POST_DELETE_WINDOW_PASSED` / `POST_DELETE_REFUSED` / `TELEGRAM_UNAVAILABLE` | Alert «The bot can no longer delete this post» / «Telegram did not let the bot delete it» / «Telegram is not responding — try again» | — |
| done | `changed` | closes; SCR-40 shows deleted | — |

### SCR-42 — Delete-draft dialog

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | author or owner (AC-18) | AlertDialog «Delete this draft?» Cancel / Delete | — |
| pending | request pending | spinner | — |
| error | `FORBIDDEN` / `POST_NOT_A_DRAFT` / failed | Alert in the dialog | — |

### SCR-43 — Change-time-zone dialog

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | owner picks a new zone (Clarifications) | AlertDialog «Change the time zone to Europe/Warsaw?» «3 scheduled posts keep their moment and show a new local time.» Cancel / Change | — |
| pending | request pending | spinner | — |
| error | `TIME_ZONE_INVALID` / failed | Alert in the dialog | — |

### SCR-44 — Back-to-draft dialog

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | Back to draft, or editing a scheduled post (AC-11) | AlertDialog «Move back to drafts?» «It won't go out unless a business owner schedules or publishes it again.» Cancel / Move to drafts | — |
| pending | request pending | spinner | — |
| too late | `POST_NOT_SCHEDULED` (it went out meanwhile) | Alert «It already went out» and the page refreshes | — |
| error | failed | Alert in the dialog | — |

## New components

| Component | Why no existing primitive fits | Composes |
|---|---|---|
| DestinationsCard | Settings list with per-row state, problem line and owner-only row actions; no inventory part shows destinations | Card, Table, Badge, Button, DropdownMenu, Skeleton, Alert |
| TimeZoneField | IANA zone chooser with the browser zone prefilled; used in SCR-33 and SCR-39 | Select, Button, Field |
| ConnectCodeDialog | Live code dialog with channel / group steps; ConnectTelegramDialog is a deep link to a private chat, not a code posted in a chat | Dialog, Tabs, Button, Alert, Skeleton |
| PostsTable | Posts list with state badges and workspace-zone times | DataTableToolbar, Tabs, Table, Badge, Button, EmptyFilterState, Skeleton, Alert |
| PostEditor | Autosaving editor with destination picker, sound option and preview; the broadcast editor is tied to audiences | Field, Select, Textarea, Checkbox, Card, Button, DropdownMenu, Alert |
| PublishDialog | Confirmation that shows the chat, the exact text and the daily headroom | AlertDialog, Badge, Alert, Button, Skeleton |
| ScheduleDialog | Date + time in the workspace zone with a first-time zone step | Dialog, Field, Input, TimeZoneField, Alert, Button |
| PostPage | Read-only post with state-specific lines and actions | Card, Badge, Button, Alert, Skeleton, NotFoundCard |
| PostCrumb | Breadcrumb label «Post» / the text start, like ContactCrumb | Breadcrumb |
