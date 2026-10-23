---
id: T29
title: "Add the web broadcasts API source and stores: the list store, the draft store (save as you go, one save in flight against the shown version, the stale-save merge, group adds and removes one by one) and the report store (totals plus one 50-recipient page, one fetch at a time), with the broadcast.changed subscriptions"
layer: "ui"
deps: ["T4"]
blocks: ["T30"]
acs: ["AC-01", "AC-03", "AC-11"]
files_hint: ["apps/web/src/features/broadcasts/api.ts", "apps/web/src/features/broadcasts/list-store.ts", "apps/web/src/features/broadcasts/list-store.test.ts", "apps/web/src/features/broadcasts/draft-store.ts", "apps/web/src/features/broadcasts/draft-store.test.ts", "apps/web/src/features/broadcasts/report-store.ts", "apps/web/src/features/broadcasts/report-store.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T29 — Add the web broadcasts API source and stores: the list store, the draft store (save as you go, one save in flight against the shown version, the stale-save merge, group adds and removes one by one) and the report store (totals plus one 50-recipient page, one fetch at a time), with the broadcast.changed subscriptions

## Place in the sequence

- **Blocked by:** T4 — Add the broadcasts zod contracts, the eleven BROADCAST_* error codes, the broadcast.changed frame and signal, the widened contact.changed (reach) and conversation.changed (broadcast) frames with their hub mapping, and keep the web stores ignoring what they do not handle yet · **Blocks:** T30 — Build SCR-24, the Broadcasts list: BroadcastsTable with statuses, audience sizes and last change, the empty state with New broadcast, the Broadcasts navigation item, the broadcast routes and BroadcastCrumb · **Wave:** 3 — after T4.
- **Lane:** own lane.

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

It gives every broadcasts screen one place to read, save and stay live, so drafts save against the version shown and the report and list follow sending without a reload.

## Inlined context

> - **Stores:** `features/broadcasts/` with a list store (SCR-24), a draft store (SCR-25/26/27/31/32: fields saved as they change against the shown version, the member's own unsaved edit kept beside a teammate's version on a stale answer, group adds and removes sent one by one) and a report store (SCR-28/29/30: totals plus one 50-recipient page with an outcome filter). They subscribe to the frame's live socket and refetch on `broadcast.changed` frames ([ADR-0011](../adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md)).
>
> — `sad.md §4, UI architecture, Stores, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. At most one report signal per broadcast per second plus a refetch of about 50 ms keeps the shown report within ~1.5 s of the newest outcome, inside the 3 s target, at a fixed cost per tab. Paging keeps every read small at 10 000 recipients. The contract stays ids-only.
>
> — `adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md §Decision outcome, ADR-0011, verbatim` · full text: [ADR-0011](../adr/0011-push-broadcast-changes-as-id-only-signals-coalesced-to-once-per-second-and-page-the-report.md)

> - drop a frame of another workspace;
> - the Broadcasts list (SCR-24) re-reads `listBroadcasts` on any change (one fetch in flight; a frame during a fetch schedules one more);
> - an open broadcast page (SCR-28) of `broadcast_id` re-reads `getBroadcast` and its current `listBroadcastRecipients` page on `report` and `status`, one fetch at a time (flow 11);
> - an open draft editor (SCR-25) of `broadcast_id`: on `status` it re-reads `getBroadcast` and switches to the read-only page (a teammate launched it); on `deleted` it shows the not-found card; on `draft` / `group` from a teammate it does **not** refetch (counts are not pushed live, ux-flows) — the next save answers with the current draft or `BROADCAST_DRAFT_CHANGED`;
> - the group picker and the dialogs ignore it.
>
> — `contracts/events.md §Frame: broadcast.changed, Panel reaction, verbatim` · full text: [events.md](../contracts/events.md)

> 3. **Save as you go** (ux-flows): the name saves on blur and 800 ms after the last keystroke; the text 800 ms after the last keystroke and on blur; each save carries the `version` the editor holds, and the answer's draft replaces it (version, breakdown). One save in flight per draft; a change made meanwhile is sent after it with the new version. A status line under the title reads «Saving…», «Saved», or «Couldn't save — Retry». The audience saves at once on each choice.
>
> — `screens.md §Decisions taken at this stage, 3, verbatim` · full text: [screens.md](../screens.md)

> - A stale save (`BROADCAST_DRAFT_CHANGED`) applies the teammate's version to the fields the member did not touch, and for the field they were editing shows both texts (Decision 3, AC-03); it never silently overwrites.
>
> — `screens.md §Assumptions, stale save, verbatim` · full text: [screens.md](../screens.md)

> | `resync` / reconnect | the re-reads of the rows above for whatever is open |
> | a background re-read fails (network / `500`) | what is shown stays; the next frame or resync asks again; no error shown |
> | `401 UNAUTHENTICATED` on any broadcasts route | … an unsent edit in the editor is kept in the draft store for the same address |
>
> — `screens.md §Screens, Shared states, abridged` · full text: [screens.md](../screens.md)

> **Contracts:** request/response bodies are zod schemas in `packages/shared`, validated by `fastify-type-provider-zod`; the web client parses responses with the same schemas (`apps/web/src/shared/api/client.ts`).
>
> — `CLAUDE.md §Rules, Contracts, verbatim` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Calls, each response parsed with its `packages/shared/src/broadcasts.ts` schema (T4) through `shared/api/client.ts`:

- `GET …/broadcasts` → `BroadcastList`; `POST …/broadcasts` `BroadcastCreate { name, text? }` → `201 Broadcast`; `GET …/broadcasts/{id}` → `BroadcastDraft | LaunchedBroadcast`.
- `POST …/save` `{ expected_version, name?, text? }` and `POST …/audience` (`TagAudience { expected_version, kind: tags, mode, tag_ids, exclude_tag_ids, expected_group_size? }` | `{ expected_version, kind: group }`) → `200 BroadcastDraft`; errors `400 BROADCAST_NAME_INVALID` / `BROADCAST_TEXT_INVALID`, `404 TAG_NOT_FOUND`, `409 BROADCAST_DRAFT_CHANGED` (`details.draft`), `409 BROADCAST_GROUP_CHANGED` (`details.group_size`), `409 BROADCAST_NOT_A_DRAFT`.
- Group: `GET …/group` (`after`) → `BroadcastGroupPage`; `GET …/group/membership` → `BroadcastGroupMembership`; `POST …/group/contacts { contact_id }` and `POST …/group/contacts/{contactId}/remove` → `BroadcastGroupChange { outcome: added | removed | unchanged, group_size }`; `GET …/group/matching` → `BroadcastGroupMatching`; `POST …/group/add-matching { q?, mode, tag_ids, expected_count }` → `BroadcastGroupMatchingAdded`; errors `409 BROADCAST_AUDIENCE_TOO_LARGE`, `409 BROADCAST_DRAFT_CHANGED`, `409 BROADCAST_NOT_A_DRAFT`.
- Also wrapped here for the dialogs: `POST …/delete`, `POST …/duplicate`, `GET …/launch-confirmation`, `POST …/launch`, `POST …/stop`, `GET …/recipients` (`state?`, `after`) → `BroadcastRecipientPage`.
- Frames: `broadcast.changed { workspace_id, broadcast_id, change: draft | group | status | report | deleted }` and `resync` via the frame's live socket.

— `contracts/openapi.yaml, operationIds listBroadcasts … listBroadcastRecipients, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml); `contracts/events.md §Frame: broadcast.changed, abridged` · full text: [events.md](../contracts/events.md)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
> **When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
> **Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — error

> **Given** two members of "Acme Flowers" with the same draft open
> **When** one changes the text or the audience and saves, and then the other saves a change made on the older version; or both add and remove contacts in the draft's group at the same moment
> **Then** the second text or audience change is not saved over the first: that member is told that a teammate changed the draft and is shown the current version to apply their change again; group additions and removals by both members are each kept (a contact added by one and not removed by the other stays in the group), so no one's additions silently disappear, and adding or removing group contacts never makes a teammate's text or name save count as stale
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] API functions over `shared/api/client.ts`, one per operation, each parsing its shared schema — `apps/web/src/features/broadcasts/api.ts`
- [ ] List store keyed by workspace: `listBroadcasts`, re-read on every `broadcast.changed` of the workspace and on `resync`, one fetch in flight plus one queued — `apps/web/src/features/broadcasts/list-store.ts`
- [ ] Draft store keyed by broadcast id: the held draft (version, fields, audience, breakdown), the save queue (one in flight; a change made meanwhile replayed with the answer's version), status `saving | saved | failed`, the stale state from `details.draft` keeping the member's own value of the touched field, group page + membership + add / remove / matching / add-matching calls one by one, `status` → re-read and mark launched, `deleted` → gone; `draft` / `group` frames ignored — `apps/web/src/features/broadcasts/draft-store.ts`
- [ ] Report store keyed by broadcast id: `getBroadcast` totals + one `listBroadcastRecipients` page (50, optional state filter, `after` for Show more), re-read on `report` / `status` one fetch at a time — `apps/web/src/features/broadcasts/report-store.ts`
- [ ] A failed background re-read keeps what is shown; a 401 keeps an unsent edit in the draft store for the same address — same files
- [ ] Store unit tests per frame kind and per save outcome, including frames of another workspace dropped — `list-store.test.ts`, `draft-store.test.ts`, `report-store.test.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| a frame arrives while the list is fetching | one more fetch is queued, never two in parallel |
| `broadcast.changed { draft }` from a teammate on the open draft | ignored; the next own save answers with the current draft or `BROADCAST_DRAFT_CHANGED` |
| the member types while a save is in flight | the change is sent after the answer with the new version, not in parallel |
| `409 BROADCAST_DRAFT_CHANGED` | the teammate's version is applied to untouched fields; the touched field keeps the member's value aside for **Use mine** / **Keep theirs** |
| `409 BROADCAST_NOT_A_DRAFT` on a save | the store marks the broadcast launched; SCR-25 switches to SCR-28 |
| a background re-read fails | what is shown stays; no error shown |
| a frame of another workspace | dropped |

## Definition of Done

- [ ] Store unit tests prove each broadcast.changed frame triggers exactly the re-reads screens.md lists (list on any change with one fetch in flight and one queued, the report on report and status one fetch at a time, the open draft only on status and deleted), that the draft store sends one save at a time with the version it holds and replays a change made meanwhile on the new version, that BROADCAST_DRAFT_CHANGED keeps the member's own edit beside the teammate's version, and that frames of another workspace are dropped.
- [ ] A store test proves a `report` frame during an in-flight report fetch leads to exactly one more fetch after it, and that a `group` frame never re-reads the open draft.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
