---
status: Living
tool: code               # figma | pencil | code — the single committed source of the design-tool choice (never sdd.local.md: that file is per-developer + gitignored)
figma_file: ""           # tool: figma → the Figma file URL/key the canon lives in; else ""
pen_file: ""             # tool: pencil → the .pen library path (e.g. docs/design/library.pen); else ""
updated_at: "2026-10-19"
---

# Design system — tg-inbox

> The project's **design canon**, produced once per repo by `design-system` and read by
> `ux-flows` / `screens` / `implement` / `review`. Committed — the tool choice and the inventory
> are team-wide, not per-developer. `architecture-map.md` §Frontend / UI foundation stays the
> inventory of the **code**; this file is the **design-side** canon (tool, posture, tokens,
> component inventory, cross-screen conventions). Refresh via `/sdd:design-system` when the
> foundation changes.

## Platform posture

- **Posture:** desktop-first — operators work a shared inbox from a laptop/desktop; every screen is designed at desktop width first and must stay usable at phone width (navigation collapses into a menu/drawer, tables and the chat list stack).
- **Breakpoints / device classes:** Tailwind defaults — `md` (768px) is the collapse point for the shell navigation; `lg` / `xl` widen page bodies. Phone width (≥360px, 16px gutter) must never scroll horizontally.

## Design tool

- **Tool:** code — no Figma/Pencil MCP in use; `screens.md` carries inline markdown wireframes and the in-repo shadcn/ui components are the source of truth for how things look.
- **Library location:** the in-repo components are the library — `apps/web/src/shared/ui/` (shadcn/ui `new-york` style, `neutral` base colour, `lucide` icons; `apps/web/components.json`).

## Visual direction

Target layout patterns for the operator panel. They follow public shadcn/ui blocks, composed onto
the primitives below.

- **Auth screens** (sign-in, invite, reset): one centred column `max-w-sm`, `min-h-svh`, logo mark + `text-xl font-bold` heading + short description above the form; form fields stacked with `gap-6`. Source pattern: shadcn login blocks — https://ui.shadcn.com/blocks/login
- **Workspace shell:** collapsible left sidebar in the `inset` variant (workspace switcher in the header, primary nav, secondary nav, account menu in the footer) + an inset body with a `h-16` header row (sidebar trigger, vertical separator, breadcrumb). Source pattern: shadcn sidebar blocks — https://ui.shadcn.com/blocks/sidebar
- **Page body:** page title row (`text-2xl font-bold tracking-tight`, primary action right-aligned), then `space-y-4 lg:space-y-6` content composed of `Card`s.
- **List pages** (team, contacts): card-wrapped `Table` with a toolbar row (search `Input`, filter popover) above it; rows carry `Avatar` + name, `Badge` for status, a row-actions `DropdownMenu`.
- **Inbox / chat:** two panes inside one full-height card — conversation list (`ScrollArea`; avatar, name, relative time, last-message preview, unread count `Badge`) and the thread (header with contact + actions, message bubbles grouped by sender, composer = `Textarea` in an input group with send `Button`). At phone width the panes become list → thread navigation.
- **Contact profile:** header card (avatar, name, key facts) + `Tabs` for sections; details as `Card`s, history as a `Table`.
- **Settings:** title + description, then a left section nav (stacks above the form below `lg`) and a form in a `Card`.

## Token source

- **Colors:** shadcn CSS variables (oklch, light `:root` + `.dark`) mapped into Tailwind via `@theme inline` — `apps/web/src/index.css:6` (light), `:28` (dark), `:49` (theme map). Screens use the semantic utilities (`bg-background`, `text-muted-foreground`, `bg-primary`, `text-destructive`, …), never raw colour values.
- **Spacing / sizing:** Tailwind's default spacing scale; radius from `--radius` (`apps/web/src/index.css:7`) via `rounded-sm|md|lg|xl` (`:50`–`:53`).
- **Typography:** Tailwind defaults (system font stack, `text-*` scale); no custom font is loaded.

## Component inventory

The reusable primitives screens compose. `screens.md` may only use these names, or declare
`NEW: <name>` with a why-no-primitive-fits justification (then registered back here).

| Component | Source (`file:line` / node / URL) | States it supports | Notes |
|---|---|---|---|
| AppShell | `apps/web/src/shared/ui/app-shell.tsx:168` | body skeleton (entering) / entered / not found (in-shell `NotFoundCard`) / error + Retry / access-removed notice | Layout-route frame shared by every `/w/:id/*` screen: inset Sidebar with the workspace switcher in the header, Inbox / Contacts / owner-only Settings nav, account menu with sign-out in the footer, Breadcrumb in the header row, drawer at phone width. Enters the URL's workspace (`useWorkspaceFromUrl`) and renders the page body only once entered; wires the shared guard handler (`useShellGuard`). Composes Sidebar, Breadcrumb, DropdownMenu, Button, Alert, Skeleton. |
| NotFoundCard | `apps/web/src/pages/NotFoundPage.tsx:9` | default | «Not found» card used both as a page and inside AppShell (`headingLevel`). |
| Button | `apps/web/src/shared/ui/button.tsx:38` | variants default / destructive / outline / secondary / ghost / link; sizes default / xs / sm / lg / icon; disabled | Async actions disable the button while pending. |
| Input | `apps/web/src/shared/ui/input.tsx:4` | default / focus / disabled / invalid (`aria-invalid`) | |
| Label | `apps/web/src/shared/ui/label.tsx:5` | default / disabled | |
| RadioGroup | `apps/web/src/shared/ui/radio-group.tsx:6` | default / checked / disabled | |
| Card | `apps/web/src/shared/ui/card.tsx:4` | default | Header / title / description / content / footer slots. |
| Alert | `apps/web/src/shared/ui/alert.tsx:21` | default / destructive | Form-level and page-level messages. |
| Badge | `apps/web/src/shared/ui/badge.tsx:27` | default / secondary / destructive / outline / ghost / link | Statuses (role, bot state, unread count). |
| Dialog | `apps/web/src/shared/ui/dialog.tsx:10` | open / closed | Forms layered over a page (e.g. paste token). |
| AlertDialog | `apps/web/src/shared/ui/alert-dialog.tsx:7` | open / closed | Confirmation of destructive or irreversible actions. |
| DropdownMenu | `apps/web/src/shared/ui/dropdown-menu.tsx:8` | open / closed / item disabled | Switchers, account menu, row actions. |
| Table | `apps/web/src/shared/ui/table.tsx:4` | default | Lists of members / invitations; wrap in a Card. |
| Skeleton | `apps/web/src/shared/ui/skeleton.tsx:3` | loading | The one loading pattern. |
| Sidebar | `apps/web/src/shared/ui/sidebar.tsx:138` | expanded / collapsed (`SidebarProvider` state, cookie-persisted) / mobile drawer / menu button active | Family: `SidebarProvider` (`:43`), `SidebarInset` (`:287`), header / content / footer / group / menu parts. Used by AppShell in the `inset` variant; pulls in Separator, Sheet, Tooltip. |
| Separator | `apps/web/src/shared/ui/separator.tsx:5` | horizontal / vertical | Header row divider, Field and Sidebar separators. |
| Sheet | `apps/web/src/shared/ui/sheet.tsx:8` | open / closed; sides top / right / bottom / left | Side drawer; the Sidebar uses it at phone width. |
| Tooltip | `apps/web/src/shared/ui/tooltip.tsx:18` | open / closed | Used by Sidebar menu buttons (collapsed state); `TooltipProvider` at `:5`. |
| Breadcrumb | `apps/web/src/shared/ui/breadcrumb.tsx:6` | link / current page / separator / ellipsis | Location trail in the AppShell header row. |
| Avatar | `apps/web/src/shared/ui/avatar.tsx:7` | image / fallback initials; sizes; badge / group | Contact and member identity in lists, conversation rows and the account menu. |
| ScrollArea | `apps/web/src/shared/ui/scroll-area.tsx:5` | default | Conversation list and message thread scrolling. |
| Textarea | `apps/web/src/shared/ui/textarea.tsx:4` | default / focus / disabled / invalid | Reply composer input. |
| Tabs | `apps/web/src/shared/ui/tabs.tsx:8` | active / inactive trigger; content | Contact profile sections; the inbox status lens (Open / Closed, disabled while searching). |
| Field | `apps/web/src/shared/ui/field.tsx:78` | default / invalid (`FieldError`) / disabled | Family: `FieldGroup` (`:44`), `FieldLabel`, `FieldDescription`, `FieldError`; form-field layout in the auth forms. |
| Checkbox | `apps/web/src/shared/ui/checkbox.tsx:6` | unchecked / checked / disabled | Tag filter in the contacts toolbar. |
| Select | `apps/web/src/shared/ui/select.tsx:8` | open / closed / item disabled / placeholder | Filter and role selects (team); the inbox assignee lens (All / Mine / Unassigned). |
| Popover | `apps/web/src/shared/ui/popover.tsx:5` | open / closed | Contacts tag filter. |
| SampleDataBadge | `apps/web/src/shared/ui/sample-data-badge.tsx:3` | default | NEW: «Sample data» label on screens backed by the swappable sample source (contacts, contact profile). The inbox no longer uses it: it runs on real data. No primitive fits: a fixed-copy Badge. |
| DataTableToolbar | `apps/web/src/shared/ui/data-table-toolbar.tsx:3` | with / without search; with / without filters | NEW: toolbar row (search slot + filters slot) above a card-wrapped Table; used by Team and Contacts. |
| EmptyFilterState | `apps/web/src/shared/ui/empty-filter-state.tsx:3` | default (message + Clear filters) / custom `actionLabel` (inbox: Clear search) | NEW: «nothing matches» state for filtered lists; `onClear` resets the filters. Used by Contacts and the inbox search (Clear search). |
| AuthLayout | `apps/web/src/shared/ui/auth-layout.tsx:14` | default (title + description + children) | NEW: centred `max-w-sm` auth column; used by sign-in, invite, reset, link-unavailable, no-access and workspace-picker screens. |
| SettingsLayout | `apps/web/src/features/settings/SettingsLayout.tsx:11` | section nav (stacks above the form below `lg`) + routed section outlet | NEW: Settings frame — title, description, left section nav (Bot, Team), section in a Card. |
| ConversationList | `apps/web/src/features/inbox/ConversationList.tsx:58` | items / selected item / unread badge / waiting marker / assignee line / closed mark / team-reply icon / skeleton rows (`ConversationSkeletons`) | NEW: inbox left pane rows on real data — Avatar, name, relative time, last item by kind + caption, unread Badge, muted assignee line (`UserRound` + name or «Unassigned»), outline «Closed» Badge in search results (`markClosed`); `InboxList` (same folder) composes it with search, the status Tabs + assignee Select lenses (written to the page address; Tabs disabled while searching), Alert notice, per-lens empty / error states in a ScrollArea. |
| InboxList | `apps/web/src/features/inbox/InboxList.tsx:55` | lens controls (status Tabs + assignee Select, in the page address) / searching / loading / per-lens empty / error + Retry / live join and leave of rows | Extended: composes ConversationList with the lens controls (`data-testid=lens-controls`); lens parsing in `features/inbox/lens.ts`. |
| MessageBubble | `apps/web/src/features/inbox/MessageBubble.tsx:8` | inbound / outbound; with author name; «edited» mark; content slot (plain text by default); footer slot (`ReplyDeliveryState`) | NEW: chat message bubble; no shadcn primitive exists. |
| ConversationActions | `apps/web/src/features/inbox/ConversationActions.tsx:46` | open / closed; assignee or Unassigned; loading skeleton; pending (spinner on the used control, all locked); change-limit countdown Alert; change-failed destructive Alert; phone second row (`compact`) | NEW: thread actions bar — status Badge, assignee button (the trigger of the built-in AssigneeChooser, SCR-10; the pending lock covers assign / unassign too), Close / Reopen; stale and needs-confirmation answers go to `onResult` (SCR-11 / SCR-12). Composes Badge, Button, Alert, Skeleton; no primitive fits the combination. |
| AssigneeChooser | `apps/web/src/features/inbox/AssigneeChooser.tsx:37` | loading (3 skeleton rows); default (Me first, members, check + `aria-current` on the current, Unassign when assigned); only me; per-row pending spinner; refused not-active destructive Alert with members re-read; members load error + Retry; phone (trigger width, min 240px, scrolls) | NEW: SCR-10 assignee popover; stays open for the in-place refusal, which a DropdownMenu cannot do. Composes Popover, Button ghost, Avatar, Separator, Skeleton, Alert. |
| ActivityLine | `apps/web/src/features/inbox/ActivityLine.tsx:25` | every kind (assigned / reassigned / unassigned / closed / reopened) and cause (member / customer wrote / reply not delivered / member deactivated) | NEW: centred muted history line in the thread with its time; names rendered as plain text. No primitive fits: fixed-copy text. |
| Thread | `apps/web/src/features/inbox/Thread.tsx:84` | loading / ready / loading older / older error / start of history / error + Retry / not found (`NotFoundCard`); phone **Back to conversations** | NEW: SCR-02 reading pane — header (Avatar, name, @username), paged history in a scrolling region, read marking while visible. Composes Avatar, Skeleton, Alert, Button, MessageBubble, NotFoundCard. |
| ConversationCrumb | `apps/web/src/features/inbox/ConversationCrumb.tsx:5` | name known / «Conversation» | NEW: breadcrumb label of an open conversation (the shell's `handle.Crumb` slot follows live state). |
| ReplyComposer | `apps/web/src/features/inbox/ReplyComposer.tsx:21` | empty (Send disabled) / ready (Enter sends, Shift+Enter new line) / over 4096 UTF-16 units or server 400 (`aria-invalid` + message) / sending (read-only, spinner, double Enter ignored) / rate-limited (countdown to `retry_at`) / send failed / unavailable, owner (Open bot settings) / unavailable, operator / available again; per-conversation draft + client key in the inbox store | NEW: SCR-02 reply box at the bottom of Thread; not optimistic. Composes Textarea, Button, Alert, TeammateRepliedDialog. |
| TeammateRepliedDialog | `apps/web/src/features/inbox/TeammateRepliedDialog.tsx:22` | default / pending (spinner, buttons disabled) / error (destructive Alert in the dialog) | NEW: SCR-04, an AlertDialog «A teammate just replied» with Keep editing / Send anyway. Composes AlertDialog, Alert, Button. |
| StateChangedDialog | `apps/web/src/features/inbox/StateChangedDialog.tsx:37` | default for assign / unassign / reopen (state now + the latest change as an activity sentence with its age, or only «Now» when none); pending (spinner, both buttons disabled, Esc ignored); asks again (notice above the buttons); error (destructive Alert in the dialog) | NEW: SCR-11, an AlertDialog «This conversation changed since you looked» with Leave it / Assign to <pick> · Unassign anyway · Reopen anyway; opened by `ConversationActions` on a stale refusal, which resends the shown version. Composes AlertDialog, Alert, Button, `activityText`. |
| CloseConfirmDialog | `apps/web/src/features/inbox/CloseConfirmDialog.tsx:61` | default (one line per close reason; unread and new share one line with its age or «since you opened it»; stale change as in SCR-11); pending (spinner, both buttons disabled, Esc ignored); asks again (notice above the buttons, lines replaced); error (destructive Alert in the dialog) | NEW: SCR-12, an AlertDialog «Close this conversation?» with Keep it open / Close anyway; opened by `ConversationActions` only from the server's `CLOSE_NEEDS_CONFIRMATION` answer (nothing pre-evaluated on the client), which resends the refusal's version and snapshot with `confirm_close_reasons`. Composes AlertDialog, Alert, Button, `activityText`. |
| ReplyDeliveryState | `apps/web/src/features/inbox/ReplyDeliveryState.tsx:30` | sending / sent / not delivered (customer blocked + hint, account gone, bot not working, author removed: no button) / not delivered (Telegram did not accept, interrupted: Try again) / not confirmed (Send again) / resending (spinner, disabled) / limited (countdown) / failed; taken-over note on every state | NEW: SCR-02 delivery line in MessageBubble's `footer` slot under every reply. Composes Button, SendAgainDialog; resend goes through the inbox store. |
| SendAgainDialog | `apps/web/src/features/inbox/SendAgainDialog.tsx:16` | default / pending (spinner, buttons disabled) / confirmation required / error (destructive Alert in the dialog) | NEW: SCR-05, an AlertDialog «Send this reply again?» with Cancel / Send again (duplicate-risk warning). Composes AlertDialog, Alert, Button. |
| MessageContent | `apps/web/src/features/inbox/MessageContent.tsx:250` | text / photo / sticker (webp image, webm video, `.tgs` label) / video / animation / video note / voice / audio / file row (Download on click) / location + venue (Open in map) / contact / poll / dice / unsupported; loading skeleton; unavailable (4 reasons); Telegram not responding + Try again | NEW: content of a customer message in the `MessageBubble` slot; media is fetched with the API client into object URLs (`media.ts`). Composes Skeleton, Alert, Button. |
| MediaViewer | `apps/web/src/features/inbox/MediaViewer.tsx:15` | photo / video / loading / not responding + Try again / unavailable / closes on forbidden | NEW: SCR-03, a Dialog (name + time header, caption), focus returns to the opener. Composes Dialog, Skeleton, Alert, Button. |

**Not yet in the repo** — shadcn/ui primitives the visual direction may still use; add each with
`pnpm dlx shadcn@latest add <name>` inside `apps/web` when the first screen needs it, check the import
points at `@/shared/lib/utils`, then move its row into the table above with its `file:line`:
`input-group`, `sonner` (toast) — catalogue: https://ui.shadcn.com/docs/components.

## Interaction & writing conventions

- **Errors:** form-level and page-level failures render as a destructive `Alert` in place (`apps/web/src/features/auth/sign-in/SignInForm.tsx:97`); guard errors (401/403/404) go through the shell's shared handler; a transient result of a background action may use a toast once `sonner` is added — never for errors that block the screen.
- **Empty states:** plain text inside the Card — one sentence saying what is missing + the primary action as a Button (e.g. bot «No bot is connected» + **Connect bot**); no illustrations.
- **Loading:** `Skeleton` shaped like the content (the shell renders a body skeleton until the workspace is entered); no full-page spinners.
- **Validation:** on submit (`noValidate` forms); field errors attach below the field and set `aria-invalid` on the input (`apps/web/src/features/auth/sign-in/SignInForm.tsx:110`); server validation errors map to the same field slots.
- **Microcopy tone:** plain, short, operator-facing English; say what happened and what to do next; never expose secrets (bot tokens) or internal codes.
