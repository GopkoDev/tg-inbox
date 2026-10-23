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
status: "todo"
step: ""
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

- [ ] `broadcastIntegrity` (the six SAD queries + the two audit ones) and their entries in `integrityViolations` — `apps/api/src/e2e/helpers.ts`
- [ ] Story: draft (tag audience) → confirmation → launch → chain to sent; one fake `sendMessage` per recipient, plain text with no `parse_mode`, a broadcast item per delivered recipient, report totals, `broadcast.changed` / `conversation.changed` frames on a socket — `apps/api/src/e2e/broadcasts-flows.int.test.ts`
- [ ] Stories: a `my_chat_member` kicked update and a broadcast send refused as blocked mark the contact (`blocked_since`, `contact.changed reach`, no message / unread / ping); stop mid-send; abort on a revoked token (`bot_stopped`); a killed link leaves one `not_confirmed` with its item; duplicate "did not reach"; double launch launches once — same file
- [ ] Cross-workspace and secrecy: every operation with a foreign broadcast / contact / tag / item id answers `404` with no hint; group rows and recipients never hold another workspace's contact; no text, name, username or chat id in captured logs, frames or job payloads — `apps/api/src/e2e/broadcasts-tenancy.int.test.ts`
- [ ] Run `integrityViolations` after each story and assert zero rows — both files

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

- [ ] The API e2e stories pass against Postgres and the fake Bot API: draft → launch → report → sent with one message per recipient and a broadcast item per delivered recipient, a my_chat_member block and a refused send marking the contact, stop mid-send, abort on a revoked token, duplicate "did not reach", the cross-workspace refusals with no hint, no text, name or chat id in logs, frames or job payloads, and every broadcastIntegrity query returns zero rows after each story. The stories also assert that a group removal changes nothing on the contact, that retags, new customers and an unblock after launch leave the recipient rows unchanged, that the recorded message carries only the text, and that a linked member's Telegram account is never a recipient (test plan).
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
