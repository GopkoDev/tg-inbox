# Tracker — workspace-operators

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | [Promote the seven staged migrations and regenerate DB types](./t01-promote-migrations.md) | migration | Dmytro Hopko | M | — | done |
| T2 | [Add platform primitives: error classes and codes, clock port, link tokens, config keys](./t02-platform-primitives.md) | infra | Dmytro Hopko | M | — | done |
| T3 | [Define the auth and workspaces zod contracts in packages/shared](./t03-shared-contracts.md) | ports | Dmytro Hopko | M | — | done |
| T4 | [Implement the auth and workspaces domain rules](./t04-domain-rules.md) | domain | Dmytro Hopko | M | — | done |
| T5 | [Build the auth repositories and the argon2id password hasher](./t05-auth-infra.md) | infra | Dmytro Hopko | M | T1, T2, T4 | done |
| T6 | [Build the workspaces repositories with cross-workspace isolation tests](./t06-workspaces-infra.md) | infra | Dmytro Hopko | L | T1, T2, T4 | done |
| T7 | [Implement the auth credential and session use cases](./t07-auth-credentials-sessions.md) | app | Dmytro Hopko | M | T5 | done |
| T8 | [Implement the password-reset link use cases](./t08-auth-reset-links.md) | app | Dmytro Hopko | M | T7 | done |
| T9 | [Implement create-workspace and re-issue-owner-invitation use cases](./t09-workspaces-admin-use-cases.md) | app | Dmytro Hopko | S | T6 | done |
| T10 | [Implement invitation lookup and acceptance](./t10-accept-invitation.md) | app | Dmytro Hopko | M | T6, T7 | done |
| T11 | [Implement workspace access: guard check, my workspaces, enter](./t11-workspace-access.md) | app | Dmytro Hopko | M | T6, T7 | done |
| T12 | [Implement the team use cases: invite, revoke, list, deactivate, reactivate](./t12-team-use-cases.md) | app | Dmytro Hopko | M | T6, T7 | done |
| T13 | [Expose the auth routes with the session cookie and resolver](./t13-auth-routes.md) | ports | Dmytro Hopko | M | T2, T3, T7, T8 | done |
| T14 | [Expose the workspace guard and the me / workspaces / enter routes](./t14-guard-and-access-routes.md) | ports | Dmytro Hopko | M | T11, T13 | done |
| T15 | [Expose the invitation lookup and acceptance routes](./t15-invitation-routes.md) | ports | Dmytro Hopko | M | T10, T14 | done |
| T16 | [Expose the owner-only team routes](./t16-team-routes.md) | ports | Dmytro Hopko | M | T12, T14 | done |
| T17 | [Extract the shared dependency builder, serve the SPA from one origin, update the conventions docs](./t17-wiring-same-origin.md) | wiring | Dmytro Hopko | M | T14, T15, T16 | done |
| T18 | [Build the admin CLI with its three commands](./t18-admin-cli.md) | ports | Dmytro Hopko | M | T8, T9, T17 | done |
| T19 | [Lay the web foundation: shadcn primitives, API client, shared guard handling, stores](./t19-web-foundation.md) | ui | Dmytro Hopko | M | T2, T3 | done |
| T20 | [Build SCR-01 sign-in, the workspace resolution, SCR-05 no access and SCR-10 not found](./t20-sign-in-and-resolution.md) | ui | Dmytro Hopko | M | T19 | done |
| T21 | [Build SCR-02 accept invitation and SCR-03 link unavailable](./t21-accept-invitation-screens.md) | ui | Dmytro Hopko | M | T20 | done |
| T22 | [Build SCR-09 set new password](./t22-set-new-password-screen.md) | ui | Dmytro Hopko | S | T21 | done |
| T23 | [Build the AppShell, SCR-06 workspace home and SCR-04 picker / switcher](./t23-app-shell-home-picker.md) | ui | Dmytro Hopko | M | T20 | done |
| T24 | [Build SCR-07 team screen](./t24-team-screen.md) | ui | Dmytro Hopko | M | T23 | done |
| T25 | [Build SCR-08 invite member dialog](./t25-invite-dialog.md) | ui | Dmytro Hopko | S | T24 | done |
| T26 | [Add API-level end-to-end flows for every user story](./t26-api-e2e.md) | ports | Dmytro Hopko | M | T18 | done |
| T27 | [Add the six browser end-to-end flows and their CI step](./t27-ui-e2e.md) | ui | Dmytro Hopko | M | T25, T26 | done |
| T28 | [Make concurrent invitation acceptance refuse cleanly instead of failing with 500](./t28-accept-invitation-concurrency.md) | app | Dmytro Hopko | M | T29 | done |
| T29 | [Make the sign-in lockout atomic per email and use the contract's credential message](./t29-atomic-sign-in-lockout.md) | app | Dmytro Hopko | M | — | done |
| T30 | [Shape route validation errors as the contract's field details and accept only JSON on mutating routes](./t30-validation-envelope-and-csrf.md) | infra | Dmytro Hopko | S | — | done |
| T31 | [Align team-route ids, statuses and error messages with the contract](./t31-team-routes-contract-fidelity.md) | ports | Dmytro Hopko | S | — | done |
| T32 | [Move the session cookie helpers out of auth's HTTP layer, add response schemas, end the previous session on sign-in](./t32-session-cookie-boundary-and-response-schemas.md) | ports | Dmytro Hopko | M | T29, T30 | done |
| T33 | [Route the CLI audit through the platform logger, fix the admin script, update the architecture map](./t33-cli-audit-logger-and-docs.md) | wiring | Dmytro Hopko | S | — | done |
| T34 | [Make the app shell enter the workspace in the URL, guard late responses, keep the access-removed notice](./t34-shell-enters-workspace-from-url.md) | ui | Dmytro Hopko | M | — | done |
| T35 | [Guard Team 'Show more', render SCR-10 in place without nested landmarks, link the invite form errors](./t35-team-list-and-invite-polish.md) | ui | Dmytro Hopko | S | T34 | done |
| T36 | [Send malformed token links to SCR-03 and align screen copy with the manifest](./t36-token-link-errors-and-copy.md) | ui | Dmytro Hopko | S | T35 | done |
| T37 | [Exercise last-used workspace and direct Team loads in the browser flows](./t37-e2e-last-used-and-direct-team-load.md) | ui | Dmytro Hopko | S | T34, T36 | done |
| T38 | [Keep argon2 out of the sign-in lock transaction and bound the pg pool](./t38-sign-in-lock-without-holding-a-connection.md) | app | Dmytro Hopko | M | — | done |
| T39 | [Keep Fastify's own 4xx statuses, refuse untyped bodies, document 415 in the contract](./t39-fastify-4xx-and-415-contract.md) | infra | Dmytro Hopko | S | — | done |
| T40 | [Let the loser of a same-email acceptance race continue through the existing-account path](./t40-accept-race-falls-back-to-existing-account.md) | app | Dmytro Hopko | S | T38 | done |
| T41 | [End the previous session on reset-link redeem, pin the response schemas with a test, fix the auth map row](./t41-redeem-ends-previous-session-and-schema-pin.md) | ports | Dmytro Hopko | S | — | done |
| T42 | [Make Docker-backed tests remove their containers and data, even on failure](./t42-docker-tests-clean-up-after-themselves.md) | infra | Dmytro Hopko | S | T38 | done |
| T43 | [Render page bodies only after the shell entered the workspace; fit SCR-10 inside the shell](./t43-shell-renders-body-only-when-entered.md) | ui | Dmytro Hopko | S | — | done |
| T44 | [Bring SCR-02 and SCR-03 copy to the manifest and fix the AC-03 accept test](./t44-scr02-scr03-copy-and-accept-test.md) | ui | Dmytro Hopko | S | — | done |
| T45 | [Show role labels, not raw role values, in the picker, switcher and Team; reconcile the manifest](./t45-role-labels-in-picker-and-team.md) | ui | Dmytro Hopko | S | — | done |
| T46 | [Show the shell's error row with Retry when the access-removed resolution fails; fix stale SCR-10 comments](./t46-shell-guard-failure-shows-retry.md) | ui | Dmytro Hopko | S | — | done |
| T47 | [Give every framework 4xx a contract code (413 included) and pin the untyped-body hook branch](./t47-framework-4xx-codes-and-hook-pin.md) | infra | Dmytro Hopko | S | — | done |
| T48 | [Remove test containers on every failure path and drop the named-volume loop from the clean script](./t48-test-container-teardown-on-every-failure.md) | infra | Dmytro Hopko | S | — | done |
| T49 | [Key the access-removed notice by workspace and ignore guard refusals from a page the person has left](./t49-notice-per-workspace-and-guard-scoped-to-url.md) | ui | Dmytro Hopko | S | — | done |
| T50 | [Send router-level framework errors through the error envelope, pin the 5xx fallback, fix the stop() comment](./t50-router-errors-envelope-and-5xx-pin.md) | infra | Dmytro Hopko | S | — | done |
| T51 | [Scope the shell guard to the URL workspace across routes and sign-out](./t51-guard-scoped-to-url-across-routes-and-sign-out.md) | ui | Dmytro Hopko | S | — | done |
| T52 | [Keep link tokens out of request logs; document the transport-level error exceptions](./t52-link-tokens-out-of-request-logs.md) | infra | Dmytro Hopko | S | — | done |
| T53 | [Pin the shell's release of the address workspace when the person leaves for a page without a shell](./t53-pin-shell-release-on-unmount.md) | ui | Dmytro Hopko | S | — | done |
| T54 | [Harden link-token log masking (raw packets, non-canonical paths) and pin the URL-error message](./t54-harden-link-token-log-masking.md) | infra | Dmytro Hopko | S | — | done |
| T55 | [Mask link tokens by a normalised path, not a pattern](./t55-mask-link-tokens-by-normalised-path.md) | infra | Dmytro Hopko | S | — | done |
| T56 | [Mask link tokens in absolute-form and trailing-dot-segment urls; fix the mask's comments](./t56-mask-absolute-form-and-trailing-dot-segments.md) | infra | Dmytro Hopko | S | — | done |
| T57 | [Mask backslash link forms; state which forms no router resolves](./t57-mask-backslash-link-forms-and-fix-comments.md) | infra | Dmytro Hopko | S | — | done |
| T58 | [Mask encoded-backslash (`%5C`) link forms](./t58-mask-encoded-backslash-link-forms.md) | infra | Dmytro Hopko | S | — | todo |

**Total:** 58 tasks (T28–T37 are follow-ups from `_review/review-2026-10-11.md`, T38–T44 from `_review/review-2026-10-11-r2.md`, T45–T48 from `_review/review-2026-10-11-r3.md`, T49–T50 from `_review/review-2026-10-11-r4.md`, T51–T52 from `_review/review-2026-10-11-r5.md`, T53–T54 from `_review/review-2026-10-11-r6.md`, T55 from `_review/review-2026-10-11-r7.md`, T56 from `_review/review-2026-10-11-r8.md`, T57 from `_review/review-2026-10-11-r9.md`, T58 from `_review/review-2026-10-11-r10.md`), ~25 person-days (T26/T27 added by implement to cover the test-plan e2e rows) (S = 0.5 d, M = 0.75 d, L = 1 d). The critical path runs T1 → T5 → T7 → T8 → T13 → T14 → T15 → T17 → T18 (9 waves). The UI branch (T19–T25) runs alongside the backend from wave 2.
