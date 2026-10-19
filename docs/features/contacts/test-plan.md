---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Implementing engineer", "Tech Lead", "Security Lead"]
updated_at: "2026-10-19"
feature_size: "M"
---

# Test plan — contacts

The team finds any customer of the workspace on a real Contacts list (search, a tag filter with any of / all of / no tags, and the matching count that is a future segment's size) and reads a contact's profile — Telegram facts, tags with who added each, the tag history and the conversation's state and history — without anything counting as read. Any member adds, removes and creates tags from the inbox conversation header or the profile, within 100 tags per workspace, 20 per contact and 60 recorded changes per member per minute. Only a business owner renames, merges (by renaming into an existing name) and deletes tags, and a delete removes exactly the number of contacts the owner confirmed. A tag or contact of another workspace can never be linked or counted.

> **Assumptions (autonomous run 2026-10-19 — change any row by editing this file before `implement`):**
>
> - Levels were picked per AC with the default heuristic, as in the operator-notifications plan. A pure rule (tag-name tidy and key, limits, merge rule, picker matching) is unit. A repository, use case, route or the live socket against the database is integration. A shape both sides agree on (the shared schemas against `contracts/openapi.yaml` and `events.md`) is contract. A full user story through the API is e2e; through the browser it is e2e-through-UI. A screen state from `screens.md` is component.
> - The **Task** column points at the `tasks.json` id that writes the test. Every row is inside one of the 26 tasks. Five tasks did not yet name every placed test in their DoD, so the DoD was extended in both `tasks.json` and the task file: T10 (empty any / all, renamed tag in a saved link), T11 (renamed meanwhile, create + add counts one, per-workspace budget), T13 (rename name rules, history under the old name, owner entries never counted), T17 (the AC-05 / AC-06 / AC-09 / AC-10 / AC-13 story assertions) and T19 (the row link to the profile, workspace switch reset, sign-in and access-removed round trips).
> - The two code findings of the data-model audit are pinned by tests: capture widens first / last wrote unconditionally, checked with an older message delivered after a newer one (T2); the "all of" filter runs as the grouped semi-join, checked by a query-plan assertion on the 10 000-contact seed (T9) and by its timing (T17).
> - Concurrency is tested with separate pooled connections and committed transactions (two members creating the same name, adds at 99 / 19, a member add racing a merge or a delete), never by mocking a lock.
> - The 60-second change window uses a controllable clock in unit tests (T5) and real committed history rows with chosen `created_at` values in integration tests (T11, T12), so no test waits a minute.
> - Visual-regression stays N/A, as in the earlier features' plans.
> - Load scenarios cover the five spec §6 rows with a latency number. Uniqueness, limits, tenant isolation, history completeness, read state and the change rate carry numbers too, but they are counts and invariants, so they are checked by integration tests and integrity queries (§NFR checks without load), not by a load tool.

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure rules: the shared tag-name tidy / key / grapheme length / tag-list order (T1); the tag limits, history kinds and sources, merge link rule and rate-limit decision (T5); the read and write use cases with in-memory port fakes (T10–T14); the picker's suggestion matching (T22). | In-memory, no external dependency; a controllable clock for the 60-second window. |
| Integration | Migrations 01–06 up, down, backfill shapes and every constraint the audit lists (T2, T3); the capture upsert (T2); the tag, contact-tag, tag-history repositories and the owner set-based statements, each with a cross-workspace isolation case (T6, T7, T8); the list query and its plans (T9); the add / remove / rename / merge / delete use cases with their locks and concurrency (T11–T14); the conversation-of-a-contact read and the read-state proof (T15); every route (T16); the live push of `contact.changed` / `tags.changed` to connected sockets (T4, T17). | An ephemeral real database container per suite with all migrations applied (the repo's existing container helper), never a mocked store. HTTP through in-process injection; the socket through a real connection to the in-process server. |
| Contract | Every request and response shape of the nine operations and the two frames / signals against `contracts/openapi.yaml` and `contracts/events.md` (T4); the web parsing every answer with the same shared schemas (T18); the route answers validated on the way out (T16). | Parse the contract's own examples and the routes' real answers with the shared schemas; no hand-rolled stubs. |
| E2E | One API-level story per user story (T17): tag from the inbox with a teammate's socket updating (US-03), rename → merge → delete with history (US-04), counts equal to the filter (US-05), profile reads leaving read state alone (US-02), renamed customer / deactivated adder / disconnected bot / another workspace (AC-13), and the cross-workspace and secrecy suite. | Real routes against the ephemeral database and the repo's scriptable fake Bot API; database reset before each story. |
| Load | Spec §6: list p95 with search and every filter mode on 10 000 contacts and 100 tags, profile p95, tag change p95, tag live update p95, owner rename / merge / delete p95 on a tag of 10 000 contacts. | The load tool already in your repo, or e.g. k6 or Locust, for the pre-release scenarios; a single-run timing assertion on the same seed runs in CI as an integration test (T17). |
| Component | SCR-18 list and its filter (T19); SCR-19 profile, tag history and crumb (T20); the read-only history (T21); SCR-20 tag control and the SCR-02 header tags (T22); SCR-21 / SCR-23 Settings — Tags and delete (T23); SCR-22 rename and merge (T24); the contacts / tags stores' live re-reads (T18). Every state row of `screens.md` for those screens is a case. | Render in the repo's component harness against a stubbed HTTP layer that answers with contract-valid bodies; assert output, focus and calls (including that the mark-read call is never made). |
| Visual-regression | <!-- N/A: pilot-stage UI still changing; baselines would churn on every layout edit (same decision as shared-inbox, bot-connection, assignment-statuses and operator-notifications). --> | — |
| E2E-through-UI | The browser flows of T25, scripted from `ux-flows.md`: US-01 list → show more → search → any / all / no tags → reload / back → a saved link with a deleted tag; US-02 profile with unread messages → inbox badge unchanged → Open in inbox; US-03 two members, one tags from the header, the other's open profile updates; US-04 rename → merge offer → merge → delete with the count; AC-11 the operator's Settings. | Real browser against the real API, the ephemeral database and the fake Bot API, seeded through the existing e2e world helpers, never through the UI under test. |

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Task | Expected outcome |
|---|---|---|---|---|
| AC-01 happy | `capture keeps first and last wrote by the customer's own send time` | integration | T2 | Insert sets both to the send time; a newer message moves last wrote; an older message delivered later lowers first wrote and leaves the profile; a duplicate, an edit and a team reply change nothing |
| AC-01 happy | `backfill fills first and last wrote from send times` | integration | T2 | The four audit shapes: send time not arrival or edit; one photo; no conversation stays empty; the other workspace untouched |
| AC-01 happy | `list orders by last wrote newest first, ties by id, never-wrote last` | integration | T9 | Seeded order matches; equal times ordered by id; contacts with no send time at the end |
| AC-01 happy | `show more continues strictly after the last row shown` | integration | T9 | Paging through 120 contacts in 50s yields every contact exactly once, across ties and the no-send-time tail |
| AC-01 happy | `list rows carry facts, tags in tag-list order and the total` | integration + contract | T7, T10, T16 | Name, username or none, language or none, first and last wrote, tags in dictionary order ignoring case, and the workspace total; the answer matches the contract shape |
| AC-01 happy | `business owner gets the same list as an operator` | integration | T16 | Identical answer for both roles |
| AC-01 happy | `Contacts list shows real rows with words for missing values and no sample label` | component | T19, T20 | «no username», «Unknown», «Never»; «120 contacts»; Show more appends without repeats; the preview, its sample source and the sample label are gone |
| AC-01 happy | `browse, show more and open a profile in the browser` | e2e-through-UI | T25 | Rows in last-wrote order, the next 50 on request, a row opens the profile |
| AC-02 happy | `search follows the inbox rules` | integration | T9 | Part of the full name or username, any letter case in any alphabet, surrounding spaces and a leading at sign ignored |
| AC-02 happy | `any of, all of and no tags filter with their matching count` | integration | T9 | Any keeps carriers of at least one, all keeps carriers of every chosen tag, no tags keeps contacts with none; the matching count equals the rows across all pages |
| AC-02 happy | `any of or all of with no tag chosen filters nothing` | unit + integration | T9, T10 | Matching count equals the total |
| AC-02 happy | `a renamed tag in a saved link still filters` | unit | T10 | The id resolves and filters; the page shows the new name from the tag list |
| AC-02 happy | `address keeps search, mode and tags across reload, back and a saved link` | component | T19 | The view is restored from the address; malformed or duplicate ids and tags with no-tags mode are dropped before the request |
| AC-02 happy | `switching workspace starts with no search and no filter` | component | T19 | The other workspace's list opens unfiltered |
| AC-02 happy | `filter, reload and back in the browser` | e2e-through-UI | T25 | Each mode narrows the list and shows «N of M contacts match»; reload and back reproduce the view |
| AC-02 error | `no tags together with chosen tags is refused` | unit + contract | T4, T10 | Refused as invalid input naming the tag field; nothing read |
| AC-02 error | `a deleted, merged-away or foreign tag in the address is left out and reported` | unit + component + e2e-through-UI | T10, T19, T25 | The page answers that tag as missing; the panel removes it from the address and says one of the chosen tags no longer exists |
| AC-03 error | `nothing matches shows one sentence with a clear button` | component | T19 | The table is replaced by «No contacts match your search and filter»; Clear removes search, mode and tags |
| AC-03 error | `no contacts yet explains how contacts appear` | component | T19 | The empty card; a business owner whose bot is not connected also gets Connect bot; an operator or a connected bot gets no button |
| AC-03 error | `empty workspace answers zero counts` | integration + contract | T16 | Total and matching counts are zero with no rows |
| AC-04 happy | `profile answers facts and tags with who added each and when` | unit + integration | T10, T16 | Facts, first and last wrote, each tag with its adder's display name and time, in tag-list order |
| AC-04 happy | `tag history pages newest first under the name the tag had then` | integration + unit | T7, T10, T13 | 50 per page, newest first, no repeat or skip; an entry written before a rename still reads under the old name; actors named |
| AC-04 happy | `conversation of a contact answers status, assignee and waiting marker` | integration + contract | T15 | The same summary the inbox gives, for either role |
| AC-04 happy | `profile renders header, conversation card, tabs and tag history` | component | T20 | Every SCR-19 state: facts line, missing facts as words, assignee or «Unassigned», «Waiting for a reply», Open in inbox, the four history line kinds, empty and error states, «No conversation to show» |
| AC-04 happy | `read-only history in inbox order with older pages and media` | component | T21 | Messages, replies with authors and activity entries in inbox order; older pages on scrolling; a photo opens in the media viewer |
| AC-04 happy | `profile is reached from a row, the header's contact name and its address` | component + e2e-through-UI | T19, T22, T25 | Each entry opens the same profile; reload reopens it |
| AC-04 error | `an unknown or foreign contact shows the not-found card` | integration + component | T10, T15, T20 | Not found with no hint for the contact, the conversation and the history; the card inside the frame |
| AC-05 cross-context | `reading the profile's conversation leaves read state untouched` | integration | T15 | After the conversation-of-contact read and thread pages, with a message captured meanwhile, read marks, the unread count and the attention count are exactly as before |
| AC-05 cross-context | `profile reads do not change who is due a ping` | e2e | T17 | The ping sweep's due set is the same with and without the profile reads |
| AC-05 cross-context | `the profile never asks to mark read and has no reply box` | component | T18, T21 | No mark-read request from any contacts or tags code path; no composer rendered |
| AC-05 cross-context | `new messages and state changes appear live on the profile` | component | T18, T21 | A conversation change re-reads the summary, the new items and the contact; status, assignee, waiting marker and a new Telegram name update in place |
| AC-05 cross-context | `the inbox badge stays until Open in inbox` | e2e-through-UI | T25 | Unread badge and attention count unchanged after reading the profile; opening the thread marks it read |
| AC-06 happy | `adding an existing tag records the link, the adder and one added entry` | integration | T11 | The contact carries it with the member and time; one added entry with the source; a contact-changed signal |
| AC-06 happy | `creating a tag by name is its own path and reuses an existing name` | integration | T11 | A new name creates one tag and one added entry and also signals the tag list; a name that differs only in case or spacing applies the existing tag |
| AC-06 happy | `adding a carried tag or removing a missing one changes nothing` | integration | T11, T12 | Answered as unchanged; no entry, no signal, not counted; also when two members act at the same moment |
| AC-06 happy | `removing a tag records one removed entry` | integration | T12 | The link is gone, one removed entry with the tag's current name, a contact-changed signal |
| AC-06 happy | `picker suggests starts-with before contains and marks carried tags` | unit + component | T22 | Groups in tag-list order; carried tags shown as carried; «Create tag "Kyiv"» only when no tag has that name ignoring case and spacing; the guidance line always shown |
| AC-06 happy | `a teammate's open header and profile show the change without reloading` | integration + component + e2e-through-UI | T17, T18, T22, T25 | The frame reaches every socket of the workspace and none of another; the open header and profile re-read and update |
| AC-06 happy | `the list filter finds the contact by its new tags` | e2e | T17 | Any of with the new tags returns the contact |
| AC-06 happy | `no tag change is ever sent to Telegram` | e2e | T17 | The fake Bot API records no send during any tag operation |
| AC-07 error | `tag names outside 1 to 32 characters are refused` | unit | T1 | Empty, spaces only and zero-width only refused; 32 graphemes accepted; 33 refused; an emoji counts as one |
| AC-07 error | `the server refuses an invalid name and creates nothing` | integration | T11 | Refused with the name-rules message; no tag, no link, no entry |
| AC-07 error | `a rename follows the same name rules` | unit + integration | T13 | Refused; the tag keeps its name |
| AC-07 error | `tag control and rename dialog say 1 to 32 characters without sending` | component | T22, T24 | The field error in place; no request made |
| AC-08 invariant | `names that differ only in case or spacing share one key` | unit | T1 | «vip», « VIP » and «VIP  » share the key of «VIP»; «V  I P» is a different tag |
| AC-08 invariant | `the database refuses a second tag with the same key` | integration | T3 | Refused in the same workspace; allowed in another |
| AC-08 invariant | `two members creating the same name at once end with one tag` | integration | T11 | One tag, applied to both contacts |
| AC-08 invariant | `the 100th tag and the 20th tag on a contact are hard limits under concurrency` | unit + integration | T5, T11 | Concurrent creates at 99 end at exactly 100; concurrent adds at 19 end at exactly 20; a 21st with a new name creates no tag either |
| AC-08 invariant | `tag control shows both limit messages` | component | T22 | At 20 carried the suggestions and create are disabled with the message; the workspace limit message names Settings → Tags |
| AC-09 happy | `rename keeps the tag's identity and writes no history` | integration | T13 | Same id; every carrier shows the new name; no entry; a case-only rename changes only how it is shown; the same text changes nothing |
| AC-09 happy | `renaming into another tag's name offers the merge with that tag's count` | integration + component | T13, T24 | Refused as taken with the existing tag and its count; the dialog's second step names both tags and counts |
| AC-09 happy | `merge keeps adders and records one merged entry per carrier` | unit + integration | T5, T8, T13 | On the spec's seed «VIP» ends on 14 contacts; the contact that had both keeps the earlier addition; each of the 3 carriers gets one merged entry; target-only contacts get none |
| AC-09 happy | `a merge target that moved is asked again` | integration + component | T13, T24 | Refused with the current holder of the name or none; the dialog asks again |
| AC-09 happy | `delete removes exactly the confirmed number and records each removal` | integration + component | T14, T23 | With a matching count the tag leaves the workspace and its 40 contacts, each with a deleted entry; the dialog states the number first |
| AC-09 error | `a delete whose count changed deletes nothing and asks again` | integration + component | T14, T23 | Refused with the current count; nothing deleted; the dialog shows the new number and sends it next time |
| AC-09 happy | `owner changes reach open headers and profiles live` | e2e | T17 | One tag-list signal per rename, merge or delete reaches every socket of the workspace |
| AC-09 happy | `rename, merge and delete in the browser` | e2e + e2e-through-UI | T17, T25 | The story's history entries appear on the affected profiles |
| AC-10 happy | `tag list in dictionary order ignoring case with counts, zero included` | integration | T6, T13 | Every tag, accented and Cyrillic names in their own order, unused tags with zero |
| AC-10 happy | `a tag's count equals the list's matching count for that tag` | e2e | T17 | For every seeded tag the two numbers are equal |
| AC-10 happy | `Settings — Tags lists counts as links with rename and delete and no create` | component | T23 | Every SCR-21 state; a count opens the Contacts list filtered by that tag |
| AC-11 authorization | `an operator cannot rename, merge or delete a tag` | integration | T16 | Refused as owners only; nothing changes, including through a crafted request |
| AC-11 authorization | `an operator still reads the tag list and tags contacts` | integration | T16 | Tag list, add, create and remove succeed for an operator |
| AC-11 authorization | `an operator sees no Tags section and gets the owners-only card on its address` | component + e2e-through-UI | T23, T25 | No Tags in the Settings menu; «Only a business owner manages the workspace's tags» on the address |
| AC-12 authorization | `every contacts and tags route refuses outsiders the guard's way` | integration | T16 | Signed out asked to sign in; another workspace's account gets not found with no hint; a deactivated member gets access removed |
| AC-12 authorization | `no foreign contact or tag can be named, linked or counted` | integration + e2e | T3, T11, T12, T17 | A foreign tag on an own contact and an own tag on a foreign contact are refused (by the database too); a remove of a foreign id answers unchanged; no list, filter or count crosses workspaces |
| AC-12 authorization | `every repository isolates workspaces` | integration | T6, T7, T8, T9 | Each method's isolation case over two workspaces with a same-named tag |
| AC-12 authorization | `contacts addresses land on sign-in, access removed or not found` | component | T19, T20 | Sign-in returns to the same address with search and filter; access removed shows the landing; an unknown contact shows the not-found card |
| AC-13 cross-context | `a renamed customer keeps their tags and a deactivated adder stays named` | unit + e2e + component | T10, T17, T20 | The new name with the same tags; adders and history actors shown by display name after deactivation |
| AC-13 cross-context | `tagging, the list and profiles work with the bot stopped or disconnected` | e2e | T17 | Every contacts and tags operation succeeds with no bot connected |
| AC-13 cross-context | `the same person in another workspace is a separate untagged contact` | integration + e2e | T2, T17 | Capture creates a second contact in the other workspace; it carries none of the tags |
| AC-14 invariant | `a tag deleted or merged away before the pick is not added` | integration + component | T11, T13, T22 | Refused as no longer existing; nothing written; the control says so and shows the current tags |
| AC-14 invariant | `a tag renamed before the pick is added under its new name` | integration | T11 | Added under the new name; no tag of the old name created |
| AC-14 invariant | `a member add racing an owner's merge or delete never leaves a tag outside the list` | integration | T13, T14 | The add lands first and is re-pointed or removed with history, or is refused as no longer existing; no deadlock |
| AC-14 invariant | `a rename or delete of a tag gone meanwhile shows the tag-gone notice` | component | T23, T24 | The dialog closes; Settings — Tags re-reads without it |
| AC-15 error | `the 61st recorded tag change within 60 seconds is refused` | unit + integration | T5, T11, T12 | Refused with the time the member can continue; adds and removes share the budget |
| AC-15 error | `only recorded changes count` | integration | T11 | An unchanged add counts none; create + add counts one |
| AC-15 error | `owner rename, merge and delete are not counted or limited` | integration | T13 | An owner's thousands of merged entries do not count; owner routes never answer the rate refusal |
| AC-15 error | `the limit is per workspace` | integration | T11 | Changes of the same account in another workspace do not count |
| AC-15 error | `the rate refusal carries when to continue` | contract + integration | T4, T16 | The retry time in the body and the same time in whole seconds in the response header |
| AC-15 error | `the tag control counts down to when changes can continue` | component | T22 | The message with the countdown; add and remove disabled until then |

## Edge cases / error paths

- Request body naming both a tag id and a name, or neither → expected: refused as invalid input; nothing written.
- Member route sent with the source «settings» → expected: refused as invalid input.
- Merge into the same tag → expected: refused as invalid input.
- Repeated delete of the same tag → expected: refused as no longer existing (idempotent by state).
- Rename to the same text → expected: answered as unchanged; nothing published.
- Tag name made only of zero-width characters, or with non-breaking spaces and line breaks inside → expected: refused / tidied to single spaces.
- A list cursor issued for another search or filter → expected: refused as invalid input or treated as a fresh first page, never rows of another filter.
- More than 100 tag ids in the address → expected: dropped by the panel; refused as invalid input by the server.
- A contact whose conversation is missing (should not occur) → expected: the conversation card says «No conversation to show»; the contact part stays.
- An older browser tab that does not know the two new frames → expected: the frames are ignored and the socket stays open; the next read shows the change.
- A background re-read on the profile or the header fails → expected: what is shown stays; the next frame or resync asks again.
- Tag name, contact name or username with markup → expected: rendered as text everywhere.
- Logs on the tag paths → expected: ids and outcome codes only; never a tag name, contact name or username; the merge log event carries ids only.
- Rollback of migrations 06 → 01 on a database with tags, links and history → expected: every down runs cleanly and the schema returns to its earlier shape; re-applying restores the backfilled times.

**Cross-workspace isolation (spec §6.1, SAD QG-1 (e)):** every new repository method in `contacts` (tags, contact tags, tag history, the list query, the profile read, the contact row lock) gets its own integration test on `twoWorkspacesWithTags` (two workspaces, each with a tag named «VIP» of the same key and different ids) (T6, T7, T8, T9); every contacts and tags route gets a foreign-workspace case (T16); the e2e tenancy suite names foreign contact and tag ids on every write and checks every count and filter (T17). No new controlled tenancy exception exists, so none is tested.

## NFR checks without load (counts and invariants)

- **Tag uniqueness — 0 workspaces with two tags of one normalised name:** the unique key (T3), concurrent creation of «Kyiv» / « kyiv » by two members (T11), and integrity query 1 below.
- **Tag limits — 0 workspaces over 100 tags, 0 contacts over 20 tags:** concurrent creates at 99 and adds at 19 (T11), integrity query 2.
- **Tenant isolation — 0 contacts carrying a tag of another workspace:** the composite foreign keys (T3), the isolation suite (T6–T9, T16, T17), integrity query 3.
- **Tag history completeness — 0 additions or removals without an entry:** one test per change path asserting the entry — member add (T11), member remove (T12), merge (T8, T13), delete (T14) — and integrity query 4 after every e2e story.
- **Read state untouched by profile — 0 changes:** the read-state integration test (T15), the ping-due assertion (T17) and the no-mark-read component and store tests (T18, T21).
- **Tag change rate — ≤ 60 per rolling 60 s per member per workspace:** the 61st refused (T11, T12), the per-workspace budget (T11), owner paths not counted (T13).
- **List uses its keyset index and the all-of filter is the grouped semi-join:** query-plan assertions on the seeded data (T9).
- **Integrity queries (T17), run after every API e2e story and after the concurrency tests of T11, T13 and T14; each must return no row. The same queries go into the run book (SAD §7):**
  1. two tags of a workspace with the same name key;
  2. workspaces over 100 tags, contacts over 20 tags;
  3. contact tags whose tag or contact belongs to another workspace;
  4. contact tags with no history entry for that contact that is either an addition of the link's tag or a merge into it.
- **Availability 99.5 % monthly:** verified by the uptime check on the health endpoint (monitoring), not by a test.

## Test data

- Seed strategy: the builders in `apps/api/src/test/fixtures/` extended per `data-model.md` §Test fixtures. `insertContact` gains first and last wrote (both empty by default, T2). The new builders in `fixtures/tags.ts` (T3): `insertTag` (tidies the name and computes its key with the shared function, so no test hand-writes a key), `insertContactTag` (inserts the link and, by default, its added entry, so integrity query 4 holds in every test), `insertTagHistory` (for keyset and rate-limit tests, with chosen times), and `twoWorkspacesWithTags` (two workspaces, each with an owner and an operator, two contacts, a «VIP» tag of the same key and one link). Synthetic ids, `Test User` names and `@example.test` addresses only.
- The AC-09 seed: «VIP» on 12 contacts, «vip-clients» on 3 (one also carrying «VIP»), «Old promo» on 40 — shared by T8, T13, T14 and T17.
- The load seed (T9 plans, T17 timings): 10 000 contacts with spread last-wrote times (a few without), 100 tags, about 30 000 links (a few tags on most contacts, many on few), about 60 000 history entries including a recent owner merge burst, built with set-based inserts in the test, not row by row.
- Telegram side: the repo's scriptable fake Bot API; customer messages arrive as recorded update bodies posted to the real webhook route with the per-bot secret (AC-13 rename, older-message-after-newer). The fake records every send, so «no tag change reaches Telegram» is asserted on its record.
- Time: a controllable clock port for the 60-second window and for history times in unit tests; integration tests write history rows with chosen times instead of waiting.
- Integration dependency: an ephemeral real database container per suite with all migrations applied, NOT a mocked store. Concurrency tests use separate pooled connections with committed transactions.
- Cleanup boundary: per test. Every test truncates the feature's tables (tags, contact tags, tag history, plus the contacts, inbox, membership and bot set) and resets the fake Bot API and the clock. API e2e stories reset the database before each story. Browser flows reset it and close every socket and browser context between flows. Containers remove their data on stop, also after a failed run.

## NFR validation (load)

- Contacts list p95 ≤ 500 ms server time (first page with search and a tag filter, including the matching count; 10 000 contacts, 100 tags) → scenario: on the load seed, 10 requests/s for 5 min, spread evenly across no filter, `any` with 2 tags, `all` with 2 and with 5 tags, `none`, each half with and half without a search; assert p95 server time ≤ 500 ms per mode (all-of included) and no error.
- Contact profile p95 ≤ 500 ms (profile, conversation summary, first thread page and first tag-history page) → scenario: 10 profile opens/s for 5 min over random seeded contacts; assert p95 of each read ≤ 500 ms.
- Tag change p95 ≤ 300 ms (add, remove, create) → scenario: 10 members each making 0.8 changes/s (under the 60-per-minute limit) for 5 min on random contacts, a fifth of them creates; assert p95 ≤ 300 ms and zero rate refusals.
- Tag live update p95 ≤ 3 s (change recorded → shown in another member's open profile or header) → scenario: during the tag-change scenario, 20 sockets of the workspace connected; assert p95 from commit to frame on a socket ≤ 3 s, plus the following contact re-read within the same budget.
- Owner rename / merge / delete p95 ≤ 2 s on a tag carried by 10 000 contacts → scenario: 20 sequential operations (rename, merge into another tag carried by half the contacts, delete), re-seeding between them; assert p95 ≤ 2 s each, with the member tag-change scenario running alongside and no deadlock.
- Tool: the load tool already in your repo, or e.g. k6 or Locust. These run on a production-like host before release; a single-run version of each (one request per mode, one operation per owner kind, one change-to-push) asserts the same thresholds in CI as part of T17.

## CI placement

- On every PR: unit, contract, component, integration (the CI runner already provides a container runtime for the ephemeral database) including the concurrency tests, the read-state proof, the query-plan checks, the integrity queries, the API-level e2e stories with the tenancy and secrecy suite, and the single-run timing checks on the 10 000-contact seed (T17).
- On every PR, or nightly if PR time grows past budget: e2e-through-UI, the browser flows of T25.
- Pre-release: the five load scenarios on a production-like host, and a manual pass with two real browsers tagging the same contact from the inbox and the profile.
