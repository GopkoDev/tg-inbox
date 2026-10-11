---
id: T22
title: "Build SCR-09 set new password"
layer: "ui"
deps: ["T21"]
blocks: []
acs: ["AC-21", "AC-22"]
files_hint: ["apps/web/src/features/auth/reset-password/", "apps/web/src/features/auth/link-unavailable/", "apps/web/src/pages/ResetPasswordPage.tsx"]
owner: "Dmytro Hopko"
estimate: "S"
context_budget: "M"
status: "todo"
---

# T22 — Build SCR-09 set new password

## Place in the sequence

- **Blocked by:** T21 — Build SCR-02 accept invitation and SCR-03 link unavailable (SCR-03 component this task extends with the reset-link variant) · **Blocks:** — · **Wave:** 5.
- **Lane:** own lane. Replaces T20's stub `ResetPasswordPage`; does **not** touch `routes.tsx` (`/reset-password/:token` already exists).

## Why (user story)

> **As a** Platform admin
> **I want** to issue a password-reset link for an account on request
> **So that** a person who forgot their password regains access without a self-serve reset flow
>
> — `spec.md §4, US-08, verbatim` · full text: [spec.md](../spec.md)

This task delivers the web half of US-08: the screen behind a reset link that sets the new password and signs the device in.

## Inlined context

> **UI:** compose shadcn/ui primitives from `apps/web/src/shared/ui` […]. Tailwind only — no CSS modules, no CSS-in-JS.
>
> — `CLAUDE.md §Rules, UI, abridged` · full text: [CLAUDE.md](../../../../CLAUDE.md)

**SCR-09 — Set new password** (states to build):

> | State | Trigger / condition | Components |
> |---|---|---|
> | loading | `lookUpPasswordResetLink` in flight after opening `/reset-password/<token>` | Card, shadcn:skeleton |
> | default | `204` — «Set a new password»: new password field (hint «at least 10 characters»), **Set password** | Card, shadcn:input, shadcn:label, Button |
> | submitting | `redeemPasswordResetLink` in flight — form disabled, button spinner | Button (disabled + `Loader2`) |
> | validation | `400 VALIDATION_ERROR` `field: password` — «The password must be at least 10 characters long»; also checked client-side before submit | shadcn:input (`aria-invalid`), shadcn:label |
> | error: link unavailable | `404 RESET_LINK_INVALID` on lookup, or on submit when the link was used / superseded / expired in between → render SCR-03 in place | — (→ SCR-03) |
> | error: unexpected | network failure / `500` — «Something went wrong» + Retry (lookup) / form kept (submit) | shadcn:alert (destructive), Button |
> | success | `204` → signed in on this device → AC-07 resolution → SCR-06 / SCR-04 / SCR-05 | — (navigation) |
>
> Footer text under the form: «Every other device will be signed out.»
>
> — `screens.md §SCR-09, state table + wireframe, abridged` · full text: [screens.md](../screens.md)

> | default: reset link invalid | `404 RESET_LINK_INVALID` — «This reset link is no longer valid»; text adds «ask the tg-inbox team for a new one» | Card |
>
> — `screens.md §SCR-03, reset-link row, verbatim` · full text: [screens.md](../screens.md)

**Fallback:** insufficient or contradicted by the code → read the named file in full
([spec.md](../spec.md) · [sad.md](../sad.md) · [screens.md](../screens.md) ·
[openapi.yaml](../contracts/openapi.yaml) · [adr/](../adr/)) and follow it. Do not guess.

## Data delta

No DB changes.

## API contract

Consumed (authored by T13):

- `POST /api/password-reset-links/lookup` (`lookUpPasswordResetLink`) — body `{ token }` → `204` · errors: `400`, `404 RESET_LINK_INVALID`.
- `POST /api/password-reset-links/redeem` (`redeemPasswordResetLink`) — body `{ token, password }` (10–1024 chars) → `204` + session cookie · errors: `400 VALIDATION_ERROR` (`details.field: password`), `404 RESET_LINK_INVALID`.

— `contracts/openapi.yaml, operationId lookUpPasswordResetLink / redeemPasswordResetLink, abridged` · full text: [openapi.yaml](../contracts/openapi.yaml)

## Acceptance criteria

### AC-21 — happy path

> **Given** a person who forgot the password of their account and asked the tg-inbox team for help
> **When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
> **Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working
>
> — `spec.md §5, AC-21, verbatim` · full text: [spec.md](../spec.md)

### AC-22 — domain invariant

> **Given** a password-reset link that is older than 24 hours or was already used
> **When** a person opens it
> **Then** the system refuses it and explains that the reset link is no longer valid
>
> — `spec.md §5, AC-22, verbatim` · full text: [spec.md](../spec.md)

## Checklist

- [ ] Extend `apps/web/src/features/auth/link-unavailable/LinkUnavailable.tsx` with the `reset-link-invalid` reason (message + «ask the tg-inbox team for a new one»).
- [ ] `apps/web/src/features/auth/reset-password/`: lookup on mount; new-password form with client-side 10-character check; submit → `redeemPasswordResetLink` → `resolveWorkspace()` (T20).
- [ ] Map `404 RESET_LINK_INVALID` (lookup or submit) to SCR-03 in place; `400` → field error.
- [ ] `apps/web/src/pages/ResetPasswordPage.tsx`: replace T20's stub.
- [ ] Tests: `ResetPasswordPage.test.tsx` (each SCR-09 state) + the new `LinkUnavailable` variant.

## Edge cases

| Case | Behaviour |
|---|---|
| Link older than 24 h, used, or superseded | SCR-03 «This reset link is no longer valid» — ask the tg-inbox team |
| Link used on another device between lookup and submit | `404` on submit → SCR-03 in place |
| Password of 9 characters | Blocked client-side; server 400 message shown under the field |
| Account has no active membership after reset | AC-07 resolution lands on SCR-05 |
| Network failure on submit | Destructive alert, form kept |

## Definition of Done

- [ ] `ResetPasswordPage.test.tsx` covers loading, default, submitting, validation, link unavailable (lookup and submit), unexpected error and success → resolution.
- [ ] every Hard Rule inlined above still holds
- [ ] lint + vet clean (`pnpm lint`)
