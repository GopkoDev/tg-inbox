---
id: T28
title: "Add the seeded sending and timing checks: pace per 1 s window with two broadcasts, 1 000 recipients within 90 s, replies during a broadcast, a reply's 429 pausing broadcasts, the stop within 2 s, the 10 000-contact draft count and launch, and blocked freshness"
layer: "tests"
deps: ["T26"]
blocks: []
acs: ["AC-11", "AC-15", "AC-18"]
files_hint: ["apps/api/src/e2e/broadcasts-load.int.test.ts"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
step: ""
---

# T28 — Add the seeded sending and timing checks: pace per 1 s window with two broadcasts, 1 000 recipients within 90 s, replies during a broadcast, a reply's 429 pausing broadcasts, the stop within 2 s, the 10 000-contact draft count and launch, and blocked freshness

## Place in the sequence

- **Blocked by:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Blocks:** — · **Wave:** 9 — after T26.
- **Lane:** own lane.

## Why (user story)

> **As an** Operator
> **I want** my replies to go out without waiting behind a broadcast, and to see the broadcast in a customer's conversation when they answer it
> **So that** support works as usual and I understand what the customer is answering
>
> — `spec.md §4, US-07, verbatim` · full text: [spec.md](../spec.md)

It proves with seeded numbers that support keeps its reply latency while broadcasts send at their paced rate, and that a stop, a launch and a draft count meet the spec's timing targets.

## Inlined context

> | Broadcast pace per bot | ≤ 25 messages per second for all of a bot's broadcasts together, over any 1 s window | send timing log per bot; integration test against the fake Telegram counting sends per second |
> | Broadcast completion | 1 000 recipients, no rate-limit answers → every recipient has an outcome within 90 s of launch; 10 000 within 10 minutes | launch-to-finish timing log; seeded integration test with 1 000 recipients |
> | Reply latency during a broadcast | p95 reply send → Telegram accepted ≤ 2 s while a 10 000-recipient broadcast is sending (the same target as on a quiet day, shared-inbox §6) | reply delivery timing log, compared between broadcast and non-broadcast windows; integration test with a broadcast and replies interleaved |
> | Draft audience count p95 — tag audience or group, workspace with 10 000 contacts | ≤ 500 ms server time (as the Contacts list, contacts §6) | request timing log; seeded integration test |
> | Launch p95 — freezing 10 000 recipients | ≤ 2 s server time from confirm to "sending" | request timing log; seeded integration test |
> | Blocked state freshness p95 — Telegram's block or unblock notice received → contact marked or unmarked | ≤ 5 s | update handling timing log; integration test with the fake Telegram |
> | Stop takes effect | 0 sends of a broadcast started more than 2 s after its stop was confirmed (AC-18) | send timing log against the stop time; integration test stopping mid-send against the fake Telegram |
>
> — `spec.md §6, NFR rows, abridged` · full text: [spec.md](../spec.md)

> **QG-1 How verify:** integration test against the fake Telegram counting `sendMessage` per bot per sliding 1 s window with two broadcasts sending together (AC-15 turns); an interleaved test sending replies during a seeded 10 000-recipient broadcast and asserting reply accept time p95; a scripted `429` from a reply, then asserting no broadcast send before `retry_after` […]
> **QG-2 How verify:** seeded integration test with 1 000 recipients against the fake Telegram with a realistic answer delay (150 ms), asserting launch-to-finish ≤ 90 s […]
> **QG-4 How verify:** integration test stopping mid-send against the fake Telegram and comparing every send's start time with the stop's commit time; integration test where the 11th launch is refused with `next_launch_at`, including a stopped broadcast among the 10.
> **QG-5 How verify:** seeded integration tests timing the draft read (tag audience and a 10 000-contact group) and the launch […]
> **QG-6 How verify:** […] integration test posting a `my_chat_member` update to the webhook with the fake Telegram and timing the reach row and the `contact.changed` signal […]
>
> — `sad.md §10, QG-1, QG-2, QG-4, QG-5, QG-6, abridged` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. With one active sender per workspace (ADR-0007), an in-process pacer is exact for that bot; 40 ms start spacing caps any 1 s window at 25. Eight in flight cover a Telegram round trip of up to 320 ms at full pace, so 1 000 recipients take about 40 s and 10 000 about 7 minutes. Replies keep their own path. The pause and the bot identity are checked inside `bots` before each call, so a rate limit from any sender pauses broadcasts, and a replaced bot is never used for an old broadcast.
>
> — `adr/0008 §Decision outcome, ADR-0008, verbatim` · full text: [ADR-0008](../adr/0008-pace-broadcasts-at-25-per-second-per-bot-in-turns-and-wait-for-the-send-pause.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (seeds 10 000 contacts with reach rows and tags through the fixtures of T2 / T3).

## API contract

Drives `getBroadcast` (draft count), `getLaunchConfirmation` + `launchBroadcast` (10 000 recipients), `stopBroadcast`, the inbox reply route (`sendReply`) during a broadcast, and `receiveTelegramUpdate` (`my_chat_member`); the fake Bot API records each `sendMessage` start time and answers after a scripted delay or with a scripted `429 retry_after`.

— `contracts/openapi.yaml §paths`, abridged · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-11 — happy path

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 36 recipients, 1 of whom has since blocked the bot and 1 of whom deleted their Telegram account
> **When** a business owner or an operator opens it while it sends and after it ends
> **Then** the page shows the text, the audience as it was defined, who launched it and when, and the delivery report: totals of waiting, delivered, blocked the bot and failed, which change live without reloading, and each recipient with their outcome and time (failed with a plain reason such as "account no longer exists" or "not confirmed — Telegram did not answer, not sent again"); the recipient who blocked the bot is shown as blocked and the contact is marked as having blocked the bot (a recipient already marked as blocked when their turn comes is not sent it and gets that outcome; one who unblocked before their turn is sent it); a send Telegram refuses for any reason other than a rate limit or a block ends that recipient as failed with its reason and is not tried again; when every recipient has an outcome the broadcast becomes "sent" with its finish time; if the service restarts while sending, sending continues with the recipients still waiting, no recipient who already has an outcome is sent the broadcast again, and a send that was in flight when the service stopped ends as "not confirmed"; a recipient whose send got no answer from Telegram is never sent it again automatically
>
> — `spec.md §5, AC-11, verbatim` · full text: [spec.md](../spec.md)

### AC-15 — cross-context

> **Given** "Acme Flowers" launches a broadcast to 3 000 contacts while operators keep answering customers, and another broadcast of the workspace is already sending
> **When** operators send replies during the broadcast, and Telegram answers the bot with a rate limit
> **Then** replies go out without waiting for the broadcasts to finish — a reply sent during a broadcast reaches the customer as fast as on a quiet day (§6); the bot's broadcast sending together stays below Telegram's per-bot limit with room left for replies, pings and the bot's own answers; two broadcasts sending at the same time take turns, so neither waits for the other to finish; on a rate-limit answer to any of the bot's sends the broadcasts pause for the time Telegram asked (the bot's send pause, as for pings) and then continue where they stopped, without skipping or doubling any recipient, while replies keep going as before; a broadcast of one workspace never slows the replies, pings or broadcasts of another workspace
>
> — `spec.md §5, AC-15, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — error

> **Given** the broadcast "Spring prices" of "Acme Flowers" sending to 3 000 recipients, 1 200 of whom already have an outcome
> **When** a business owner chooses to stop it and confirms; or an operator looks for a way to stop it; or the owner chooses stop at the moment the last recipient gets an outcome
> **Then** after the owner confirms (the confirmation says how many recipients are still waiting and that a stop cannot be undone), no new send of it starts; a send already in flight finishes and its outcome is recorded as usual; every recipient still waiting is marked "not sent — stopped" and the broadcast becomes "stopped" for every member, with who stopped it and when, and the report keeps every outcome recorded before; nothing of it is ever sent later; the stopped broadcast stays read-only and can be duplicated, its stopped recipients included in "only recipients it did not reach" (AC-13); an operator sees no stop action and cannot stop it in any other way; a stop that arrives after every recipient has an outcome changes nothing and the broadcast stays "sent"
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Seed helper: a workspace with 10 000 contacts (reach rows for the bot, a tag on a subset) and a second workspace with its own bot — `apps/api/src/e2e/broadcasts-load.int.test.ts`
- [ ] Pace: two broadcasts of one workspace sending together; no sliding 1 s window of the bot's broadcast sends holds more than 25; both progress (turns) — same file
- [ ] Completion: 1 000 recipients with a 150 ms answer delay → every recipient has an outcome ≤ 90 s after launch — same file
- [ ] Replies: replies sent while a large broadcast sends are accepted with p95 ≤ 2 s; a scripted `429` to a reply → no broadcast send before `retry_after`, then the broadcast continues without skips or doubles — same file
- [ ] Stop: no send of the broadcast starts more than 2 s after the stop commits; draft count ≤ 500 ms (tags and a 10 000 group); launch of 10 000 ≤ 2 s; `my_chat_member` → reach row + `contact.changed` ≤ 5 s — same file

## Edge cases

| Case | Behaviour |
|---|---|
| a send in flight when the stop commits | it finishes and records its outcome; no new send starts after the commit (AC-18) |
| `429` answered to a ping or reply, not a broadcast | broadcasts still pause until `send_paused_until` (AC-15) |
| a second workspace replying while the first broadcasts | its reply latency is unchanged (separate link, bot, pacer, pause) |
| CI machine slower than a laptop | timing assertions use the spec bounds, not tighter ones; the measured values are logged |

## Definition of Done

- [ ] Seeded integration tests against the fake Bot API prove no 1 s window holds more than 25 broadcast sends of one bot with two broadcasts sending, 1 000 recipients with a 150 ms answer delay all have an outcome within 90 s, replies sent during a broadcast are accepted with p95 ≤ 2 s, a 429 to a reply stops every broadcast send until retry_after, no send starts more than 2 s after a stop commits, the draft count of a 10 000-contact workspace is ≤ 500 ms and freezing 10 000 recipients ≤ 2 s, and a my_chat_member update marks the contact within 5 s.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
