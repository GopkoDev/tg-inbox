---
status: Draft
owner: "Dmytro Hopko (QA + implementer)"
updated_at: "2026-11-03"
feature_size: "M"
---

# Test plan — group-posts

> Maps every acceptance criterion in [spec.md](spec.md) §5 to at least one named test. `implement` writes the red tests from this map at the level stated here. Levels are generic; `implement` uses the runners the repo already has. Autonomous run (2026-11-03): every level below was chosen by the skill from the default heuristic; each can be vetoed at review.

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure logic: post transitions, schedule window, 15-minute rule, limits, connect-code parsing, update classification, time-zone conversion, Telegram link | In-memory, no external dependency; app use cases with in-memory port fakes |
| Integration | posts / bots / workspaces against the real database and job queue; Telegram through the repo's fake Bot API | An ephemeral real database container per suite (the repo's existing harness applies migrations); fake clock for time |
| Contract | The HTTP shapes in `contracts/openapi.yaml` and the live frames in `contracts/events.md` | Parse every contract example with the shared schemas; route responses validated by the same schemas |
| E2E | One API story per critical user story | The HTTP entry point (in-process inject) against the ephemeral database and fake Telegram |
| Load | Capture speed under group traffic; on-time sending | The load tool already in your repo, or e.g. k6 or Locust (a seeded integration timing test where the repo has none) |
| Component | SCR-33…SCR-44 components, every state row in `screens.md` | Render in the repo's component harness; assert output + interactions |
| Visual-regression | — | <!-- N/A: the repo has no visual baseline suite; screens are checked by component tests --> |
| E2E-through-UI | The `ux-flows.md` flows US-01…US-06 | Driven through the real panel against the real API, ephemeral database and fake Telegram |

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Expected outcome |
|---|---|---|---|
| AC-01 happy | a code posted in a channel connects it live and is used up | unit + integration + e2e + e2e-through-UI | destination listed with title and kind; code used; code message removed when allowed; open panel updates |
| AC-02 invariant | a chat without the right to post, a chat with no code, and an expired or used code connect nothing | unit + integration | not connected; result names the missing right / expired; no destination row |
| AC-03 authorization | an operator cannot connect, remove, publish, schedule, delete a published post or change the zone | integration + component | refused with "only a business owner"; owner actions hidden; saved owner address opens the post |
| AC-04 authorization | another workspace's post, destination or code looks unknown | integration + e2e | not found with no hint; repositories isolated per workspace |
| AC-05 happy | a member's draft saves as typed and appears for everyone | integration + component | draft saved with destination, text, sound option; list row live |
| AC-06 error | empty, too long or destination-less drafts cannot go out, and a stale save never overwrites | unit + integration + component | publish / schedule blocked with the reason; stale save refused with the current version |
| AC-07 happy | an owner publishes now and the post appears once with a way to open it | integration + e2e + e2e-through-UI | published with time, owner, link; text and destination frozen; duplicate available |
| AC-08 invariant | double confirm, two owners, a changed draft and a restart mid-send never send twice | integration | one send; changed draft refused; unanswered send ends not confirmed and is never repeated |
| AC-09 happy | a post scheduled for 09:00 in the workspace zone goes out within a minute with nobody online | unit + integration + e2e + e2e-through-UI | scheduled label with zone; accepted ≤ 60 s after the time; back to draft and change time work |
| AC-10 error | a time under 2 minutes, over 90 days, or skipped by daylight saving is refused | unit + integration + component | not scheduled; allowed range or "time does not exist" shown |
| AC-11 invariant | editing a scheduled post or deactivating its owner returns it to a draft | integration + component | back in drafts (with notice on deactivation); goes out only after an owner schedules again; demoted owner caught at the send |
| AC-12 cross-context | a post that cannot start within 15 minutes is missed and never sent later | unit + integration + e2e | missed with reason; attention counted; posts inside the window still go out in order after an outage |
| AC-13 error | a refusal from Telegram fails the post with a plain reason and marks the destination | integration + component | failed with reason; counted for attention until opened; destination unavailable with problem |
| AC-14 cross-context | a bot that stopped working or was replaced refuses posting and fails due posts | integration | refusals with the way to bot settings; due posts fail with the right reason; old bot's destinations unavailable; upgraded group keeps working |
| AC-15 happy | an owner deletes a fresh post from the chat and it stays as a deleted record | integration + e2e-through-UI | message deleted; post marked deleted with owner and time; past 48 hours or on refusal the bot cannot delete it |
| AC-16 invariant | the 31st post in 24 hours and the 101st scheduled post are refused | unit + integration | refused with the limit and when posting frees up; a due post over the daily limit fails with that reason |
| AC-17 cross-context | group traffic is never captured and posts never slow support | unit + integration + load | no contact, conversation, unread or ping from a destination; a post rate limit sets no bot pause; capture and reply speed unchanged |
| AC-18 authorization | only the author or an owner deletes a draft, and only a draft | integration + component | other operator refused; scheduled must go back first; sent posts kept |

## Edge cases / error paths

| Case | Expected outcome |
|---|---|
| a code posted in a chat that is already a destination (available, unavailable or removed) | the same destination revives; no second row; slot count unchanged |
| a membership update older than the stored one arrives late | ignored |
| a group upgrade arrives before a scheduled post's time | the post goes to the new chat |
| three posts due at 09:00 in one chat | sent in scheduled order, at least 3 seconds apart |
| a job for a moment the post no longer has (time changed) | exits without sending |
| a stale claim found by a retry or the dead letter | settled as not confirmed, never sent |
| Telegram does not answer a delete | stays published, the owner is told Telegram is not responding |
| the workspace time zone changes with posts scheduled | every post keeps its instant; labels change |
| the live socket reconnects | lists and the post re-read; nothing missed |
| post text, chat title, username, code or chat id | never present in logs, frames or job payloads |

## Test data

- **Seed:** factories through the posts app layer and the existing workspace / membership / bot fixtures; the fake Bot API scripts `sendMessage`, `deleteMessage` and `getChatMember` answers per call; group, supergroup and channel update fixtures. Names and emails use the repo's placeholder fixtures (`@example.test`, "Test User").
- **Cleanup boundary:** per suite — the ephemeral database is created for the suite and removed after it (also on failure); each test uses its own workspace, so tests never share rows.
- **Time:** an injectable clock for scheduling, the 15-minute window, 48 hours and the daily limit; no real waiting.

## NFR validation (load)

| NFR (spec.md §6) | Scenario | Metric + threshold |
|---|---|---|
| Customer capture unaffected | a destination group receives 10 updates per second for 60 s while private messages arrive at 2 per second | p95 private capture time within ± 1 s of a run without group traffic |
| Scheduled post on time | 20 posts due in the same minute across 5 workspaces and 3 posts in one chat | first post per chat accepted p95 ≤ 30 s, max ≤ 60 s after its time; each further post in the same chat ≤ 3 s later |
| Publish now | 20 sequential publishes | p95 ≤ 5 s from confirm to published |
| Reply latency unaffected | replies at 2 per second while posts go out for 60 s | reply send → accepted p95 ≤ 2 s |
| Live updates / destination connect | outcome and code changes with an open socket | p95 ≤ 3 s change → frame; code posted → destination shown p95 ≤ 5 s |

## CI placement

- Every PR: unit, contract, integration, component, API e2e (the repo already runs its database-backed suites in CI).
- Pre-release / on demand: e2e-through-UI and the load / timing scenarios.
