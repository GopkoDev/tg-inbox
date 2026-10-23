---
id: T39
title: "Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate \"did not reach\", the broadcast item in the thread, the blocked marker, and the operator's missing launch"
layer: "tests"
deps: ["T27", "T33", "T34", "T36", "T37", "T38"]
blocks: []
acs: ["AC-01", "AC-04", "AC-06", "AC-07", "AC-11", "AC-14", "AC-16", "AC-18"]
files_hint: ["apps/web/e2e/broadcasts.spec.ts", "apps/web/e2e/support/world.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T39 — Add browser end-to-end broadcasts flows against the real API: draft a tag audience, build a group, launch and follow the live report, stop, duplicate "did not reach", the broadcast item in the thread, the blocked marker, and the operator's missing launch

## Place in the sequence

- **Blocked by:** T27 — Add the API end-to-end broadcasts stories, the cross-workspace and secrecy suite, the broadcastIntegrity run-book queries and the live-push assertions, T33 — Build the broadcast group on SCR-25 and SCR-26: BroadcastGroupList with tags, blocked markers and Remove, and GroupPicker over the Contacts read with membership marks, Add, and the two-step Add all matching, T34 — Build SCR-27, the LaunchConfirmDialog on the /launch address: the exact text, the count, who is left out and why, the risk warning, launch with the version and fingerprint, the re-ask on a changed draft or audience, and the operator redirect, T36 — Build SCR-30, the DuplicateBroadcastDialog from the list, the draft and the broadcast page: the audience choice with per-option counts, "did not reach" disabled until the broadcast ends, and the not-confirmed warning, T37 — Render the broadcast item in the inbox thread (SCR-02): BroadcastItem as a new ThreadItemView kind with the name linking to the broadcast, the launching owner, the text and the delivered or not-confirmed time, inserted live without touching read state or attention, T38 — Show the blocked mark on Contacts (SCR-18) and the profile (SCR-19), re-read live on contact.changed reach · **Blocks:** — · **Wave:** 10 — after T27, T33, T34, T36, T37, T38.
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

It walks the real panel through the stories a pilot owner and an operator live — draft, launch, follow, stop, duplicate, answer — so the screens, the stores and the API are proven together in a browser.

## Inlined context

> The draft offers Launch only to a business owner. An operator sees no launch action and a note that only a business owner launches broadcasts. A saved link to the launch confirmation brings an operator to the draft with the same note, and nothing changes. When an owner chooses Launch, the draft first checks whether it can be launched. […]
>
> — `ux-flows.md §Flows, US-03, abridged` · full text: [ux-flows.md](../ux-flows.md)

> A launched broadcast opens from its row on the list or from its address. Its page shows the name, the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, and each recipient with outcome, reason and time. Totals and outcomes change live while it sends. […]
>
> — `ux-flows.md §Flows, US-04, abridged` · full text: [ux-flows.md](../ux-flows.md)

> On a draft whose audience is a broadcast group, "Add contacts" opens the group picker over the draft. It has the same search and tag filter as the Contacts list, with the same matching and the same counts. Contacts already in the group are marked. […] "Add all matching" first says how many contacts it will add (the matching ones not yet in the group), and adds them on confirmation. […]
>
> — `ux-flows.md §Flows, US-02, abridged` · full text: [ux-flows.md](../ux-flows.md)

> In the conversation of each recipient who got it, the broadcast shows as a broadcast item at the time it was delivered, with its text, its name and the business owner who launched it (still named if that owner was deactivated since). It is shown apart from the team's replies. […]
>
> — `ux-flows.md §Flows, US-07, abridged` · full text: [ux-flows.md](../ux-flows.md)

> | `broadcast.changed` (any change) | SCR-24 re-reads `listBroadcasts` (one fetch in flight, one more queued); SCR-28 of that broadcast re-reads `getBroadcast` and its current recipient page on `report` / `status`, one fetch at a time; SCR-25 of that broadcast acts only on `status` and `deleted` (§Assumptions) | AC-01, AC-11; flows 5, 11; events.md |
> | `contact.changed` (`change: reach`) | SCR-18 re-reads its current page when the contact is on it; SCR-19 of that contact re-reads `getContact`; nothing else | AC-14; flow 16; events.md |
>
> — `screens.md §Screens, Shared states, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Drives the panel against the real API and the fake Bot API of `apps/web/e2e/support/world.ts`: the broadcasts routes (list, create, save, audience, group, matching, add-matching, launch confirmation, launch, recipients, stop, duplicate), `listThreadItems`, `listContacts`, and the webhook (`my_chat_member` posted by the test as Telegram).

— `contracts/openapi.yaml §paths`, abridged · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** an operator of "Acme Flowers", whose bot is connected and working, where "VIP" is on 40 contacts, "Kyiv" on 120 and "Staff" on 3 (two of them also "VIP"), and 2 of the "VIP" contacts have blocked the bot
> **When** they open Broadcasts, create a broadcast named "Spring prices", type its text, choose a tag audience "any of" "VIP" with "Staff" left out, and leave the page
> **Then** a draft "Spring prices" is saved with its text and audience and is listed on Broadcasts for every member of "Acme Flowers" with its status "draft", its audience and who last changed it; while editing, the draft shows that its audience matches 38 contacts, of whom 2 cannot be reached because they blocked the bot and 0 because they never wrote to the current bot, so it would reach 36 (the same breakdown the launch confirmation shows); the count follows the same rules as the Contacts tag filter ("any of", "all of", "no tags"; no tag chosen means every contact), and a contact carrying any left-out tag is never counted; a tag renamed since still works under its new name, and a tag deleted or merged away is dropped from the audience with a notice saying so; reopening the draft later shows the same text and audience with the count as it is now; nothing is sent to any customer
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-04 — happy path

> **Given** an operator editing a draft "Wholesale catch-up" of "Acme Flowers" whose audience is a broadcast group already holding 1 contact
> **When** they search contacts by name or username and add "Olena K.", then filter contacts by the tag "Wholesale" with the search "kyiv" and choose "add all matching" (14 contacts, one of them already in the group), then remove one contact
> **Then** the search and filter work as on the Contacts list (the same matching, the same counts); "add all matching" first says how many contacts it will add and then adds the 13 not already in the group; the group shows its contacts with name, username and tags, marks the ones that blocked the bot, and says how many it holds (14) and how many it would reach; if the matching contacts changed between the count and the confirmation, the current ones are added and the editor says how many were; contacts who match the filter later are not added; removing a contact takes it out of this draft only and changes nothing on the contact; the group belongs to this draft and is not a list of its own anywhere else in the panel
>
> — `spec.md §5, AC-04, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — happy path

> **Given** a business owner of "Acme Flowers" with the draft "Spring prices" whose audience would reach 36 contacts, and a working bot
> **When** they choose to launch it
> **Then** a confirmation shows the exact text as the customer will see it, the number of contacts it will be sent to (36), how many are left out because they blocked the bot or never wrote to the current bot (2), and a warning that customers who did not expect the message can block or report the bot, which can limit the bot for support too; on confirmation the recipient list is fixed to exactly the 36 contacts counted in the confirmation, the broadcast becomes "sending" for every member, records who launched it and when, and sending starts; if between opening the confirmation and confirming it the text, the audience or the set of contacts it would reach changed (even if their number is the same), nothing is launched and the owner is shown the current version and number to confirm again; choosing launch twice, or two business owners launching the same draft at the same moment, launches it once and sends each recipient one message
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-07 — authorization

> **Given** an operator (not a business owner) of "Acme Flowers"
> **When** they open a draft they could launch if they were an owner, or try to launch it in any other way (for example from a saved link to the confirmation), or try to delete a draft that a teammate created
> **Then** the draft shows no launch action and says that only a business owner launches broadcasts; the attempt sends nothing and changes nothing; the delete is refused with the explanation that a draft is deleted by its author or a business owner; the operator can still edit, duplicate and delete their own drafts
>
> — `spec.md §5, AC-07, verbatim` · full text: [spec.md](../spec.md)

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

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] World helpers: seed tagged contacts with reach rows, post a private `my_chat_member` update, read the fake's sent messages — `apps/web/e2e/support/world.ts`
- [ ] Operator: New broadcast, name and text (remaining length), tag audience "any of VIP" leaving out "Staff" with the breakdown; a second draft as a group via the picker (search, Add, Add all matching); no Launch, owners-only note; `/launch` address lands on the draft — `apps/web/e2e/broadcasts.spec.ts`
- [ ] Owner: Launch → confirmation (text, Send to N, warning) → Launch; the report reaches Sent live; the recipient's inbox thread shows the broadcast item and the unread count does not move — same file
- [ ] Owner: launch a slower broadcast, Stop with the waiting count, Stopped; Duplicate → "Only recipients it did not reach" opens a new draft with the stopped recipients — same file
- [ ] Contacts: after a `my_chat_member` kicked update the row shows "Blocked the bot" without a reload; the profile shows the line — same file

## Edge cases

| Case | Behaviour |
|---|---|
| the report finishes before the page loads | the page shows Sent with the final totals; the test asserts the end state, not the transitions |
| two members' tabs open | the list changes live in the second tab after the first launches (AC-01) |
| operator on the stop | no Stop control anywhere (AC-18) |
| flaky timing | waits on visible state (role/text), never on sleeps |

## Definition of Done

- [ ] The browser flows pass locally and in CI with pnpm test:e2e: an operator drafts a tag audience and builds a group, an owner launches from the confirmation and watches the report reach sent live, an owner stops a second broadcast, duplicates it as "did not reach", the inbox thread shows the broadcast item without changing unread, Contacts shows the blocked marker after a my_chat_member block, and an operator sees no Launch or Stop.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
