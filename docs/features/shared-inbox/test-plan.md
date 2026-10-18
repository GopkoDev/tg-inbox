---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Implementing engineer", "Tech Lead", "Security Lead"]
updated_at: "2026-10-18"
feature_size: "M"
---

# Test plan — shared-inbox

Every active member of a workspace sees its captured conversations live, newest activity first, with their own unread counts and a shared "waiting for a reply" marker; searches them by contact; reads the whole history including customer media streamed through the panel; and sends text replies through the workspace's own bot — each reply delivered at most once, in order within its conversation, with a truthful delivery state — while no member ever sees another workspace's inbox, a revoked member's live stream stops within 5 s, and the bot token never reaches the browser or the logs.

> **Assumptions (decided in an autonomous pipeline run, 2026-10-18 — change any row by editing this file before `implement`):** levels were chosen per AC by the default heuristic (pure rule → unit; repository / use case / route against the database → integration; a shape both sides agree on → contract; a full user story → e2e; a screen state → component; a user-facing flow → e2e-through-UI); visual-regression stays N/A as in the earlier features' plans; load scenarios cover only the five latency NFRs, the other numeric NFRs are verified by integration tests.

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure rules in `conversations/domain` (reply states and allowed transitions, thread position order and cursors, the arrival-watermark rule for unread and read) and `inbox/domain` (reply text check: empty / blank / over 4096 UTF-16 units, delivery outcome → reply state + failure reason, 5-minute retry window, 30-per-60-s member limit window); the bots gateway's classification of every Telegram answer into a typed outcome; contact-search normalisation (trim, one leading "@", case folding in any alphabet); app-layer use cases (list, search, open, mark read, send, resend, deliver, open media, bot status) with in-memory port fakes; shared request / response / live-frame schemas. | In-memory, no external dependency; time from a fake clock port; Telegram behind a fake gateway port. |
| Integration | Repositories, use cases and HTTP routes of `inbox`, `conversations`, `contacts`, `bots` and `workspaces` against a real database; the delivery drain worker and its back-off / dead-letter jobs; the realtime publisher (published inside the writing transaction) and listener (reconnect + gap resync); the live socket endpoint (guarded upgrade, origin check, per-workspace dispatch, deactivation close, 5 s re-validation); the media route streaming bytes from the fake Bot API. | An ephemeral real database container per suite with every migration applied (incl. the promoted 01–10); routes through the in-process HTTP entry point of `buildApp()`; the live socket through a real connection to the in-process server; Telegram through the repo's scriptable fake Bot API (`sendMessage`, `getFile`, file download — answers, hangs and failures scripted per call); a controllable clock for the retry window, the member limit and staleness. |
| Contract | (a) Every inbox API response body against the zod schemas in `packages/shared` and `contracts/openapi.yaml` (incl. the six new error codes and their `details`); (b) every live frame (`conversation.changed`, `bot.changed`, `read`, resync) against `contracts/events.md` and the shared frame schemas; (c) the outbound `sendMessage` request the bot makes (plain text, no parse mode, no tg-inbox marks) against what the fake Bot API records. | Validate real responses / frames / outbound calls produced by the integration suite against the agreed shapes; no hand-rolled stubs. |
| E2E | One full flow per user story through the HTTP API + live socket: capture → list → open → reply → delivered (US-01…US-05), two members live side by side (US-06), bot breaks and is fixed (US-07). | Multi-step scenario against an ephemeral database and the fake Bot API; customer messages enter through the real webhook route; each step uses only what an earlier step returned. |
| Load | Spec §6 latency NFRs: live update, reply latency, list, thread, media. | The load tool already in your repo, or e.g. k6 or Locust; run against a production-like host, not a CI runner. |
| Component | SCR-01…SCR-05 of `screens.md` and the new components (`MessageContent`, `ReplyDeliveryState`, the reply composer, the realtime client + workspace-keyed inbox store), every state row of the manifest including §Shared inbox states (guard and live frames). | Render the screen in a component harness with a stubbed API client and a stubbed live socket; assert the rendered state, the request sent and the navigation it triggers. |
| Visual-regression | <!-- N/A: pilot-stage UI still changing; baselines would churn on every layout edit (same decision as workspace-operators and bot-connection). --> | — |
| E2E-through-UI | Six flows from `ux-flows.md` driven through the built web panel served from the same origin as the API. | A real browser against the API + an ephemeral database + the fake Bot API; conversations seeded through the webhook route or the app layer, never through the UI under test. |

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Expected outcome |
|---|---|---|---|
| AC-01 happy | `inbox lists every captured conversation newest activity first` | integration + contract + component | 30 seeded conversations, only this workspace's, ordered by last activity; no sample data or "Sample data" label |
| AC-01 happy | `only a customer message or a sent reply moves a conversation` | unit + integration | A customer edit, a "sending", "not confirmed" or "not delivered" reply leaves the order unchanged; a new message or a reply turning "sent" moves it to the top |
| AC-01 happy | `list row shows the last message by kind and caption` | unit + component | A photo with caption reads "Photo · new bouquet?"; text shows its text; time shown as "how long ago" |
| AC-01 happy | `unread count is per member and counts only customer messages after they became active` | unit + integration | Teammates' replies never count; messages before the member joined or was reactivated count as read; two members of one workspace see different counts |
| AC-01 happy | `waiting-for-a-reply marker follows the last sent reply` | unit + integration + component | Marker shown when the customer wrote after the last "sent" reply; a sending / not confirmed / not delivered reply does not clear it |
| AC-01 happy | `business owner sees and does in the inbox everything an operator does` | integration | Every inbox route answers an owner exactly as an operator |
| AC-01 e2e | `operator sees real conversations in the inbox` | e2e-through-UI | The list shows the seeded conversations with unread counts and markers |
| AC-02 happy | `search finds a contact by any part of full name or username` | unit + integration | Matches anywhere in "first last" or username; case-insensitive in Latin and Cyrillic; surrounding spaces and one leading "@" ignored; other workspaces' contacts never match |
| AC-02 happy | `search with no match offers to clear it` | component | "No conversations match" with Clear search; clearing restores the full list |
| AC-02 happy | `empty inbox explains where conversations come from` | component | Empty-workspace message; owner without a connected bot gets the way to bot settings, an operator is told to ask an owner |
| AC-03 happy | `thread opens on the latest page in history order with authors` | unit + integration + contract + component | Latest page of a 600-item history; customer messages and replies interleaved by position; each reply names its author; header shows the contact's name |
| AC-03 happy | `scrolling up pages older history to the first message` | unit + integration + component | Cursor pages walk back with no gap or duplicate until there is no earlier page |
| AC-03 happy | `opening a conversation marks read only for this member` | unit + integration | Watermark moves to the newest arrival for this member; teammates' unread counts unchanged; read counted by arrival, not by history position |
| AC-03 happy | `conversation address survives reload, back and a saved link` | component + e2e-through-UI | The same conversation reopens from its address |
| AC-03 error | `unknown conversation address shows the not-found card` | integration + component | Not found in the frame; no data |
| AC-03 happy | `phone width swaps list and thread with a back control` | component + e2e-through-UI | List fills the screen; picking a row shows the thread; back returns to the list |
| AC-04 happy | `every captured kind renders in the thread` | component | Photo / sticker / video shown; voice / audio playable; file downloadable under its name; location as coordinates (venue name + address) with a map link; contact as name + phone; poll as question + options; caption with its message; kind "other" as "unsupported message — tg-inbox cannot show this kind yet" |
| AC-04 happy | `media streams through the panel with ranges` | integration + contract | The media route returns the bytes from the fake Bot API with forced safe headers and byte-range support; addressed by message, never by a Telegram file address |
| AC-04 security | `opening a thread sends nothing to an outside map service` | component | No outside address is requested on render; the map link opens only on click, in a new tab without referrer |
| AC-04 security | `customer text, captions and file names are shown as plain text` | component | Markup or script in a message, caption or file name is shown literally, never interpreted |
| AC-04 security | `bot token never reaches the panel or the logs` | integration + e2e | Token-secrecy suite extended to every inbox response, the media route (body, headers, redirects), socket frames and captured logs — zero occurrences |
| AC-05 error | `media of a disconnected or broken bot is unavailable with the reason` | unit + integration + component | Kind + caption with "content unavailable — the bot is disconnected" / "the bot is not working — needs a new token"; rest of the thread readable |
| AC-05 error | `media over the bot download limit is unavailable` | unit + integration + component | File larger than 20 MB → "the file is too large to open in tg-inbox"; no download attempted |
| AC-05 error | `media Telegram no longer keeps is unavailable` | integration + component | Fake Bot API answers "file not found" → "Telegram no longer keeps this file" |
| AC-06 happy | `reply goes from sending to sent and moves the conversation for everyone` | integration + e2e + e2e-through-UI | Reply stored "sending" with the author's name, the drain sends it, it becomes "sent"; the conversation goes to the top for every member, the waiting marker clears |
| AC-06 happy | `composer sends on Enter, adds a line on Shift+Enter and clears after send` | component | Enter sends, Shift+Enter inserts a new line; box empty and focused afterwards; no "nothing is sent" preview note |
| AC-07 error | `empty, blank or over-long reply cannot be sent` | unit + component | Send unavailable; Enter does nothing; over 4096 characters shows the limit message and keeps the text |
| AC-07 error | `server refuses an invalid reply text` | integration + contract | Empty, whitespace-only and over-4096 bodies refused as invalid; nothing stored, nothing sent |
| AC-08 authorization | `member of another workspace gets not found on every inbox route` | integration | List, search, conversation, thread, items, mark read, media, send, resend and bot status of "Acme Flowers" answer the same neutral not-found as a non-existent workspace; nothing sent |
| AC-08 authorization | `deactivated member is refused with access removed on every inbox route` | integration + component | Every inbox route refuses with access removed; the panel clears the workspace's data and shows the access-removed landing |
| AC-08 authorization | `signed-out visitor is asked to sign in` | integration + component | Every inbox route refuses as not signed in; the panel goes to sign-in and returns afterwards |
| AC-08 authorization | `live socket upgrade is refused without an active membership` | integration | Upgrade refused for another workspace's member, a deactivated member, a signed-out visitor and a foreign origin; no frame delivered |
| AC-08 authorization | `every new repository method is scoped to its workspace` | integration | For each new method, the two-workspace fixture proves it never returns or changes the other workspace's rows |
| AC-09 authorization | `deactivation closes the member's live stream within five seconds` | integration + e2e | After deactivation no further frame reaches that member; the socket closes ≤ 5 s even with the deactivation signal suppressed (re-validation alone) |
| AC-09 authorization | `workspace switch in one tab stops only that tab's old stream` | integration + component + e2e-through-UI | The switched tab gets no more "Acme Flowers" frames and never shows its conversations inside the other workspace, not even for a moment; another tab still on "Acme Flowers" keeps working |
| AC-09 authorization | `after access ends the next action shows access removed` | component + e2e-through-UI | The open inbox clears and lands on the access-removed notice |
| AC-09 authorization | `a removed author's pending replies are not sent` | integration | Replies still waiting for retry end "not delivered — the author's access was removed"; no send call |
| AC-10 error | `reply to a customer who blocked the bot is not delivered with the reason` | unit + integration + component + e2e | "Not delivered — the customer blocked the bot" (or "the customer's Telegram account no longer exists"); no retry; waiting marker stays; reply box still usable |
| AC-10 error | `further replies to a blocked customer fail the same way until they write again` | integration | Each later reply ends with the same reason; after a new customer message a reply is sent |
| AC-11 invariant | `double press of one send creates one reply` | unit + integration + component | Two requests with one client key → one stored reply, one send call; the second answer returns the same reply |
| AC-11 invariant | `two deliberate sends with the same text are both sent` | integration | Two client keys → two replies, two send calls |
| AC-11 invariant | `unknown send outcome ends not confirmed and is never retried` | unit + integration | Fake Bot API hangs past the timeout or the connection drops → "not confirmed — it may or may not have reached the customer"; no second send call |
| AC-11 invariant | `a worker dying mid-send resolves to not confirmed` | integration | An attempt left in flight is found stale on the next run and marked "not confirmed"; never resent |
| AC-11 invariant | `send again needs an explicit duplicate-risk confirmation` | integration + contract + component | Resend of a "not confirmed" reply without the confirmation is refused; the warning dialog sends only on confirm; cancel leaves it "not confirmed" |
| AC-11 invariant | `no reply is delivered twice without send again` | integration | Reconciliation over the attempts log across the whole suite: zero replies with more than one accepted send and no confirmed resend |
| AC-12 error | `refused sends are retried for up to five minutes` | unit + integration | Telegram unavailable / slow-down answers are retried with back-off while the reply stays "sending"; success within the window → "sent" |
| AC-12 error | `replies of one conversation arrive in order without holding up others` | integration | With the first reply refused, the later reply of the same conversation waits; a reply in a second conversation is delivered meanwhile; the customer receives the first before the second |
| AC-12 error | `still refused after five minutes ends not delivered with try again` | unit + integration + component | "Not delivered — Telegram did not accept it, try again"; Try again sends it once more and it moves to the end of the thread at its new time |
| AC-12b error | `the 31st reply within a minute is refused` | unit + integration + component | Refused with the per-member limit and when sending is available again; text kept; automatic retries not counted, Try again and send again counted |
| AC-12b error | `concurrent sends cannot exceed the member limit` | integration | 31 simultaneous sends → at most 30 accepted |
| AC-12b error | `the member limit is per workspace` | integration | The same account at its limit in "Acme Flowers" can still reply in "Bolt Bikes" |
| AC-13 cross-context | `reply is refused while the bot is not connected or needs a token` | integration + contract | Send refused as bot cannot reply, with the bot state; nothing stored or sent; conversations still readable |
| AC-13 cross-context | `composer explains the broken bot per role` | component | Box and Send unavailable; owner gets the way to bot settings, operator is told to ask a business owner; draft kept |
| AC-13 cross-context | `replies sending when the bot stops end not delivered` | integration | Pending replies end "not delivered — the bot is not working"; no send call |
| AC-13 cross-context | `fixing the bot re-enables replying without a reload` | integration + component + e2e + e2e-through-UI | Every bot state transition publishes a change; the open inbox re-reads the status and the composer comes back with the kept draft |
| AC-14 cross-context | `taken-over bot shows the not-receiving notice to every member` | integration + component | Bot status visible to operators and owners; notice above the list for every member, bot-settings way only for owners; it disappears live when reconnected |
| AC-14 cross-context | `replies still send while taken over and show the notice` | integration + component | Reply sent and "sent"; its state line carries the not-receiving notice |
| AC-15 happy | `customer message reaches every open inbox live` | integration + component + e2e + e2e-through-UI | A captured message publishes a change in the writing transaction; every connected member of the workspace gets the frame; list re-orders and the open thread shows it without reload |
| AC-15 happy | `first message from a new customer adds a conversation live` | integration + component | New conversation appears at the top of every open list |
| AC-15 happy | `customer edit shows the new text marked edited without unread` | unit + integration + component | Edited text with "edited"; unread count unchanged; conversation not moved |
| AC-15 happy | `teammate reply appears live with name and delivery state` | integration + component | Appended with the teammate's name; later state changes follow |
| AC-15 happy | `a message arriving in a visible open thread is read, in a background tab it is not` | unit + component | Visible tab marks read through the newest arrival; hidden tab marks nothing until it becomes visible |
| AC-15 happy | `late redelivery takes its place in history and counts unread by arrival` | unit + integration + component | Inserted at its history position; unread for every member who has not looked since; never hidden behind read messages |
| AC-15 happy | `live stream recovers from a dropped connection` | integration + component | After a listener or socket reconnect, a resync re-reads the list and open thread; no change lost |
| AC-16 invariant | `teammate reply after typing started needs confirmation` | unit + integration + contract | Send with a last-seen reply older than the newest teammate reply is refused as teammate replied, with the author and time; nothing stored |
| AC-16 invariant | `confirming sends, keeping editing does not` | component + e2e-through-UI | Dialog names the teammate and how long ago; Send anyway sends with the same client key; Keep editing keeps the draft and sends nothing |
| AC-17 happy | `customer receives the reply as a plain bot message` | integration + contract + e2e | Fake Bot API records one send to the customer's chat through the workspace's own bot: the text with line breaks, plain text, no operator name or tg-inbox mark |
| AC-17 happy | `customer's answer continues the same conversation` | integration + e2e | A webhook message from the customer after the reply lands in the same conversation |
| AC-18 cross-context | `one person writing to two workspaces' bots gets one conversation in each` | integration + e2e | Each inbox shows only its own bot's messages and its own team's replies; at most one conversation per customer per workspace |
| AC-18 cross-context | `a reply goes only through its workspace's bot` | integration + e2e | A reply from "Bolt Bikes" is sent with "Bolt Bikes"' bot to that person's chat; "Acme Flowers"' bot is never called |
| AC-18 cross-context | `switching workspace shows only that workspace's inbox` | component + e2e-through-UI | The workspace-keyed store never shows one workspace's conversations under the other |

**E2E-through-UI scope (six flows, from `ux-flows.md`):** see and open conversations (US-01/US-02 — AC-01, AC-03), reply and see it sent (US-03 — AC-06), two members side by side with a live message and the teammate confirmation (US-06 — AC-15, AC-16), bot breaks and is fixed (US-07 — AC-13), deactivation and workspace switch with an open inbox (AC-09, AC-18).

## Edge cases / error paths

- Malformed or unknown conversation / message id in an inbox address → expected: the same neutral not-found as a foreign workspace.
- Media request for a message with no media (text, location, poll) → expected: refused as not found; no Telegram call.
- Media seek past the end of the file → expected: refused as an unsatisfiable range; the player offers to try again.
- Telegram unavailable while opening media → expected: "Telegram is not responding — try again"; nothing cached, the thread stays readable.
- Send request with a missing or malformed client key → expected: refused as invalid; nothing stored.
- Send with the same client key but different text → expected: the stored reply is returned unchanged; nothing new sent.
- Resend of a reply that is "sent", "sending", or was already resent by another member or tab → expected: refused as not resendable, answered with the current reply.
- Try again on a reply whose customer has blocked the bot or whose bot needs a token → expected: no Try again offered; a direct resend is refused.
- Send while a teammate's reply is still "sending" → expected: the teammate check counts it (same confirmation as a sent one).
- Search text over 200 characters → expected: refused as invalid (the UI cannot produce it).
- Search text that is only "@" or spaces → expected: treated as no search, the full list.
- Page cursor tampered with or from another conversation → expected: refused as invalid; no rows of another conversation.
- Mark read with a watermark older than the stored one → expected: the stored watermark never moves back.
- Database notification listener disconnects → expected: it reconnects and every open socket is told to resync; no frame of another workspace delivered.
- Socket idle without pings → expected: closed by the server; the client reconnects and resyncs.
- Network failure or server error on any inbox screen load or action → expected: the screen's own error state with retry; the composer keeps text and client key.
- Logs on the send, deliver, media and socket paths → expected: no bot token, no reply text, no session cookie; the webhook secret header redacted.
- Database unavailable during a send → expected: send fails with the generic error and nothing is sent to Telegram — fail-closed.

**Cross-workspace isolation (spec §6.1, SAD QG-2):** every new or changed repository method in `conversations`, `contacts`, `workspaces` and `bots` gets its own integration test on the two-workspace fixture; every inbox route, the media route and the socket upgrade get a foreign-workspace test (AC-08); the existing controlled exceptions are unchanged and no new one is added.

## Test data

- Seed strategy: the existing builders in `apps/api/src/test/fixtures/` extended per `data-model.md` §Test fixtures — `insertMembership` (with active-since), `insertConversation` (with last activity / last message received / last reply sent), `insertReply`, `insertReplyAttempt`, `insertReadMark`, and `twoWorkspacesWithInbox` (two workspaces sharing one Telegram user, a conversation, messages and a reply each) as the base of every isolation and AC-18 test. Customer messages for e2e flows enter through the real webhook route with the fake Bot API's update builders. Synthetic ids, `Test User` and `@example.test` only.
- Volume seeds: 1 000 conversations for the list timing test and a 5 000-message conversation for the thread timing test, inserted in bulk through the builders once per suite.
- Telegram: the repo's scriptable fake Bot API — per-call answers for `sendMessage` (accepted, blocked, account gone, chat not found, unavailable, slow down, hang past timeout, connection drop), `getFile` (size, not found) and the file download (bytes, ranges, failure); it records every outbound call for the contract and secrecy checks.
- Time: a controllable clock port for the 5-minute retry window, the 60-s member limit, stale in-flight detection and the 5-s socket re-validation; never sleep in tests except where the real socket timing is the subject (AC-09, with a bounded wait).
- Integration dependency: an ephemeral real database container per suite with all migrations applied — NOT a mocked store. E2E and E2E-through-UI use their own ephemeral database and fake Bot API.
- Cleanup boundary: per-test — every test truncates the feature's tables and resets the fake Bot API script; concurrency tests (double press, 31 concurrent sends, drain ordering) use committed transactions and truncate afterwards; volume seeds are per-suite and read-only. The queue's job tables are truncated with the rest. E2E suites reset the database before each flow; browser suites close every socket between flows.

## NFR validation (load)

- Live update p95 ≤ 3 s → scenario: 50 connected sockets across 5 workspaces, 10 customer messages/s through the webhook route plus 5 replies/s for 5 min; assert p95 from capture/send commit to socket write ≤ 3 s and no frame delivered to another workspace.
- Reply latency p95 ≤ 2 s → scenario: 5 replies/s across 50 conversations for 5 min with a fake Bot API answering in ~100 ms; assert p95 from send request to "sent" ≤ 2 s and zero duplicate sends.
- Inbox list p95 ≤ 500 ms server time → scenario: 20 list requests/s (half with search) for 5 min on a workspace with 1 000 conversations; assert p95 server time ≤ 500 ms and zero server errors.
- Thread open p95 ≤ 500 ms server time → scenario: 20 latest-page requests/s for 5 min on a 5 000-message conversation; assert p95 server time ≤ 500 ms.
- Media open p95 ≤ 3 s → scenario: 2 media opens/s of a 5 MB file for 5 min with the bot connected; assert p95 time to last byte ≤ 3 s and stable memory (bytes streamed, not buffered).
- Tool: the load tool already in your repo, or e.g. k6 or Locust. Run on a production-like host before each release — not on a shared CI runner.
- Duplicate replies (0), access revocation (≤ 5 s), member reply rate (30 / 60 s) and token exposure (0) → covered by integration tests in AC coverage, not load. The list, thread, live-push and reply-latency numbers also get a seeded integration assertion in CI (SAD QG-1, QG-3), so a regression shows before the load run.
- Availability 99.5 % monthly → verified by the uptime check on the health endpoint (monitoring), not by a load test.

## CI placement

- On every PR: unit, contract, component, integration (the CI runner already provides a container runtime for the ephemeral database), API-level e2e including the extended token-secrecy suite.
- On every PR or nightly (if PR time grows past budget): e2e-through-UI — the six browser flows.
- Pre-release: load scenarios on a production-like host, plus a manual two-browser check of AC-09 (deactivation and switch with an open inbox) and AC-16.
