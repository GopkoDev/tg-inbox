---
id: T18
title: "Build SCR-33 Channels & groups with SCR-34 connect-code, SCR-35 remove and SCR-43 time-zone dialogs"
layer: "ui"
deps: ["T17"]
blocks: ["T23", "T24"]
acs: ["AC-01", "AC-02", "AC-03", "AC-13", "AC-14"]
files_hint: ["apps/web/src/features/posts/settings/", "apps/web/src/pages/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T18 — Build SCR-33 Channels & groups with SCR-34 connect-code, SCR-35 remove and SCR-43 time-zone dialogs

## Place in the sequence

- **Blocked by:** T17 — Add the web posts API source, stores (posts, destinations, a · **Blocks:** T23 — Add browser end-to-end posts flows against the real API: con, T24 — Update CLAUDE.md, the architecture map and the design-system · **Wave:** 3 (after its deps).
- **Lane:** own lane.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business's Telegram channel or group to the workspace by posting a code from the panel into it
> **So that** the team can post there through the business bot, and no other chat can be posted to by mistake
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

This task delivers: build SCR-33 Channels & groups with SCR-34 connect-code, SCR-35 remove and SCR-43 time-zone dialogs.

## Inlined context

> SCR-33 states: loading · default (owner) · default (operator) · empty · unavailable row (problems incl. not_current_bot) · time zone not set · no working bot · destination limit · error · live — components DestinationsCard, TimeZoneField
>
> — `screens.md SCR-33, abridged` · full text: [screens.md](../screens.md)

> SCR-34 states: creating · waiting (Tabs Channel/Group, code or group command, Copy, expiry) · connected · missing right · expired · replaced · refused · error
>
> — `screens.md SCR-34, abridged` · full text: [screens.md](../screens.md)

> SCR-35: «2 scheduled posts to it go back to drafts»; SCR-43: «3 scheduled posts keep their moment and show a new local time.»
>
> — `screens.md SCR-35, SCR-43, abridged` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full ([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

listDestinations, createDestinationCode, getDestinationCode, removeDestination, setPostingTimeZone (T17 client).

— `contracts/openapi.yaml, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers" whose connected bot was added as an admin with the right to post to the channel "Acme Flowers News"
> **When** the owner creates a connect code in Settings and posts it in that channel within 10 minutes
> **Then** "Acme Flowers News" appears among the workspace's destinations, live, as a channel with its Telegram name, the code stops working, and the bot removes the code message from the channel when it is allowed to
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — domain invariant

> **Given** a business owner whose bot is in a group but may not send messages there, or in a channel without the right to post
> **When** the owner posts a valid connect code there
> **Then** the chat is not connected, and Settings tells the owner which right the bot needs in that chat; a chat the bot was added to without a code never becomes a destination; an expired or already used code connects nothing, and Settings shows the code as expired
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — authorization

> **Given** an operator of "Acme Flowers"
> **When** they look at destinations, a draft or a published post
> **Then** they see the destinations and the post but are offered no way to connect or remove a destination, publish, schedule or delete a published post, and an attempt made anyway is refused and says only a business owner can do it; a saved link to an owner-only step opens the post instead
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-13 — error

> **Given** a published-now or scheduled post
> **When** Telegram refuses it — the bot lost the right to post or was removed from the chat, the chat no longer exists, or the text was refused
> **Then** the post is marked failed with that reason in plain language, is not tried again, is counted next to Posts in the navigation for the whole team until any member opens it, and the destination is marked unavailable with what is wrong when the bot can no longer post there
>
> — `spec.md §5, AC-13, verbatim` · full text: [spec.md](../spec.md)

### AC-14 — cross-context

> **Given** a workspace with destinations and scheduled posts
> **When** its bot stops working or is disconnected, or a different Telegram bot is connected
> **Then** while the bot is not working, publishing and scheduling are refused with a way to the bot settings and posts whose time comes fail with "the bot was not working"; with a different working bot, only the old bot's destinations are unavailable until connected again with a code, and posts due to them fail with "this chat is not connected to the current bot"; while reconnecting the same bot keeps them; a group that Telegram upgraded keeps working as the same destination
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] DestinationsCard, TimeZoneField, ConnectCodeDialog components
- [ ] AlertDialogs for remove / zone
- [ ] Testing Library tests per state

## Edge cases

| Case | Behaviour |
|---|---|
| operator | read-only with note |
| code expires while open | expired state, Get a new code |

## Definition of Done

- [ ] component tests for every listed state pass
- [ ] lint + vet clean
- [ ] every Hard Rule inlined above still holds
