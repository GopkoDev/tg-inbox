# Tracker — bot-connection

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | [Promote the four staged migrations and regenerate DB types](./t01-promote-migrations.md) | migration | Dmytro Hopko | S | — | done |
| T2 | [Add platform primitives: bot error codes incl. the first 5xx, owner-guard message, config keys, Bot API root, secret-header redaction](./t02-platform-primitives.md) | infra | Dmytro Hopko | M | — | done |
| T3 | [Build the scriptable fake Telegram Bot API and the webhook update builder for tests](./t03-fake-telegram.md) | tests | Dmytro Hopko | M | — | done |
| T4 | [Define the bots zod contracts in packages/shared](./t04-shared-contracts.md) | ports | Dmytro Hopko | S | T2 | todo |
| T5 | [Implement the bots domain: token check, connection states, inbound filter, update normalisation, due rule](./t05-bots-domain.md) | domain | Dmytro Hopko | M | — | done |
| T6 | [Implement the conversations and contacts domain rules: message kinds, edit rule, profile refresh](./t06-conversation-contact-domain.md) | domain | Dmytro Hopko | S | — | done |
| T7 | [Build the contacts module: repository with isolation tests, upsert-from-profile and count use cases](./t07-contacts-module.md) | infra | Dmytro Hopko | M | T1, T6 | todo |
| T8 | [Build the conversation and message repositories with cross-workspace isolation tests](./t08-conversations-infra.md) | infra | Dmytro Hopko | M | T1, T6 | todo |
| T9 | [Implement the conversations app layer: capture inbound message, apply edit, last message time, has conversations](./t09-capture-use-cases.md) | app | Dmytro Hopko | M | T7, T8 | todo |
| T10 | [Build the bot repository, the AES-GCM token cipher and webhook secrets, with isolation tests incl. the two controlled exceptions](./t10-bots-infra.md) | infra | Dmytro Hopko | L | T1, T2, T5 | todo |
| T11 | [Build the Telegram gateway: getMe, getWebhookInfo, setWebhook, deleteWebhook with typed outcomes and timeouts](./t11-telegram-gateway.md) | infra | Dmytro Hopko | M | T2, T3 | todo |
| T12 | [Implement the bots use cases get-settings and paste-token (connect, rotate, connect again, refusals, takeover confirmation)](./t12-settings-and-paste.md) | app | Dmytro Hopko | L | T2, T7, T9, T10, T11 | todo |
| T13 | [Implement the bots use cases reconnect-with-stored-token and disconnect](./t13-reconnect-and-disconnect.md) | app | Dmytro Hopko | M | T12 | todo |
| T14 | [Implement the bots use case accept-webhook-update: secret check, inbound filter, capture epoch, hand-off to conversations](./t14-accept-update.md) | app | Dmytro Hopko | M | T5, T9, T10 | todo |
| T15 | [Implement the scheduled health check: run-health-check use case and the bots.schedule-health-checks / bots.check-health jobs](./t15-health-check.md) | app | Dmytro Hopko | M | T5, T10, T11 | todo |
| T16 | [Expose the owner-only bot routes and wire the bots, conversations and contacts modules into buildDeps / buildApp](./t16-owner-routes.md) | ports | Dmytro Hopko | M | T4, T12, T13 | todo |
| T17 | [Expose the Telegram webhook route with secret-before-parse, empty-body 401/200 and fail-closed 500](./t17-webhook-route.md) | ports | Dmytro Hopko | M | T14, T16 | todo |
| T18 | [Register the health-check workers in buildApp and prove five-minute freshness over a simulated hour](./t18-register-health-jobs.md) | wiring | Dmytro Hopko | S | T15, T16 | todo |
| T19 | [Update CLAUDE.md, the architecture map, the workspace-operators SAD and the design system for the new modules, exceptions and config](./t19-conventions-docs.md) | docs | Dmytro Hopko | S | T16, T17, T18 | todo |
| T20 | [Add the three API-level end-to-end stories: capture lifecycle, edits and redeliveries, health and recovery](./t20-api-e2e.md) | tests | Dmytro Hopko | M | T17, T18 | todo |
| T21 | [Add the token-secrecy suite: no token, secret or message text in any log line or response across every bot flow](./t21-token-secrecy-suite.md) | tests | Dmytro Hopko | S | T17, T18 | todo |
| T22 | [Write the load-test script for throughput, flood isolation, owner actions and settings load (runnable locally, run pre-pilot)](./t22-load-test-script.md) | tests | Dmytro Hopko | M | T17 | todo |
| T23 | [Lay the web bot foundation: bot API client, store, /w/:workspaceId/bot route and the owner-only Bot entry in AppShell (SCR-01)](./t23-web-bot-foundation.md) | ui | Dmytro Hopko | M | T4 | todo |
| T24 | [Build SCR-02 Bot settings with every declared state](./t24-bot-settings-page.md) | ui | Dmytro Hopko | M | T23 | todo |
| T25 | [Build SCR-03 Paste token dialog with every declared state](./t25-paste-token-dialog.md) | ui | Dmytro Hopko | M | T24 | todo |
| T26 | [Build SCR-04 Confirm takeover and SCR-05 Confirm disconnect](./t26-confirm-dialogs.md) | ui | Dmytro Hopko | M | T25 | todo |
| T27 | [Add the seven browser end-to-end flows for bot settings against the fake Bot API](./t27-ui-e2e.md) | ui | Dmytro Hopko | M | T20, T26 | todo |

**Total:** 27 tasks, ~25 person-days (S = ½ day, M = 1 day, L = 1½ days of focused work; L tasks stay within one reviewable PR).
