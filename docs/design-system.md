---
status: Living
tool: code               # figma | pencil | code — the single committed source of the design-tool choice (never sdd.local.md: that file is per-developer + gitignored)
figma_file: ""           # tool: figma → the Figma file URL/key the canon lives in; else ""
pen_file: ""             # tool: pencil → the .pen library path (e.g. docs/design/library.pen); else ""
updated_at: "2026-10-18"
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

Target layout patterns for the operator panel. They follow public shadcn/ui blocks; local,
**uncommitted** reference markup for them may sit in `docs/design-refs/` on a maintainer's machine
(never committed — treat it as a picture, not as code to copy: rewrite it onto the primitives below).

- **Auth screens** (sign-in, invite, reset): one centred column `max-w-sm`, `min-h-svh`, logo mark + `text-xl font-bold` heading + short description above the form; form fields stacked with `gap-6`. Source pattern: shadcn login blocks — https://ui.shadcn.com/blocks/login
- **Workspace shell:** collapsible left sidebar in the `inset` variant (workspace switcher in the header, primary nav, secondary nav, account menu in the footer) + an inset body with a `h-16` header row (sidebar trigger, vertical separator, breadcrumb). Source pattern: shadcn sidebar blocks — https://ui.shadcn.com/blocks/sidebar
- **Page body:** page title row (`text-2xl font-bold tracking-tight`, primary action right-aligned), then `space-y-4 lg:space-y-6` content composed of `Card`s.
- **List pages** (team, contacts): card-wrapped `Table` with a toolbar row (search `Input`, filter popover, column toggle) above it; rows carry `Avatar` + name, `Badge` for status, a row-actions `DropdownMenu`.
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
| AppShell | `apps/web/src/shared/ui/app-shell.tsx:32` | body skeleton (entering) / entered / not found (in-shell `NotFoundCard`) / error + Retry / access-removed notice | Workspace-area frame shared by every `/w/:id/*` screen: enters the URL's workspace (`useWorkspaceFromUrl`) and renders the page body only once entered; workspace switcher, owner-only Team and Bot links, account menu with sign-out (collapses into a menu at phone width); wires the shared guard handler (`useShellGuard`). Composes DropdownMenu, Button, Alert, Skeleton. |
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

**Not yet in the repo** — the visual direction above needs these shadcn/ui primitives; add each with
`pnpm dlx shadcn@latest add <name>` inside `apps/web` when the first screen needs it, check the import
points at `@/shared/lib/utils`, then move its row into the table above with its `file:line`:
`sidebar` (+ `separator`, `sheet`, `tooltip`), `breadcrumb`, `avatar`, `scroll-area`, `textarea`,
`input-group`, `tabs`, `field`, `checkbox`, `select`, `popover`, `sonner` (toast) — catalogue:
https://ui.shadcn.com/docs/components. A chat message bubble has no shadcn primitive: it is a
`NEW:` candidate for the inbox feature's `screens.md`.

## Interaction & writing conventions

- **Errors:** form-level and page-level failures render as a destructive `Alert` in place (`apps/web/src/features/auth/sign-in/SignInForm.tsx:97`); guard errors (401/403/404) go through the shell's shared handler; a transient result of a background action may use a toast once `sonner` is added — never for errors that block the screen.
- **Empty states:** plain text inside the Card — one sentence saying what is missing + the primary action as a Button (e.g. bot «No bot is connected» + **Connect bot**); no illustrations.
- **Loading:** `Skeleton` shaped like the content (the shell renders a body skeleton until the workspace is entered); no full-page spinners.
- **Validation:** on submit (`noValidate` forms); field errors attach below the field and set `aria-invalid` on the input (`apps/web/src/features/auth/sign-in/SignInForm.tsx:110`); server validation errors map to the same field slots.
- **Microcopy tone:** plain, short, operator-facing English; say what happened and what to do next; never expose secrets (bot tokens) or internal codes.
