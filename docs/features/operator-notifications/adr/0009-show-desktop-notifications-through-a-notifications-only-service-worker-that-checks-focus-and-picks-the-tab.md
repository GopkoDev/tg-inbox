---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead"]
updated_at: "2026-10-19"
feature_size: "M"
ticket: "roadmap step 6 — operator-notifications"
---

# 0009 — Show desktop notifications through a notifications-only service worker that checks focus and picks the tab

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** Architect (autonomous pipeline run, 2026-10-19), to be confirmed by the Tech Lead at review

## Context

AC-02 asks for these rules:
- one desktop notification per browser, even with several tabs open;
- further messages in a conversation replace it;
- it is held back while any tab of that workspace in this browser is **in focus**;
- a visible but unfocused tab does not hold it back;
- a click brings forward the workspace tab **most recently in focus**, with the conversation open.

Each tab gets the same live frames independently and knows only its own focus. The repo has no service worker, no `BroadcastChannel` and no focus code. Permission is asked only on the member's click (AC-03).

## Decision drivers

- AC-02 rules (once per browser, replace, focus test, click to the most recently focused tab)
- AC-03: no permission prompt without a click; the count keeps working without permission
- Robust when tabs close, crash or are throttled in the background
- No new runtime dependency; standard browser APIs only

## Considered options

1. **A notifications-only service worker.** Each tab that qualifies a new message posts a candidate to the worker. The worker calls `clients.matchAll({ type: 'window', includeUncontrolled: true })` and shows nothing if a client of that workspace is `focused`. Otherwise it shows the notification with `tag` = workspace + conversation, and keeps a short dedupe of message ids. On click it focuses the first matching client, which the browser orders by most recent focus, and asks it to open the conversation. It has no `fetch` handler and caches nothing.
2. **Tabs coordinate over `BroadcastChannel` (+ Web Locks).** Tabs broadcast focus events. The most recently focused live tab creates the notification in-page, and its `onclick` focuses itself. No worker. But liveness is guesswork: a crashed or discarded tab sends no goodbye, background timers are throttled, so heartbeats are unreliable, and every tab must agree on who the most recent one is.
3. **Every tab creates the notification with the same `tag`.** No coordination, and the tag collapses duplicates. But no tab knows whether another tab is focused, and the click goes to whichever tab created the notification last, not the most recently focused one. This fails two AC-02 rules.

## Decision outcome

**Chosen:** Option 1. The browser already knows which windows are focused and in what order, and exposes both to a service worker. So the worker meets every AC-02 rule without any tab-to-tab protocol. The `tag` gives "replace instead of stack", and the dedupe gives "once per browser". The worker is registered only after the member turns notifications on, and is limited to notifications.

## Consequences

**Positive**
- No tab election, no heartbeats, no stale leader after a crash.
- Click-to-focus works from a background tab, which page code cannot do reliably.

**Negative**
- A first service worker in the repo: a static file at the origin root, served with `no-cache`, plus a registration lifecycle to test (unit tests with a mocked `clients`).
- `includeUncontrolled` is needed for tabs opened before registration.

**Neutral**
- The same worker could later receive Web Push to notify with no tab open, which spec §3 rules out for now.

## Links

- Spec: [[../spec.md]] AC-02, AC-03, §3
- SAD: [[../sad.md]] §4 supporting choices, §5, §6 flow 3, §11
- Related ADR: [[0008-serve-the-attention-count-from-a-conversations-query-refetched-on-change-signals]]
