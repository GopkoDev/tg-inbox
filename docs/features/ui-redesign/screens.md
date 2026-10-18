---
status: draft
feature_size: "S"
tool: "code"
updated_at: "2026-10-18"
---

# Screens — ui-redesign

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code (from `docs/design-system.md`) — inline wireframes below, one per state that needs a distinct layout.
- **File:** inline wireframes below.
- **Visual reference:** the canon's *Visual direction* (shadcn login block, inset sidebar block, list page, two-pane chat, contact profile, settings). The local reference markup in `docs/design-refs/` is a picture, rebuilt onto `apps/web/src/shared/ui`; the auth and logged-in layout blocks may be followed nearly 1:1 minus social sign-in, sign-up, Support/Feedback and project lists.
- **Component names:** names from the canon inventory (`AppShell`, `Button`, `Card`, `Alert`, `Badge`, `Dialog`, `AlertDialog`, `DropdownMenu`, `Table`, `Skeleton`, `Input`, `Label`, `RadioGroup`, `NotFoundCard`); `shadcn:<name>` = a primitive from the canon's *Not yet in the repo* list, added with the shadcn CLI when first used; `NEW: <name>` = a reusable part listed under §New components.
- **Inherited states (redesigned screens).** Every state already specified for a redesigned screen in `docs/features/workspace-operators/screens.md` and `docs/features/bot-connection/screens.md` — its trigger, copy, server message and outcome — **holds verbatim**; the tables below repeat the states whose layout or location changes and add the new ones, and point at the source section for the rest (`inherited: <file> §SCR-NN`). This is the behaviour-preserved rule (spec §2 goal 3, AC-19, QG-1).
- **Addresses** (ADR-0001): entry — `/sign-in`, `/invite/<token>`, `/reset-password/<token>`, `/workspaces`, `/no-access`; workspace — `/w/<id>` → `/w/<id>/inbox`, `/w/<id>/inbox/<conversationId>`, `/w/<id>/contacts`, `/w/<id>/contacts/<contactId>`, `/w/<id>/settings` → `/w/<id>/settings/bot`, `/w/<id>/settings/team`; old `/w/<id>/team` → `/w/<id>/settings/team`, old `/w/<id>/bot` → `/w/<id>/settings/bot`.
- **Copy:** existing texts stay word for word; new texts are quoted below.

## Screens

**Shared guard states** — unchanged; see `docs/features/workspace-operators/screens.md` §Shared guard states (`401` → SCR-01 session-ended, `403 ACCESS_REMOVED` → landing rule + notice, `404` → not-found card in the frame, network/`500` → the screen's error row). Rows below say `guard states` and point here.

### SCR-01 — Sign-in

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `/sign-in` signed out — centred column: product mark (lucide `MessagesSquare` in a `size-8` rounded square), heading «Sign in» (existing text, spec: copy unchanged), one-line description «Answer your customers' Telegram messages together», email + password fields, **Sign in** | NEW: AuthLayout, shadcn:field, Input, Label, Button | wireframe «auth default» |
| validation | submit with an empty / invalid email or empty password — message under the field, `aria-invalid` (AC-05) | shadcn:field, Input | wireframe «auth default» (field error line) |
| error: wrong credentials | existing in-place message «Email or password is incorrect» above the button (AC-05) | Alert (destructive) | — |
| submitting, session-ended, success, error: unexpected | inherited: workspace-operators §SCR-01 — success follows the AC-07 destination rule (AC-04) | Button (disabled + `Loader2`), Alert | — |

```text
auth default (desktop and phone — one centred column, max-w-sm, min-h-svh, p-6 md:p-10)
            +------------------------------+
            |            [◼]               |
            |          Sign in             |
            |  Answer your customers'      |
            |  Telegram messages together  |
            |                              |
            |  Email                       |
            |  [ m@example.com          ]  |
            |  Password                    |
            |  [ ••••••••               ]  |
            |  ⚠ Enter your password       |  ← field error (validation)
            |  [        Sign in         ]  |
            +------------------------------+
```

### SCR-02 — Accept invitation

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | invitation link valid — same centred column as SCR-01; heading and fields as today (new account: name + password; existing account: **Join workspace**) | NEW: AuthLayout, shadcn:field, Input, Label, Button | wireframe «auth default» |
| validation, error, submitting, success | inherited: workspace-operators §SCR-02 (AC-06) | shadcn:field, Alert, Button | — |
| link dead | → SCR-04 | — | — |

### SCR-03 — Set new password

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | reset link valid — centred column, new-password field, **Set password** | NEW: AuthLayout, shadcn:field, Input, Label, Button | wireframe «auth default» |
| validation, error, submitting, success | inherited: workspace-operators §SCR-09 (AC-06) | shadcn:field, Alert, Button | — |
| link dead | → SCR-04 | — | — |

### SCR-04 — Link unavailable

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | dead invitation / reset link — centred column, existing heading + explanation + **Go to sign-in** (AC-06) | NEW: AuthLayout, Button | wireframe «auth default» (text only) |
| error / empty | N/A: a static explanation screen with no data load | — | — |

### SCR-05 — Workspace picker

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | several active memberships — centred column (`max-w-md`), heading «Your workspaces» (existing text), one full-width row per workspace (name + role badge) | NEW: AuthLayout, Button (`outline`), Badge | wireframe «picker» |
| access-removed | arrived through the guard — dismissible notice «Your access to Acme Flowers was removed» above the list (AC-18) | Alert | wireframe «picker» |
| loading, error: unexpected, guard states | inherited: workspace-operators §SCR-04 | Skeleton, Alert, Button | — |

```text
picker
            +------------------------------+
            |            [◼]               |
            |      Your workspaces         |
            | [i] Your access to Bloom     |
            |     Bakery was removed   [x] |
            | [ Acme Flowers   Business owner ] |
            | [ Bolt Bikes          Operator  ] |
            |        Sign out              |
            +------------------------------+
```

### SCR-06 — No access

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | signed in, no active membership — centred column, existing text + **Sign out** | NEW: AuthLayout, Button | wireframe «auth default» (text only) |
| access-removed | arrived through the guard — notice above the text (AC-18) | Alert | — |
| error | N/A: static screen, no data load | — | — |

### SCR-07 — Workspace frame

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default (desktop ≥ md) | workspace entered — inset sidebar: header = workspace switcher (workspace name + role, dropdown of other workspaces); nav group: **Inbox**, **Contacts**, and for an owner **Settings**; footer = account menu (avatar initials, email; menu: email label, **Sign out**); inset body: `h-16` header row = sidebar trigger, vertical separator, breadcrumb (`Acme Flowers › Inbox`, `… › Contacts › Olena Kravets`, `… › Settings › Team`); current item highlighted (AC-01) | AppShell, shadcn:sidebar, shadcn:separator, shadcn:breadcrumb, shadcn:avatar, shadcn:tooltip, DropdownMenu | wireframe «frame desktop» |
| collapsed (desktop) | sidebar trigger pressed — sidebar collapses to icons with tooltips | shadcn:sidebar, shadcn:tooltip | — |
| drawer (phone < md) | sidebar hidden; the trigger opens it as a sheet over the page; picking an item closes it (AC-02) | shadcn:sidebar, shadcn:sheet | wireframe «frame phone» |
| role: operator | current membership role is operator — **Settings** absent from the nav (AC-03, AC-10) | shadcn:sidebar | — |
| entering (loading) | workspace entry in flight — body skeleton, no workspace data; the sidebar shows the switcher skeleton (AC-20, QG-5) | Skeleton | — |
| not found | workspace missing / not theirs, or an unknown sample conversation/contact — `NotFoundCard` in the body (AC-20, AC-12, AC-15) | NotFoundCard | — |
| error | entry failed — «Something went wrong» + **Retry** in the body (AC-20) | Alert (destructive), Button | — |
| access-removed | inherited: workspace-operators §SCR-06 — notice under the header row when landing in another workspace (AC-18) | Alert | — |
| switching | switcher picks another workspace — outlet content remounts keyed on the workspace id; lands on its inbox (AC-03) | AppShell | — |
| guard states | → shared guard table | — | §Shared guard states |

```text
frame desktop
+--------------------+-------------------------------------------------------+
| [◼] Acme Flowers ▾ | [≡] |  Acme Flowers › Inbox                           |
|     Business owner |-------------------------------------------------------|
|                    |                                                       |
|  Workspace         |              (outlet: the current screen)             |
|  ▸ Inbox      ●    |                                                       |
|  ▸ Contacts        |                                                       |
|  ▸ Settings        |                                                       |
|                    |                                                       |
|                    |                                                       |
| (AN) ana@acme.test▾|                                                       |
+--------------------+-------------------------------------------------------+

frame phone                         drawer open
+--------------------------------+  +----------------------+---------+
| [≡] | Inbox                    |  | [◼] Acme Flowers ▾   |░░░░░░░░░|
|--------------------------------|  |  ▸ Inbox             |░░░░░░░░░|
|  (outlet)                      |  |  ▸ Contacts          |░░░░░░░░░|
|                                |  |  ▸ Settings          |░░░░░░░░░|
|                                |  | (AN) ana@acme.test ▾ |░░░░░░░░░|
+--------------------------------+  +----------------------+---------+
```

### SCR-08 — Inbox preview

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default (desktop) | `/w/<id>/inbox` — page title row «Inbox» + `NEW: SampleDataBadge` («Sample data»); one full-height `Card` with two panes: left = conversation list (search `Input` placeholder «Search conversations» filtering by name, rows: avatar, name, relative time, last-message preview, unread `Badge`), right = «Pick a conversation to see it here» (AC-12) | Card, NEW: SampleDataBadge, NEW: ConversationList, Input, shadcn:avatar, Badge, shadcn:scroll-area | wireframe «inbox desktop» |
| thread open | a conversation picked (address `/w/<id>/inbox/<conversationId>`) — right pane: header (avatar, name, `@username`), messages grouped by sender with times (customer left, operator right), reply area; its unread count cleared for this visit (AC-12) | NEW: MessageBubble, NEW: ReplyComposer, shadcn:avatar, shadcn:scroll-area | wireframe «inbox desktop» |
| validation | reply empty, spaces only, or > 4096 characters — send disabled; over the limit the composer shows «Replies are limited to 4096 characters» (AC-13) | NEW: ReplyComposer (shadcn:textarea, Button) | — |
| success: reply sent | Enter (Shift+Enter = new line) or **Send** — the reply appended as an operator bubble, the list entry shows it as the last message «now» and moves to the top; the always-visible note «Preview — nothing is sent to customers» stays under the box (AC-14) | NEW: MessageBubble, NEW: ConversationList | — |
| reset | another conversation picked, inbox left, workspace switched or reload — sent replies gone (AC-14) | — | — |
| empty: search | search matches nothing — «No conversations match» + **Clear search** in the list pane | Button (`ghost`) | — |
| phone: list | < md — the list fills the body | NEW: ConversationList | wireframe «inbox phone» |
| phone: thread | < md, conversation picked — the thread replaces the list; header has a back button «Back to conversations» (AC-12b) | NEW: MessageBubble, NEW: ReplyComposer, Button (`ghost`, icon) | wireframe «inbox phone» |
| not found | unknown `<conversationId>` → SCR-07 not found (AC-12) | NotFoundCard | — |
| loading | N/A: sample data is in the bundle — renders at once, no simulated loading (spec §6 Loading feedback) | — | — |
| error | N/A: the sample source cannot fail; there is no request | — | — |

```text
inbox desktop (thread open)
+----------------------------------------------------------------------------+
| Inbox  [Sample data]                                                       |
| +-------------------------+----------------------------------------------+ |
| | [ Search conversations ]| (OK) Olena Kravets  @olena_k                 | |
| |-------------------------|----------------------------------------------| |
| | (OK) Olena Kravets  2m  |  ┌────────────────────────┐                  | |
| |  Is the peony bouquet…  |  │ Hi! Is the peony bouquet│ 10:02           | |
| | (MB) Maks Bondar    1h ②|  │ still available?        │                  | |
| |  Can you deliver on Sat…|  └────────────────────────┘                  | |
| | (IS) Iryna S.      Yest.|              ┌──────────────────────────────┐ | |
| |  Thanks, got it!        |        10:05 │ Yes! Delivery today by 18:00 │ | |
| | …                       |              └──────────────────────────────┘ | |
| |                         |----------------------------------------------| |
| |                         | [ Write a reply…                    ] [Send] | |
| |                         | Preview — nothing is sent to customers       | |
| +-------------------------+----------------------------------------------+ |
+----------------------------------------------------------------------------+

inbox phone: list                    inbox phone: thread
+--------------------------------+  +--------------------------------+
| Inbox [Sample data]            |  | [←] (OK) Olena Kravets         |
| [ Search conversations       ] |  |--------------------------------|
| (OK) Olena Kravets          2m |  | ┌─────────────────┐            |
|  Is the peony bouquet…         |  | │ Hi! Is the peony│ 10:02      |
| (MB) Maks Bondar         1h ②  |  | └─────────────────┘            |
|  Can you deliver on Sat…       |  |        ┌──────────────────┐    |
+--------------------------------+  |  10:05 │ Yes! Delivery …  │    |
                                    |        └──────────────────┘    |
                                    | [ Write a reply…      ] [Send] |
                                    | Preview — nothing is sent…     |
                                    +--------------------------------+
```

Sample data (ADR-0002): ~12 conversations with invented names and `@usernames`, mixed unread counts (0–3), relative times from «now» to «13 days», 3–12 text messages each grouped by sender; no media, no real person.

### SCR-09 — Contacts preview

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `/w/<id>/contacts` — title row «Contacts» + SampleDataBadge; card-wrapped table with a toolbar (search `Input` «Search by name or username», tag filter popover with checkboxes; column toggle — deferred (no AC requires it)); columns: contact (avatar + name + `@username`), tags (`Badge`s), language, first message date, last message (relative); rows open the profile (AC-15) | Card, Table, NEW: SampleDataBadge, NEW: DataTableToolbar (Input, shadcn:popover, shadcn:checkbox, DropdownMenu), shadcn:avatar, Badge | wireframe «contacts» |
| filtered | search and/or tags set — rows narrow; active tag filter shows a count on its button (AC-15) | NEW: DataTableToolbar | — |
| empty: no match | search + filter match nothing — table body replaced by «No contacts match» + **Clear filters** (AC-16) | NEW: EmptyFilterState (Button) | wireframe «contacts» (empty) |
| phone | < md — language and first-message columns hidden; the table scrolls sideways inside its card if still wider (AC-02) | Table | — |
| loading / error | N/A: sample data in the bundle, no request | — | — |

```text
contacts
+----------------------------------------------------------------------------+
| Contacts  [Sample data]                                                    |
| +------------------------------------------------------------------------+ |
| | [ Search by name or username ]  [Tags ▾ 1]                [Columns ▾] | |
| |------------------------------------------------------------------------| |
| | Contact                    Tags              Language  First   Last    | |
| | (OK) Olena Kravets         [wholesale][vip]  uk        12 Sep  2m      | |
| |      @olena_k                                                          | |
| | (MB) Maks Bondar           [new]             en        3 Oct   1h      | |
| |------------------------------------------------------------------------| |
| | empty:      No contacts match.   [Clear filters]                       | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

### SCR-10 — Contact profile preview

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `/w/<id>/contacts/<contactId>` — header card (large avatar, name, `@username`, tags, language, first / last message dates, SampleDataBadge); `Tabs`: **Overview** (cards: Profile facts, Tags, Notes placeholder text «Notes arrive with contacts») and **Conversation history** (table: date, direction, message preview) (AC-15) | Card, NEW: SampleDataBadge, shadcn:avatar, Badge, shadcn:tabs, Table | wireframe «profile» |
| empty: history | N/A: every sample contact has ≥ 1 message by construction (a contact is created by its first message) | — | — |
| not found | unknown `<contactId>` → SCR-07 not found (AC-15) | NotFoundCard | — |
| phone | header card stacks avatar above facts; tabs full width | Card, shadcn:tabs | — |
| loading / error | N/A: sample data in the bundle, no request | — | — |

```text
profile
+----------------------------------------------------------------------------+
| +------------------------------------------------------------------------+ |
| | (OK)  Olena Kravets  @olena_k            [Sample data]                 | |
| |       [wholesale] [vip]   Language: uk   First: 12 Sep   Last: 2m ago  | |
| +------------------------------------------------------------------------+ |
| [ Overview ] [ Conversation history ]                                      |
| +---------------------------+  +----------------------------------------+ |
| | Profile                   |  | Tags                                   | |
| | Telegram  @olena_k        |  | [wholesale] [vip]                      | |
| | Language  uk              |  +----------------------------------------+ |
| +---------------------------+                                             |
+----------------------------------------------------------------------------+
```

### SCR-11 — Settings — Bot

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default layout | `/w/<id>/settings` or `/settings/bot` or the old bot address — title «Settings», description «Manage your workspace's bot and team»; left section menu (**Bot**, **Team**; stacks above the content below `lg`); the Bot section in a `Card` (AC-07, AC-11) | NEW: SettingsLayout, Card, Button (`ghost` menu items) | wireframe «settings» |
| loading, not connected, connected, empty: no messages yet, needs token, taken over, reconnecting, success, reconnect → takeover warning / needs token, stale, error: Telegram unavailable, error: unexpected, guard states | inherited verbatim: bot-connection §SCR-02 — now rendered inside the Settings section card | Card, Badge, Alert, Button, Skeleton | — |
| owners only | operator opened Settings / the Bot section / the old bot address — the section shows only «Only business owners manage the bot» + **Back to inbox**; no bot data (AC-10) | Card, Button | wireframe «owners only» |

```text
settings (desktop ≥ lg)                                       below lg: menu stacks on top
+----------------------------------------------------------------------------+
| Settings                                                                   |
| Manage your workspace's bot and team                                       |
| ---------------------------------------------------------------------------|
|  > Bot        | +------------------------------------------------------+   |
|    Team       | | Acme Flowers Bot  @acme_flowers_bot    [Connected]   |   |
|               | | Last message received: 18 Oct, 10:05                 |   |
|               | | Contacts captured: 42                                |   |
|               | | Checked with Telegram: 10:06                         |   |
|               | | [New token]  [Disconnect]                            |   |
|               | +------------------------------------------------------+   |
+----------------------------------------------------------------------------+

owners only (in the section card)
+------------------------------------------+
|  Only business owners manage the bot     |
|  [       Back to inbox        ]          |
+------------------------------------------+
```

### SCR-12 — Settings — Team

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | `/settings/team` or the old team address — SettingsLayout with **Team** selected; section header «Team» + **Invite**; toolbar (search «Search by name or email», role filter: all / business owner / operator, state filter: all / active / deactivated); **Members** card table: avatar + name (+ «(you)»), email, role badge, state badge, row-actions `DropdownMenu` (Deactivate / Reactivate); **Pending invitations** card table: email, role badge, expiry, row-actions (Revoke); never a link (AC-08) | NEW: SettingsLayout, NEW: DataTableToolbar (Input, shadcn:select), Card, Table, shadcn:avatar, Badge, DropdownMenu, Button | wireframe «team» |
| filtered | search / role apply to both tables, state to members only, over the rows loaded so far; **Show more** stays under a table while more rows exist and newly loaded rows are filtered the same way (AC-08) | NEW: DataTableToolbar, Button (`outline`) | — |
| empty: no match | a table with no matching loaded row — «Nothing matches among the loaded rows» + **Clear filters**, **Show more** still under it when more exist (AC-09) | NEW: EmptyFilterState | wireframe «team» (empty) |
| loading, empty: no pending invitations, confirm deactivate, confirm revoke, pending action, success, error: last active owner, error: stale row, self-deactivated, has-more, error: unexpected, guard states | inherited verbatim: workspace-operators §SCR-07 — row actions now in the row-actions menu, confirmations unchanged | Skeleton, AlertDialog, Alert, Badge, Button | — |
| owners only | operator opened the Team section / the old team address — only «Only business owners manage the team» + **Back to inbox**; no list (AC-10) | Card, Button | wireframe «owners only» (team text) |
| phone | email and expiry move under the name; tables scroll inside their card if still wider (AC-02) | Table | — |

```text
team
+----------------------------------------------------------------------------+
| Settings / Manage your workspace's bot and team                            |
|    Bot        |  Team                                          [+ Invite]  |
|  > Team       |  [ Search by name or email ] [Role: All ▾] [State: All ▾]  |
|               |  +------------------------------------------------------+  |
|               |  | Members                                              |  |
|               |  | (AN) Ana (you)   ana@acme.test  [Owner]  [Active]  ⋯ |  |
|               |  | (BP) Bob Petrenko bob@acme.test [Operator][Active] ⋯ |  |
|               |  |                     [Show more]                      |  |
|               |  +------------------------------------------------------+  |
|               |  +------------------------------------------------------+  |
|               |  | Pending invitations                                  |  |
|               |  | max@acme.test   [Operator]   expires 18 Oct        ⋯ |  |
|               |  +------------------------------------------------------+  |
|               |  empty:  Nothing matches among the loaded rows. [Clear filters] |
+----------------------------------------------------------------------------+
```

### SCR-13 — Paste token

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| all states | inherited verbatim: bot-connection §SCR-03 — opened from SCR-11 (AC-19) | Dialog, Input, Label, Alert, Button | — |

### SCR-14 — Confirm takeover

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| all states | inherited verbatim: bot-connection §SCR-04 — opened from SCR-11 (AC-19) | AlertDialog, Button | — |

### SCR-15 — Confirm disconnect

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| all states | inherited verbatim: bot-connection §SCR-05 — opened from SCR-11 (AC-19) | AlertDialog, Button | — |

### SCR-16 — Invite member

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| all states | inherited verbatim: workspace-operators §SCR-08 — opened from SCR-12 (AC-19) | Dialog, Input, Label, RadioGroup, Alert, Button | — |

### SCR-17 — Confirm member action

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| confirm deactivate / confirm revoke / pending / errors | inherited verbatim: workspace-operators §SCR-07 «confirm deactivate», «confirm revoke», «pending action», «error: last active owner», «error: stale row»; reactivate stays without a confirmation as today (AC-19) | AlertDialog, Alert, Button | — |

## New components

| Component | Why no existing primitive fits | Registered in design-system |
|---|---|---|
| AppShell (rebuilt) | The existing frame becomes the inset-sidebar layout route (ADR-0001); same name, new composition (shadcn:sidebar, breadcrumb, avatar) — its inventory row is updated, not duplicated | pending |
| AuthLayout | Six entry screens share the centred column with the product mark; no primitive is a page layout | pending |
| SettingsLayout | Settings title + section menu + outlet, stacking below `lg`; no primitive is a page layout | pending |
| SampleDataBadge | One consistent "Sample data" label on every preview screen (spec AC-12/17); a `Badge` variant with fixed copy so steps 4/7 remove it in one place | pending |
| ConversationList | Avatar + name + relative time + preview + unread badge rows with selection; no shadcn primitive for a chat list | pending |
| MessageBubble | Chat bubble aligned by sender with time; the canon names it a `NEW:` candidate (no shadcn primitive) | pending |
| ReplyComposer | Textarea + send button + Enter/Shift+Enter + 4096 limit + preview note; composed once, reused by step 4 | pending |
| DataTableToolbar | Search + filter controls above a card table, shared by Contacts and Team; no single primitive | pending |
| EmptyFilterState | «Nothing matches» sentence + clear-filters button inside a table card, shared by Contacts and Team | pending |

**shadcn primitives to install** (from the canon's *Not yet in the repo* list): `sidebar` (+ `separator`, `sheet`, `tooltip`), `breadcrumb`, `avatar`, `scroll-area`, `textarea`, `tabs`, `field`, `checkbox`, `select`, `popover` — each added with `pnpm dlx shadcn@latest add <name>` in `apps/web`, import fixed to `@/shared/lib/utils`, then moved into the canon inventory with its `file:line`.
