---
status: Accepted
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
ticket: "roadmap step 2 — workspace-operators"
---

# 0001 — Build an API, a SPA and a server-side admin CLI

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dmytro Hopko (Architect) with Claude during the design walk

## Context

workspace-operators has three kinds of actors (sad.md §3): business owners and operators work in the web panel, while platform admins create workspaces, re-issue the first business owner invitation and issue password-reset links "outside the web panel" (spec §6.1). Spec §8 left open, due during design, through what channel a platform admin acts and how that admin is authenticated. The answer fixes which runnable parts this feature builds — its target surfaces — and how big the most powerful attack surface in the system is: a platform admin controls every workspace.

## Decision drivers

- Spec §6.1: creating workspaces and issuing reset links are platform-admin capabilities outside the web panel; an owner must never reset another person's password.
- Spec §6.1 data classification: confidential — credentials and the membership graph control access to every business's data.
- Spec §8 default: a command run on the server, access to the server is the authority, every action written to a log.
- `ux-flows.md` covers only the web panel; an admin web surface would need new flows and screens.
- sad.md §2: no deployment target is decided yet; one process serves every workspace.

## Considered options

1. **API + SPA + a server-side admin CLI** — `[backend-service, web-frontend, cli]`; admin commands run on the server against the same app-layer use cases; server access is the authority.
2. **API + SPA + a separate admin web app** — `[backend-service, web-frontend, web-frontend (admin)]`; a second browser app on its own origin with its own platform-admin sign-in, calling admin HTTP routes — outside the operators' web panel, as spec §6.1 requires.
3. **API + SPA + admin HTTP routes behind a static API key** — `[backend-service, web-frontend]`; an `ADMIN_API_KEY` from config authorises admin calls made with an HTTP client.

## Decision outcome

**Chosen:** Option 1. It keeps every platform-wide capability off the internet — there is no admin endpoint or admin session to steal — and matches the spec §8 default, closing that open question. Option 2 puts an internet-facing admin sign-in in front of every workspace ("one compromised admin session controls them all"), adds a second UI surface with its own flows, and still needs a server-side bootstrap for the first admin; option 3 turns a single leaked key into full remote control with no per-person attribution.

The CLI (`pnpm admin <command>`, entry under `apps/api/src/cli/`) offers `workspace:create`, `workspace:reissue-owner-invitation` and `account:issue-reset-link`. It builds the same module dependencies as the HTTP app (a shared dependency builder used by both `buildApp()` and the CLI), calls the same app-layer use cases, prints the issued link exactly once to its own stdout, and writes one structured audit log line per action (`event: "admin.<action>"`, the operating-system user, target ids — never the link or its token).

## Consequences

**Positive**
- No internet-facing admin surface; the admin's authority is the server or database access the tg-inbox team already guards.
- Admin commands reuse the app-layer use cases, so validation (AC-02), single-use and expiry rules behave exactly as in the web panel.
- `ux-flows.md` stays complete — no admin flows or screens are needed.

**Negative**
- A third surface means a third contract (`contracts/cli.md`: commands, flags, exit codes) and command-level end-to-end tests.
- A platform admin needs a shell on the server, or a tunnel to the database from a trusted machine.
- The composition root grows a shared dependency builder so the CLI does not construct modules on its own — `CLAUDE.md` ("only `buildApp()` constructs deps") must be updated together with this feature.

**Neutral**
- An admin web area can be added later on top of the same use cases without changing them.
- Audit lines live in the process logs; their retention depends on the deployment target chosen later.

## Links

- Spec: [[../spec.md]] — US-01, US-08, §6.1, §8 (platform-admin channel)
- SAD: [[../sad.md]] §4
- Related ADR: [[0002-use-opaque-cookie-sessions-stored-in-postgres]] (the web panel's authentication, which the CLI does not use)
