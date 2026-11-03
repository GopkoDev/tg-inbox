---
status: Accepted
owner: "Dmytro Hopko (Architect)"
reviewers: ["Tech Lead", "Security Lead"]
updated_at: "2026-11-03"
feature_size: "M"
ticket: "roadmap step 10 — group-posts"
---

# 0001 — Add a posts module that owns destinations, codes and posts and reaches bots and workspaces through their app layers

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dmytro Hopko (autonomous design run; decided by the skill, vetoable at review)

## Context

group-posts adds a new capability area with its own data (destinations, connect codes, posts), screens and a timed job. The codebase is a modular monolith where each roadmap capability is a module (`CLAUDE.md`), only `bots` talks to Telegram, and broadcasts set the precedent of a new module that reaches others through app layers (broadcasts ADR-0001).

## Decision drivers

- Module rule: cross-module calls only through app layers, built in `buildDeps()`; never another module's tables (`CLAUDE.md`).
- Only `bots` holds the token and talks to Telegram (`CLAUDE.md` Telegram rule).
- Spec §6.1: every read and write scoped to the workspace; posts only through the workspace's own bot.

## Considered options

1. **New `posts` module** owning `destinations`, `destination_codes`, `posts`; calls `bots` (send, delete, readiness) and `workspaces` (time zone, membership locks); `bots` hands chat facts back through a late-bound `ChatEventsPort`.
2. **Extend `broadcasts`** with a second kind of target (a chat instead of contacts) — shares the "owner sends through the bot" shape.
3. **Put destinations in `bots`** (a chat is a bot fact) and posts in a new module.

## Decision outcome

**Chosen:** Option 1. Broadcasts' data, states and rules (audiences, recipient lists, per-recipient outcomes) do not fit a single post to one chat, so option 2 would bend both. Option 3 splits one workflow (connect → pick → post) across two modules and puts business rules (who connects, the 20 limit, removal) in the Telegram adapter module.

## Consequences

**Positive**
- One module owns the whole workflow; `bots` stays the Telegram adapter.
- Dependencies stay one-way: `posts → {bots, workspaces}`; the reverse is a runtime port, as the inbound interceptor already is.

**Negative**
- A third late-bound port into `bots` (after the interceptor and the bot-connected hook) — wiring order in `buildDeps()` matters.

**Neutral**
- A future "post to several destinations" or media post stays inside `posts`.

## Links

- Spec: [[../spec.md]] §1, §6.1
- SAD: [[../sad.md]] §4, §5
- Related ADR: [[0003-classify-group-and-channel-updates-in-bots-and-hand-only-codes-membership-upgrades-and-renames-to-posts]]
