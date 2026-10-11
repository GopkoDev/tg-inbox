---
slug: workspace-operators
date: 2026-10-11
triage: gap
acs: [AC-05b, AC-05, AC-03, AC-08, AC-14, AC-21]
commit: 61ec6be, 74bbeab (round-12 follow-up), e3e1510 (round-13 follow-up), 34784d9 (round-14 follow-up), d11ac4c (round-15 follow-up)
recurrence_of: none
---

# Fix: web forms check fields with hand-written rules instead of the shared zod schemas

## Symptom

On the accept-invitation or set-new-password form, entering a password longer than 1024 characters is accepted client-side; the server rejects it, so the person waits a round trip for an error the panel could have shown. On the sign-in and invite forms, an invalid email is sent to the server instead of being checked first. The forms and the server can disagree because the rules are written twice. This affects every user of those forms and has been the case since the forms shipped, in the workspace-operators implementation.

## Root cause

The forms copied the rules as literals instead of reusing the zod schemas in `packages/shared`, which the API already validates with:

- `AcceptInvitationForm.tsx` checked `password.length < 10` and `trimmed.length < 1 || > 200`.
- `ResetPasswordForm.tsx` checked `password.length < 10`.
- `SignInForm` and `InviteDialog` left email validation to the server.

The copies dropped the upper password bound, and nothing tied them to `Password`, `DisplayName` or `EmailInput`. Component tests covered only the rules that were copied, such as the 9-character password, so the missing bound and the absent email check went unnoticed.

## The pinning test

These are component tests (Testing Library) in the block `client rules come from the shared schemas (fix 2026-10-11-shared-form-validation)`:

- `pages/AcceptInvitationPage.test.tsx`: a password over 1024 characters is blocked client-side with the server message.
- `pages/ResetPasswordPage.test.tsx`: the same check for the reset form.
- `pages/SignInPage.test.tsx`: an invalid email is blocked client-side with the server message.
- `features/workspaces/invite/InviteDialog.test.tsx`: the same check for the invite dialog.

On the RED run all four failed on the expected-behaviour assertion, which is a GOOD red. For example:

> `TestingLibraryElementError: Unable to find an element with the text: The password must be at most 1024 characters long, which matches selector 'p#password-error'`
>
> `TestingLibraryElementError: Unable to find an element with the text: Enter a valid email address.`

The fix itself:

- The forms now call `firstIssue(schema, value)` from `apps/web/src/shared/lib/validate.ts` with `Password`, `DisplayName` and `EmailInput`.
- `Password.max` and `DisplayName` now carry explicit messages (`PASSWORD_MAX_MESSAGE` and `DISPLAY_NAME_MESSAGE`), so the client and the server word the error the same way.
- Two existing InviteDialog tests and one existing SignIn test exercise the server's 400 path. They previously used malformed emails; they now use well-formed ones so they still reach the server.

## Round-12 review follow-up

The round-12 review ([review-2026-10-11-r12.md](../_review/review-2026-10-11-r12.md)) found that AC-05b's "same message" claim did not hold everywhere. It was fixed under the same fix id:

- **F1:** `invitation-routes.ts` `AcceptBody` now carries `PASSWORD_MAX_MESSAGE` and `DISPLAY_NAME_MESSAGE` on its `max(1024)` bounds. It still has no minimum, so AC-04 continues to allow an existing password of any length.
- **F2:** the display-name `ValidationError` no longer carries the `display_name: ` prefix.
- **F3:**
  - The new shared `CurrentPassword` (1–1024, with the max message) backs `SignIn.password`.
  - The sign-in form checks it client-side and routes a server 400 to the field named by `details.field`.
  - The accept form checks `CurrentPassword` for existing accounts.
- **F4:** added component tests:
  - a blank, whitespace-only or over-200-character name;
  - an existing account's short password not being blocked (AC-04);
  - an existing account's over-long password;
  - sign-in's over-long password, and a server 400 on `password`.

  Integration tests now cover accept (new and existing account) and sign-in with a 1025-character password, and accept with a blank name.
- **F6:** the tests are titled AC-05b.

AC-05b was reworded to name the rule each form applies.

RED evidence (server, quoted):

> `- "message": "The password must be at most 1024 characters long"` / `+ "message": "Too big: expected string to have <=1024 characters"`
>
> `- "message": "Enter your name (up to 200 characters)"` / `+ "message": "display_name: Enter your name (up to 200 characters)"`

## Round-13 review follow-up

[review-2026-10-11-r13.md](../_review/review-2026-10-11-r13.md) G1: an empty password from an existing account on the accept form was blocked client-side with zod's default text, while the server would answer 401. The fix:

- The new shared `PasswordBound` (upper bound only) backs `AcceptBody.password` and the accept form's existing-account check, so an empty password reaches the server as before (401).
- `CurrentPassword` (sign-in) gains `PASSWORD_REQUIRED_MESSAGE` ("Enter your password"), so an empty sign-in password gets the same shared message on both sides. 

Pinning tests:

- web: `AC-05b: an existing account with an empty password is not blocked client-side`;
- api: `AC-05b: an empty password is 400 on password with the shared message` (RED: `+ "message": "Too small: expected string to have >=1 characters"`).

## Round-14 and round-15 review follow-ups

[review-2026-10-11-r14.md](../_review/review-2026-10-11-r14.md), `34784d9`:

- **H1:** the sign-in form gained `noValidate`, like the other three forms. Before that, the browser's `required` bubble pre-empted the shared messages for an empty email or password.
  - Pinning tests (web): `AC-05b: an empty email shows the shared email message under the email` and `AC-05b: an empty password shows the shared required message under the password`.
  - RED: both failed, because the `required` check blocked the submit.
- **Spec and contract:**
  - AC-05b's sign-in password rule became 1–1024.
  - The SCR-01 validation row now names the shared messages for empty fields.
  - `contracts/openapi.yaml` `InvitationAccept.password` became bound-only (`maxLength: 1024`). Its description says the 10–1024 policy applies only when `account_exists` is false.

[review-2026-10-11-r15.md](../_review/review-2026-10-11-r15.md), `d11ac4c`:

- **I3:** the shared zod `InvitationAccept.password` is now `PasswordBound` as well, so the shared schema, the contract and the route body agree. `AcceptBody` no longer overrides the password.
  - Pinning test (shared): `InvitationAccept only bounds the password`.
  - RED: a short password was refused by the shared schema.
- **I2 and I4:** the api-sync report and the test-plan row are updated.

## Spec patch

This is a gap: no AC required the panel and the server to apply the same rule with the same message. The following AC was added to spec.md §5 after AC-05, with the marker `<!-- added-by-fix: 2026-10-11 -->`:

> **AC-05b (US-02) — error.** **Given** a person filling in a web panel form: accept invitation, set new password, sign in or invite a member **When** a field breaks a rule the server enforces for it on that form: a new password of 10–1024 characters (accepting as a new account, setting a new password), an existing account's password of 1–1024 characters (signing in) or of at most 1024 characters (accepting with an existing account), a name of 1–200 characters after trimming (accepting as a new account), or a valid email address (signing in, inviting) **Then** the panel shows the server's own message for that rule under the field and sends nothing; the same value sent to the server would be refused with the same message

This is the wording after round 14 (`34784d9`). Its history:

- The first version (`61ec6be`) said "a password of 10–1024 characters" for every form.
- Round 12 (`74bbeab`) reworded it per form.
- Round 14 (`34784d9`) split the existing-account password rule into "1–1024 (signing in)" and "at most 1024 (accepting with an existing account)".

The validation rows of the screens manifest for SCR-01, SCR-02, SCR-08 and SCR-09 now say the check also runs client-side, with the shared rule. The test plan has an AC-05b row.

## Follow-ups

- The server's `auth/domain/password-policy.ts` still holds its own `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` and message templates. This is a third copy of the `Password` rule; derive it from `@tg/shared`, or derive the shared schema from it.
- AC-09's integration test `20 parallel wrong passwords record at most 10 failures` flaked once under full-suite load: it got 4 records where 10 were expected. It passed 3/3 when run alone, and this fix does not touch sign-in failure counting. Investigate whether the parallelism makes the test flaky or exposes a real race.
