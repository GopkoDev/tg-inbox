---
id: T8
title: "Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link"
layer: "infra"
deps: ["T1"]
blocks: ["T10", "T11", "T15", "T16", "T18", "T20"]
acs: ["AC-05", "AC-06", "AC-12"]
files_hint: ["apps/api/src/modules/notifications/infra/telegram-link-repo.ts", "apps/api/src/modules/notifications/infra/connect-link-repo.ts", "apps/api/src/modules/notifications/infra/repos.int.test.ts", "apps/api/src/modules/notifications/app/ports.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T8 — Build the telegram-link and connect-link repositories with cross-workspace isolation tests, including the sixth-exception read of workspaces with a live link

## Place in the sequence

- **Blocked by:** T1 — Promote migrations 04–08 (the bot send pause and the five notifications tables), regenerate DB types and add the test fixtures · **Blocks:** T10 — Add the notifications use cases for my settings, creating a connect link (limit, already linked, bot readiness, replace) and disconnecting, T11 — Redeem a connect-link start: share-lock the membership, lock and re-check the link, enforce both uniqueness rules, link, signal and enqueue the answer, T15 — Add the notifications.send-bot-message worker: readiness and pause, the answer text from the kind, outcomes, retries and the dead letter, and clearing a removed link's Telegram id, T16 — Add the send-pings use case: the per-workspace sweep, the per-member send transaction that re-checks and writes the ledger before the call, and the outcome transaction, T18 — Remove links on deactivation through the composed onMembershipDeactivated port and on a different bot through the bot-connected hook, both in the existing transactions, T20 — Add telegram_pings to Membership on the Team reads and the deactivate / reactivate answers through a notifications port that team takes · **Wave:** 2 — after T1.
- **Lane:** shares `apps/api/src/modules/notifications/app/ports.ts` with T9; shares `apps/api/src/modules/notifications/app/ports.ts` with T10 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to connect my own Telegram account to the workspace's bot from the panel, see that it is connected, and disconnect it
> **So that** the bot can ping me when I am away, and only after I chose so
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

It is the persistence every link use case goes through, scoped by workspace on every method.

## Inlined context

> - **Tenancy:** every tenant-owned table has a non-null `workspace_id`; every repository method takes `workspaceId` and filters by it. Every repository gets an integration test proving cross-workspace isolation. Five reads are the controlled exceptions because they produce the workspace id: three in `workspaces` (memberships of an account, invitation by token hash, membership for the guard — account id + workspace id from the URL) and two in `bots` (_bot by webhook id_, scoped by possession of the webhook secret's hash; _bots due for a health check_, used only by the scheduled job — bot-connection ADR-0007); a new exception needs a change to the SAD (shared-inbox added none).
>
> — `CLAUDE.md §Rules, Tenancy, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> | Tenancy | Every new table carries `workspace_id`, and every repository method takes it. The interceptor and the redeem look up by `(workspace_id, …)`, with the workspace id coming from the authenticated webhook's bot. **New controlled exception (the sixth):** *workspaces with a live Telegram link*, read only by the `notifications.schedule-pings` cron backstop, like *bots due for a health check*. It returns workspace ids only, and every later read in the job is scoped by that id. CLAUDE.md and the architecture map list it after this feature. | `CLAUDE.md`, [ADR-0005](adr/0005-decide-pings-in-a-per-workspace-sweep-every-20-s-with-a-per-period-ledger-written-before-the-send.md) |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

> - Interceptor, one read per private update: `(workspace_id, telegram_user_id)` among live rows, then a compare of `telegram_bot_id` (flow 11, ADR-0003) → `telegram_links_live_workspace_id_telegram_user_id_key`.
> - My notification state, Disconnect `FOR UPDATE`, and send-time "link still live" (flows 8, 9, 18, 1): `(workspace_id, account_id)` live → the live-link index on `(workspace_id, account_id)`, or the full index.
> - Bot-connected hook: live links of W whose bot id differs (flow 16) → the same workspace prefix (assumption 9).
> - Cron backstop, *workspaces with a live Telegram link*: the sixth controlled tenancy exception (SAD §8, ADR-0005). `SELECT DISTINCT workspace_id … WHERE removed_at IS NULL` → index-only scan of a live partial index.
> - Notice spacing, outcome write, answer-job lookup and clear: by PK, with `workspace_id` as a filter.
>
> — `data-model.md §Entities telegram_links, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> - Redeem, a plain read by hash and then `FOR UPDATE` by PK (flow 2) → `connect_links_workspace_id_token_hash_key`.
> - Issue under the `connect-links:<ws>:<account>` advisory lock (flow 8): count this member's links with `created_at > now − 10 min`, take the oldest for the retry time, mark the unused one replaced. Deactivation marks the unused ones replaced (flow 15) → `connect_links_workspace_id_account_id_created_at_idx`.
>
> — `data-model.md §Entities connect_links, access patterns, verbatim` · full text: [data-model.md](../data-model.md)

> - so that "notifications off" can find its recipient, a link **the member removed** keeps `telegram_user_id` after `removed_at` until that job has finished (sent, blocked, bot not working or given up). The job then clears it. `telegram_links_telegram_user_id_check` allows this only for `removed_reason = 'member'`;
>
> — `data-model.md §Assumptions, 3, telegram user id after removal, verbatim` · full text: [data-model.md](../data-model.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

| Table | Columns this task reads / writes |
|---|---|
| `telegram_links` | all; live = `removed_at IS NULL`; removal sets `removed_at`, `removed_reason`, clears `display_name` and (unless `member`) `telegram_user_id`; conditional notice `UPDATE … WHERE last_notice_at IS NULL OR last_notice_at < now − 1 h` |
| `connect_links` | all; `usable` re-check under `FOR UPDATE`; `used_at`, `replaced_at` |

— `data-model.md §Entities telegram_links + connect_links, abridged` · full text: [data-model.md](../data-model.md)

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-05 — error

> **Given** a member who opens a connect link
> **When** the link is older than 10 minutes, was already used, was replaced by a newer link, or belongs to a member who has since been deactivated
> **Then** nothing is linked. The bot answers that the link has expired and that a new one is in the panel. The panel of the member who asked for it still shows "Not connected". The attempt creates no contact and no conversation.
>
> — `spec.md §5, AC-05, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — domain invariant

> **Given** an operator of "Acme Flowers" who is already connected, or a Telegram account that is already connected to another member of "Acme Flowers"
> **When** they open a new connect link in a different Telegram account, or a teammate opens their own connect link from that same Telegram account
> **Then** nothing changes. A member has at most one Telegram link per workspace, and a Telegram account is linked to at most one member of a workspace. The bot answers that this Telegram account cannot be connected and why ("already receives notifications for another member of Acme Flowers" / "you are already connected from another Telegram account — disconnect it in the panel first"). An existing link is never replaced silently. A connected member who opens a new connect link from the Telegram account they are already connected with is told "you are already connected", and the link is used up. While a member is connected, the panel offers "Disconnect" and no connect link. Connecting another Telegram account means disconnecting first.
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-12 — authorization

> **Given** a person who is not an active member of "Acme Flowers": an account of another workspace, a deactivated member, someone not signed in, or a Telegram user who got hold of a connect link
> **When** they try to get a connect link for "Acme Flowers", see or remove a member's Telegram link, or use a link issued to someone else
> **Then** the system refuses and changes nothing. An account of another workspace gets no hint that the workspace exists. A deactivated member gets the access-removed notice. Someone not signed in is asked to sign in first. A connect link works only for the membership it was issued to, only once and only for 10 minutes (AC-05). A member sees and removes only their own Telegram link. A business owner sees which members are connected ("Telegram pings on/off" in Team) but cannot link or unlink for them, and never sees the Telegram account itself. A ping opened by someone else leads to the panel's sign-in and the workspace's usual access rules. Only an active member of "Acme Flowers" reaches the conversation.
>
> — `spec.md §5, AC-12, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] `telegramLinkRepo`: `findLiveByAccount(ws, account, { lock? })`, `findLiveByTelegramUser(ws, userId)`, `listLive(ws)`, `insert`, `remove(ws, id, reason, at)`, `markBlocked` / `clearBlocked`, `claimNotice(ws, id, now)`, `clearRemovedUserId(ws, id)`, `listLiveWithOtherBot(ws, botId)`, and `workspacesWithLiveLink()` — the **sixth controlled exception**, workspace ids only, for the cron — `apps/api/src/modules/notifications/infra/telegram-link-repo.ts`
- [ ] `connectLinkRepo`: `findByHash(ws, hash)`, `lockById(ws, id)`, `countSince(ws, account, since)` + oldest, `markUnusedReplaced(ws, account, at)`, `insert`, `markUsed` — `apps/api/src/modules/notifications/infra/connect-link-repo.ts`
- [ ] Advisory lock helper `connect-links:<ws>:<account>` (`hashtextextended`) — same file
- [ ] Integration tests: every method isolated with `twoWorkspacesWithLinks`; the exception read returns both workspaces' ids and nothing else — `apps/api/src/modules/notifications/infra/repos.int.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Same Telegram user live in two workspaces | each lookup returns only its own workspace's link |
| Two concurrent `claimNotice` within the hour | exactly one returns true |
| Removal for `deactivated` / `bot_replaced` | Telegram id and name cleared in the same statement |
| Removal for `member` | name cleared, Telegram id kept until `clearRemovedUserId` |

## Definition of Done

- [ ] Integration tests prove every telegram-link and connect-link repository method against Postgres, each one refusing to see the other workspace of twoWorkspacesWithLinks, the conditional notice claim gives one winner, removals clear the right columns per reason, and workspacesWithLiveLink returns workspace ids only.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
