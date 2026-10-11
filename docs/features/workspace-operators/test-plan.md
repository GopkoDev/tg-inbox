---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Implementing engineer", "Tech Lead"]
updated_at: "2026-10-11"
feature_size: "M"
---

# Test plan — workspace-operators

A platform admin creates a workspace with a single-use first-owner invitation; people join by invitation, sign in with email and password, switch between their workspaces, and business owners run the team — while no workspace ever sees another's data and a deactivated member loses access within 5 s.

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure rules in `auth/domain` and `workspaces/domain`: password policy, email normalisation, lockout window, invitation and reset-link validity, "already a member", "at least one active business owner"; app-layer use cases with in-memory port fakes; shared request schemas. | In-memory, no external dependency; time comes from a fake clock port. |
| Integration | Repositories, use cases and HTTP routes of `auth` and `workspaces` against a real database; the admin CLI commands against the same database. | An ephemeral real database container per suite with every migration applied; routes exercised through the in-process HTTP entry point of `buildApp()`; a controllable clock for expiry, lockout and session idle time. |
| Contract | (a) Every API response body against the zod schemas in `packages/shared` and against `contracts/openapi.yaml`; (b) admin CLI output and exit behaviour against `contracts/cli.md`. | Validate real responses produced by the integration suite against the agreed shapes; no hand-rolled stubs. |
| E2E | One full flow per user story through its real entry point — HTTP API for US-02…US-07, the admin CLI then the HTTP API for US-01 and US-08. | Multi-step scenario against an ephemeral database; each step uses only what an earlier step returned (links, cookies). |
| Load | Spec §6 latency NFRs (sign-in p95, team / switch / invite p95). | The load tool already in your repo, or e.g. k6 or Locust; run against a production-like host, not a CI runner. |
| Component | Each screen of `screens.md` (SCR-01…SCR-10) and the shared guard handler of the API client, every state row of the manifest. | Render the screen in a component harness with a stubbed API client; assert the rendered state and the navigation it triggers. |
| Visual-regression | <!-- N/A: pilot-stage UI still changing; baselines would churn on every layout edit. Revisit once the design canon is stable. --> | — |
| E2E-through-UI | Six critical flows from `ux-flows.md` driven through the built web panel served from the same origin as the API. | A real browser against the API + an ephemeral database; data seeded through the admin CLI / app layer, never through the UI under test. |

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Expected outcome |
|---|---|---|---|
| AC-01 happy | `admin creates workspace with first-owner invitation` | integration + contract + e2e | Workspace exists with no members; one pending business-owner invitation for the normalised email; the link is printed once on CLI output and never stored in clear; an audit line names the action without the link |
| AC-01 happy | `workspace awaiting its owner is invisible to everyone` | integration | No account can list, enter or read the workspace until the invitation is accepted |
| AC-01b happy | `admin re-issues first-owner invitation and the old link stops working` | unit + integration + e2e | Earlier invitation is superseded; a new 7-day business-owner invitation exists for the same email; the old link is refused, the new one accepted |
| AC-01b edge | `re-issuing for a workspace that already has members is refused` | integration | Nothing changes; the admin is told the workspace already has members |
| AC-02 error | `create workspace with empty name is rejected` | unit + integration | Nothing is created; the admin is told the name is missing |
| AC-02 error | `create workspace with invalid owner email is rejected` | unit + integration | Nothing is created; the admin is told the email is not valid |
| AC-03 happy | `new person accepts invitation and lands in the workspace` | integration + e2e + e2e-through-UI | Account created, active membership with the invited role, signed in on this device, workspace home of that workspace opens |
| AC-03 component | `accept invitation screen shows new-account form` | component | SCR-02 shows workspace name, read-only email, role, name + password fields |
| AC-04 cross-context | `existing account accepts invitation with its current password` | integration + e2e + e2e-through-UI | New membership added; every other membership of the account unchanged; no second account created |
| AC-04 cross-context | `existing account signed in on this device still confirms password` | integration | Acceptance requires the existing password even with a live session for the same email |
| AC-04 error | `wrong existing password during acceptance counts toward lockout` | integration | Acceptance refused with the generic credentials message; the failure is counted for that email |
| AC-04b authorization | `invitation opened by a different signed-in account is refused` | integration + component | No membership added to the signed-in account; SCR-03 explains the invitation belongs to another email and offers sign-out |
| AC-05 error | `password shorter than 10 characters is rejected` | unit + integration + component | No account created; the person is told the password must be at least 10 characters (also checked before submit) |
| AC-05b error | `form fields are checked with the shared schemas before submit` | component + integration | Component: a too-long password (accept as new or existing account, reset, sign-in), a blank / whitespace-only / over-200-character name, an invalid email (sign-in, invite), or an empty sign-in email or password shows the shared message under the field and sends no request; an existing account's short password is not blocked (AC-04). Integration: accept and sign-in answer a password over 1024 characters, sign-in answers an empty password, and accept answers a blank name, with the same shared message on `details.field` |
| AC-06 domain invariant | `expired invitation is refused` | unit + integration | Refused as no longer valid; the person is told to ask a business owner |
| AC-06 domain invariant | `used invitation is refused` | unit + integration | Second acceptance refused; no second membership |
| AC-06 domain invariant | `revoked or replaced invitation is refused` | unit + integration | Refused as no longer valid |
| AC-06 domain invariant | `invalid first-owner invitation points to the tg-inbox team` | integration + component | Refusal says to ask the tg-inbox team instead of a business owner |
| AC-07 happy | `sign-in opens the last-used workspace` | integration + e2e + e2e-through-UI | Session cookie set; the last-used active workspace opens |
| AC-07 happy | `sign-in with one active membership opens it` | integration + component | That workspace opens without the picker |
| AC-07 happy | `sign-in with unavailable last-used workspace and several memberships shows the picker` | integration + component | Picker lists only active memberships; picking one opens it |
| AC-08 error | `unknown email and wrong password get the same refusal` | integration + component | Identical refusal message and shape in both cases; no account existence revealed |
| AC-09 domain invariant | `ten failures lock the email for fifteen minutes` | unit + integration | 11th attempt with the correct password refused as "too many failed attempts"; lock lifts 15 min after the 10th failure |
| AC-09 domain invariant | `lockout is indistinguishable for an email without an account` | integration | Same sequence on an unknown email yields identical responses |
| AC-09 domain invariant | `successful sign-in clears the failure count` | unit + integration | After a success, 9 further failures do not lock |
| AC-10 authorization | `sign-in with every membership deactivated shows no access` | integration + component | Signed in, but no workspace data is returned; SCR-05 shown with sign-out |
| AC-11 happy | `sign-out ends only this device's session` | integration + e2e-through-UI | That session is refused afterwards and the panel asks to sign in; another device's session keeps working |
| AC-12 happy | `switching workspace scopes this device only and becomes the next sign-in default` | integration + e2e + e2e-through-UI | This device shows only "Bolt Bikes" data; another device stays in "Acme Flowers"; next sign-in anywhere opens "Bolt Bikes" |
| AC-13 authorization | `never-member opening a foreign workspace sees not found` | integration + component | Same neutral not-found as for a non-existent workspace; no workspace name or item hint (SCR-10) |
| AC-13 authorization | `every workspace-scoped route refuses a foreign workspace` | integration | For each route under the workspace prefix, a session from another workspace gets the neutral not-found and no data |
| AC-14 happy | `owner invites a new email as operator and sees the link once` | integration + contract + e2e + e2e-through-UI | Pending 7-day invitation appears in the team list; link returned only in the creation response; earlier pending invitation for the same email stops working |
| AC-15 authorization | `operator cannot invite` | integration + component | Refused with "only business owners manage the team"; nothing created |
| AC-15 authorization | `operator cannot list, deactivate, reactivate or revoke` | integration + component | Each owner-only action refused the same way; SCR-07 shows the owners-only state; operators see no Team entry |
| AC-16 domain invariant | `inviting an active member is refused` | unit + integration + component | Refused as already a member; no invitation created |
| AC-16 domain invariant | `inviting a deactivated member suggests reactivation` | unit + integration | Refused as already a member, told to reactivate instead |
| AC-17 cross-context | `deactivated member is refused within five seconds on every session` | integration + e2e | With two open sessions, the next request from each to "Acme Flowers" is refused as access removed; requests to "Bolt Bikes" still succeed; account intact |
| AC-17 cross-context | `panel clears workspace data and moves the member on access removed` | component + e2e-through-UI | At the first refusal the workspace's data leaves the screen, a notice names the workspace, the panel moves to another active workspace or SCR-05 |
| AC-18 domain invariant | `deactivating the last active owner is refused` | unit + integration + component | Refused with "a workspace must always have at least one active business owner"; state unchanged |
| AC-18 domain invariant | `owner may deactivate themselves while another owner remains` | unit + integration | Self-deactivation succeeds |
| AC-18 domain invariant | `two simultaneous owner deactivations keep one active owner` | integration | Of two concurrent deactivations of the last two owners at most one succeeds; at least one active owner remains |
| AC-19 happy | `reactivated member regains access with the previous role` | unit + integration + component | Member can act in the workspace again with the same role |
| AC-20 happy | `team list shows members and pending invitations without links` | integration + contract + component | Name, email, role, state per member; email, role, expiry per invitation; no link or token anywhere in the response |
| AC-20 happy | `revoked invitation disappears and its link stops working` | integration + e2e | Invitation leaves the pending list; opening its link is refused as no longer valid |
| AC-21 happy | `redeeming a reset link signs in and ends every other session` | integration + e2e | New password works; this device signed in; every other session refused; failure count cleared; link single-use |
| AC-21 happy | `new reset link supersedes the earlier unused one` | integration | Earlier link refused; link printed once by the CLI |
| AC-21 component | `set new password screen sets the password and resolves the workspace` | component | SCR-09 submits and lands on workspace home / picker / no access per AC-07 |
| AC-22 domain invariant | `reset link older than 24 hours is refused` | unit + integration + component | Refused as no longer valid (SCR-03); password unchanged |
| AC-22 domain invariant | `used reset link is refused` | unit + integration | Second redemption refused; password unchanged |

**E2E-through-UI scope (six flows, from `ux-flows.md`):** join as a new person (AC-03), join with an existing account (AC-04), sign in and sign out (AC-07, AC-11), switch workspace (AC-12), invite a teammate (AC-14), deactivate a member with an open second tab (AC-17).

## Edge cases / error paths

- Email with different case and surrounding spaces (` Bob@x.com` vs `bob@x.com`) → expected: treated as the same account in sign-in, lockout, invitation acceptance and the already-a-member check (spec §6.1).
- Invitation or reset link with a malformed or unknown token → expected: refused as no longer valid, same as an expired one; no hint whether it ever existed.
- Malformed or unknown workspace id in a workspace-scoped address → expected: the same neutral not-found as a foreign workspace.
- Invitation revoked between lookup and submit → expected: acceptance refused as no longer valid; no account or membership created.
- Two acceptances of the same invitation at the same moment → expected: exactly one membership; the other refused as no longer valid.
- Two account creations for the same email at the same moment (two invitations to different workspaces) → expected: one account; the second acceptance is refused cleanly by the unique email and nothing is half-written (the person retries and joins with the existing password).
- Session idle 30 days with only background requests → expected: session ended, next action asks to sign in; a user action on day 29 keeps it alive.
- Missing or expired session on any authenticated route → expected: refused as not signed in; the panel goes to sign-in and returns to the opened address afterwards.
- Mutating request with a non-JSON body → expected: refused, nothing changed (CSRF guard, ADR-0004).
- Password longer than 1024 characters or a blank display name → expected: rejected with the field named.
- Deactivate / reactivate / revoke on an item no longer in this workspace → expected: refused as not found; SCR-07 refreshes the lists.
- Picking a workspace in the picker that was removed meanwhile → expected: refused; the list reloads with "that workspace is no longer available".
- Network failure or server error on any screen load or action → expected: the screen's own error state with retry; forms keep their input.
- Logs during sign-in, acceptance, reset and CLI actions → expected: no password, session token, link or link token appears in any log line; cookies redacted.
- Database unavailable → expected: the health endpoint reports failure and actions fail with the generic error — fail-closed, never granting access.

**Cross-workspace isolation (spec §6 NFR, SAD QG-1a):** every `workspaces` repository method gets its own integration test with two seeded workspaces proving it never returns or changes the other workspace's rows; the three controlled exceptions (memberships of an account, invitation by token hash, membership for the guard) each get a dedicated test proving they are scoped by the account / token / (account, workspace) they claim.

## Test data

- Seed strategy: factories per `data-model.md` entity — account (normalised email, hashed password with low-cost test parameters), session, sign-in failure, password-reset link, workspace, membership (role, state, last used time), invitation (role, expiry, state). A "two workspaces, one shared operator" fixture ("Acme Flowers" + "Bolt Bikes") backs every isolation, switch and deactivation test. Link and session tokens are generated by the same helper production uses so only hashes are stored.
- Time: a controllable clock port injected into the app layer; expiry (7 days, 24 hours), lockout (15 minutes) and session idle (30 days) are driven by advancing it, never by sleeping.
- Integration dependency: an ephemeral real database container per suite with all migrations applied — NOT a mocked store. E2E and E2E-through-UI use their own ephemeral database and seed through the admin CLI / app layer.
- Cleanup boundary: per-test — every test truncates the feature's tables (or runs in a rolled-back transaction where the code under test allows it); concurrency tests (AC-18, simultaneous acceptance) use committed transactions and truncate afterwards. E2E suites reset the database before each flow.

## NFR validation (load)

- Latency p95 sign-in ≤ 500 ms → scenario: 5 sign-ins/s for 5 min across distinct seeded accounts (no lockout triggered), with production password-hash parameters; assert p95 request duration ≤ 500 ms and zero server errors.
- Latency p95 team / switch / invite ≤ 300 ms → scenario: 20 requests/s for 5 min, a mix of list team, enter workspace and create invitation across seeded workspaces; assert p95 per route ≤ 300 ms and zero server errors.
- Tool: the load tool already in your repo, or e.g. k6 or Locust. Run on a production-like host before each release — not on a shared CI runner, where hashing cost skews the numbers.
- Deactivation ≤ 5 s, brute-force (10 / 15 min), session lifetime (30 days) → covered by integration tests in AC coverage, not load.
- Availability 99.5% monthly → verified by the uptime check on the health endpoint (monitoring), not by a load test.

## CI placement

- On every PR: unit, contract, component, integration (the CI runner already provides a container runtime for the ephemeral database), API-level e2e.
- On every PR or nightly (if PR time grows past budget): e2e-through-UI — the six browser flows.
- Pre-release: load scenarios on a production-like host, plus the manual two-browser check of AC-17 (SAD QG-1b).
