---
id: T27
title: "Add the API end-to-end broadcasts stories, the cross-workspace and secrecy suite, the broadcastIntegrity run-book queries and the live-push assertions"
layer: "tests"
deps: ["T26"]
blocks: ["T39"]
acs: ["AC-06", "AC-08", "AC-09", "AC-11", "AC-13", "AC-14", "AC-16", "AC-18"]
files_hint: ["apps/api/src/e2e/broadcasts-flows.int.test.ts", "apps/api/src/e2e/broadcasts-tenancy.int.test.ts", "apps/api/src/e2e/helpers.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "done"
step: "COMMIT"
---

# T27 — Add the API end-to-end broadcasts stories, the cross-workspace and secrecy suite, the broadcastIntegrity run-book queries and the live-push assertions

## Place in the sequence

- **Blocked by:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Blocks:** T39 — Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate "did not reach", the broadcast item in the thread, the blocked marker, and the operator's missing launch · **Wave:** 9 — after T26.
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to see the final number of recipients and the text one last time, then launch the broadcast
> **So that** the message goes out once, to the customers I confirmed, from the workspace's bot
>
> — `spec.md §4, US-03, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to follow a launched broadcast's progress and see for each recipient whether it was delivered, failed (and why) or could not arrive because they blocked the bot
> **So that** I know how many customers it really reached and whom it did not
>
> — `spec.md §4, US-04, verbatim` · full text: [spec.md](../spec.md)

It proves end to end, through the real routes, the real sending chain and the fake Bot API, that a launch sends exactly the confirmed recipients once, that the report and the thread tell the truth, and that nothing crosses a workspace.

## Inlined context

> **When:** a launch is confirmed twice at once, the process is killed mid-send, a send gets no answer, or members try every edit path on a launched broadcast. **Then:** at most once per recipient "0 recipients sent the same broadcast twice, including after a restart mid-send or a double launch"; frozen recipients "0 changes to a launched broadcast's text or recipient list"; the recipient list equals the set the confirmation fingerprinted (AC-06). **How verify:** integration tests: two concurrent launches (one launched, one returned); kill a link between claim and outcome, then run the next link (the recipient ends not confirmed, the fake records one send); a fake send that never answers (not confirmed, never resent); each edit route on a launched broadcast → `BROADCAST_NOT_A_DRAFT`; a retag between confirmation and launch → `BROADCAST_AUDIENCE_CHANGED`; the `broadcastIntegrity` run-book queries.
>
> — `sad.md §10, QG-3, abridged` · full text: [sad.md](../sad.md)

> | Integrity run book | `apps/api/src/e2e/helpers.ts` gains `broadcastIntegrity.*`: recipients with more than one broadcast item; recipients still `sending` with no active link; launched broadcasts whose recipients were created after `launched_at`; recipients or group rows whose contact belongs to another workspace; more than 10 launches in any 24 h per workspace; delivered or not confirmed recipients without a broadcast item | here |
>
> — `sad.md §8, Integrity run book, verbatim` · full text: [sad.md](../sad.md)

> - launched broadcasts whose `recipient_count` differs from their recipient rows;
> - recipients `delivered` / `not_confirmed` with no broadcast item for their contact's conversation (the SAD's last item), joined through `conversations_contact_id_key`.
>
> — `_audit/data-model-2026-10-23.md §New integrity queries, two added, verbatim` · full text: [audit](../_audit/data-model-2026-10-23.md)

> | Tenancy | every new table has a non-null `workspace_id` and composite foreign keys `(workspace_id, …)` to `contacts`, `memberships`, `broadcasts` and `conversations`; every repository method takes `workspaceId`; each repository has a cross-workspace isolation test. The sender job carries its workspace id; `sendBroadcastMessage` takes the workspace id and the expected Telegram bot id. **No new tenancy exception** (the six stay six) | CLAUDE.md; ADR-0007 |
>
> — `sad.md §8, Tenancy, verbatim` · full text: [sad.md](../sad.md)

> | Logging | pino structured logs. Never the broadcast text, contact names, usernames, chat ids or the token; ids, counts, states and reasons only. The group picker's search text is masked in request logs, like the Contacts search | CLAUDE.md, contacts SAD §8, here |
>
> — `sad.md §8, Logging, verbatim` · full text: [sad.md](../sad.md)

> As before, no frame, signal or job payload carries content: ids and a change kind only. No broadcast text, contact name, username or chat id travels on the bus, the socket or the job queue (sad.md §8 *Logging*, *Events*).
>
> — `contracts/events.md, intro, verbatim` · full text: [events.md](../contracts/events.md)

> Every route sits behind the workspace-access guard: a caller who was never a member gets `404 NOT_FOUND` with no hint, a deactivated member `403 ACCESS_REMOVED`, a signed-out caller `401 UNAUTHENTICATED` (AC-08). A broadcast, contact or tag id is always looked up together with the workspace id, so a foreign id is not found, and the composite foreign keys make a cross-workspace group row, recipient or item impossible.
>
> — `contracts/openapi.yaml, info.description, guard, verbatim` · full text: [openapi.yaml](../contracts/openapi.yaml)

> | `broadcast.changed` v1 | `workspace_id`, `broadcast_id`, `change` | every socket of `workspace_id`, as the frame above | […] | seeded 1, 2, 4; flows 5–15 |
> | `contact.changed` v1 | `workspace_id`, `contact_id`, `change: "reach"` | every socket of `workspace_id` | `contacts.recordBlockChange` from `bots` (a `my_chat_member` update, a reply or broadcast send refused as blocked) and capture's `upsertFromProfile` when it clears a block — only when a mark changed (assumption 4) | seeded 3; flows 12, 16 |
> | `conversation.changed` v1 | as before, `item.type: "broadcast"`, `change: "created"` | every socket of `workspace_id` | `conversations.recordBroadcastItem`, in the recipient's outcome transaction (delivered or not confirmed) and in the stale-in-flight resolution | seeded 2; flows 12, 14, 18 |
>
> — `contracts/events.md §Channel: realtime signals, added signals, abridged` · full text: [events.md](../contracts/events.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (reads every broadcasts table, `contact_bot_reach` and `broadcast_items` for the integrity queries).

## API contract

Drives, through `app.inject()` and a live socket: `createBroadcast`, `saveBroadcastFields`, `saveBroadcastAudience`, `addBroadcastGroupContact`, `addBroadcastGroupMatching`, `getLaunchConfirmation`, `launchBroadcast`, `getBroadcast`, `listBroadcastRecipients`, `stopBroadcast`, `duplicateBroadcast` (`not_reached`), `deleteBroadcast`, `listThreadItems` / `getThreadBroadcastItem`, `listContacts` / `getContact` (`blocked_since`), and `receiveTelegramUpdate` with a private `my_chat_member`. Expected refusals: `BROADCAST_NOT_A_DRAFT`, `BROADCAST_AUDIENCE_CHANGED`, `OWNER_ONLY`, `404` with no hint, `403 ACCESS_REMOVED`, `401`.

— `contracts/openapi.yaml §paths`, abridged · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-06 — happy path

> **Given** a business owner of "Acme Flowers" with the draft "Spring prices" whose audience would reach 36 contacts, and a working bot
> **When** they choose to launch it
> **Then** a confirmation shows the exact text as the customer will see it, the number of contacts it will be sent to (36), how many are left out because they blocked the bot or never wrote to the current bot (2), and a warning that customers who did not expect the message can block or report the bot, which can limit the bot for support too; on confirmation the recipient list is fixed to exactly the 36 contacts counted in the confirmation, the broadcast becomes "sending" for every member, records who launched it and when, and sending starts; if between opening the confirmation and confirming it the text, the audience or the set of contacts it would reach changed (even if their number is the same), nothing is launched and the owner is shown the current version and number to confirm again; choosing launch twice, or two business owners launching the same draft at the same moment, launches it once and sends each recipient one message
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-08 — authorization

> **Given** a person with no active membership in "Acme Flowers" — an account of another workspace, a deactivated member, or someone not signed in
> **When** they try to list, open, create, edit, duplicate, delete or launch a broadcast of "Acme Flowers", see its delivery report, or add a contact of "Acme Flowers" to a group of another workspace (or a contact of another workspace to a group of "Acme Flowers")
> **Then** the system refuses and changes nothing; an account of another workspace gets no hint that the workspace, the broadcast or the contact exists; a deactivated member gets the access-removed notice and a member deactivated while on the confirmation launches nothing; someone not signed in is asked to sign in first; a broadcast's audience, recipients and report only ever hold contacts of its own workspace, and the bot of one workspace never sends another workspace's broadcast
>
> — `spec.md §5, AC-08, verbatim` · full text: [spec.md](../spec.md)

### AC-09 — domain invariant

> **Given** "Acme Flowers" with the broadcast "Spring prices" launched to 36 recipients, a draft whose audience reaches nobody, and 10 broadcasts launched in the last 24 hours
> **When** a member tries to change the text, name or audience of "Spring prices", add or remove a recipient, or delete it; or teammates retag contacts, new customers write in, or a recipient unblocks the bot after the launch; or an owner tries to launch the empty draft or an 11th broadcast within 24 hours
> **Then** a launched broadcast cannot be changed or deleted — the page says it is read-only and offers to duplicate it — and its recipient list stays the 36 contacts fixed at launch whatever happens to tags and contacts afterwards; a draft that would reach nobody cannot be launched and says that its audience has no reachable contact; the 11th launch is refused and the owner is told that a workspace can launch at most 10 broadcasts in 24 hours and when the next launch is possible; every confirmed launch counts toward the 10, including one that was stopped or ended early, and a refused launch does not; drafts can still be created and edited
>
> — `spec.md §5, AC-09, verbatim` · full text: [spec.md](../spec.md)

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — happy path

> **Given** "Acme Flowers" with a draft "Wholesale catch-up" (a group of 14 contacts) and the sent broadcast "Spring prices" (tag audience; 33 delivered, 1 blocked the bot, 2 failed because the bot stopped working)
> **When** an operator duplicates the draft, and duplicates "Spring prices" choosing first "all recipients" and then "only recipients it did not reach"
> **Then** each duplicate is a new draft named "Copy of …" (shortened to fit 80 characters) with the same text, listed for every member, its author being the member who duplicated it, and the original is unchanged; the copy of the draft has the same group of 14 contacts; the copy of "Spring prices" with "all recipients" has a broadcast group of its 36 recipients, the one who blocked the bot counted as unreachable; "only recipients it did not reach" is offered once a broadcast has ended, and gives a group of the 2 who failed: it copies recipients who failed for a reason a new attempt can fix (the bot stopped working, Telegram refused the text, a Telegram error, stopped before their turn) and those marked "not confirmed" only after a warning that they may have received it, while recipients who were delivered, who blocked the bot or whose account no longer exists are not copied; a tag audience can also be duplicated as the same tags, evaluated again at the copy's launch; the copy is then edited and launched like any draft
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

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

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [x] `broadcastIntegrity` (the six SAD queries + the two audit ones) and their entries in `integrityViolations` — `apps/api/src/e2e/helpers.ts`
- [x] Story: draft (tag audience) → confirmation → launch → chain to sent; one fake `sendMessage` per recipient, plain text with no `parse_mode`, a broadcast item per delivered recipient, report totals, `broadcast.changed` / `conversation.changed` frames on a socket — `apps/api/src/e2e/broadcasts-flows.int.test.ts`
- [x] Stories: a `my_chat_member` kicked update and a broadcast send refused as blocked mark the contact (`blocked_since`, `contact.changed reach`, no message / unread / ping); stop mid-send; abort on a revoked token (`bot_stopped`); a killed link leaves one `not_confirmed` with its item; duplicate "did not reach"; double launch launches once — same file
- [x] Cross-workspace and secrecy: every operation with a foreign broadcast / contact / tag / item id answers `404` with no hint; group rows and recipients never hold another workspace's contact; no text, name, username or chat id in captured logs, frames or job payloads — `apps/api/src/e2e/broadcasts-tenancy.int.test.ts`
- [x] Run `integrityViolations` after each story and assert zero rows — both files

## Edge cases

| Case | Behaviour |
|---|---|
| two owners launch the same draft at once | one launch; the second answers the launched broadcast; one message per recipient (AC-06) |
| retag between confirmation and launch, same count | `409 BROADCAST_AUDIENCE_CHANGED`, nothing launched (AC-06) |
| link killed between claim and outcome | next link: `not_confirmed` with its item at the claim time; the fake recorded one send (AC-11, AC-16) |
| every edit route on a launched broadcast | `409 BROADCAST_NOT_A_DRAFT`; recipients unchanged (AC-09) |
| block notice for a linked member who is not a contact | no-op; never a recipient (AC-14) |
| a broadcast of workspace A while workspace B's bot is connected | B's bot never sends it (AC-08) |

## Definition of Done

- [x] The API e2e stories pass against Postgres and the fake Bot API: draft → launch → report → sent with one message per recipient and a broadcast item per delivered recipient, a my_chat_member block and a refused send marking the contact, stop mid-send, abort on a revoked token, duplicate "did not reach", the cross-workspace refusals with no hint, no text, name or chat id in logs, frames or job payloads, and every broadcastIntegrity query returns zero rows after each story. The stories also assert that a group removal changes nothing on the contact, that retags, new customers and an unblock after launch leave the recipient rows unchanged, that the recorded message carries only the text, and that a linked member's Telegram account is never a recipient (test plan).
- [x] every Hard Rule inlined above still holds
- [x] lint + vet clean (`pnpm lint`)

## Implementation notes

- `implement` (T27): `e2e/helpers.ts` — `broadcastIntegrity` with eight workspace-scoped ops queries, each also in `integrityViolations` (so every e2e suite runs them): 1 `sendingWithoutLink` (a `sending` recipient with no `broadcasts.send` job of its workspace `created` / `retry` / `active` in `pgboss.job`; with no pg-boss schema every `sending` row counts), 2 `recipientsWithTwoItems`, 3 `recipientsAfterLaunch` (recipients carry no `created_at`: the UUIDv7 id's millisecond time later than `launched_at` + 1 s — the launch mints the ids right after `launched_at`; fixtures that launch "in the past" trip it, so the stories pass `launchedAt: new Date()`), 4 `launchesOverCap` (the 11th launch in any 24 h), 5 `recipientCountMismatch` (audit), 6 `contactsAcrossWorkspaces` (recipients and group rows), 7 `outcomesWithoutItem` (delivered / not confirmed with no item on the contact's conversation — the SAD's last query as the audit refined it), 8 `itemsWithoutOutcome` (an item whose recipient is missing or in another state — "no item for failed, stopped, blocked"; the checklist's "six + two" counted the audit's refinement of the SAD's last query as a second one, so the eighth is this mirror check).
- `implement` (T27): `e2e/broadcasts-flows.int.test.ts` (6 stories, `buildApp()` + the real pg-boss chain + webhook + live socket + fake Bot API): (1) tag audience → confirmation (3 / 1 blocked / 2) → launch → sent; one plain `sendMessage` per recipient whose params are exactly `chat_id` + `text`; report; the thread item (name, text, launching owner) and its one-item read; Olena's closed conversation, Maria's, attention and pings unchanged; `broadcast.changed` status + report and `conversation.changed` broadcast frames with no text / name / chat id; a linked member's block notices and message make no contact and get no broadcast; after launch, retags, a new customer and an unblock leave the recipient rows equal; save / audience ×2 / group add / remove / add-matching / delete → 409 `BROADCAST_NOT_A_DRAFT`; her answer reopens and counts unread + attention. (2) `my_chat_member` kicked → `blocked_since` on profile and list, `contact.changed reach`, no message / conversation change / ping; a group by add + add-all-matching; a send refused as blocked marks the contact, no item for it; an unblock and a new message clear both marks and a new draft counts them reachable; removing from a group leaves profile and contact row equal. (3) stop mid-send: 8 sends held 3 s, operator `OWNER_ONLY`, owner stop → 4 stopped, the 8 finish delivered, no send after the stop, second stop `unchanged`, "did not reach" copies the 4. (4) a 401 mid-send → `sent` / `bot_stopped`, failed `bot_stopped`, "did not reach" = the failed. (5) a killed link (fixture: one `sending` claimed 30 s ago) resolved by the next link → `not_confirmed`, item at the claim time, never sent; a send with no answer → `not_confirmed`, item at `claimed_at`, never resent. (6) a same-count retag → 409 `BROADCAST_AUDIENCE_CHANGED` (current confirmation in `details.confirmation`), nothing launched; two owners at once → `launched` + `already_launched`, one message each.
- `implement` (T27): `e2e/broadcasts-tenancy.int.test.ts` (10 tests): every broadcasts route ×3 foreign broadcasts, own group + foreign contact (both), foreign conversation / item in the inbox reads, for owner and operator — the answer equals the one for an id that exists nowhere (404 `NOT_FOUND`; an operator meets `OWNER_ONLY` on the owner-only trio before any lookup, also for a nowhere id — no hint), names no foreign id, writes nothing, no Telegram call; B's owner on A's routes 404; A and B launching at once each send only their own recipients through their own bot (a customer of both included); signed-out 401, a member deactivated after reading the confirmation → 403 `ACCESS_REMOVED`, nothing launched. Non-vacuity: each of the eight queries finds a planted violation inside a rolled-back transaction (constraints dropped where the schema forbids it). Secrecy: trace log, socket frames, raw `NOTIFY` payloads and `pgboss.job` payloads (keys only `workspace_id` / `broadcast_id`) carry no text, broadcast name, contact name, username, chat id or token across draft, picker search, launch, send, block, stop and duplicate.
- `implement` (T27): first run (RED classification for a test task over a built feature): 5 of 6 stories red, all **BAD red** (the test's assumptions, not the product): the linked member got the bot's own notice (filter the broadcast's sends by text); a customer message dated in the same Telegram second as a refused-send block is "older" than the block (wait into the next second — see the finding below); `ended()` read status before in-flight sends finished after an abort (now waits for no waiting / sending, as AC-18 says in-flight sends finish); the no-answer script was consumed by the other broadcast's send (split into two launches); `BROADCAST_AUDIENCE_CHANGED` carries `details.confirmation`. Tenancy: the operator's 403 `OWNER_ONLY` on the trio — changed to "equals the nowhere-id answer". Then green; a mutation (adding `parse_mode` to the broadcast send) turned story 1 red, reverted.
- `implement` (T27): **finding** (not changed, product behaviour per T7): Telegram dates messages in whole seconds while a refused-send block is recorded at the server's millisecond time, so a customer who unblocks and writes within the same second as the refused send keeps the "blocked" mark until her next notice or message. Low impact; for `review`.
- `implement` (T27): gate — `pnpm lint` clean; full `pnpm test`: 2 failures of 4404 — this task's secrecy test read the log before the link's final `broadcast.link` line under load (fixed: wait for it; re-run green) and the known `contacts-load` merge timing flake (green re-run alone). The send-link "two broadcasts alternate" flake from T26 is fixed separately (claim order, commit `test(broadcasts): …`).
