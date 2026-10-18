---
id: T27
title: "Add the seven browser end-to-end flows for bot settings against the fake Bot API"
layer: "ui"
deps: ["T20", "T26"]
blocks: []
acs: ["AC-01", "AC-02", "AC-03", "AC-06", "AC-16", "AC-16b", "AC-17", "AC-18"]
files_hint: ["apps/web/e2e/bot.spec.ts", "apps/web/e2e/global-setup.ts", "apps/web/e2e/support/"]
owner: "Dmytro Hopko"
estimate: "M"
context_budget: "M"
status: "todo"
---

# T27 — Add the seven browser end-to-end flows for bot settings against the fake Bot API

## Place in the sequence

- **Blocked by:** T20 — API e2e helpers + fake wiring, T26 — every screen built · **Blocks:** — · **Wave:** 9 — last.
- **Lane:** shares `apps/web/e2e/global-setup.ts` / `support/` with nothing else in this epic.

## Why (user story)

> **As a** Business owner
> **I want** to connect the business bot to my workspace by pasting its token
> **So that** messages from our customers start arriving in tg-inbox without help from the tg-inbox team
>
> — `spec.md §4, US-01, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to see which bot is connected, whether it is working and when the last message arrived
> **So that** I notice a broken connection before customers do
>
> — `spec.md §4, US-05, verbatim` · full text: [spec.md](../spec.md)

> **As a** Business owner
> **I want** to give the connected bot a new token or disconnect it
> **So that** a leaked token or a bot we stop using does not put our customers at risk, without losing what was captured
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

This task proves the panel and the API agree, in a real browser, for every owner journey.

## Inlined context

> **E2E-through-UI scope (seven flows, from `ux-flows.md`):** (1) connect a clean bot, then a customer message shows up as "last message received" and "contacts captured 1" after reload (AC-01, AC-07, AC-15); (2) paste an invalid token, see the error, paste a valid one (AC-02); (3) connect a bot delivering to another service — cancel once, then confirm (AC-06); (4) bot revoked → "needs a new token" → paste new token → connected (AC-16, AC-17); (5) bot taken over → reconnect → confirm (AC-16b); (6) disconnect with confirmation (AC-18); (7) operator sees no Bot entry and the owners-only page at the Bot address (AC-03). Revoke and takeover are scripted on the fake Bot API and the health check is triggered through the app layer, not waited for.
>
> — `test-plan.md §E2E-through-UI scope, verbatim` · full text: [test-plan.md](../test-plan.md)

> A real browser against the API + an ephemeral database + the fake Bot API; owners and workspaces seeded through the admin CLI / app layer; customer messages posted to the webhook by the test, never through the UI.
>
> — `test-plan.md §Levels, E2E-through-UI, verbatim` · full text: [test-plan.md](../test-plan.md)

Precedent: `apps/web/e2e/global-setup.ts` builds the SPA, starts `startTestDatabase()` and `buildApp(e2eConfig(...))` on one origin; `support/world.ts` seeds through the app layer.

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Through the UI only; the webhook is posted by the test with the secret read from the fake's recorded `setWebhook`.

## Acceptance criteria

### AC-01 — happy path

> **Given** a business owner of "Acme Flowers", which has no connected bot, and the token of the business's bot "Acme Flowers Support", which is not connected to any workspace
> **When** the owner pastes the token (surrounding spaces are ignored) and confirms
> **Then** the system checks the token with Telegram, connects the bot, and shows the owner the bot's name and username with the state "connected"; from then on the bot's private messages are captured into "Acme Flowers", and the token itself is never shown again
>
> — `spec.md §5, AC-01, verbatim` · full text: [spec.md](../spec.md)

### AC-02 — error

> **Given** a business owner of "Acme Flowers" connecting a bot or giving the connected bot a new token
> **When** the pasted text is not a bot token, or Telegram does not accept it (mistyped, revoked, or the bot was deleted)
> **Then** the system changes nothing — an existing connection keeps working as before — and tells the owner the token is not valid — copy it again from BotFather
>
> — `spec.md §5, AC-02, verbatim` · full text: [spec.md](../spec.md)

### AC-03 — authorization

> **Given** an operator of "Acme Flowers" who is not a business owner
> **When** they try to connect, rotate or disconnect the bot, or open the bot settings
> **Then** the system refuses and tells them that only business owners manage the bot; a person with no active membership in "Acme Flowers" gets no hint that the workspace or its bot exists
>
> — `spec.md §5, AC-03, verbatim` · full text: [spec.md](../spec.md)

### AC-06 — cross-context

> **Given** a business owner of "Acme Flowers" pasting a valid token of a bot that, according to Telegram, currently delivers its messages to another address (another service); a service that instead fetches the bot's messages itself is not visible to tg-inbox and gets no warning
> **When** the system checks the token
> **Then** before connecting, it warns the owner that connecting will stop that bot delivering messages to the other service, and connects only after the owner confirms
>
> — `spec.md §5, AC-06, verbatim` · full text: [spec.md](../spec.md)

### AC-16 — error

> **Given** a connected bot whose token was revoked in BotFather, or which was deleted there
> **When** a business owner of "Acme Flowers" opens the bot settings
> **Then** the system shows the state "not working — needs a new token", explains that messages are not arriving until the owner pastes a new token of the same bot, and keeps every contact and conversation already captured; once a new token is pasted (AC-17), messages customers sent meanwhile that Telegram still holds (up to 24 h) are captured in order
>
> — `spec.md §5, AC-16, verbatim` · full text: [spec.md](../spec.md)

### AC-16b — cross-context

> **Given** a connected bot of "Acme Flowers" whose messages another service has since taken over
> **When** a business owner opens the bot settings and then chooses to reconnect the bot (with the token already stored — no paste needed; pasting that same token again does the same)
> **Then** the settings show the state "not receiving messages — another service took them over"; on reconnecting, the system gives the warning of AC-06, and after the owner confirms the bot is connected again and new messages are captured into their existing conversations; messages the other service received meanwhile are not recovered
>
> — `spec.md §5, AC-16b, verbatim` · full text: [spec.md](../spec.md)

### AC-17 — happy path

> **Given** a business owner of "Acme Flowers" whose bot is connected (or not working because its old token was revoked)
> **When** they paste a new token of the same bot
> **Then** the bot is connected with the new token, the old token is no longer used, and new messages from existing end customers continue their existing conversations
>
> — `spec.md §5, AC-17, verbatim` · full text: [spec.md](../spec.md)

### AC-18 — happy path

> **Given** a business owner of "Acme Flowers" with a connected bot
> **When** they disconnect it and confirm
> **Then** the bot settings show "not connected", the bot stops delivering its messages to tg-inbox, its token is no longer kept by tg-inbox, messages sent to the bot afterwards are never captured (not even if the bot is connected again later), and every contact and conversation captured so far stays in the workspace
>
> — `spec.md §5, AC-18, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Global setup also starts the fake Bot API and passes `TELEGRAM_API_ROOT` + a test `BOT_TOKEN_ENCRYPTION_KEY` into `e2eConfig` — `apps/web/e2e/global-setup.ts`, `support/config.ts`
- [ ] `world` helpers: script a bot on the fake, post a customer message, run one health tick — `support/world.ts`
- [ ] The seven flows; select by role/label text — `apps/web/e2e/bot.spec.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| Fake Bot API state leaks between flows | reset before each flow (with the DB) |

## Definition of Done

- [ ] the seven flows pass locally (Docker running) and in the existing browser e2e CI step
- [ ] lint + vet clean (`pnpm lint`)
