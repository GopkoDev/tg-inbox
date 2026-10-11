---
status: Draft
owner: "Dmytro Hopko"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-10-11"
feature_size: "M"
---

# Spec — workspace-operators

> **Glossary:** [CONTEXT](../../../CONTEXT.md)
> **Reference module / docs / channels used:** None — only the interview + CONTEXT, plus `docs/idea-brief.md`, `docs/roadmap.md` (step 2) and `docs/architecture-map.md`.

## 1. Context

Every later capability of tg-inbox — connecting a bot, the shared inbox, contacts — belongs to one business and is used by that business's team. Today there is no notion of a business on the platform and no way for a person to sign in to the web panel, so nothing that follows can be built or piloted. Target pilot businesses are teams of 3+ operators (idea brief §3 — still to be confirmed, roadmap open decision D2); each of them needs its own isolated space, and its owner needs to bring the team in and take people out without asking the tg-inbox team every time.

Why now: this is step 2 of the roadmap and the root of the dependency graph — the bot connection (step 3) attaches a bot to a workspace, and the inbox (step 4) shows conversations to signed-in operators. The near-term goal is 5–10 hand-onboarded pilot businesses using v1 daily (idea brief §4), so this step must make onboarding a pilot take minutes, not engineering work.

Committed approach: a platform admin creates each workspace by hand together with an invitation for its first business owner; from then on business owners run their own team in the web panel — inviting people by a copyable, single-use, expiring link and deactivating members who leave. People sign in with email and password; one account can hold memberships in several workspaces and switches between them, while every workspace's data stays visible only to its active members.

Traceability: the architecture map fixes the workspace as the tenancy boundary of every tenant-owned record and requires proof of cross-workspace isolation for every data access; the roadmap places self-serve signup out of scope ("pilots are connected by hand").

## 2. Goals

- A pilot business gets a working, isolated workspace and its owner runs the team without involving the tg-inbox team for day-to-day changes.
- Operators reach their workspace with one sign-in, and a person who works for several businesses keeps a single identity.
- No business can ever see or change another business's data — isolation holds from the first feature onward.

## 3. Non-goals

- Self-serve signup — pilots are connected by hand; v1 effort goes into support, not onboarding (roadmap § Out of scope).
- Sign-in through Telegram, single sign-on or two-factor authentication — email and password are enough for 5–10 hand-picked pilots; revisit once pilots ask.
- Automatic emails for invitations and password resets — links are copied and passed on by hand, so v1 does not depend on mail delivery.
- Changing the role of an existing member and fine-grained permissions — two fixed roles (business owner, operator) cover teams of 3–10 people.
- Connecting the business bot — that is roadmap step 3.
- Self-service profile changes — a signed-in person cannot change their own password, name or email from the web panel in v1; a forgotten password goes through a platform admin (US-08).

## 4. User stories

### US-01: Create a workspace by hand

**As a** Platform admin
**I want** to create a workspace for a pilot business together with an invitation for its first business owner
**So that** the business can start using tg-inbox without a self-serve signup

### US-02: Join a workspace by invitation

**As an** Operator
**I want** to accept an invitation link and set up my access
**So that** I become a member of the business's workspace with the role I was invited for

### US-03: Sign in and sign out

**As an** Operator
**I want** to sign in to the web panel with my email and password and sign out when I am done
**So that** only I can act in the workspaces I belong to

### US-04: Switch between workspaces

**As an** Operator
**I want** to switch between the workspaces I am a member of
**So that** I can work for several businesses with one account while seeing only one business's data at a time

### US-05: Invite a teammate

**As a** Business owner
**I want** to invite a person by email as an operator or a business owner
**So that** my team grows without asking the tg-inbox team

### US-06: Deactivate and reactivate a member

**As a** Business owner
**I want** to deactivate a member who left and reactivate them if they return
**So that** former staff lose access to our customers at once

### US-07: Review the team

**As a** Business owner
**I want** to see every member and every pending invitation of my workspace and revoke an invitation
**So that** I always know who has or is about to get access

### US-08: Restore access after a forgotten password

**As a** Platform admin
**I want** to issue a password-reset link for an account on request
**So that** a person who forgot their password regains access without a self-serve reset flow

## 5. Acceptance criteria

### AC-01 (US-01) — happy path

**Given** a platform admin and a pilot business named "Acme Flowers" together with its owner's email address
**When** the platform admin creates the workspace with that name and owner email
**Then** the workspace exists, awaiting its first business owner, with an invitation carrying the business owner role issued for that email, and the platform admin sees the invitation link once, right after creation, to pass on; until that invitation is accepted nobody can see or act in the workspace

### AC-01b (US-01) — happy path

**Given** a workspace still awaiting its first business owner, whose owner invitation has expired or whose link was lost
**When** a platform admin re-issues the first business owner invitation for that workspace
**Then** the earlier invitation stops working, a new 7-day invitation with the business owner role is issued for the same email, and the platform admin sees its link once, right after issuing it

### AC-02 (US-01) — error

**Given** a platform admin creating a workspace
**When** the workspace name is empty or the owner email is not a valid email address
**Then** the system creates nothing and tells the platform admin which field is wrong and why

### AC-03 (US-02) — happy path

**Given** a valid, unused invitation for a person whose email has no account yet
**When** the person opens the invitation link, enters their name and a password, and confirms
**Then** the system creates their account, gives them an active membership with the invited role, signs them in and opens that workspace

### AC-04 (US-02) — cross-context

**Given** a valid invitation for an email that already has an account (whatever the state of its other memberships, and even if that account is already signed in on this device)
**When** the person opens the invitation link
**Then** the system asks them to enter that account's existing password instead of creating a new one, and after they confirm it adds the new membership while their other memberships stay unchanged

### AC-04b (US-02) — authorization

**Given** a person signed in with an account whose email differs from the email the invitation was issued for
**When** they open the invitation link
**Then** the system does not add any membership to the signed-in account and tells them the invitation belongs to another email — sign out and open the link again to accept it

### AC-05 (US-02) — error

**Given** a person accepting a valid invitation
**When** they choose a password shorter than 10 characters
**Then** the system does not create the account and tells them the password must be at least 10 characters long

### AC-05b (US-02) — error <!-- added-by-fix: 2026-10-11 -->

**Given** a person filling in a web panel form: accept invitation, set new password, sign in or invite a member
**When** a field breaks a rule the server enforces for it on that form: a new password of 10–1024 characters (accepting as a new account, setting a new password), an existing account's password of 1–1024 characters (signing in) or of at most 1024 characters (accepting with an existing account), a name of 1–200 characters after trimming (accepting as a new account), or a valid email address (signing in, inviting)
**Then** the panel shows the server's own message for that rule under the field and sends nothing; the same value sent to the server would be refused with the same message

### AC-06 (US-02) — domain invariant

**Given** an invitation that has expired (older than 7 days), was already used, or was revoked or replaced by the business owner
**When** a person opens its link
**Then** the system refuses it, explains that the invitation is no longer valid, and suggests asking for a new one — from a business owner of the workspace, or from the tg-inbox team when it was the first business owner's invitation (only a platform admin re-issues that one)

### AC-07 (US-03) — happy path

**Given** an operator with an active account and at least one active membership
**When** they sign in with the correct email and password
**Then** the system opens the workspace they used last; when they have exactly one active membership it opens that one; when the last-used workspace is no longer available to them (or there is none yet) and they have several active memberships, it shows the list of those workspaces and lets them pick one

### AC-08 (US-03) — error

**Given** a person on the sign-in screen
**When** they enter an unknown email or a wrong password
**Then** the system refuses with the same message in both cases, without revealing whether the email has an account

### AC-09 (US-03) — domain invariant

**Given** 10 failed sign-in attempts for the same email within 15 minutes
**When** anyone tries to sign in to that email again within the next 15 minutes
**Then** the system refuses even a correct password and tells them to try again later — "too many failed attempts"; it behaves exactly the same for an email that has no account, so the lockout never reveals whether an account exists. The 15 minutes count from the 10th failure; a successful sign-in or a password reset clears the failure count

### AC-10 (US-03) — authorization

**Given** an operator whose every membership has been deactivated
**When** they sign in with the correct email and password
**Then** the system tells them they no longer have access to any workspace and shows no workspace data

### AC-11 (US-03) — happy path

**Given** a signed-in operator
**When** they sign out
**Then** their session ends on that device and opening the web panel again asks them to sign in

### AC-12 (US-04) — happy path

**Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently working in "Acme Flowers"
**When** they switch to "Bolt Bikes"
**Then** on that device the panel shows only "Bolt Bikes" data from then on, while their other signed-in devices stay in the workspace they were in; their next sign-in on any device opens "Bolt Bikes"

### AC-13 (US-04) — authorization

**Given** an operator who has never been a member of the "Bolt Bikes" workspace (a deactivated former member is covered by AC-17)
**When** they try to open anything belonging to "Bolt Bikes" (for example through a link a colleague shared)
**Then** the system behaves as if it does not exist — no data, no hint that the workspace or the item exists

### AC-14 (US-05) — happy path

**Given** a business owner of "Acme Flowers"
**When** they invite a new hire's email address as an operator
**Then** a pending invitation valid for 7 days appears in the team list and the owner sees its link to copy once, right after creating it (a lost link is replaced by inviting the same email again); any earlier pending invitation for the same email stops working

### AC-15 (US-05) — authorization

**Given** an operator of "Acme Flowers" who is not a business owner
**When** they try to invite someone or manage the team
**Then** the system refuses and tells them that only business owners manage the team

### AC-16 (US-05) — domain invariant

**Given** a business owner of "Acme Flowers" and a person who already has a membership there (active or deactivated)
**When** the owner invites that person's email
**Then** the system refuses and tells the owner the person is already a member — reactivate them instead if they are deactivated

### AC-17 (US-06) — cross-context

**Given** an operator with active memberships in "Acme Flowers" and "Bolt Bikes", currently signed in to "Acme Flowers"
**When** a business owner of "Acme Flowers" deactivates their membership
**Then** from at most 5 seconds after the deactivation, every action or data load the operator makes in "Acme Flowers" is refused; at the first such refusal the panel removes "Acme Flowers" data from the screen and tells them their access to "Acme Flowers" was removed, then moves them to another workspace where they are active (or to the no-access screen of AC-10 when there is none); their account and their access to "Bolt Bikes" stay intact

### AC-18 (US-06) — domain invariant

**Given** "Acme Flowers" has active business owners
**When** any deactivation — of oneself or of another owner, including two deactivations made at the same moment — would leave the workspace with no active business owner
**Then** the system refuses that deactivation and explains that a workspace must always have at least one active business owner (of two simultaneous deactivations at most the one that keeps an active owner succeeds); an owner may deactivate themselves while another active business owner remains

### AC-19 (US-06) — happy path

**Given** a deactivated member of "Acme Flowers"
**When** a business owner reactivates them
**Then** the member regains access to "Acme Flowers" with the role they had before

### AC-20 (US-07) — happy path

**Given** a business owner of "Acme Flowers" with three members and one pending invitation
**When** they open the team list and revoke the pending invitation
**Then** they see each member's name, email, role and state and each pending invitation's email, role and expiry (but not its link), the revoked invitation disappears from the pending list, and its link stops working

### AC-21 (US-08) — happy path

**Given** a person who forgot the password of their account and asked the tg-inbox team for help
**When** a platform admin issues a password-reset link for that account and the person sets a new valid password through it
**Then** the person is signed in on that device with the new password, every other session of that account ends, the failure count of AC-09 is cleared, and the link cannot be used again; the platform admin sees the link once, right after issuing it, and issuing a new reset link for the same account makes any earlier unused one stop working

### AC-22 (US-08) — domain invariant

**Given** a password-reset link that is older than 24 hours or was already used
**When** a person opens it
**Then** the system refuses it and explains that the reset link is no longer valid

## 6. Non-functional requirements

| Aspect | Target | Measurement |
|---|---|---|
| Latency p95 sign-in | ≤ 500 ms (deliberately slow password check included) | server request-duration logs, weekly p95 |
| Latency p95 team / switch / invite actions | ≤ 300 ms | server request-duration logs, weekly p95 |
| Deactivation takes effect | ≤ 5 s from deactivation until every action or data load of the member in that workspace is refused, on every open session (no proactive push to idle screens in v1) | integration test + manual check per release |
| Availability | 99.5% monthly | uptime check on the health endpoint, monthly window |
| Brute-force protection | ≤ 10 failed sign-in attempts per email per 15 min, then a 15-min lockout | integration test |
| Session lifetime | ends after 30 days without activity (activity = an authenticated request triggered by a user action; automatic background checks do not extend the session); ends at once on sign-out (that device) or password reset (all devices) | integration test |
| Cross-workspace isolation | 0 data reads or writes across workspaces | an isolation test for every data-access path, run in CI |

## 6.1 Security / privacy

- **Data classification:** confidential — account credentials and the membership graph control access to every business's customer data.
- **Email identity:** an email is compared ignoring letter case and surrounding spaces everywhere (accounts, invitations, membership checks, sign-in lockout) — `Bob@x.com` and ` bob@x.com` are the same account.
- **Personal data touched:** account email (identifier, confidential), display name (low), password (secret — never stored or logged in recoverable form, never shown back), workspace name (internal).
- **AuthZ/AuthN impact:** introduces authentication (email + password sessions) and two workspace roles. Every workspace-scoped action checks that the caller has an active membership in the active workspace; team management additionally requires the business owner role; creating workspaces and issuing reset links are platform-admin capabilities outside the web panel.
- **Abuse cases:**
  - Cross-tenant access (opening another workspace's item by link or identifier): hide existence — the item behaves as not found, so workspace names and ids cannot be probed.
  - Credential stuffing / password guessing: 10 failures per email per 15 min → 15-min lockout, applied identically to emails with and without an account; one generic error for unknown email and wrong password (no account enumeration).
  - Forwarded or intercepted invitation link: single use, 7-day expiry, bound to one email (a different signed-in account cannot accept it), revocable, shown only once at creation; the owner sees who joined in the team list.
  - Unverified email ownership (accepted risk): with no mail delivery nobody proves they own the invited email — whoever holds the link becomes that email's account. Mitigated by passing links over a trusted channel and by the owner seeing who joined; revisit together with automatic emails (§3).
  - Former staff keeping access: deactivation cuts access to that workspace within 5 s; a password reset ends every session of the account.
  - Over-reaching business owner: an owner can never reset another person's password or touch that person's other memberships — reset links come only from a platform admin.
- **Security review:** Required — new authentication boundary, new personal data (email, password) and the tenancy boundary every later feature relies on.

## 7. Metrics / KPIs

- **Pilot workspaces with ≥3 active operators** (members who made at least one user action in that workspace during the last 7 days) — baseline: 0, target: ≥5 workspaces within 30 days of onboarding the first pilot.
- **Time from workspace creation to the owner's first sign-in** — baseline: none (no workspaces yet), target: median ≤ 1 day across pilots.
- **Invitation acceptance rate** (accepted ÷ issued, excluding revoked) — baseline: none, target: ≥ 80% accepted within 7 days.
- **Manual password resets** issued by platform admins — baseline: 0, target: ≤ 1 per workspace per month (above that, self-serve reset by email moves up the roadmap).

## 8. Open questions

- [ ] Should operators (not only business owners) see the team list — e.g. to know whom to hand a conversation to? Default now: business owners only. — owner: Dmytro Hopko, due: before roadmap step 5 (assignment) is specified
- [ ] Does a platform admin need to suspend a whole workspace when a pilot ends? Default now: no — deactivate its members instead. — owner: Dmytro Hopko, due: before `sdd:design workspace-operators`
- [ ] When does self-serve password reset by email replace admin-issued reset links? Default now: admin-issued links through the pilot phase. — owner: Dmytro Hopko, due: before onboarding pilot #6
- [ ] Through what channel does a platform admin act (create workspace, re-issue the first owner invitation, issue reset links) and how is the admin authenticated? Default now: a command run on the server by the tg-inbox team — access to the server is the authority, no HTTP surface, every action written to a log. — owner: Dmytro Hopko, due: during `sdd:design workspace-operators`
