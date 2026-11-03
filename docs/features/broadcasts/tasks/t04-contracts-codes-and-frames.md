---
id: T4
title: "Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet"
layer: "ports"
deps: ["T1"]
blocks: ["T7", "T13", "T16", "T29", "T37", "T38"]
acs: ["AC-02", "AC-11", "AC-14", "AC-16"]
files_hint: ["packages/shared/src/broadcasts.ts", "packages/shared/src/broadcasts.test.ts", "packages/shared/src/errors.ts", "packages/shared/src/contacts.ts", "packages/shared/src/inbox.ts", "packages/shared/src/index.ts", "apps/api/src/platform/errors.ts", "apps/api/src/platform/realtime.ts", "apps/api/src/modules/inbox/infra/hub.ts", "apps/web/src/features/attention/store.ts", "apps/web/src/features/inbox/store.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet

## Place in the sequence

- **Blocked by:** T1 — Add the shared broadcast text and name rules: trim both ends, 1–4096 UTF-16 code units for the text, 1–80 graphemes for the name, and the "Copy of …" cut · **Blocks:** T7 — Record reachability in contacts: capture's upsertFromProfile takes the receiving bot's Telegram id and writes "wrote" (clearing an older block), recordBlockChange applies a block or unblock only when newer, and contact.changed reach fires only when a mark changed, T13 — Add broadcast items to conversations: recordBroadcastItem in the outcome transaction without touching any conversation column, the thread kind broadcast in the keyset order, one-item reads and conversation.changed with item type broadcast, T16 — Add the broadcasts draft use cases: ports, the broadcast.changed publisher, create, save name and text against the version, save the tag audience or switch the kind against the confirmed group size, and delete by the author or a business owner, T29 — Add the web broadcasts API source and stores: the list store, the draft store (save as you go, one save in flight against the shown version, the stale-save merge, group adds and removes one by one) and the report store (totals plus one 50-recipient page, one fetch at a time), with the broadcast.changed subscriptions, T37 — Render the broadcast item in the inbox thread (SCR-02): BroadcastItem as a new ThreadItemView kind with the name linking to the broadcast, the launching owner, the text and the delivered or not-confirmed time, inserted live without touching read state or attention, T38 — Show the blocked mark on Contacts (SCR-18) and the profile (SCR-19), re-read live on contact.changed reach · **Wave:** 2 — after T1.
- **Lane:** shares `packages/shared/src/index.ts` with T1; shares `apps/web/src/features/inbox/store.ts` with T37 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to write a broadcast's text and choose its audience by contact tags, seeing how many contacts it would reach
> **So that** the team can prepare a message for a group of customers before anyone sends it
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It fixes the shapes both sides speak — request and response bodies, the eleven refusals and the three live frames — so the report, the blocked marker and the thread item can update live and every refusal can be shown in place.

## Inlined context

> - **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
> - **Errors:** throw `ValidationError` / `NotFoundError` / `ForbiddenError` / `ConflictError` / `UnauthenticatedError` / `TooManyRequestsError` (or a specific-code subclass …) from `src/platform/errors.ts`. … codes are declared in `packages/shared/src/errors.ts`.
>
> — `CLAUDE.md §Rules, Contracts + Errors, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

> 2. **Error code ↔ repo error definition** *(core)* — … The eleven new codes are this contract's proposal: ten named by sad.md §8 (…) and `BROADCAST_NOT_ENDED` (F-2). `implement` adds them to `ErrorCode`, to `platform/errors.ts` (`BroadcastLaunchLimitReachedError` with `Retry-After`, after `ChangeLimitReachedError`) and the zod refusal schemas to `packages/shared/src/broadcasts.ts` (sad.md §5).
>
> — `contracts/api-sync-report.md §Drift check, point 2, abridged` · full text: [api-sync-report.md](../contracts/api-sync-report.md)

> - Socket frames: `LiveFrame` in `packages/shared/src/inbox.ts` gains `BroadcastChangedFrame` (`change: z.enum(['draft','group','status','report','deleted'])`); `ContactChangedFrame.change` becomes `z.enum(['tags','reach'])`; `ConversationChangedFrame.item.type` gains `'broadcast'`, with a refine that a broadcast item is `created` only (as `activity`). All non-strict like the existing frames.
> - Signals: `realtimeSignalSchema` in `apps/api/src/platform/realtime.ts` gains `broadcast.changed` and the widened enums. The hub (`modules/inbox/infra/hub.ts`) maps each to its frame for every socket of the workspace.
>
> — `contracts/events.md §Schema registry, verbatim` · full text: [events.md](../contracts/events.md)

> 1. **`broadcast.changed` goes to every socket of the workspace.** Both roles see every broadcast and report (spec §1), so it is not account-scoped. The hub forwards it like `tags.changed`.
> 5. **`conversation.changed` for a broadcast item is `change: "created"` only**: an item is never edited. The inbox list and the attention store ignore it (ADR-0010); only a tab with that conversation open refetches it.
>
> — `contracts/events.md §Assumptions, 1 and 5, verbatim` · full text: [events.md](../contracts/events.md)

> - **Thread and Contacts:** the inbox thread renders a new item kind `broadcast` (SCR-02). The attention store ignores `conversation.changed` frames whose item is a broadcast (§5, [ADR-0010]). …
>
> — `sad.md §4, UI architecture, Thread and Contacts, abridged` · full text: [sad.md](../sad.md)

> - **Old bundles:** a tab opened before the deploy parses `LiveFrame` without these values, so the frames fail `safeParse` and are ignored (the existing "unknown → ignore" rule).
>
> — `contracts/events.md §Frame conversation.changed, Old bundles, abridged` · full text: [events.md](../contracts/events.md)

> As before, no frame, signal or job payload carries content: ids and a change kind only. No broadcast text, contact name, username or chat id travels on the bus, the socket or the job queue.
>
> — `contracts/events.md §intro, verbatim` · full text: [events.md](../contracts/events.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

- **Schemas to add in `packages/shared/src/broadcasts.ts`** (each `x-delta: added` in openapi.yaml `components/schemas`): the names / constants (`BroadcastName`, `BroadcastText`, `RawBroadcastName`, `RawBroadcastText`, `BroadcastStatus`, `AudienceKind`, `AudienceTagKind`, `EndReason`, `RecipientState`, `RecipientFailureReason`, `AudienceFingerprint` = 64 lowercase hex); audience and breakdown (`AudienceTag`, `Draft*/Launched*Audience`, `DraftBreakdown` with `reach: null` when no bot, `LaunchBreakdown`, `RecipientTotals`); broadcasts (`BroadcastListItem`, `BroadcastList`, `BroadcastDraft`, `LaunchedBroadcast`, `Broadcast`); group (`GroupContactCard` … `BroadcastGroupMatchingAdded`); requests (`BroadcastCreate`, `BroadcastFieldsSave`, `BroadcastAudienceSave`, `BroadcastDuplicate`, `BroadcastLaunch`); answers (`LaunchConfirmation`, `BroadcastLaunched`, `BroadcastStopped`, `BroadcastDeleted`, `RecipientContact`, `BroadcastRecipient`, `BroadcastRecipientPage`); refusal bodies (`Broadcast*Error`, each with its `details`).
- **Changed shared schemas:** `ContactRow` / `ContactProfile` gain `blocked_since: string(date-time) | null` (`packages/shared/src/contacts.ts`); `ThreadItem` gains `ThreadBroadcastItem { type: 'broadcast', id, workspace_id, conversation_id, broadcast_id, broadcast_name, text, launched_by: MemberRef, state: delivered | not_confirmed, position_at }` (`packages/shared/src/inbox.ts`).
- **Codes (`ErrorCode`)**: `BROADCAST_NAME_INVALID` 400, `BROADCAST_TEXT_INVALID` 400, `BROADCAST_DRAFT_CHANGED` 409, `BROADCAST_GROUP_CHANGED` 409, `BROADCAST_NOT_A_DRAFT` 409, `BROADCAST_NOT_ENDED` 409, `BROADCAST_AUDIENCE_CHANGED` 409, `BROADCAST_AUDIENCE_TOO_LARGE` 409, `BROADCAST_NO_REACHABLE_CONTACT` 409, `BROADCAST_NEEDS_WORKING_BOT` 409, `BROADCAST_LAUNCH_LIMIT_REACHED` 429 (`details { limit: 10, window_hours: 24, next_launch_at }` + `Retry-After` in whole seconds).
- **Frames:** `broadcast.changed { type, v: 1, workspace_id, broadcast_id, change: draft | group | status | report | deleted }` → every socket of the workspace; `contact.changed.change` gains `reach`; `conversation.changed.item.type` gains `broadcast` (`created` only).

— `contracts/openapi.yaml §components/schemas (lines 1737–2533) + ErrorCode + LaunchLimitReached, abridged`; `contracts/events.md §Channel: live socket, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-02 — error

> **Given** an operator editing a draft broadcast of "Acme Flowers"
> **When** they leave the name empty or make it longer than 80 characters, leave the text empty or only spaces, or make it longer than Telegram allows for one message
> **Then** the draft keeps its last valid content, nothing is sent, and the editor says next to the field that a name must be 1 to 80 characters, or that the text must be 1 to 4096 characters as Telegram counts them; the remaining length is shown while typing, counted the way Telegram counts it, so an emoji-heavy text is never accepted by the editor and then refused by Telegram for its length
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — cross-context

> **Given** "Olena K.", whose conversation is closed, unassigned and not waiting for a reply, received the broadcast "Spring prices"
> **When** an operator opens her conversation in the inbox, and then she answers the broadcast in Telegram
> **Then** the thread shows the broadcast at the time it was delivered as a broadcast item — its text, its name and the business owner who launched it (still named if that owner was deactivated since) — distinct from the team's replies; a recipient whose send ended "not confirmed" also gets the item, marked "not confirmed" and placed at the time the send was made; receiving it did not reopen the conversation, did not change its assignee, its "waiting for a reply" marker, any unread or attention count, and triggered no ping; her answer is captured as a customer message as before: it reopens the conversation and counts for unread, "waiting for a reply" and pings like any message; a recipient whose broadcast failed for any other reason, was stopped before their turn, or who was left out gets no broadcast item
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Red: parse every `examples` value of openapi.yaml's broadcasts operations and refusal schemas through the new zod schemas; refuse an unknown `change`, a 63-char fingerprint, a `failed` recipient without reason — `packages/shared/src/broadcasts.test.ts`
- [ ] Green: zod schemas + inferred types — `packages/shared/src/broadcasts.ts`; `blocked_since` — `packages/shared/src/contacts.ts`; `ThreadBroadcastItem`, `BroadcastChangedFrame`, widened frames with the created-only refine — `packages/shared/src/inbox.ts`; exports — `packages/shared/src/index.ts`
- [ ] The eleven codes — `packages/shared/src/errors.ts`; `AppError` subclasses with their status (and `BroadcastLaunchLimitReachedError` setting `Retry-After`) + `errors.test.ts` cases — `apps/api/src/platform/errors.ts`
- [ ] `realtimeSignalSchema` gains the three signals (ids only, ≤ 1000 bytes) — `apps/api/src/platform/realtime.ts` (+ `realtime.test.ts`)
- [ ] Hub maps `broadcast.changed` and the widened signals to frames for every socket of the workspace — `apps/api/src/modules/inbox/infra/hub.ts`
- [ ] Web: the inbox list store and the attention store ignore `conversation.changed` with `item.type: broadcast` (tests: no list refetch, no attention refetch, no mark-read); other new frames pass through as unhandled — `apps/web/src/features/inbox/store.ts`, `apps/web/src/features/attention/store.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| `conversation.changed` broadcast with `change: edited` | refused by the refine (a broadcast item is `created` only) |
| frame of another workspace | dropped by the existing workspace check |
| old bundle receives `broadcast.changed` | fails `safeParse`, ignored (accepted for the deploy window) |
| `ContactRow` without `blocked_since` from an old server | refused (required, nullable) — server and web ship together |
| refusal body with `details` missing for `BROADCAST_LAUNCH_LIMIT_REACHED` | schema refuses; the error handler always sends `next_launch_at` |

## Definition of Done

- [ ] packages/shared and platform unit tests parse every contract example of openapi.yaml and events.md (including the refusal bodies with their details), map each BROADCAST_* code to its status and AppError subclass (BROADCAST_LAUNCH_LIMIT_REACHED as 429 with Retry-After), accept broadcast.changed with each change kind and refuse an unknown one, refuse a broadcast conversation.changed whose change is not created, and the hub forwards the three signals to every socket of the workspace; web store tests prove the inbox list and the attention store ignore a conversation.changed whose item type is broadcast.
- [ ] `pnpm -r build` type-checks api and web with the widened unions (no exhaustive switch left without the new members).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T4): `ContactRow` / `ContactProfile.blocked_since` is required (nullable) as the contract says, so the contacts use cases (`apps/api/src/modules/contacts/app/contacts.ts`) answer `blocked_since: null` until T9 reads the current bot's mark, and the web contact test fixtures gained `blocked_since: null`. Kept the gate green without weakening the schema.
- `implement` (T4): `ThreadItemView` returns `null` for a `broadcast` item until T37 renders `BroadcastItem`; no broadcast item reaches a thread before T13/T25.
- `implement` (T4): the tag-audience request refinements (`"No tags"` with tags → `tag_ids`; a tag both chosen and left out → `exclude_tag_ids`; repeated ids) and `BroadcastGroupAddMatching` (`none` + tags → `tag_ids`) live in the shared zod schemas, so the routes answer `VALIDATION_ERROR` with the contract's `details.field`.
- `implement` (T4): `BROADCAST_LAUNCH_LIMIT_REACHED`'s message names the wait in minutes (the panel formats `next_launch_at` itself); the contract example's wording "at 14:20" is illustrative.
