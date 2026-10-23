---
id: T11
title: "Re-register outdated webhooks in the bots health check: a webhook that is ours but lacks my_chat_member is set again with the same URL and secret, keeping pending updates"
layer: "app"
deps: ["T10"]
blocks: ["T26"]
acs: ["AC-14"]
files_hint: ["apps/api/src/modules/bots/app/health-check.ts", "apps/api/src/modules/bots/app/health-check.test.ts", "apps/api/src/modules/bots/domain/health.ts", "apps/api/src/modules/bots/infra/telegram-gateway.ts"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "S"
status: "todo"
step: ""
---

# T11 — Re-register outdated webhooks in the bots health check: a webhook that is ours but lacks my_chat_member is set again with the same URL and secret, keeping pending updates

## Place in the sequence

- **Blocked by:** T10 — Learn blocks in bots: allowed_updates gains my_chat_member, the classifier turns a private kicked / member update into a reach decision handled before the interceptor and capture, and a reply refused as blocked records the block · **Blocks:** T26 — Register the broadcasts routes (registerBroadcasts): the seventeen operations with their zod schemas, the owner-only launch confirmation, launch and stop, the masked picker search, and the wiring in buildDeps (contacts ⇄ bots late-bound ports, broadcasts after team, inbox given itemDetails) and buildApp · **Wave:** 5 — after T10.
- **Lane:** shares `apps/api/src/modules/bots/infra/telegram-gateway.ts` with T10; shares `apps/api/src/modules/bots/infra/telegram-gateway.ts` with T12 — serialized.

## Why (user story)

> **As an** Operator
> **I want** to see on a contact that they have blocked the bot, and have such contacts left out of broadcasts
> **So that** the team does not count on reaching customers the bot cannot reach
>
> — `spec.md §4, US-06, verbatim` · full text: [spec.md](../spec.md)

It makes bots connected before this feature start receiving block notices within minutes of the deploy, with no owner action.

## Inlined context

> Bots connected before this feature registered only `message` and `edited_message`. The existing 3-minute health check now compares the webhook's allowed updates with the expected set. When the URL is ours but the set is outdated, it registers the webhook again with the same URL and secret, keeping pending updates (ADR-0003). A webhook taken over by someone else is left alone, as today. A failure is logged by code and the next scheduled check tries again, as the health check already does (no retry, no dead-letter queue). Until then, refused sends still mark blocks (AC-14).
>
> — `sad.md §6, Flow 17, prose, verbatim` · full text: [sad.md](../sad.md)

> **Chosen:** Option 1. […] The health check already holds the token and the derived secret, and it reaches every live bot within 3 minutes, so the rollout needs no manual step.
> - The health check gains a write path (`setWebhook`) that runs once per bot after the deploy.
>
> — `adr/0003 §Decision outcome + §Consequences (Negative), ADR-0003, abridged` · full text: [ADR-0003](../adr/0003-learn-blocks-from-my-chat-member-updates-and-refused-sends-in-bots-and-re-register-outdated-webhooks-in-the-health-check.md)

> Rollout: the migration (reach table + backfill, broadcasts tables, broadcast items) runs before the new code; after the deploy, each bot's next health check (≤ 3 min) re-registers its webhook with `my_chat_member` (ADR-0003).
>
> — `sad.md §7, Deployment view, verbatim` · full text: [sad.md](../sad.md)

> | Until a bot's next health check after the deploy (≤ 3 min), its webhook does not deliver `my_chat_member` | Low | refused sends still mark blocks; the window is minutes, once | Backend |
>
> — `sad.md §11, Risks, verbatim` · full text: [sad.md](../sad.md)

> **Hard rule:** All Bot API calls go through `telegramApi(token, { apiRoot })` in `src/platform/telegram.ts` (via the `bots` gateway). […] Bot tokens are secrets — encrypted at rest, never logged, never returned.
>
> — `CLAUDE.md §Rules, Telegram, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [data-model.md](../data-model.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [events.md](../contracts/events.md) ·
[screens.md](../screens.md) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes (the check's state write through `bots.setState` is unchanged).

## API contract

Internal — no API surface.

## Acceptance criteria

### AC-14 — cross-context

> **Given** a contact "Olena K." of "Acme Flowers"
> **When** she blocks the business bot in Telegram, or a broadcast or reply to her is refused because she blocked it; and later she unblocks the bot, or writes to it again
> **Then** after the block her profile says she has blocked the bot and since when, the Contacts list marks her row, every draft that includes her counts her as unreachable, and a launch leaves her out; blocking the bot creates no customer message, does not open her conversation, does not change any unread count and triggers no ping; after she unblocks the bot or writes again the mark is gone and drafts count her as reachable again; the recipient list of a broadcast already launched is not changed by either event, and if she is still waiting in a sending broadcast, her mark at her turn decides whether she is sent it (AC-11); a member's own Telegram account linked for pings is never a contact and never a recipient
>
> — `spec.md §5, AC-14, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Failing tests first against the fake Bot API: ours + outdated `allowed_updates` → one `setWebhook` with the same URL, secret and the full set, `drop_pending_updates` not set; ours + current set → no `setWebhook`; foreign / stale / none → no `setWebhook`, `taken_over` as today; a failing `setWebhook` → logged by code, outcome `transient` — `apps/api/src/modules/bots/app/health-check.test.ts`
- [ ] Gateway: `getWebhook` also reports whether the registered `allowed_updates` equal `ALLOWED_UPDATES` (e.g. a new result `ours_outdated`), and a re-register call reusing the connect path's `setWebhook` with the derived secret — `apps/api/src/modules/bots/infra/telegram-gateway.ts`
- [ ] Health check: on `ours_outdated` re-register, then write `connected` as for `ours` — `apps/api/src/modules/bots/app/health-check.ts`
- [ ] Keep `DUE_AFTER_MS` (3 min) unchanged; the expected set lives with `ALLOWED_UPDATES` only — `apps/api/src/modules/bots/domain/health.ts`

## Edge cases

| Case | Behaviour |
|---|---|
| webhook ours and already current | nothing written to Telegram |
| webhook taken over by another URL | left alone, `taken_over` (unchanged) |
| `setWebhook` fails or times out | logged by code only (never the token), next scheduled check retries |
| token revoked (`unauthorized`) | `needs_token` as today, no re-register |
| pending updates queued at Telegram | kept (no `drop_pending_updates`) |

## Definition of Done

- [ ] Health-check tests against the fake Bot API prove an ours-but-outdated webhook is re-registered once with the same URL, secret and the full allowed updates without dropping pending updates, an up-to-date one is left alone, a taken-over webhook is not touched, and a failed re-registration is logged by code and retried by the next scheduled check.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
