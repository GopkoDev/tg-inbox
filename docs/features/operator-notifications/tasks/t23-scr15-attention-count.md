---
id: T23
title: "Build the attention store and SCR-15's count: the (N) title prefix, the Inbox SidebarMenuBadge, the phone header badge, the collapsed tooltip and Settings for operators"
layer: "ui"
deps: ["T22"]
blocks: ["T29", "T30"]
acs: ["AC-01", "AC-12"]
files_hint: ["apps/web/src/features/attention/store.ts", "apps/web/src/features/attention/api.ts", "apps/web/src/features/attention/store.test.ts", "apps/web/src/shared/ui/app-shell.tsx", "apps/web/src/shared/ui/app-shell.test.tsx"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T23 — Build the attention store and SCR-15's count: the (N) title prefix, the Inbox SidebarMenuBadge, the phone header badge, the collapsed tooltip and Settings for operators

## Place in the sequence

- **Blocked by:** T22 — Move the live socket to the workspace frame as one per-tab connection with subscribers, send presence frames on open and on visibilitychange, and let the inbox store subscribe · **Blocks:** T29 — Add browser end-to-end notification flows against the real API and the fake Bot API, T30 — Update CLAUDE.md, the architecture map, the design-system canon and CONTEXT.md for the notifications module, the sixth tenancy exception, the new queues, the ports and the new components · **Wave:** 3 — after T22.
- **Lane:** shares `apps/web/src/shared/ui/app-shell.tsx` with T22 — serialized.

## Why (user story)

> **As an** Operator
> **I want** the browser tab and the navigation to show how many conversations need me
> **So that** I notice new customer messages while I work on another page or another tab
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

It is what the operator sees at a glance on every workspace page.

## Inlined context

> 3. **The attention count sits on the Inbox item as `SidebarMenuBadge`** and in the tab title as a `(N) ` prefix to the existing title (`(3) tg-inbox`). Both show the exact number, uncapped, as the contract returns it. With the sidebar collapsed to icons, the badge is hidden and the Inbox tooltip reads «Inbox (3)». At phone width, where the nav is in a drawer, the same number also shows as a small `Badge` next to the sidebar trigger in the header row, so the count is visible without opening the drawer.
>
> — `screens.md §Source, Decision 3, verbatim` · full text: [screens.md](../screens.md)

> | default: count above 0 | workspace entered and `getAttentionCount` `200` with `count` N > 0 — the tab title is `(N) tg-inbox`; the **Inbox** nav item shows N in a `SidebarMenuBadge` on its right, with `aria-label` «N conversations need you»; the same on Inbox, Contacts and every Settings page; each tab shows only its own workspace (AC-01; flow 4) | extended: AppShell, Sidebar (`SidebarMenuBadge`) | wireframe «frame desktop» |
> | default: count 0 | `count: 0` — title `tg-inbox`, no badge (AC-01) | extended: AppShell | — |
> | role: operator (changed) | an operator's nav now shows **Settings** too (Decision 1); it leads to Settings — Notifications (AC-12; ux-flows «one personal place») | extended: AppShell, Sidebar | wireframe «frame desktop» |
> | live: count changes | a `conversation.changed` / `resync` frame → re-read, debounced 300 ms → title and badge change without a reload: a customer writes in a conversation that is mine or unassigned, I read one, one is assigned to me / unassigned / to a teammate, closed or reopened; a teammate's or closed conversation never adds to it (AC-01; flow 4) | extended: AppShell | — |
> | collapsed (desktop) | sidebar collapsed to icons — the badge is hidden; the Inbox tooltip reads «Inbox (N)» (Decision 3) | Sidebar, Tooltip | — |
> | phone (< md) | the drawer's Inbox item shows the badge; with N > 0 the header row also shows N in a `Badge` after the sidebar trigger (`aria-hidden`, the drawer item carries the label) (Decision 3; canon posture) | Sidebar, Sheet, Badge | wireframe «frame phone» |
>
> — `screens.md §SCR-15, state table, verbatim` · full text: [screens.md](../screens.md)

> loading: no count, no badge until the first answer · error: the last count stays, no error shown · entering / not found / error / access removed: no count and no title prefix (AC-12).
>
> — `screens.md §SCR-15, loading, error, inherited, abridged` · full text: [screens.md](../screens.md)

> | `conversation.changed` (`created` / `message`, `created` / `activity`, `read`) of this workspace | the attention store re-reads `getAttentionCount`, debounced 300 ms (SCR-15); the desktop notifier evaluates `created` / `message` only (OS-02) | AC-01, AC-02; flow 4, flow 6; events.md |
>
> — `screens.md §Shared states, attention triggers, verbatim` · full text: [screens.md](../screens.md)

> **Chosen:** Option 1. It is the only option that is always correct. It follows the decided "signal, then refetch" pattern, and its cost is one indexed count per tab per burst of frames (debounced 300 ms). That fits the 3 s target with room to spare. Own-read updates already arrive account-scoped (`change: read` with `account_id`), so a read in one tab updates the count in the others.
>
> — `adr/0008-serve-the-attention-count-from-a-conversations-query-refetched-on-change-signals.md §Decision outcome, ADR-0008, verbatim` · full text: [ADR-0008](../adr/0008-serve-the-attention-count-from-a-conversations-query-refetched-on-change-signals.md)

> - **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` (add new ones with `pnpm dlx shadcn@latest add <name>` inside `apps/web`, then check the import points at `@/shared/lib/utils`). Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Reads `getAttentionCount` → `{ workspace_id, count }` (`401` / `403` / `404` → the inherited guard rows). — `contracts/openapi.yaml, getAttentionCount, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers" with the inbox open: 2 open conversations assigned to them and 1 unassigned open conversation have customer messages they have not read, while a teammate's conversation and a closed one also have unread messages
> **When** they look at the browser tab or move to Settings or Contacts
> **Then** the tab title starts with "(3)" and the Inbox item in the side navigation shows 3: the **attention count** includes only open conversations that are theirs or unassigned and have unread messages for them. It changes without reloading within the live-update target of §6 as messages arrive, as they read conversations and as conversations are assigned, closed or reopened. At 0 the title has no count and the navigation shows no number. Each tab shows the count of its own workspace. A business owner sees the same.
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Attention store per workspace: read on enter, refetch debounced 300 ms on `conversation.changed` / `resync`, keep the last count on failure, drop late answers of another workspace — `apps/web/src/features/attention/store.ts`, `apps/web/src/features/attention/api.ts`
- [ ] Frame: `document.title` `(N) tg-inbox`, `SidebarMenuBadge` with `aria-label` «N conversations need you», tooltip «Inbox (N)» when collapsed, phone header `Badge`, Settings item for operators — `apps/web/src/shared/ui/app-shell.tsx`
- [ ] Testing Library tests for every SCR-15 state above — `apps/web/src/shared/ui/app-shell.test.tsx`, `apps/web/src/features/attention/store.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Count 0 | plain `tg-inbox`, no badge |
| Count 137 | `(137) tg-inbox`, badge 137 (uncapped) |
| Burst of 20 frames | one refetch after 300 ms |
| Access removed | count and prefix gone |

## Definition of Done

- [ ] Testing Library tests cover every SCR-15 state this feature adds in screens.md (count above 0 and 0, operator Settings item, loading, live change within the debounce, failed read keeps the last count, collapsed tooltip, phone header badge, inherited states without a count), with the title prefix and badge driven by getAttentionCount.
- [ ] the attention store refetches, debounced, on a message, an activity, this account's read change, membership.deactivated and resync, and drops a late answer of another workspace (test-plan.md, AC-01)
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
