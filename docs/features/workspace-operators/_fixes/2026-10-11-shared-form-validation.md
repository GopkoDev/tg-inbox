---
slug: workspace-operators
date: 2026-10-11
triage: gap
acs: [AC-05b, AC-05, AC-03, AC-08, AC-14, AC-21]
commit: <filled after commit>
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

## Spec patch

This is a gap: no AC required the panel and the server to apply the same rule with the same message. The following AC was added to spec.md §5 after AC-05, with the marker `<!-- added-by-fix: 2026-10-11 -->`:

> **AC-05b (US-02) — error.** **Given** a person filling in a web panel form: accept invitation, set new password, sign in or invite a member. **When** a field breaks a rule the server enforces for it: a password of 10–1024 characters, a name of 1–200 characters after trimming, or a valid email address. **Then** the panel shows the server's own message for that rule under the field and sends nothing; the same value sent to the server would be refused with the same message.

The validation rows of the screens manifest for SCR-01, SCR-02, SCR-08 and SCR-09 now say the check also runs client-side, with the shared rule. The test plan has an AC-05b row.

## Follow-ups

- The server's `auth/domain/password-policy.ts` still holds its own `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` and message templates. This is a third copy of the `Password` rule; derive it from `@tg/shared`, or derive the shared schema from it.
- `invitation-routes.ts` `AcceptBody` relaxes `password` and `display_name` to `max(1024)` so that the use case can attach `details.field`. Consider a zod-error-to-`details.field` mapping in the error handler instead.
- The use case prefixes the display-name error with `display_name: `, and the client shows that prefix verbatim on a server 400.
- AC-09's integration test `20 parallel wrong passwords record at most 10 failures` flaked once under full-suite load: it got 4 records where 10 were expected. It passed 3/3 when run alone, and this fix does not change API code. Investigate whether the parallelism makes the test flaky or exposes a real race.
