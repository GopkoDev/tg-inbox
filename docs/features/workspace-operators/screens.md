---
status: approved
feature_size: "M"
tool: "code"
updated_at: "2026-10-11"
---

# Screens — workspace-operators

> The canonical **screen manifest** — every screen in every state — produced by `screens` (between
> `api` and `tasks`) and read by `tasks` (each `ui` task cites SCR ids + states), `implement`
> (builds the screen to the declared states) and `review` (the built screen must match this).
> Downstream stages reference **only this manifest** — never the raw Figma / `.pen` file.

## Source

- **Tool:** code — `docs/design-system.md` does not exist yet, so there is no canon `tool`; the
  stage runs in `code` mode by default (not an MCP degradation). Run `/sdd:design-system` before the
  next UI feature.
- **File:** inline wireframes below (ASCII, one per state that needs a distinct layout).
- **Component inventory used:** without a canon, the inventory is what `apps/web/src/shared/ui`
  holds today — **Button**, **Card** — plus shadcn/ui registry primitives, which `CLAUDE.md` makes
  the sanctioned source («compose shadcn/ui primitives … add new ones with
  `pnpm dlx shadcn@latest add <name>`»). Registry primitives not installed yet are marked
  `shadcn:<name>` and listed under §New components → *shadcn primitives to install*. Icons come
  from `lucide-react` (`components.json` → `iconLibrary: lucide`).
- **Posture:** responsive-both (ux-flows.md §Platform decisions) — every screen works at phone
  width (≥ 360 px, 16 px gutter) and desktop width; wireframes show the phone layout where it
  differs from the desktop one.
- **Addresses** (from ADR-0003 and `contracts/cli.md`): public — `/sign-in`, `/invite/<token>`,
  `/reset-password/<token>`; signed-in without a workspace — `/workspaces` (SCR-04), `/no-access`
  (SCR-05); workspace area — `/w/<workspaceId>` (SCR-06), `/w/<workspaceId>/team` (SCR-07, SCR-08
  layered over it). SCR-03 and SCR-10 are rendered in place at the address that failed, not
  routes of their own.
- **Copy:** user-facing texts quoted below are the contract `message` strings where one exists
  (`contracts/openapi.yaml` §components/responses); the panel shows the server message for errors
  and does not invent its own wording for them.

## Screens

**Shared guard states (every workspace-area request — SCR-06, SCR-07, SCR-08, the switcher).**
These come from the workspace-access guard (sad.md §6 critical flow 3, ADR-0003) and are handled
once, in the API client layer, not re-implemented per screen. Each screen below lists them as one
row pointing here.

| Guard answer | What the panel does | Source |
|---|---|---|
| `401 UNAUTHENTICATED` | Clear the account + workspace stores, go to SCR-01 state `session-ended`, remember the current address to return to after sign-in | flow 3 «no session or idle > 30 days», flow 6, flow 12 (other devices), AC-11, AC-21 |
| `403 ACCESS_REMOVED` | Clear that workspace's data from the stores at once, re-run the AC-07 workspace resolution (`getMe` → `listMyWorkspaces`), land on SCR-06 / SCR-04 / SCR-05 with the `access-removed` notice naming the workspace | flow 3 «membership deactivated», AC-17 |
| `404 NOT_FOUND` from the guard | Render SCR-10 in place | flow 3 «never a member», AC-13 |
| network failure / `500 INTERNAL_ERROR` | The screen's own `error` row (Retry) | error envelope, `ErrorCode.INTERNAL_ERROR` |

### SCR-01 — Sign-in

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | App boot: `getMe` in flight to find out whether a session already exists | Card, shadcn:skeleton | wireframe «loading» |
| default | No session (`getMe` → 401) or after sign-out | Card, shadcn:input, shadcn:label, Button | wireframe «default» |
| submitting | `signIn` in flight — fields and button disabled, button shows a spinner | Button (disabled + lucide `Loader2`) | same as default |
| validation | `400 VALIDATION_ERROR` (email not a valid address after trimming) — message under the email field; empty fields are blocked client-side by `required` | shadcn:input (`aria-invalid`), shadcn:label | wireframe «default» + field error line |
| error: invalid credentials | `401 INVALID_CREDENTIALS` — «Email or password is incorrect», same for an unknown email and a wrong password; password field cleared | shadcn:alert (destructive) | wireframe «error» |
| error: locked out | `429 TOO_MANY_ATTEMPTS` — «Too many failed attempts, try again later»; also for emails without an account | shadcn:alert (destructive) | wireframe «error» (other text) |
| session-ended | Arrived through the shared `401` handler from a workspace screen — neutral notice «Sign in to continue» above the form; after sign-in the panel continues to the remembered address | shadcn:alert (default) | wireframe «session-ended» |
| success | `204` → AC-07 resolution: return address (if one) → `last_used_workspace_id` → the only workspace → SCR-04 (several) → SCR-05 (none) | — (navigation) | — |
| empty | N/A: a form with no list or data to be empty | — | — |

Sources: AC-07, AC-08, AC-09, AC-10, AC-11; sad.md §6 critical flow 1, flow 6; `signIn` 204/400/401/429, `getMe` 401.

```text
loading                          default (phone = desktop, card max-w-sm, centered)
+------------------------------+ +------------------------------+
|                              | |  tg-inbox                    |
|   [▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒]     | |  Sign in                     |
|   [▒▒▒▒▒▒▒▒▒▒▒▒]             | |                              |
|                              | |  Email                       |
+------------------------------+ |  [________________________]  |
                                 |  Password                    |
                                 |  [________________________]  |
                                 |  [        Sign in         ]  |
                                 |                              |
                                 |  Forgot your password? Ask   |
                                 |  the tg-inbox team for a     |
                                 |  reset link.                 |
                                 +------------------------------+
error                            session-ended
+------------------------------+ +------------------------------+
|  Sign in                     | |  Sign in                     |
| ┌──────────────────────────┐ | | ┌──────────────────────────┐ |
| │ ! Email or password is   │ | | │ i Sign in to continue    │ |
| │   incorrect              │ | | └──────────────────────────┘ |
| └──────────────────────────┘ | |  Email   [_______________]   |
|  Email   [ana@acme.test  ]   | |  Password[_______________]   |
|  Password[_______________]   | |  [        Sign in         ]   |
|  [        Sign in         ]  | +------------------------------+
+------------------------------+
```

The «Forgot your password?» line is static help text (no link): reset links come only from a
platform admin (spec §3 non-goals, US-08).

### SCR-02 — Accept invitation

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `lookUpInvitation` in flight after opening `/invite/<token>` | Card, shadcn:skeleton | wireframe «loading» (as SCR-01) |
| default: new account | `200` with `account_exists: false` — shows workspace name, invited email (read-only) and role; fields: name, password (hint «at least 10 characters») | Card, shadcn:input, shadcn:label, shadcn:badge (role), Button | wireframe «new account» |
| default: existing account | `200` with `account_exists: true` — workspace name, email, role; one field: the account's existing password | Card, shadcn:input, shadcn:label, shadcn:badge, Button | wireframe «existing account» |
| submitting | `acceptInvitation` in flight — form disabled, button spinner | Button (disabled + `Loader2`) | same as default |
| validation | `400 VALIDATION_ERROR` with `details.field` — password < 10 chars «The password must be at least 10 characters long» (AC-05), name blank or > 200 chars; the length rule is also checked client-side before submit | shadcn:input (`aria-invalid`), shadcn:label | field error line under the field |
| error: invalid credentials | `401 INVALID_CREDENTIALS` on the existing-account form — wrong password **or** locked-out email, one message «Email or password is incorrect»; password cleared | shadcn:alert (destructive) | as SCR-01 «error» |
| error: link unavailable | `404 INVITATION_INVALID` (on lookup, or on submit when the invitation was revoked/used in between) or `403 INVITATION_FOR_ANOTHER_EMAIL` → render SCR-03 in place | — (→ SCR-03) | SCR-03 |
| error: unexpected | network failure / `500` on lookup or submit — «Something went wrong» + Retry (lookup) / keep the form filled (submit) | shadcn:alert (destructive), Button | — |
| success | `200 WorkspaceSummary` → `enterWorkspace` → SCR-06 of the joined workspace | — (navigation) | — |
| empty | N/A: a single-record form, nothing to list | — | — |

Sources: AC-03, AC-04, AC-04b, AC-05, AC-06, AC-09; sad.md §6 critical flow 2 + its prose; `lookUpInvitation` 200/403/404, `acceptInvitation` 200/400/401/403/404.

```text
new account                         existing account
+--------------------------------+  +--------------------------------+
|  Join Acme Flowers             |  |  Join Acme Flowers             |
|  You are invited as [Operator] |  |  You are invited as [Operator] |
|                                |  |                                |
|  Email                         |  |  ana@acme.test already has a   |
|  ana@acme.test (read-only)     |  |  tg-inbox account. Enter its   |
|  Your name                     |  |  password to join.             |
|  [__________________________]  |  |                                |
|  Password                      |  |  Password                      |
|  [__________________________]  |  |  [__________________________]  |
|  At least 10 characters        |  |  [      Join workspace      ]  |
|  [ Create account and join  ]  |  +--------------------------------+
+--------------------------------+
```

### SCR-03 — Link unavailable

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default: invitation invalid, ask a business owner | `404 INVITATION_INVALID`, `details.ask: business_owner` — «This invitation is no longer valid — ask a business owner for a new one» | Card, lucide `LinkOff` icon | wireframe «invitation invalid» |
| default: invitation invalid, ask the tg-inbox team | `404 INVITATION_INVALID`, `details.ask: tg_inbox_team` — «… ask the tg-inbox team for a new one» | Card | wireframe «invitation invalid» (other text) |
| default: invitation for another email | `403 INVITATION_FOR_ANOTHER_EMAIL` — «This invitation belongs to another email — sign out and open the link again»; **Sign out** button signs out (`signOut`) and reloads the same `/invite/<token>` | Card, Button | wireframe «another email» |
| default: reset link invalid | `404 RESET_LINK_INVALID` — «This reset link is no longer valid»; text adds «ask the tg-inbox team for a new one» | Card | wireframe «invitation invalid» (other text) |
| loading | N/A: SCR-03 is only rendered after SCR-02 / SCR-09 finished their lookup; their `loading` covers it | — | — |
| empty | N/A: a message screen, nothing to list | — | — |
| error | N/A: the screen *is* the error outcome; the sign-out call cannot fail visibly (`signOut` always answers 204) | — | — |

Sources: AC-04b, AC-06, AC-20 (revoked link), AC-22; sad.md §6 critical flow 2, flow 12; `InvitationInvalid`, `InvitationForAnotherEmail`, `ResetLinkInvalid` responses.

```text
invitation invalid                  another email
+--------------------------------+  +--------------------------------+
|  ⊘                             |  |  ⊘                             |
|  This link can't be used       |  |  This invitation is for        |
|                                |  |  another email                 |
|  This invitation is no longer  |  |                                |
|  valid — ask a business owner  |  |  This invitation belongs to    |
|  for a new one.                |  |  another email — sign out and  |
|                                |  |  open the link again.          |
|  [   Go to sign-in   ]         |  |  [        Sign out         ]   |
+--------------------------------+  +--------------------------------+
```

«Go to sign-in» is shown only when the device has no session; with a session the button reads
«Go to my workspace» and runs the AC-07 resolution.

### SCR-04 — Workspace picker

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `listMyWorkspaces` in flight | Card, shadcn:skeleton | wireframe «loading» (3 row skeletons) |
| default: page | After sign-in / password reset with several active workspaces and no usable last-used one — full page at `/workspaces`, one row per workspace: name + role badge | Card, Button (`variant="ghost"`, full-width row), shadcn:badge | wireframe «page» |
| default: switcher | Opened from the workspace header on SCR-06/SCR-07 — the same list as a menu, the current workspace checked | shadcn:dropdown-menu, shadcn:badge | wireframe «switcher» |
| access-removed | Arrived through the shared `403 ACCESS_REMOVED` handler — notice «Your access to Acme Flowers was removed» above the list | shadcn:alert (default) | wireframe «page» + notice |
| entering | A workspace was picked — `enterWorkspace` in flight, the picked row shows a spinner, others disabled | Button (disabled + `Loader2`) | — |
| error: pick refused | `enterWorkspace` → `404` or `403 ACCESS_REMOVED` for the picked workspace (removed meanwhile) — reload the list and show «That workspace is no longer available» | shadcn:alert (destructive) | — |
| error: unexpected | network failure / `500` on the list — «Something went wrong» + Retry | shadcn:alert (destructive), Button | — |
| has-more | `has_next: true` — the list is fetched with `limit=100`; a **Show more** button fetches the next page with `after=next_cursor` | Button (`variant="outline"`) | — |
| empty | N/A: zero active memberships never reaches the picker — the AC-07 resolution sends the person to SCR-05 instead; in the switcher the current workspace is always listed | — | — |
| success | `enterWorkspace` 200 → SCR-06 of the picked workspace | — (navigation) | — |

Sources: AC-07, AC-12, AC-17, AC-19 (reactivated workspace listed again); sad.md §6 critical flow 1, flow 7; `listMyWorkspaces` 200/401, `enterWorkspace` 200/401/403/404.

```text
page (phone; desktop = same card, max-w-md)   switcher (desktop header menu)
+--------------------------------+            +--------------------------+
|  Choose a workspace            |            | Acme Flowers        ▾    |
|                                |            +--------------------------+
|  [ Acme Flowers   Business owner ] |        | ✓ Acme Flowers  Business owner |
|  [ Bolt Bikes     Operator      ] |        |   Bolt Bikes    Operator       |
|  [ Cozy Cafe      Operator      ] |        +--------------------------+
|                                |
|  Signed in as ana@acme.test    |
|  [ Sign out ]                  |
+--------------------------------+
```

### SCR-05 — No access

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | AC-07 resolution found no active membership (`listMyWorkspaces` → empty) after sign-in or password reset — «You no longer have access to any workspace»; shows the signed-in email and **Sign out**; no workspace data | Card, Button | wireframe «default» |
| access-removed | Arrived through the shared `403 ACCESS_REMOVED` handler — adds «Your access to Acme Flowers was removed» above the text | shadcn:alert (default) | wireframe «default» + notice |
| loading | N/A: rendered only after the resolution already loaded the (empty) list | — | — |
| empty | N/A: the screen itself is the «no workspaces» outcome | — | — |
| error | N/A: no data load of its own; sign-out always answers 204 | — | — |

Sources: AC-10, AC-17; sad.md §6 critical flow 1 (last step), critical flow 3; `listMyWorkspaces` 200 with no items.

```text
default
+--------------------------------+
|  No access                     |
|                                |
|  You no longer have access to  |
|  any workspace. Ask a business |
|  owner to reactivate you.      |
|                                |
|  Signed in as ana@acme.test    |
|  [        Sign out         ]   |
+--------------------------------+
```

### SCR-06 — Workspace home

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | Opening `/w/<workspaceId>` — `enterWorkspace` in flight; the header shows a name skeleton | NEW: AppShell, shadcn:skeleton | — |
| default: owner | `enterWorkspace` 200, `role: owner` — header: workspace switcher (SCR-04 menu), **Team** link, account menu (email, **Sign out**); body: placeholder «Your inbox arrives here» (roadmap step 4) | NEW: AppShell, shadcn:dropdown-menu, Button, Card | wireframe «owner» |
| default: operator | `role: operator` — the same, **without** the Team link | NEW: AppShell, shadcn:dropdown-menu, Card | wireframe «owner» minus Team |
| access-removed | Arrived through the shared `403 ACCESS_REMOVED` handler (moved here from the workspace that was removed) — dismissible notice «Your access to Acme Flowers was removed» under the header | shadcn:alert (default) | wireframe «access-removed» |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` on `enterWorkspace` → shared guard table above | — | §Shared guard states |
| error: unexpected | network failure / `500` on `enterWorkspace` — «Something went wrong» + Retry in the body | shadcn:alert (destructive), Button | — |
| empty | N/A: the home has no data of its own in this feature — the placeholder *is* the default body | — | — |

Sources: AC-03, AC-07, AC-11 (sign-out), AC-12, AC-15 (no Team entry for operators), AC-17; sad.md §6 flows 1, 6, 7; `enterWorkspace` 200/401/403/404, `signOut` 204.

```text
owner — desktop                                   owner — phone
+-----------------------------------------------+ +----------------------------+
| tg-inbox | Acme Flowers ▾ | Team   ana@… ▾    | | ☰  Acme Flowers ▾          |
+-----------------------------------------------+ +----------------------------+
|                                               | |                            |
|   ┌───────────────────────────────────────┐   | | ┌────────────────────────┐ |
|   │ Your inbox arrives here               │   | | │ Your inbox arrives     │ |
|   │ Connecting the bot comes next.        │   | | │ here                   │ |
|   └───────────────────────────────────────┘   | | └────────────────────────┘ |
+-----------------------------------------------+ +----------------------------+
                                                   ☰ opens: Team · ana@… · Sign out
access-removed (under the header)
| ┌──────────────────────────────────────────┐ |
| │ i Your access to Acme Flowers was removed ✕│ |
| └──────────────────────────────────────────┘ |
```

### SCR-07 — Team

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `listMemberships` + `listPendingInvitations` in flight | NEW: AppShell, shadcn:skeleton (table rows) | — |
| default | Both lists loaded — **Members**: name, email, role badge, state badge, row action (**Deactivate** for active, **Reactivate** for deactivated); **Pending invitations**: email, role badge, «expires <date>», **Revoke**; never a link; **Invite** button in the section header | NEW: AppShell, shadcn:table, shadcn:badge, Button | wireframe «default» |
| empty: no pending invitations | `listPendingInvitations` → no items — «No pending invitations» line in that section | shadcn:table (single muted row) | wireframe «default» (second section) |
| confirm deactivate | **Deactivate** clicked — «Deactivate Bob? Bob loses access to Acme Flowers at once. You can reactivate them later.» Cancel / Deactivate | shadcn:alert-dialog | wireframe «confirm» |
| confirm revoke | **Revoke** clicked — «Revoke the invitation for bob@x.test? Its link stops working.» Cancel / Revoke | shadcn:alert-dialog | wireframe «confirm» (other text) |
| pending action | `deactivateMembership` / `reactivateMembership` / `revokeInvitation` in flight — that row's button spinner, other row actions disabled | Button (disabled + `Loader2`) | — |
| success | Deactivated → row state badge «Deactivated», action «Reactivate»; reactivated → «Active» with the previous role; revoked → row removed from pending | shadcn:badge, shadcn:table | — |
| error: last active owner | `409 LAST_ACTIVE_OWNER` — the dialog closes, an alert above Members: «A workspace must always have at least one active business owner» | shadcn:alert (destructive) | — |
| error: stale row | `404 NOT_FOUND` on deactivate / reactivate / revoke (item no longer in this workspace, or invitation no longer pending) — alert «This item has changed — the list was refreshed» and both lists reload | shadcn:alert (default) | — |
| error: owners only | `403 OWNER_ONLY` on any team call (an operator opened `/w/<id>/team` by address) — the body shows only «Only business owners manage the team» + **Back to home**; no list is rendered | Card, Button | wireframe «owners only» |
| self-deactivated | The owner deactivated themselves while another active owner remains → `200`; the next request answers `403 ACCESS_REMOVED` → shared guard handler | — | §Shared guard states |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` on any team call → shared guard table | — | §Shared guard states |
| has-more | `has_next: true` on either list (fetched with `limit=100`) — **Show more** under that list | Button (`variant="outline"`) | — |
| error: unexpected | network failure / `500` on a list load — «Something went wrong» + Retry; on an action — alert, the row keeps its old state | shadcn:alert (destructive), Button | — |
| empty: members | N/A: an owner viewing the team is always an active member; AC-18 keeps ≥ 1 active business owner | — | — |

Sources: AC-14 (pending row appears), AC-15, AC-17, AC-18, AC-19, AC-20; sad.md §6 flows 9, 10 (+ flow 8 operator branch); `listMemberships`, `listPendingInvitations` 200/401/403/404, `deactivateMembership` 200/403/404/409, `reactivateMembership` 200/403/404, `revokeInvitation` 204/403/404.

```text
default — desktop
+---------------------------------------------------------------------+
| tg-inbox | Acme Flowers ▾ | Team                         ana@… ▾      |
+---------------------------------------------------------------------+
|  Team                                                   [ + Invite ]|
|  Members                                                            |
|  Name        Email             Role       State                     |
|  Ana (you)     ana@acme.test   [Business owner] [Active] [Deactivate]|
|  Bob Petrenko  bob@acme.test   [Operator] [Active]    [Deactivate]  |
|  Ira Melnyk    ira@acme.test   [Operator] [Deactivated][Reactivate] |
|                                                                     |
|  Pending invitations                                                |
|  Email             Role        Expires                              |
|  max@acme.test     [Operator]  18 Oct 2026            [Revoke]      |
+---------------------------------------------------------------------+

default — phone (email + role move under the name: `hidden md:table-cell`)
+--------------------------------+
| ☰  Acme Flowers ▾              |
+--------------------------------+
|  Team               [+ Invite] |
|  Members                       |
|  Bob Petrenko      [Deactivate]|
|  bob@acme.test                 |
|  [Operator] [Active]           |
|  ──────────────────────────────|
|  Pending invitations           |
|  max@acme.test        [Revoke] |
|  [Operator] expires 18 Oct     |
+--------------------------------+

confirm (alert-dialog)              owners only
+--------------------------------+  +--------------------------------+
|  Deactivate Bob Petrenko?      |  |  Only business owners manage   |
|  Bob loses access to Acme      |  |  the team                      |
|  Flowers at once. You can      |  |                                |
|  reactivate them later.        |  |  [     Back to home      ]     |
|        [Cancel] [Deactivate]   |  +--------------------------------+
+--------------------------------+
```

The signed-in owner's own row carries a «(you)» label next to the name and offers **Deactivate**
like any other row; the server decides (AC-18 allows self-deactivation while another active owner
remains, and answers `409 LAST_ACTIVE_OWNER` otherwise).

### SCR-08 — Invite member

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | **Invite** on SCR-07 — a dialog over SCR-07: email field, role choice (Operator — preselected / Business owner), **Create invitation** | shadcn:dialog, shadcn:input, shadcn:label, shadcn:radio-group, Button | wireframe «form» |
| submitting | `createInvitation` in flight — form disabled, button spinner | Button (disabled + `Loader2`) | — |
| validation | `400 VALIDATION_ERROR` — email not a valid address after trimming → message under the email field | shadcn:input (`aria-invalid`), shadcn:label | field error line |
| error: already a member | `409 ALREADY_A_MEMBER` — alert in the dialog «This person is already a member — reactivate them instead if they are deactivated»; the form stays | shadcn:alert (destructive) | — |
| success: link shown once | `201 IssuedInvitation` — the form is replaced by: «Invitation created for max@acme.test (Operator), valid until 18 Oct 2026», the link in a read-only field with **Copy** (label turns «Copied» for 2 s), a warning «You won't see this link again — copy it now», **Done**; any earlier pending invitation for the email was replaced (said in the text) | shadcn:dialog, shadcn:input (`readOnly`, select-all on focus), Button, shadcn:alert (default) | wireframe «link» |
| closed | **Done** / ✕ / Esc → back to SCR-07, the pending list refetched and showing the new row; the link is gone for good | — (→ SCR-07) | SCR-07 «default» |
| error: owners only | `403 OWNER_ONLY` — not reachable from the UI (operators get no **Invite**), but if returned: the dialog closes and SCR-07 shows its `owners only` state | — (→ SCR-07) | SCR-07 «owners only» |
| guard states | `401` / `403 ACCESS_REMOVED` / `404` → shared guard table | — | §Shared guard states |
| error: unexpected | network failure / `500` — alert in the dialog, form kept | shadcn:alert (destructive) | — |
| empty | N/A: a form, nothing to list | — | — |
| loading | N/A: opens instantly over the already-loaded SCR-07, no fetch of its own | — | — |

Sources: AC-14, AC-15, AC-16; sad.md §6 flow 8; `createInvitation` 201/400/401/403/404/409; `IssuedInvitation.link` «returned only here, never again».

```text
form (dialog; phone = full-width sheet-like dialog)   link (same dialog, after 201)
+--------------------------------+                 +--------------------------------+
|  Invite a member            ✕  |                 |  Invitation created         ✕  |
|                                |                 |  max@acme.test · Operator      |
|  Email                         |                 |  valid until 18 Oct 2026       |
|  [__________________________]  |                 |                                |
|  Role                          |                 |  [https://…/invite/Zt8w…][Copy]|
|  (•) Operator                  |                 | ┌────────────────────────────┐ |
|  ( ) Business owner            |                 | │ i You won't see this link  │ |
|                                |                 | │   again — copy it now.     │ |
|        [ Create invitation ]   |                 | └────────────────────────────┘ |
+--------------------------------+                 |                     [ Done ]   |
                                                   +--------------------------------+
```

### SCR-09 — Set new password

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| loading | `lookUpPasswordResetLink` in flight after opening `/reset-password/<token>` | Card, shadcn:skeleton | as SCR-01 «loading» |
| default | `204` — «Set a new password»: new password field (hint «at least 10 characters»), **Set password** | Card, shadcn:input, shadcn:label, Button | wireframe «default» |
| submitting | `redeemPasswordResetLink` in flight — form disabled, button spinner | Button (disabled + `Loader2`) | — |
| validation | `400 VALIDATION_ERROR` `field: password` — «The password must be at least 10 characters long»; also checked client-side before submit | shadcn:input (`aria-invalid`), shadcn:label | field error line |
| error: link unavailable | `404 RESET_LINK_INVALID` on lookup, or on submit when the link was used / superseded / expired in between → render SCR-03 in place | — (→ SCR-03) | SCR-03 |
| error: unexpected | network failure / `500` — «Something went wrong» + Retry (lookup) / form kept (submit) | shadcn:alert (destructive), Button | — |
| success | `204` → signed in on this device → AC-07 resolution → SCR-06 / SCR-04 / SCR-05 | — (navigation) | — |
| empty | N/A: a single-field form | — | — |

Sources: AC-21, AC-22, AC-07 (resolution after reset); sad.md §6 flow 12; `lookUpPasswordResetLink` 204/400/404, `redeemPasswordResetLink` 204/400/404.

```text
default
+--------------------------------+
|  Set a new password            |
|                                |
|  New password                  |
|  [__________________________]  |
|  At least 10 characters        |
|  [       Set password       ]  |
|                                |
|  Every other device will be    |
|  signed out.                   |
+--------------------------------+
```

### SCR-10 — Not found

| State | Trigger / condition | Components (from the inventory) | Source-ref |
|---|---|---|---|
| default | The guard answered `404 NOT_FOUND` for `/w/<workspaceId>/…` (never a member, unknown or malformed id) — «Page not found», no workspace name, no hint the workspace or item exists; **Go to my workspace** runs the AC-07 resolution | Card, Button | wireframe «default» |
| loading | N/A: rendered after the guarded request already answered | — | — |
| empty | N/A: a message screen | — | — |
| error | N/A: the screen *is* the not-found outcome; signed-out visitors first pass SCR-01 (shared `401` handler) and return here | — | — |

Sources: AC-13; sad.md §6 critical flow 3, flow 7; `WorkspaceNotFound` response («indistinguishable on purpose»). Unknown non-workspace addresses reuse this screen.

```text
default
+--------------------------------+
|  Page not found                |
|                                |
|  This page doesn't exist or    |
|  you don't have access to it.  |
|                                |
|  [   Go to my workspace    ]   |
+--------------------------------+
```

## New components

| Component | Why no existing primitive fits | Registered in design-system |
|---|---|---|
| AppShell | The workspace area needs one header shared by SCR-06/07/08 — workspace switcher, role-dependent **Team** link, account menu with sign-out, collapsing into a menu at phone width — and the slot for the `access-removed` notice; shadcn/ui ships no app-layout primitive, and repeating the header per screen would let the owner-only Team entry drift. Composes shadcn:dropdown-menu, Button, shadcn:alert. Lives in `apps/web/src/shared/ui/app-shell.tsx`. | pending (no `docs/design-system.md` yet) |

**shadcn primitives to install** (`pnpm dlx shadcn@latest add <name>` in `apps/web`, then check the
import points at `@/shared/lib/utils`) — standard registry primitives, not hand-rolled; listed so
`tasks` schedules the install:

| Primitive | Used by |
|---|---|
| input | SCR-01, SCR-02, SCR-08, SCR-09 |
| label | SCR-01, SCR-02, SCR-08, SCR-09 |
| alert | SCR-01, SCR-02, SCR-04, SCR-05, SCR-06, SCR-07, SCR-08, SCR-09 |
| skeleton | SCR-01, SCR-02, SCR-04, SCR-06, SCR-07, SCR-09 |
| badge | SCR-02, SCR-04, SCR-07 |
| dropdown-menu | SCR-04 (switcher), SCR-06 / AppShell |
| table | SCR-07 |
| alert-dialog | SCR-07 |
| dialog | SCR-08 |
| radio-group | SCR-08 |
